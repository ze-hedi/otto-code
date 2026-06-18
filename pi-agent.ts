// pi-agent.ts
// Clean class-based wrapper for Pi coding agent SDK

import fs from "fs";
import os from "os";
import path from "path";
import { Type } from "typebox";
import { Mem0 } from "./mem0.js";
import type { Mem0Config } from "./mem0.js";
import type { McpBridge, McpToolEntry } from "./mcp-bridge.js";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { getModel, Model, type Api, type KnownProvider } from "@mariozechner/pi-ai";
import type { Skill } from "@mariozechner/pi-coding-agent";
import type { TSchema } from "typebox";

// ── Types extracted from AgentSessionEvent union ───────────────────────────────
// This avoids importing from sub-packages (@mariozechner/pi-agent-core, @mariozechner/pi-ai)
// directly — all shapes are derived from the single AgentSessionEvent union.

export type AgentMessage = Extract<AgentSessionEvent, { type: "message_update" }>["message"];
export type AssistantStreamEvent = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];
export type ToolResultMessage = Extract<AgentSessionEvent, { type: "turn_end" }>["toolResults"][number];

// ── Public API types ───────────────────────────────────────────────────────────

export interface SkillInput {
  /** Skill name (used as the file stem and skill identifier) */
  name: string;
  /** Raw markdown content of the skill file */
  content: string;
}

/** Simplified tool input for users of PiAgent wrapper */
export interface ToolInput {
  /** Tool name for LLM calls (e.g., "search_database") */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Description for the LLM to understand when to use this tool */
  description: string;
  /** TypeBox schema for tool parameters */
  parameters: TSchema;
  /** Optional: One-line snippet for "Available tools" section in system prompt */
  promptSnippet?: string;
  /** Optional: Guidelines appended to system prompt */
  promptGuidelines?: string[];
  /** Optional: Execution mode override */
  executionMode?: "sequential" | "parallel";
  /** Execute handler for this tool */
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal
  ) => Promise<{ content: any[]; details?: any }>;
}

export interface PiAgentConfig {
  /** Agent name (used for session file naming) */
  name?: string;
  /** Model provider and name, e.g., "anthropic/claude-sonnet-4-5" */
  model: string;
  /** Additional system prompt appended to Pi's default */
  systemPromptSuffix?: string;
  /** Thinking level: "off" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  /** Optional: override API key at runtime */
  apiKey?: string;
  /** Session persistence: "memory" | "disk" | "continue" */
  sessionMode?: "memory" | "disk" | "continue";
  /** Working directory for disk-based sessions */
  workingDir?: string;
  /** Repository/directory the agent will operate in (cwd for file and shell tools) */
  playground?: string;
  /** Skills to inject into the agent session */
  skills?: SkillInput[];
  /** Custom tools to register at construction time */
  tools?: ToolInput[];
  /** Override directory for session persistence (used by SessionManager.create). */
  sessionDir?: string;
  /** Mem0 configuration. When provided, a Mem0 instance is created with a per-agent history DB. */
  mem0Config?: Mem0Config;
  /** When true, tool calls pause for user approval before executing (default: false) */
  toolCallGuardrails?: boolean;
  /** MCP gateway endpoint URL. When set, call connectMcp() to discover and register tools. */
  mcpEndpoint?: string;
  /** MCP connection timeout in ms (default: 5000). */
  mcpConnectionTimeout?: number;
  /**
   * Which built-in tools the agent is allowed to use.
   * Defaults to ["read", "bash", "edit", "write"] (the SDK default).
   * Pass a subset to restrict (e.g. ["read", "bash", "grep", "ls"] for read-only agents).
   * Pass [] to disable all built-in tools.
   */
  builtInTools?: string[];
  /** Compaction (context compression) settings */
  compaction?: {
    /** Enable/disable auto-compaction (default: true) */
    enabled?: boolean;
    /** Tokens to reserve as headroom before triggering compaction */
    reserveTokens?: number;
    /** How many recent tokens to keep after compaction (not summarized) */
    keepRecentTokens?: number;
    /** Custom instructions appended to the summarization prompt */
    customInstructions?: string;
  };
}

/** Raw event callback — receives the full AgentSessionEvent union. */
export type EventCallback = (event: AgentSessionEvent) => void;
/** Re-exported for consumers who don't want to depend on @mariozechner directly. */
export type AgentEvent = AgentSessionEvent;

// ── PiAgent class ──────────────────────────────────────────────────────────────

export class PiAgent {
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private model: Model<Api>;
  private config: Required<
    Omit<PiAgentConfig, "apiKey" | "workingDir" | "playground" | "model" | "skills" | "tools" | "mem0Config" | "compaction" | "sessionDir" | "name" | "toolCallGuardrails" | "mcpEndpoint" | "mcpConnectionTimeout">
  > & {
    workingDir: string;
    playground: string;
    skills: SkillInput[];
  };
  private currentSession: AgentSession | null = null;
  private skillsTmpDir: string | null = null;
  private toolDefinitions: Map<string, ToolDefinition> = new Map();
  private _hasApiKey: boolean = false;
  private _provider: string = "";
  private _mem0: Mem0 | null = null;
  private _compaction: PiAgentConfig["compaction"];
  private _sessionDir: string | undefined;
  private _name: string | undefined;
  private _toolCallGuardrails: boolean = false;
  private _pendingApprovals: Map<string, { resolve: (approved: boolean) => void; comment?: string }> = new Map();
  private _mcpBridge: McpBridge | null = null;
  private _mcpEndpoint: string | undefined;
  private _mcpConnectionTimeout: number;
  private _mcpToolNames: Set<string> = new Set();
  private _builtInTools: string[];

  constructor(config: PiAgentConfig) {
    const [provider, modelName] = config.model.split("/");
    if (!provider || !modelName) {
      throw new Error(
        `Invalid model format. Expected "provider/model-name", got: ${config.model}`
      );
    }

    this._provider = provider;
    this.authStorage = AuthStorage.create();
    if (config.apiKey) {
      this.authStorage.setRuntimeApiKey(provider, config.apiKey);
      this._hasApiKey = true;
    }
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    const model = getModel(provider as any, modelName as any);
    if (!model) {
      throw new Error(
        `Model not found: ${config.model}. Check provider and model name.`
      );
    }
    this.model = model;

    this.config = {
      systemPromptSuffix: config.systemPromptSuffix ?? "",
      thinkingLevel: config.thinkingLevel ?? "medium",
      sessionMode: config.sessionMode ?? "memory",
      workingDir: config.workingDir ?? process.cwd(),
      playground: config.playground ?? process.cwd(),
      skills: config.skills ?? [],
    };

    // Store optional overrides for session creation
    this._name = config.name;
    this._sessionDir = config.sessionDir;
    this._compaction = config.compaction;
    this._toolCallGuardrails = config.toolCallGuardrails ?? false;
    this._mcpEndpoint = config.mcpEndpoint;
    this._mcpConnectionTimeout = config.mcpConnectionTimeout ?? 5000;
    this._builtInTools = config.builtInTools ?? ["read", "bash", "edit", "write"];

    // Initialize mem0 if configured
    if (config.mem0Config) {
      const agentDir = this.config.workingDir;
      const defaultDbPath = path.join(agentDir, `mem0_${Date.now()}.db`);
      this._mem0 = new Mem0({
        ...config.mem0Config,
        historyDbPath: config.mem0Config.historyDbPath ?? defaultDbPath,
      });
    }

    // Initialize custom tools from config
    this._registerToolsFromConfig(config.tools ?? []);
  }

  // ── Tool Management ────────────────────────────────────────────────────────

  /**
   * Convert ToolInput to ToolDefinition.
   * The execute function delegates to the external handler.
   */
  private _createToolDefinition(toolInput: ToolInput): ToolDefinition {
    return {
      name: toolInput.name,
      label: toolInput.label,
      description: toolInput.description,
      parameters: toolInput.parameters,
      promptSnippet: toolInput.promptSnippet,
      promptGuidelines: toolInput.promptGuidelines,
      executionMode: toolInput.executionMode,

      async execute(toolCallId, params, signal, _onUpdate, _ctx) {
        try {
          const result = await toolInput.execute(toolCallId, params, signal);
          return {
            content: result.content,
            details: result.details ?? {},
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`
            }],
            details: { error: true },
            isError: true,
          };
        }
      },
    };
  }

  /**
   * Register all tools from config by converting ToolInput to ToolDefinition.
   */
  private _registerToolsFromConfig(tools: ToolInput[]): void {
    for (const toolInput of tools) {
      const toolDef = this._createToolDefinition(toolInput);
      this.toolDefinitions.set(toolInput.name, toolDef);
    }
  }

  // ── MCP Tool Definition ────────────────────────────────────────────────────

  private _createMcpToolDefinition(mcpTool: McpToolEntry, bridge: McpBridge): ToolDefinition {
    return {
      name: mcpTool.name,
      label: mcpTool.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: mcpTool.description,
      parameters: Type.Unsafe(mcpTool.inputSchema),
      promptSnippet: `${mcpTool.name}: ${mcpTool.description}`,
      executionMode: "sequential",

      async execute(toolCallId, params, signal) {
        try {
          const result = await bridge.callTool(mcpTool.name, params as Record<string, unknown>);
          return { content: result.content, details: {} };
        } catch (error) {
          return {
            content: [{ type: "text", text: `MCP tool error: ${error instanceof Error ? error.message : String(error)}` }],
            details: { error: true },
            isError: true,
          };
        }
      },
    };
  }

  // ── Session management ─────────────────────────────────────────────────────

  private _writeSkillsToTmp(): { tmpDir: string; skills: Skill[] } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-skills-"));
    const skills: Skill[] = [];

    for (const input of this.config.skills) {
      const safeName =
        input.name
          .toLowerCase()
          .replace(/[\s_]+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .replace(/^-+|-+$/g, "") || "skill";

      const filePath = path.join(tmpDir, `${safeName}.md`);
      fs.writeFileSync(filePath, input.content, "utf-8");

      const descMatch = input.content.match(/^description:\s*(.+)$/m);
      const description = descMatch ? descMatch[1].trim() : input.name;

      skills.push({
        name: safeName,
        description,
        filePath,
        baseDir: tmpDir,
        disableModelInvocation: false,
        sourceInfo: {
          path: filePath,
          source: "otto-agent",
          scope: "temporary",
          origin: "top-level",
          baseDir: tmpDir,
        },
      });
    }

    return { tmpDir, skills };
  }

  private async _createSession(): Promise<AgentSession> {
    const sessionDir = this._sessionDir ?? this.config.workingDir;
    let sessionManager: SessionManager;
    switch (this.config.sessionMode) {
      case "memory":
        sessionManager = SessionManager.inMemory(this.config.playground);
        break;
      case "disk": {
        // Use custom filename: <agentName>_<date>.jsonl
        const safeName = (this._name ?? "agent").replace(/[^a-zA-Z0-9_-]/g, "_");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `${safeName}_${timestamp}.jsonl`;
        const filePath = path.join(sessionDir, filename);
        sessionManager = SessionManager.open(filePath, sessionDir, this.config.playground);
        break;
      }
      case "continue":
        sessionManager = SessionManager.continueRecent(this.config.playground, sessionDir);
        break;
    }
    return this._createSessionWith(sessionManager);
  }

  /**
   * Core session creation: builds resource loader, settings, and calls createAgentSession.
   * Shared by _createSession() and loadSession().
   */
  private async _createSessionWith(sessionManager: SessionManager): Promise<AgentSession> {
    // Always build a resource loader so we can:
    // 1. Scope cwd to the playground (bash tool starting dir, system prompt, settings)
    // 2. Filter out AGENTS.md files from parent directories — the SDK walks up the
    //    directory tree from cwd, which would otherwise leak workspace-level context
    //    into the agent's awareness.
    const agentDir = getAgentDir();
    const playground = this.config.playground;
    const loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0] = {
      cwd: playground,
      agentDir,
      agentsFilesOverride: (base) => ({
        agentsFiles: base.agentsFiles.filter((f) =>
          f.path.startsWith(playground + "/") ||
          f.path.startsWith(playground + path.sep)
        ),
      }),
    };

    if (this.config.systemPromptSuffix) {
      loaderOptions.appendSystemPrompt = [this.config.systemPromptSuffix];
    }

    if (this.config.skills.length > 0) {
      const { tmpDir, skills: injectedSkills } = this._writeSkillsToTmp();
      this.skillsTmpDir = tmpDir;
      loaderOptions.skillsOverride = (base) => ({
        skills: [...base.skills, ...injectedSkills],
        diagnostics: base.diagnostics,
      });
    }

    const resourceLoader = new DefaultResourceLoader(loaderOptions);
    await resourceLoader.reload();

    // Build settings manager with compaction overrides if configured
    const settingsManager = this._compaction
      ? SettingsManager.inMemory({
          compaction: {
            enabled: this._compaction.enabled,
            reserveTokens: this._compaction.reserveTokens,
            keepRecentTokens: this._compaction.keepRecentTokens,
          },
        })
      : undefined;

    const { session } = await createAgentSession({
      cwd: playground,
      model: this.model,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      thinkingLevel: this.config.thinkingLevel,
      resourceLoader,
      tools: [...this._builtInTools, ...this.toolDefinitions.keys()],
      ...(settingsManager ? { settingsManager } : {}),
      ...(this.toolDefinitions.size > 0 ? { customTools: Array.from(this.toolDefinitions.values()) } : {}),
    });

    // Install tool call guardrails hook if enabled
    console.log(`[pi-agent] toolCallGuardrails = ${this._toolCallGuardrails}`);
    if (this._toolCallGuardrails) {
      console.log('[pi-agent] Installing beforeToolCall guardrails hook');
      session.agent.beforeToolCall = async ({ toolCall, args }) => {
        const toolCallId = toolCall.id;
        console.log(`[pi-agent] beforeToolCall fired for ${toolCall.name} (${toolCallId})`);
        // Notify listeners that approval is required
        this._onToolApprovalRequired?.(toolCallId, toolCall.name, args);
        // Block until the user approves or rejects
        const approved = await new Promise<boolean>((resolve) => {
          this._pendingApprovals.set(toolCallId, { resolve });
        });
        if (!approved) {
          const entry = this._pendingApprovals.get(toolCallId);
          const comment = entry?.comment || 'No reason provided';
          this._pendingApprovals.delete(toolCallId);
          return { block: true, reason: `Tool call rejected by user. Reason: ${comment}` };
        }
        this._pendingApprovals.delete(toolCallId);
        return undefined; // proceed with execution
      };
    }

    this.currentSession = session;
    return session;
  }

  // ── Tool call guardrails ───────────────────────────────────────────────────

  /** Callback fired when a tool call requires user approval (set by caller) */
  private _onToolApprovalRequired?: (toolCallId: string, toolName: string, args: unknown) => void;

  /** Register a callback for when tool approval is needed */
  onToolApprovalRequired(cb: (toolCallId: string, toolName: string, args: unknown) => void): void {
    this._onToolApprovalRequired = cb;
  }

  /** Approve a pending tool call — execution proceeds */
  approveToolCall(toolCallId: string): void {
    const entry = this._pendingApprovals.get(toolCallId);
    if (entry) entry.resolve(true);
  }

  /** Reject a pending tool call — LLM sees the rejection reason */
  rejectToolCall(toolCallId: string, comment?: string): void {
    const entry = this._pendingApprovals.get(toolCallId);
    if (entry) {
      entry.comment = comment;
      entry.resolve(false);
    }
  }

  // ── Internal subscribe helper ──────────────────────────────────────────────

  /**
   * Subscribe to `session` with an optional per-call event callback.
   * Returns the unsubscribe function.
   */
  private _subscribe(
    session: AgentSession,
    onEvent?: EventCallback
  ): () => void {
    if (!onEvent) return () => {};
    return session.subscribe(onEvent);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // ── Context Management ────────────────────────────────────────────────────

  private requireSession(): AgentSession {
    if (!this.currentSession) throw new Error('No active session. Call execute() first.');
    return this.currentSession;
  }

  /** Returns token usage details for the current context window. */
  getContextUsage() {
    return this.requireSession().getContextUsage();
  }

  /** Returns full session statistics: total tokens, cost, number of turns, etc. */
  getSessionStats() {
    return this.requireSession().getSessionStats();
  }

  // ── Config & Readiness ────────────────────────────────────────────────────

  /** Returns the resolved config (including all defaults). */
  getConfig() {
    return { model: this.model.id, hasApiKey: this._hasApiKey, ...this.config };
  }

  /**
   * Returns true if the agent is ready to make API calls.
   * For Anthropic models, an explicit API key must be set.
   * For all other providers, it always returns true.
   */
  isApiReady(): boolean {
    if (this._provider === "anthropic") {
      return this._hasApiKey;
    }
    return true;
  }

  /**
   * Register a custom tool with the agent.
   *
   * Tools registered after session creation will be available in the next session
   * created by query() or execute(). For the current chat() session, tools are
   * available immediately if the session hasn't been created yet.
   *
   * @param tool - Tool definition with name, description, and TypeBox parameter schema
   *
   * @example
   * ```typescript
   * import { Type } from "@typebox/typebox";
   *
   * agent.addTool({
   *   name: "search_database",
   *   label: "Search Database",
   *   description: "Search the user database by name or email",
   *   parameters: Type.Object({
   *     query: Type.String({ description: "Search query" }),
   *     limit: Type.Optional(Type.Number({ description: "Max results" })),
   *   }),
   * });
   * ```
   */
  addTool(tool: ToolInput): void {
    if (this.toolDefinitions.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    this.toolDefinitions.set(tool.name, this._createToolDefinition(tool));

    // If session already exists, warn about recreation
    if (this.currentSession) {
      console.warn(
        `Tool "${tool.name}" registered but will only be available in new sessions. ` +
        `Current session must be recreated to use this tool.`
      );
    }
  }

  /**
   * Get all registered custom tool names.
   * @returns Array of tool names
   */
  getRegisteredTools(): string[] {
    return Array.from(this.toolDefinitions.keys());
  }

  /**
   * Check if a tool is registered.
   * @param toolName - Name of the tool to check
   * @returns True if the tool is registered
   */
  hasTool(toolName: string): boolean {
    return this.toolDefinitions.has(toolName);
  }

  /**
   * Remove a custom tool.
   * @param toolName - Name of the tool to remove
   * @returns True if the tool was removed, false if it didn't exist
   */
  removeTool(toolName: string): boolean {
    if (!this.toolDefinitions.has(toolName)) {
      return false;
    }

    this.toolDefinitions.delete(toolName);

    if (this.currentSession) {
      console.warn(
        `Tool "${toolName}" removed but is still available in current session. ` +
        `Create a new session to reflect this change.`
      );
    }

    return true;
  }

  // ── MCP Integration ─────────────────────────────────────────────────────────

  /**
   * Connect to an MCP gateway, discover tools, and register them.
   * Call this before the first chat()/execute() so tools are available in the session.
   * Can be called again to reconnect (old MCP tools are replaced).
   * @param endpoint - Override the configured mcpEndpoint
   * @returns Array of discovered MCP tool names
   */
  async connectMcp(endpoint?: string): Promise<string[]> {
    const url = endpoint ?? this._mcpEndpoint;
    if (!url) throw new Error("No MCP endpoint configured. Set mcpEndpoint in config or pass it to connectMcp().");

    // Tear down previous MCP connection if reconnecting
    if (this._mcpBridge) {
      Array.from(this._mcpToolNames).forEach((name) => this.toolDefinitions.delete(name));
      this._mcpToolNames.clear();
      await this._mcpBridge.close().catch(() => {});
      this._mcpBridge = null;
    }

    const { createMcpBridge } = await import("./mcp-bridge.js");
    const bridge = await createMcpBridge(url, this._mcpConnectionTimeout);
    this._mcpBridge = bridge;

    for (const mcpTool of bridge.tools) {
      if (this.toolDefinitions.has(mcpTool.name)) {
        console.warn(`[pi-agent] MCP tool "${mcpTool.name}" conflicts with existing tool, skipping`);
        continue;
      }
      const toolDef = this._createMcpToolDefinition(mcpTool, bridge);
      this.toolDefinitions.set(mcpTool.name, toolDef);
      this._mcpToolNames.add(mcpTool.name);
    }

    if (this.currentSession) {
      console.warn("[pi-agent] MCP tools registered but require a new session to take effect.");
    }

    return Array.from(this._mcpToolNames);
  }

  /** Disconnect from MCP gateway and unregister all MCP tools. */
  async disconnectMcp(): Promise<void> {
    if (!this._mcpBridge) return;
    Array.from(this._mcpToolNames).forEach((name) => this.toolDefinitions.delete(name));
    this._mcpToolNames.clear();
    await this._mcpBridge.close().catch(() => {});
    this._mcpBridge = null;
  }

  /** Returns true if an MCP bridge is currently connected. */
  isMcpConnected(): boolean {
    return this._mcpBridge !== null;
  }

  /** Returns the list of tool names registered from MCP. */
  getMcpTools(): string[] {
    return Array.from(this._mcpToolNames);
  }

  /**
   * Get or create the persistent session.
   * Subsequent calls reuse the same session (continuous conversation).
   */
  async getSession(): Promise<AgentSession> {
    if (!this.currentSession) {
      await this._createSession();
    }
    return this.currentSession!;
  }

  /**
   * Load a session from a JSONL file. Replaces the current session.
   * The agent resumes with the full conversation history (including compaction summaries).
   * @param sessionPath - Path to the .jsonl session file
   * @param cwdOverride - Optional cwd override (defaults to playground)
   */
  async loadSession(sessionPath: string, cwdOverride?: string): Promise<AgentSession> {
    const sessionManager = SessionManager.open(
      sessionPath,
      undefined,
      cwdOverride ?? this.config.playground
    );
    return this._createSessionWith(sessionManager);
  }

  /**
   * Execute a query on a fresh session and wait for completion.
   * Throws if the stream ends with an error (e.g. API quota exceeded).
   */
  async execute(query: string, onEvent?: EventCallback): Promise<void> {
    const session = await this._createSession();
    let streamError: Error | undefined;
    const unsubError = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "error"
      ) {
        const msg = (event.assistantMessageEvent.error as any)?.errorMessage;
        streamError = new Error(msg ?? "Stream error");
      }
    });
    const unsubscribe = this._subscribe(session, onEvent);
    try {
      await session.prompt(query);
      if (streamError) throw streamError;
    } finally {
      unsubscribe();
      unsubError();
    }
  }

  /**
   * Send a message on the persistent session, preserving conversation history.
   * Subsequent calls reuse the same session so the agent remembers prior turns.
   * Throws if the stream ends with an error.
   */
  async chat(message: string, onEvent?: EventCallback): Promise<void> {
    const session = await this.getSession();
    let streamError: Error | undefined;
    const unsubError = session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "error"
      ) {
        const msg = (event.assistantMessageEvent.error as any)?.errorMessage;
        streamError = new Error(msg ?? "Stream error");
      }
    });
    const unsubscribe = this._subscribe(session, onEvent);
    try {
      await session.prompt(message);
      if (streamError) throw streamError;
    } finally {
      unsubscribe();
      unsubError();
    }

    // Fire-and-forget: feed conversation to mem0 if configured
    if (this._mem0) {
      this._extractMemories(session.messages).catch(err =>
        console.error(`[pi-agent] mem0 extraction failed: ${err.message}`)
      );
    }
  }

  /**
   * Convert session messages to mem0 format and call add().
   * Only text content is kept (tool_use blocks are skipped).
   */
  private async _extractMemories(messages: AgentMessage[]): Promise<void> {
    const mem0Messages: { role: string; content: string }[] = [];
    for (const msg of messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
      }
      if (text.trim()) {
        mem0Messages.push({ role: msg.role, content: text.trim() });
      }
    }
    if (mem0Messages.length === 0) return;
    await this._mem0!.add(mem0Messages);
  }

  /** Get the currently active session (if any) */
  getCurrentSession(): AgentSession | null {
    return this.currentSession;
  }

  /** Set the Mem0 instance for this agent. */
  setMem0(mem0: Mem0): void {
    this._mem0 = mem0;
  }

  /** Get the Mem0 instance (null if not configured). */
  getMem0(): Mem0 | null {
    return this._mem0;
  }

  /** Get the compaction settings (from config or null if using defaults). */
  getCompactionSettings(): PiAgentConfig["compaction"] | null {
    return this._compaction ?? null;
  }

  /** Get all messages from the current session */
  async getMessages(): Promise<AgentMessage[]> {
    const session = await this.getSession();
    return session.messages;
  }
}

// pi-agent.ts
// Clean class-based wrapper for Pi coding agent SDK

// Patch Node.js fetch to route through http_proxy / https_proxy.
// EnvHttpProxyAgent reads HTTP_PROXY, HTTPS_PROXY (and no_proxy) from the environment.
// Unlike ProxyAgent, it routes HTTP and HTTPS through the appropriate proxy when both are set.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new EnvHttpProxyAgent());

import fs from "fs";
import os from "os";
import path from "path";
import { Type } from "typebox";
import type { McpBridge, McpToolEntry } from "../mcp-bridge.js";
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
import { getModel, Model, type Api, type KnownProvider, type ImageContent } from "@mariozechner/pi-ai";
import type { Skill } from "@mariozechner/pi-coding-agent";
import {type EventCallback, SkillInput, ToolInput, SubAgentToolConfig , PersistantSubAgentToolConfig} from "./pi-agent-types"
import {PiAgentConfig} from "./pi-agent-configs"
import { createSubAgentTool } from "./sub-agent-pattern.js";
import { AgentInterface } from './workflow-interface.js';

// ── Types extracted from AgentSessionEvent union ───────────────────────────────
// This avoids importing from sub-packages (@mariozechner/pi-agent-core, @mariozechner/pi-ai)
// directly — all shapes are derived from the single AgentSessionEvent union.

export type AgentMessage = Extract<AgentSessionEvent, { type: "message_update" }>["message"];
export type AssistantStreamEvent = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];
export type ToolResultMessage = Extract<AgentSessionEvent, { type: "turn_end" }>["toolResults"][number];

// ── PiAgent class ──────────────────────────────────────────────────────────────

export class PiAgent {
  protected authStorage: AuthStorage;
  protected modelRegistry: ModelRegistry;
  protected model: Model<Api>;
  protected config: Required<
    Omit<PiAgentConfig, "apiKey" | "workingDir" | "playground" | "model" | "skills" | "tools" | "compaction" | "sessionDir" | "name" | "toolCallGuardrails" | "mcpServers" | "mcpConnectionTimeout" | "builtInTools">
  > & {
    workingDir: string;
    playground: string;
    skills: SkillInput[];
  };
  protected currentSession: AgentSession | null = null;
  protected skillsTmpDir: string | null = null;
  protected toolDefinitions: Map<string, ToolDefinition> = new Map();
  private _hasApiKey: boolean = false;
  protected _provider: string = "";
  protected _compaction: PiAgentConfig["compaction"];
  protected _sessionDir: string | undefined;
  protected _name: string | undefined;
  protected _toolCallGuardrails: Set<string> = new Set();
  protected _pendingApprovals: Map<string, { resolve: (approved: boolean) => void; comment?: string }> = new Map();
  /** Map of server_name → active McpBridge */
  private _mcpBridges: Map<string, McpBridge> = new Map();
  /** Configured server_name → endpoint URL */
  private _mcpServers: Map<string, string> = new Map();
  private _mcpConnectionTimeout: number;
  /** Map of tool_name → server_name (for routing calls to the correct bridge) */
  private _mcpToolServerMap: Map<string, string> = new Map();
  protected _builtInTools: string[];
  /** Full system prompt override (replaces the SDK default when set). */
  protected _systemPrompt: string | undefined;
  /** When true, skip loading AGENTS.md/CLAUDE.md project context files. */
  protected _noContextFiles: boolean = false;
  /** Sub-agent configs keyed by name, converted to tools on demand. */
  protected _subAgents: Map<string, SubAgentToolConfig> = new Map();
  /**  Iterface that we will need in the case of workfow*/
  protected _agentInterfaces : AgentInterface[] ; 


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
    this._agentInterfaces = config.interfaceTools ; 

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
    this._toolCallGuardrails = new Set(config.toolCallGuardrails ?? []);
    if (config.mcpServers) {
      for (const [name, url] of Object.entries(config.mcpServers)) {
        this._mcpServers.set(name, url);
      }
    }
    this._mcpConnectionTimeout = config.mcpConnectionTimeout ?? 5000;
    this._builtInTools = config.builtInTools ?? ["read", "bash", "edit", "write"];

    // Store sub-agent configs
    if (config.subAgents) {
      for (const [key, subAgentConfig] of Object.entries(config.subAgents)) {
        this._subAgents.set(key, subAgentConfig);
      }
    }




    // Initialize custom tools from config
    this._registerToolsFromConfig(config.tools ?? []);
    if ( config.interfaceTools)
      this._registerInterfaceToolsFromConfig(config.interfaceTools) ; 
  }

  // ── Tool Management ────────────────────────────────────────────────────────

  /**
   * Convert ToolInput to ToolDefinition.
   * The execute function delegates to the external handler.
   */
  protected _createToolDefinition(toolInput: ToolInput): ToolDefinition {
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
            terminate : toolInput.terminate
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


  public _createPersistentSubAgentTool(config: PersistantSubAgentToolConfig, agent: PiAgent): ToolInput {
  const parameters = config.parameters ?? Type.Object({
    task: Type.String({ description: "The task and all context the sub-agent needs" }),
  });

  return {
    name: config.name,
    label: config.name.replace(/_/g, " "),
    description: config.description,
    parameters,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const entries = Object.entries(params as Record<string, unknown>);
      const task = entries.map(([k, v]) => {
        const val = Array.isArray(v) ? v.join(", ") : String(v);
        return `${k}: ${val}`;
      }).join("\n\n");

      try {
        await agent.chat(task);

        const messages = await agent.getMessages();
        const last = messages.filter((m) => m.role === "assistant").at(-1);

        let output = "";
        if (last) {
          if (typeof last.content === "string") {
            output = last.content;
          } else if (Array.isArray(last.content)) {
            output = last.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n");
          }
        }

        return { content: [{ type: "text", text: output || "(no output)" }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
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

  /**
   * Register all tools from the interfaces 
  */

  private _registerInterfaceToolsFromConfig(agentInterfaces: AgentInterface[]) : void {
    if (agentInterfaces) 
        for (let agentInterface of agentInterfaces) {
            let tool2Inject = agentInterface?.getTool() ; 
            const toolDef = this._createToolDefinition(tool2Inject) ; 
            this.toolDefinitions.set(tool2Inject.name,toolDef) ; 
      }


  }

  // ── MCP Tool Definition ────────────────────────────────────────────────────

  private _createMcpToolDefinition(mcpTool: McpToolEntry, serverName: string): ToolDefinition {
    // Capture `this` so the execute closure can look up the bridge at call time
    const agent = this;
    return {
      name: mcpTool.name,
      label: mcpTool.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: mcpTool.description,
      parameters: Type.Unsafe(mcpTool.inputSchema),
      promptSnippet: `${mcpTool.name}: ${mcpTool.description}`,
      executionMode: "sequential",

      async execute(toolCallId, params, signal) {
        const bridge = agent._mcpBridges.get(serverName);
        if (!bridge) {
          return {
            content: [{ type: "text", text: `MCP server "${serverName}" is not connected` }],
            details: { error: true },
            isError: true,
          };
        }
        try {
          const result = await bridge.callTool(mcpTool.name, params as Record<string, unknown>);
          return { content: result.content, details: {} };
        } catch (error) {
          return {
            content: [{ type: "text", text: `MCP tool error (${serverName}): ${error instanceof Error ? error.message : String(error)}` }],
            details: { error: true },
            isError: true,
          };
        }
      },
    };
  }

  // ── Session management ─────────────────────────────────────────────────────

  protected _writeSkillsToTmp(): { tmpDir: string; skills: Skill[] } {
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
  protected async _createSessionWith(sessionManager: SessionManager): Promise<AgentSession> {
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
      noContextFiles: this._noContextFiles,
      agentsFilesOverride: (base) => ({
        agentsFiles: base.agentsFiles.filter((f) =>
          f.path.startsWith(playground + "/") ||
          f.path.startsWith(playground + path.sep)
        ),
      }),
    };

    if (this._systemPrompt !== undefined) {
      loaderOptions.systemPrompt = this._systemPrompt;
    }

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
    console.log(`[pi-agent] toolCallGuardrails = [${[...this._toolCallGuardrails].join(', ')}]`);
    if (this._toolCallGuardrails.size > 0) {
      console.log('[pi-agent] Installing beforeToolCall guardrails hook');
      session.agent.beforeToolCall = async ({ toolCall, args }) => {
        // Skip approval for tools not in the guardrails set
        if (!this._toolCallGuardrails.has(toolCall.name)) return undefined;
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
    if (this._agentInterfaces && this._agentInterfaces.length > 0 )
    {
        session.agent.afterToolCall = async ({toolCall, args}) => {
        console.log("########### print message after tool call ######### ") ; 
        console.log(`called tool ${toolCall.name}`)
      }
    }

    this.currentSession = session;
    return session;
  }

  // ── Tool call guardrails ───────────────────────────────────────────────────

  /** Callback fired when a tool call requires user approval (set by caller) */
  protected _onToolApprovalRequired?: (toolCallId: string, toolName: string, args: unknown) => void;

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

  // ── Sub-Agent Tools ───────────────────────────────────────────────────────

  /**
   * Create a single ToolInput from a sub-agent config by key.
   * @param key - The key used in the subAgents config map.
   */
  createSubAgentTool(key: string): ToolInput {
    const config = this._subAgents.get(key);
    if (!config) throw new Error(`Sub-agent "${key}" not found in config`);
    return createSubAgentTool(config);
  }

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
    return {
      model: this.model.id,
      hasApiKey: this._hasApiKey,
      systemPrompt: this._systemPrompt,
      ...this.config,
    };
  }

  /** Returns the current full system prompt override, or `undefined` if using the SDK default. */
  async getSystemPrompt(): Promise<string>  {
    const session = await this.getSession() ; 
    return session.systemPrompt;
  }


  // ── MCP Integration ─────────────────────────────────────────────────────────

  /**
   * Connect to a single MCP server by name, discover tools, and register them.
   * Call this before the first chat()/execute() so tools are available in the session.
   * Can be called again to reconnect (old tools from that server are replaced).
   * @param serverName - Name identifying the MCP server
   * @param endpoint - Endpoint URL (falls back to the configured URL for this serverName)
   * @returns Array of discovered tool names from this server
   */
  async connectMcp(serverName: string, endpoint?: string): Promise<string[]> {
    const url = endpoint ?? this._mcpServers.get(serverName);
    if (!url) throw new Error(`No endpoint configured for MCP server "${serverName}". Set it in mcpServers config or pass it to connectMcp().`);

    // Tear down previous connection for this server if reconnecting
    await this._disconnectServer(serverName);

    // Store/update the endpoint mapping
    this._mcpServers.set(serverName, url);

    const { createMcpBridge } = await import("../mcp-bridge.js");
    const bridge = await createMcpBridge(url, this._mcpConnectionTimeout);
    this._mcpBridges.set(serverName, bridge);

    const registered: string[] = [];
    for (const mcpTool of bridge.tools) {
      if (this.toolDefinitions.has(mcpTool.name)) {
        console.warn(`[pi-agent] MCP tool "${mcpTool.name}" conflicts with existing tool, skipping`);
        continue;
      }
      const toolDef = this._createMcpToolDefinition(mcpTool, serverName);
      this.toolDefinitions.set(mcpTool.name, toolDef);
      this._mcpToolServerMap.set(mcpTool.name, serverName);
      registered.push(mcpTool.name);
    }

    if (this.currentSession) {
      console.warn("[pi-agent] MCP tools registered but require a new session to take effect.");
    }

    return registered;
  }

  /**
   * Connect to all configured MCP servers (from mcpServers config).
   * @returns Map of server_name → array of discovered tool names
   */
  async connectAllMcp(): Promise<Map<string, string[]>> {
    const results = new Map<string, string[]>();
    for (const [name, url] of this._mcpServers) {
      const tools = await this.connectMcp(name, url);
      results.set(name, tools);
    }
    return results;
  }

  /** Internal helper: tear down one server's bridge and unregister its tools. */
  private async _disconnectServer(serverName: string): Promise<void> {
    const bridge = this._mcpBridges.get(serverName);
    if (!bridge) return;

    // Remove tools belonging to this server
    for (const [toolName, sName] of this._mcpToolServerMap) {
      if (sName === serverName) {
        this.toolDefinitions.delete(toolName);
        this._mcpToolServerMap.delete(toolName);
      }
    }

    await bridge.close().catch(() => {});
    this._mcpBridges.delete(serverName);
  }

  /**
   * Disconnect from one or all MCP servers and unregister their tools.
   * @param serverName - If provided, disconnect only that server. Otherwise disconnect all.
   */
  async disconnectMcp(serverName?: string): Promise<void> {
    if (serverName) {
      await this._disconnectServer(serverName);
    } else {
      const names = Array.from(this._mcpBridges.keys());
      for (const name of names) {
        await this._disconnectServer(name);
      }
    }
  }

  /**
   * Returns true if the specified server (or any server, if no name given) is connected.
   */
  isMcpConnected(serverName?: string): boolean {
    if (serverName) return this._mcpBridges.has(serverName);
    return this._mcpBridges.size > 0;
  }

  /**
   * Returns MCP tool names, optionally filtered by server.
   * @param serverName - If provided, return only tools from that server.
   */
  getMcpTools(serverName?: string): string[] {
    if (serverName) {
      return Array.from(this._mcpToolServerMap.entries())
        .filter(([, sName]) => sName === serverName)
        .map(([toolName]) => toolName);
    }
    return Array.from(this._mcpToolServerMap.keys());
  }

  /** Returns the names of all connected MCP servers. */
  getMcpServerNames(): string[] {
    return Array.from(this._mcpBridges.keys());
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
  async execute(
    query: string,
    images?: ImageContent[],
    onEvent?: EventCallback,
  ): Promise<void> {
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
      await session.prompt(query, { images });
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
  }

  /** Get the currently active session (if any) */
  getCurrentSession(): AgentSession | null {
    return this.currentSession;
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


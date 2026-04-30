// pi-agent.ts
// Clean class-based wrapper for Pi coding agent SDK

import fs from "fs";
import os from "os";
import path from "path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { getModel, Model } from "@mariozechner/pi-ai";
import type { Skill } from "@mariozechner/pi-coding-agent";

// ── Types extracted from AgentSessionEvent union ───────────────────────────────
// This avoids importing from sub-packages (@mariozechner/pi-agent-core, @mariozechner/pi-ai)
// directly — all shapes are derived from the single AgentSessionEvent union.

export type AgentMessage = Extract<AgentSessionEvent, { type: "message_update" }>["message"];
export type AssistantStreamEvent = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];
export type ToolResultMessage = Extract<AgentSessionEvent, { type: "turn_end" }>["toolResults"][number];

// ── Granular event handler interface ──────────────────────────────────────────
//
// Each callback maps to one specific event or sub-event.
// Implement only what you need; unknown events are silently ignored.

export interface PiAgentEventHandlers {
  // ── Agent lifecycle ───────────────────────────────────────────────────────
  /** Fired once when a prompt starts processing. */
  onAgentStart?: () => void;
  /** Fired once when the agent becomes idle. Carries the full transcript. */
  onAgentEnd?: (messages: AgentMessage[]) => void;

  // ── Turn lifecycle ────────────────────────────────────────────────────────
  /** Fired at the start of each LLM call (a single prompt can span many turns). */
  onTurnStart?: () => void;
  /** Fired at the end of each LLM call, after all tool results for that turn are ready. */
  onTurnEnd?: (message: AgentMessage, toolResults: ToolResultMessage[]) => void;

  // ── Message streaming (high-level) ────────────────────────────────────────
  /** Fired when streaming begins. `message` is partial. */
  onMessageStart?: (message: AgentMessage) => void;
  /** Fired when streaming completes. `message` is the final, complete assistant message. */
  onMessageEnd?: (message: AgentMessage) => void;

  // ── Message streaming (granular AssistantStreamEvent sub-events) ──────────
  /** Fired on each text token delta. Use this to render streamed text output. */
  onTextDelta?: (delta: string, contentIndex: number, partial: AgentMessage) => void;
  /** Fired when a text block finishes streaming. `content` is the complete block text. */
  onTextEnd?: (content: string, contentIndex: number, partial: AgentMessage) => void;
  /**
   * Fired on each thinking/reasoning token delta.
   * Only fires when thinkingLevel is not "off" and the model supports it.
   */
  onThinkingDelta?: (delta: string, contentIndex: number, partial: AgentMessage) => void;
  /** Fired when a thinking block finishes streaming. `content` is the full reasoning text. */
  onThinkingEnd?: (content: string, contentIndex: number, partial: AgentMessage) => void;
  /**
   * Fired when the model finishes streaming a tool call block.
   * `toolCall` contains the tool name and fully parsed arguments.
   */
  onToolCallStreamed?: (toolCall: any, contentIndex: number, partial: AgentMessage) => void;
  /**
   * Fired when the stream ends normally.
   * reason: "stop" (natural end), "length" (max tokens), "toolUse" (tool calls pending)
   */
  onStreamDone?: (reason: "stop" | "length" | "toolUse", message: AgentMessage) => void;
  /**
   * Fired when the stream ends with an error.
   * reason: "aborted" (cancelled) or "error" (provider/network failure)
   */
  onStreamError?: (reason: "aborted" | "error", error: AgentMessage) => void;

  // ── Tool execution ────────────────────────────────────────────────────────
  /**
   * Fired just before a tool starts executing.
   * In parallel mode, multiple onToolStart events may fire before any onToolEnd.
   * Use toolCallId to correlate with onToolUpdate and onToolEnd.
   */
  onToolStart?: (toolCallId: string, toolName: string, args: any) => void;
  /**
   * Fired during tool execution for tools that stream partial output (e.g. bash stdout).
   * Not all tools emit updates; some go straight from onToolStart to onToolEnd.
   */
  onToolUpdate?: (toolCallId: string, toolName: string, args: any, partialResult: any) => void;
  /**
   * Fired when a tool finishes.
   * `result` is the final AgentToolResult. `isError` is true if the tool threw or was blocked.
   */
  onToolEnd?: (toolCallId: string, toolName: string, result: any, isError: boolean) => void;

  // ── Session-level events ──────────────────────────────────────────────────
  /**
   * Fired whenever the steering or follow-up queues change.
   * steering: messages injected mid-turn (after tool batch, before next LLM call)
   * followUp: messages processed only after the agent would otherwise stop
   */
  onQueueUpdate?: (steering: readonly string[], followUp: readonly string[]) => void;
  /** Fired when context compaction begins. */
  onCompactionStart?: (reason: "manual" | "threshold" | "overflow") => void;
  /** Fired when compaction completes or is aborted. */
  onCompactionEnd?: (
    reason: "manual" | "threshold" | "overflow",
    result: any,
    aborted: boolean,
    willRetry: boolean,
    errorMessage?: string
  ) => void;
  /** Fired when the session display name is set or cleared. */
  onSessionNameChanged?: (name: string | undefined) => void;
  /**
   * Fired when an automatic retry is about to start.
   * Triggered by overload / rate-limit / transient server errors (NOT context overflow).
   */
  onRetryStart?: (
    attempt: number,
    maxAttempts: number,
    delayMs: number,
    errorMessage: string
  ) => void;
  /** Fired when an automatic retry cycle completes — either successfully or after all attempts. */
  onRetryEnd?: (success: boolean, attempt: number, finalError?: string) => void;

  // ── Raw catch-all ─────────────────────────────────────────────────────────
  /** Receives every event, dispatched after all specific handlers above. */
  onEvent?: (event: AgentSessionEvent) => void;
}

// ── Public API types ───────────────────────────────────────────────────────────

export interface SkillInput {
  /** Skill name (used as the file stem and skill identifier) */
  name: string;
  /** Raw markdown content of the skill file */
  content: string;
}

export interface PiAgentConfig {
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
  /** Skills to inject into the agent session */
  skills?: SkillInput[];
  /**
   * Structured event handlers wired into every session automatically.
   * These fire on every call to chat(), execute(), and query().
   * Per-call EventCallback passed to those methods fires alongside these.
   */
  handlers?: PiAgentEventHandlers;
}

/** Raw event callback — receives the full AgentSessionEvent union. */
export type EventCallback = (event: AgentSessionEvent) => void;
/** Re-exported for consumers who don't want to depend on @mariozechner directly. */
export type AgentEvent = AgentSessionEvent;

// ── PiAgent class ──────────────────────────────────────────────────────────────

export class PiAgent {
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private model: Model;
  private config: Required<
    Omit<PiAgentConfig, "apiKey" | "workingDir" | "model" | "skills" | "handlers">
  > & { workingDir: string; skills: SkillInput[]; handlers: PiAgentEventHandlers };
  private currentSession: AgentSession | null = null;
  private skillsTmpDir: string | null = null;

  constructor(config: PiAgentConfig) {
    const [provider, modelName] = config.model.split("/");
    if (!provider || !modelName) {
      throw new Error(
        `Invalid model format. Expected "provider/model-name", got: ${config.model}`
      );
    }

    this.authStorage = AuthStorage.create();
    if (config.apiKey) {
      this.authStorage.setRuntimeApiKey(provider, config.apiKey);
    }
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    const model = getModel(provider, modelName);
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
      skills: config.skills ?? [],
      handlers: config.handlers ?? {},
    };
  }

  // ── Event loop ──────────────────────────────────────────────────────────────

  /**
   * Central event dispatcher.
   *
   * Receives every AgentSessionEvent and routes it to the appropriate handler
   * in `config.handlers`. All specific handlers fire first; `onEvent` fires last
   * as a catch-all.
   *
   * Event groups and their handlers:
   *
   *   Agent lifecycle:
   *     agent_start              → onAgentStart()
   *     agent_end                → onAgentEnd(messages)
   *
   *   Turn lifecycle:
   *     turn_start               → onTurnStart()
   *     turn_end                 → onTurnEnd(message, toolResults)
   *
   *   Message streaming (high-level):
   *     message_start            → onMessageStart(message)
   *     message_end              → onMessageEnd(message)
   *
   *   Message streaming (granular — from AssistantStreamEvent inside message_update):
   *     message_update + text_delta      → onTextDelta(delta, index, partial)
   *     message_update + text_end        → onTextEnd(content, index, partial)
   *     message_update + thinking_delta  → onThinkingDelta(delta, index, partial)
   *     message_update + thinking_end    → onThinkingEnd(content, index, partial)
   *     message_update + toolcall_end    → onToolCallStreamed(toolCall, index, partial)
   *     message_update + done            → onStreamDone(reason, message)
   *     message_update + error           → onStreamError(reason, error)
   *
   *   Tool execution:
   *     tool_execution_start     → onToolStart(id, name, args)
   *     tool_execution_update    → onToolUpdate(id, name, args, partial)
   *     tool_execution_end       → onToolEnd(id, name, result, isError)
   *
   *   Session events:
   *     queue_update             → onQueueUpdate(steering, followUp)
   *     compaction_start         → onCompactionStart(reason)
   *     compaction_end           → onCompactionEnd(reason, result, aborted, willRetry, msg?)
   *     session_info_changed     → onSessionNameChanged(name)
   *     auto_retry_start         → onRetryStart(attempt, max, delayMs, errorMessage)
   *     auto_retry_end           → onRetryEnd(success, attempt, finalError?)
   *
   *   Catch-all:
   *     every event              → onEvent(event)
   */
  private _processEvent(event: AgentSessionEvent): void {
    const h = this.config.handlers;

    switch (event.type) {
      // ── Agent lifecycle ─────────────────────────────────────────────────
      case "agent_start":
        h.onAgentStart?.();
        break;

      case "agent_end":
        h.onAgentEnd?.(event.messages);
        break;

      // ── Turn lifecycle ──────────────────────────────────────────────────
      case "turn_start":
        h.onTurnStart?.();
        break;

      case "turn_end":
        h.onTurnEnd?.(event.message, event.toolResults);
        break;

      // ── Message streaming (high-level) ──────────────────────────────────
      case "message_start":
        h.onMessageStart?.(event.message);
        break;

      case "message_end":
        h.onMessageEnd?.(event.message);
        break;

      // ── Message streaming (granular) ────────────────────────────────────
      // message_update wraps an AssistantStreamEvent sub-event.
      // We fan-out to granular handlers here so callers never need a nested switch.
      case "message_update": {
        const se = event.assistantMessageEvent;
        const msg = event.message;

        switch (se.type) {
          case "text_delta":
            h.onTextDelta?.(se.delta, se.contentIndex, msg);
            break;
          case "text_end":
            h.onTextEnd?.(se.content, se.contentIndex, msg);
            break;
          case "thinking_delta":
            h.onThinkingDelta?.(se.delta, se.contentIndex, msg);
            break;
          case "thinking_end":
            h.onThinkingEnd?.(se.content, se.contentIndex, msg);
            break;
          case "toolcall_end":
            h.onToolCallStreamed?.(se.toolCall, se.contentIndex, msg);
            break;
          case "done":
            h.onStreamDone?.(se.reason, se.message);
            break;
          case "error":
            h.onStreamError?.(se.reason, se.error);
            break;
          // start, text_start, thinking_start, toolcall_start, toolcall_delta:
          // structural markers — no dedicated handler, available via onEvent catch-all
        }
        break;
      }

      // ── Tool execution ──────────────────────────────────────────────────
      case "tool_execution_start":
        h.onToolStart?.(event.toolCallId, event.toolName, event.args);
        break;

      case "tool_execution_update":
        h.onToolUpdate?.(event.toolCallId, event.toolName, event.args, event.partialResult);
        break;

      case "tool_execution_end":
        h.onToolEnd?.(event.toolCallId, event.toolName, event.result, event.isError);
        break;

      // ── Session-level events ────────────────────────────────────────────
      case "queue_update":
        h.onQueueUpdate?.(event.steering, event.followUp);
        break;

      case "compaction_start":
        h.onCompactionStart?.(event.reason);
        break;

      case "compaction_end":
        h.onCompactionEnd?.(
          event.reason,
          event.result,
          event.aborted,
          event.willRetry,
          event.errorMessage
        );
        break;

      case "session_info_changed":
        h.onSessionNameChanged?.(event.name);
        break;

      case "auto_retry_start":
        h.onRetryStart?.(event.attempt, event.maxAttempts, event.delayMs, event.errorMessage);
        break;

      case "auto_retry_end":
        h.onRetryEnd?.(event.success, event.attempt, event.finalError);
        break;
    }

    // Catch-all — always fires last, after all specific handlers
    h.onEvent?.(event);
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
    let sessionManager: SessionManager;
    switch (this.config.sessionMode) {
      case "memory":
        sessionManager = SessionManager.inMemory();
        break;
      case "disk":
        sessionManager = SessionManager.create(this.config.workingDir);
        break;
      case "continue":
        sessionManager = SessionManager.continueRecent(this.config.workingDir);
        break;
    }

    const needsResourceLoader =
      this.config.skills.length > 0 || this.config.systemPromptSuffix;

    let resourceLoader: DefaultResourceLoader | undefined;
    if (needsResourceLoader) {
      const agentDir = getAgentDir();
      const loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0] = {
        cwd: this.config.workingDir,
        agentDir,
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

      resourceLoader = new DefaultResourceLoader(loaderOptions);
      await resourceLoader.reload();
    }

    const { session } = await createAgentSession({
      model: this.model,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      thinkingLevel: this.config.thinkingLevel,
      ...(resourceLoader ? { resourceLoader } : {}),
    });

    this.currentSession = session;
    return session;
  }

  // ── Internal subscribe helper ──────────────────────────────────────────────

  /**
   * Subscribe to `session` with both the internal event loop and an optional
   * per-call raw callback. Returns the combined unsubscribe function.
   */
  private _subscribe(
    session: AgentSession,
    onEvent?: EventCallback
  ): () => void {
    // Internal structured event loop — always active
    const unsubLoop = session.subscribe((event) => this._processEvent(event));
    // Optional raw per-call callback
    const unsubRaw = onEvent ? session.subscribe(onEvent) : undefined;

    return () => {
      unsubLoop();
      unsubRaw?.();
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns the resolved config (including all defaults). */
  getConfig() {
    return { model: this.model.id, ...this.config };
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
   * Send a message to the persistent session and stream events back.
   * Creates the session on first call; reuses it on subsequent calls.
   * The event listeners are automatically removed after the prompt resolves.
   */
  async chat(message: string, onEvent?: EventCallback): Promise<void> {
    const session = await this.getSession();
    const unsubscribe = this._subscribe(session, onEvent);
    try {
      await session.prompt(message);
    } finally {
      unsubscribe();
    }
  }

  /**
   * Execute a query on a fresh session and return it for further interaction.
   * Fires-and-forgets the prompt; subscribe before calling session.prompt() yourself
   * if you need to await completion.
   */
  async query(query: string, onEvent?: EventCallback): Promise<AgentSession> {
    const session = await this._createSession();
    this._subscribe(session, onEvent);
    session.prompt(query);
    return session;
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

  /** Get the currently active session (if any) */
  getCurrentSession(): AgentSession | null {
    return this.currentSession;
  }
}

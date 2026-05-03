// claude-code-agent.ts
// TypeScript wrapper for the Claude CLI — uses your Pro/Max subscription,
// no API tokens required.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Config ─────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeCodeAgentConfig {
  /** Replaces the default Claude Code system prompt. */
  systemPrompt?: string;
  /** Model to use, e.g. "claude-sonnet-4-6". Defaults to CLI default. */
  model?: string;
  /** Cap the agentic loop. Maps to --max-turns. */
  maxTurns?: number;
  /** Permission mode. Maps to --permission-mode. */
  permissionMode?: "auto" | "default" | "acceptEdits" | "bypassPermissions";
  /**
   * MCP servers to make available. Written to a temp .mcp.json file and
   * passed via --mcp-config. Cleaned up automatically after each run.
   */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Whitelist of built-in Claude Code tools Claude may use.
   * Maps to --allowedTools tool1,tool2,...
   * Example: ["Read", "Bash", "Grep"]
   */
  allowedTools?: string[];
}

// ── Events ─────────────────────────────────────────────────────────────────────

/** First event emitted before any turn. Carries session bootstrap info. */
export type ClaudeSystemEvent = {
  type: "system";
  subtype: "init";
  sessionId: string;
  model: string;
  tools: string[];
  cwd: string;
  apiKeySource: string;
};

/** Text content from an assistant turn. In stream-json mode this is the full
 *  text block of a turn, not a character-level token. */
export type ClaudeTextEvent = { type: "text"; delta: string };

/** Extended-thinking content emitted before the assistant's reply. */
export type ClaudeThinkingEvent = { type: "thinking"; thinking: string };

/** A tool invocation Claude decided to make. */
export type ClaudeToolStartEvent = { type: "tool_start"; name: string; input: unknown };

/** The result returned to Claude after a tool executed. */
export type ClaudeToolResultEvent = { type: "tool_result"; content: string; isError: boolean };

/** Final event emitted when the agent stops. Contains the full response and
 *  billing info. The session ID is also stored on the agent for resumption. */
export type ClaudeResultEvent = {
  type: "result";
  subtype: "success" | "error_during_execution" | "max_turns_reached";
  text: string;
  sessionId: string;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  isError: boolean;
};

/** Emitted when the CLI exits with a non-zero code or writes to stderr. */
export type ClaudeErrorEvent = { type: "error"; message: string };

export type ClaudeEvent =
  | ClaudeSystemEvent
  | ClaudeTextEvent
  | ClaudeThinkingEvent
  | ClaudeToolStartEvent
  | ClaudeToolResultEvent
  | ClaudeResultEvent
  | ClaudeErrorEvent;

// ── Agent ──────────────────────────────────────────────────────────────────────

export class ClaudeCodeAgent {
  private config: ClaudeCodeAgentConfig;
  private sessionId: string | null = null;

  constructor(config: ClaudeCodeAgentConfig = {}) {
    this.config = config;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Run a prompt and stream typed events as they arrive.
   *
   * @example
   * ```ts
   * for await (const event of agent.run("List the files here")) {
   *   if (event.type === "text")   process.stdout.write(event.delta);
   *   if (event.type === "result") console.log("\ncost:", event.costUsd);
   * }
   * ```
   */
  async *run(prompt: string): AsyncGenerator<ClaudeEvent> {
    const args = this._buildArgs(prompt);
    let tmpMcpPath: string | null = null;

    if (this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0) {
      tmpMcpPath = path.join(os.tmpdir(), `claude-mcp-${Date.now()}-${process.pid}.json`);
      fs.writeFileSync(tmpMcpPath, JSON.stringify({ mcpServers: this.config.mcpServers }));
      args.push("--mcp-config", tmpMcpPath);
    }

    try {
      yield* this._spawnAndStream(args);
    } finally {
      if (tmpMcpPath) {
        try { fs.unlinkSync(tmpMcpPath); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Set the session ID to resume on the next `run()` call.
   * Returns `this` for fluent chaining:
   * ```ts
   * agent.resume(agent.getSessionId()!).run("follow-up question")
   * ```
   */
  resume(sessionId: string): this {
    this.sessionId = sessionId;
    return this;
  }

  /** Returns the session ID captured from the last `result` event, or null. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private _buildArgs(prompt: string): string[] {
    const args: string[] = ["-p", prompt, "--output-format", "stream-json", "--verbose"];

    if (this.config.systemPrompt)   args.push("--system-prompt", this.config.systemPrompt);
    if (this.config.model)          args.push("--model", this.config.model);
    if (this.config.maxTurns != null) args.push("--max-turns", String(this.config.maxTurns));
    if (this.config.permissionMode) args.push("--permission-mode", this.config.permissionMode);
    if (this.config.allowedTools?.length) {
      args.push("--allowedTools", this.config.allowedTools.join(","));
    }
    if (this.sessionId) args.push("--resume", this.sessionId);

    return args;
  }

  private async *_spawnAndStream(args: string[], timeoutMs = 120_000): AsyncGenerator<ClaudeEvent> {
    // Simple async queue: producers push to `pending`, consumers await `notify`.
    const pending: ClaudeEvent[] = [];
    let notify: (() => void) | null = null;
    let closed = false;

    const push = (...events: ClaudeEvent[]) => {
      pending.push(...events);
      notify?.();
      notify = null;
    };

    const proc = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });

    // Kill the process and emit an error if it doesn't finish within timeoutMs.
    const timer = setTimeout(() => {
      if (!closed) {
        proc.kill();
        push({ type: "error", message: `Claude CLI timed out after ${timeoutMs / 1000}s` });
      }
    }, timeoutMs);

    let lineBuffer = "";
    let stderrBuffer = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!; // last (possibly incomplete) line stays buffered
      for (const line of lines) {
        const events = this._parseLine(line);
        if (events.length) push(...events);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      // Flush any remaining buffered content
      if (lineBuffer.trim()) {
        const events = this._parseLine(lineBuffer);
        if (events.length) push(...events);
      }
      if (code !== 0 && stderrBuffer.trim()) {
        push({ type: "error", message: stderrBuffer.trim() });
      }
      closed = true;
      notify?.();
      notify = null;
    });

    // Drain the queue until the process closes and nothing is left
    while (!closed || pending.length > 0) {
      if (pending.length > 0) {
        yield pending.shift()!;
      } else {
        await new Promise<void>((resolve) => { notify = resolve; });
      }
    }
  }

  /**
   * Parse one line of stream-json output into zero or more typed events.
   * Silently skips lines that are not valid JSON or have unknown shapes.
   */
  private _parseLine(line: string): ClaudeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let raw: any;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return [];
    }

    const events: ClaudeEvent[] = [];

    switch (raw.type) {
      case "system": {
        if (raw.subtype === "init") {
          const sessionId = raw.session_id ?? "";
          if (sessionId) this.sessionId = sessionId;
          events.push({
            type: "system",
            subtype: "init",
            sessionId,
            model: raw.model ?? "",
            tools: raw.tools ?? [],
            cwd: raw.cwd ?? "",
            apiKeySource: raw.api_key_source ?? "",
          });
        }
        break;
      }

      case "assistant": {
        const blocks: any[] = raw.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "text" && typeof block.text === "string") {
            events.push({ type: "text", delta: block.text });
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            events.push({ type: "thinking", thinking: block.thinking });
          } else if (block.type === "tool_use" && block.name) {
            events.push({ type: "tool_start", name: block.name, input: block.input ?? {} });
          }
        }
        break;
      }

      case "user": {
        const blocks: any[] = raw.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "tool_result") {
            const content = Array.isArray(block.content)
              ? block.content.map((c: any) => (typeof c.text === "string" ? c.text : "")).join("")
              : typeof block.content === "string"
                ? block.content
                : "";
            events.push({ type: "tool_result", content, isError: block.is_error ?? false });
          }
        }
        break;
      }

      case "result": {
        const sessionId = raw.session_id ?? "";
        if (sessionId) this.sessionId = sessionId;
        events.push({
          type: "result",
          subtype: raw.subtype ?? "success",
          text: raw.result ?? "",
          sessionId,
          costUsd: raw.total_cost_usd ?? 0,
          durationMs: raw.duration_ms ?? 0,
          numTurns: raw.num_turns ?? 0,
          usage: {
            inputTokens: raw.usage?.input_tokens ?? 0,
            outputTokens: raw.usage?.output_tokens ?? 0,
            cacheReadInputTokens: raw.usage?.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: raw.usage?.cache_creation_input_tokens ?? 0,
          },
          isError: raw.is_error ?? false,
        });
        break;
      }
    }

    return events;
  }
}

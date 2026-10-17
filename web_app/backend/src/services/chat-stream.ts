import type { Response } from "express";
import type { RawPiAgent } from "../../../../agents/raw-pi-agent.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import {
  getAgentBusyState, getAgentEmitter, getSessionKey, markBusy, markIdle,
} from "./agent-state.js";
import { setClarificationCallback } from "./clarification.js";

// SSE chat plumbing shared by the in-process /agents routes and the container runner.

function openSse(res: Response, opts: { noBuffering?: boolean } = {}): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (opts.noBuffering) res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function writeEvent(res: Response, payload: object): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  (res.socket as any)?.flush?.();
  (res as any).flush?.();
}

/** Streams one chat turn to `res` and publishes every event on the agent's reconnection bus. */
export async function streamChat(
  agentId: string,
  agent: RawPiAgent,
  message: string,
  res: Response,
): Promise<void> {
  const sessionKey = getSessionKey(agentId);
  const emitter = markBusy(agentId, sessionKey);

  openSse(res, { noBuffering: true });

  let closed = false;
  res.on("close", () => { closed = true; console.log("[chat] client disconnected"); });

  const send = (payload: object) => {
    if (!closed) {
      console.log("[chat] SSE send:", JSON.stringify(payload).slice(0, 200));
      writeEvent(res, payload);
    }
  };

  // Wire tool approval SSE event
  agent.onToolApprovalRequired((toolCallId, toolName, args) => {
    const payload = { type: "tool_approval_required", toolCallId, name: toolName, args };
    send(payload);
    emitter.emit("event", payload);
  });

  // Wire clarification tool SSE event
  setClarificationCallback(agentId, (toolCallId, questions) => {
    const payload = { type: "clarification_required", toolCallId, questions };
    send(payload);
    emitter.emit("event", payload);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      agent.chat(message, (event) => {
        handleEventWithClient(event, send);
        // Broadcast to event bus so reconnecting clients receive events
        handleEventWithClient(event, (payload) => emitter.emit("event", payload));
        if (event.type === "agent_end") resolve();
      }, sessionKey).catch(reject);
    });
  } catch (err: any) {
    console.error("[chat] error:", err);
    send({ type: "error", message: err?.message ?? String(err) });
  } finally {
    markIdle(agentId);
    res.end();
  }
}

/** Re-attaches a client to an in-flight chat turn (or reports `agent_idle`). */
export function streamReconnect(agentId: string, res: Response): void {
  const state = getAgentBusyState(agentId);
  const emitter = state.busy ? getAgentEmitter(agentId) : undefined;

  if (!emitter) {
    openSse(res);
    res.write(`data: ${JSON.stringify({ type: "agent_idle" })}\n\n`);
    res.end();
    return;
  }

  openSse(res, { noBuffering: true });

  const onEvent = (payload: object) => writeEvent(res, payload);
  const onDone = () => {
    res.write(`data: ${JSON.stringify({ type: "agent_idle" })}\n\n`);
    res.end();
  };

  emitter.on("event", onEvent);
  emitter.once("done", onDone);

  res.on("close", () => {
    emitter.off("event", onEvent);
    emitter.off("done", onDone);
  });
}

// ── Message history ─────────────────────────────────────────────────────────

export interface ChatPart {
  type: "thinking" | "text" | "tool";
  content?: string;
  name?: string;
  input?: string;
  result?: string;
  isError?: boolean;
  status?: "running" | "done";
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  parts: ChatPart[];
}

export function transformMessages(rawMessages: any[]): ChatMsg[] {
  const out: ChatMsg[] = [];

  // Collect tool results keyed by toolCallId for look-ahead attachment
  const toolResults = new Map<string, { content: string; isError: boolean }>();
  for (const msg of rawMessages) {
    if (msg.role === "toolResult") {
      const text = Array.isArray(msg.content)
        ? msg.content.map((c: any) => c.text ?? "").join("\n")
        : String(msg.content ?? "");
      const trimmed = text.length > 1500 ? text.slice(0, 1500) + "\n... (truncated)" : text;
      toolResults.set(msg.toolCallId, { content: trimmed, isError: !!msg.isError });
    }
  }

  for (const msg of rawMessages) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c: any) => c.text ?? "").join("\n")
          : "";
      out.push({ role: "user", content: text, parts: [] });
    } else if (msg.role === "assistant") {
      const parts: ChatPart[] = [];
      for (const block of msg.content ?? []) {
        if (block.type === "thinking") {
          parts.push({ type: "thinking", content: block.thinking });
        } else if (block.type === "text") {
          parts.push({ type: "text", content: block.text });
        } else if (block.type === "toolCall") {
          const tr = toolResults.get(block.id);
          parts.push({
            type: "tool",
            name: block.name,
            input: JSON.stringify(block.arguments, null, 2),
            result: tr?.content,
            isError: tr?.isError,
            status: "done",
          });
        }
      }
      out.push({ role: "assistant", content: "", parts });
    }
    // skip toolResult, bashExecution, compactionSummary, etc.
  }

  return out;
}

import { apiUrl } from "../api/client";
import * as api from "../api/agents";
import { readSSE, SSEHttpError } from "../sse/readSSE";
import { applyEvent } from "./eventReducer";
import {
  getChat,
  patchChat,
  setMessages,
  updateLastAssistantParts,
  updatePart,
  useChatStore,
} from "./chatStore";

/**
 * Owns every stream. Screens only read the store, so a chat keeps streaming
 * when the user navigates away. Backend rule: one stream per agent, so the
 * connection key is simply the agentId.
 */
const connections = new Map<string, AbortController>();

const isLive = (agentId: string) => connections.has(agentId);

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Drains an SSE stream into the store. Resolves when the server closes it. */
async function consume(agentId: string, stream: AsyncGenerator<any>) {
  for await (const ev of stream) {
    if (ev?.type === "agent_idle") break;
    updateLastAssistantParts(agentId, (parts) => applyEvent(parts, ev));
  }
}

function startConnection(agentId: string): AbortController {
  connections.get(agentId)?.abort();
  const controller = new AbortController();
  connections.set(agentId, controller);
  patchChat(agentId, { status: "streaming", error: undefined });
  return controller;
}

async function finish(agentId: string, controller: AbortController, error?: unknown) {
  // A newer connection replaced this one (resync) — it owns the state now.
  if (connections.get(agentId) !== controller) return;
  connections.delete(agentId);
  if (controller.signal.aborted) {
    patchChat(agentId, { status: "idle" });
    return;
  }
  if (error) {
    patchChat(agentId, { status: "disconnected", error: errMessage(error) });
    return;
  }
  patchChat(agentId, { status: "idle" });
  // Settle on the server's canonical history (also fills any missed tokens).
  try {
    setMessages(agentId, await api.getMessages(agentId));
  } catch {}
}

async function attach(agentId: string) {
  const controller = startConnection(agentId);
  try {
    await consume(
      agentId,
      readSSE(apiUrl(`/agents/${agentId}/events`), { signal: controller.signal }),
    );
    await finish(agentId, controller);
  } catch (e) {
    await finish(agentId, controller, e);
  }
}

/** Loads history and reattaches to a running chat. No-op if already live. */
export async function openChat(agentId: string) {
  if (isLive(agentId)) return;
  try {
    const [messages, status] = await Promise.all([api.getMessages(agentId), api.getStatus(agentId)]);
    setMessages(agentId, messages);
    patchChat(agentId, { loaded: true, error: undefined });
    if (status.busy) {
      // The in-flight assistant turn may not be in history yet; the reducer
      // creates the slot when the first event arrives.
      void attach(agentId);
    } else {
      patchChat(agentId, { status: "idle" });
    }
  } catch (e) {
    patchChat(agentId, { loaded: true, status: "disconnected", error: errMessage(e) });
  }
}

/** Drops a possibly dead socket and re-runs the open flow. */
export async function resync(agentId: string) {
  connections.get(agentId)?.abort();
  connections.delete(agentId);
  await openChat(agentId);
}

/** Called when the app returns to the foreground. */
export function resyncAll() {
  const { chats } = useChatStore.getState();
  for (const chat of Object.values(chats)) {
    if (chat.status !== "idle") void resync(chat.agentId);
  }
}

export async function sendMessage(agentId: string, text: string) {
  const message = text.trim();
  if (!message || getChat(agentId).status === "streaming") return;

  const chat = getChat(agentId);
  setMessages(agentId, [
    ...chat.messages,
    { role: "user", content: message, parts: [] },
    { role: "assistant", content: "", parts: [] },
  ]);

  const controller = startConnection(agentId);
  try {
    await consume(
      agentId,
      readSSE(apiUrl(`/agents/${agentId}/chat`), {
        method: "POST",
        body: { message },
        signal: controller.signal,
      }),
    );
    await finish(agentId, controller);
  } catch (e) {
    if (e instanceof SSEHttpError && e.status === 409) {
      // Already running elsewhere (e.g. the web app): watch it instead.
      connections.delete(agentId);
      await resync(agentId);
      return;
    }
    await finish(agentId, controller, e);
  }
}

export async function stopChat(agentId: string) {
  try {
    await api.stopAgent(agentId);
  } catch (e) {
    patchChat(agentId, { error: errMessage(e) });
  }
}

export async function approveTool(agentId: string, toolCallId: string) {
  updatePart(agentId, toolCallId, (p) => (p.type === "tool_approval" ? { ...p, status: "approved" } : p));
  try {
    await api.approveTool(agentId, toolCallId);
  } catch (e) {
    patchChat(agentId, { error: errMessage(e) });
  }
}

export async function rejectTool(agentId: string, toolCallId: string, comment?: string) {
  updatePart(agentId, toolCallId, (p) => (p.type === "tool_approval" ? { ...p, status: "rejected" } : p));
  try {
    await api.rejectTool(agentId, toolCallId, comment);
  } catch (e) {
    patchChat(agentId, { error: errMessage(e) });
  }
}

export async function answerClarification(agentId: string, toolCallId: string, answers: string[]) {
  updatePart(agentId, toolCallId, (p) =>
    p.type === "clarification" ? { ...p, answers, status: "answered" } : p,
  );
  try {
    await api.answerClarification(agentId, toolCallId, answers);
  } catch (e) {
    patchChat(agentId, { error: errMessage(e) });
  }
}

/** Sessions of one agent are sequential: switching is refused while streaming. */
export async function startNewSession(agentId: string) {
  if (getChat(agentId).status === "streaming") throw new Error("Agent is busy");
  await api.newSession(agentId);
  setMessages(agentId, []);
}

export async function resumeSession(agentId: string, filename: string) {
  if (getChat(agentId).status === "streaming") throw new Error("Agent is busy");
  await api.loadSession(agentId, filename);
  setMessages(agentId, await api.getMessages(agentId));
}

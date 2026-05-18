import { createContext, useContext, useCallback, useSyncExternalStore } from 'react';

// ── Internal store (lives outside React's tree, survives navigation) ─────────

/**
 * Per-session shape held in the store.
 * @typedef {{
 *   agentId: string,
 *   agentName: string,
 *   messages: Array,
 *   streaming: boolean,
 *   error: string|null,
 *   hydrated: boolean,
 *   createdAt: number,
 *   toolCallCounts: Object,
 * }} ChatSession
 */

/** Map<sessionId, ChatSession> */
const sessions = new Map();

/** Map<agentId, Set<sessionId>> — index for looking up all sessions of an agent */
const agentSessions = new Map();

/** Set of subscriber callbacks (called on any mutation) */
const listeners = new Set();

function emit() {
  for (const cb of listeners) cb();
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      agentId: null,
      agentName: '',
      messages: [],
      streaming: false,
      error: null,
      hydrated: false,
      createdAt: Date.now(),
      toolCallCounts: {},
    });
  }
  return sessions.get(sessionId);
}

function updateSession(sessionId, updater) {
  const s = getSession(sessionId);
  const patch = typeof updater === 'function' ? updater(s) : updater;
  sessions.set(sessionId, { ...s, ...patch });
  emit();
}

function updateMessages(sessionId, updater) {
  const s = getSession(sessionId);
  sessions.set(sessionId, { ...s, messages: updater(s.messages) });
  emit();
}

// ── Session management ──────────────────────────────────────────────────────

function createSession(agentId, sessionId, agentName) {
  sessions.set(sessionId, {
    agentId,
    agentName: agentName || '',
    messages: [],
    streaming: false,
    error: null,
    hydrated: false,
    createdAt: Date.now(),
    toolCallCounts: {},
  });

  if (!agentSessions.has(agentId)) {
    agentSessions.set(agentId, new Set());
  }
  agentSessions.get(agentId).add(sessionId);
  emit();
}

function removeSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s?.agentId && agentSessions.has(s.agentId)) {
    agentSessions.get(s.agentId).delete(sessionId);
  }
  sessions.delete(sessionId);
  emit();
}

function getAgentSessions(agentId) {
  const sids = agentSessions.get(agentId);
  if (!sids || sids.size === 0) return [];
  const result = [];
  for (const sid of sids) {
    const s = sessions.get(sid);
    if (s) {
      result.push({
        sessionId: sid,
        agentId: s.agentId,
        agentName: s.agentName,
        messageCount: s.messages.length,
        streaming: s.streaming,
        createdAt: s.createdAt,
      });
    }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt);
}

// ── Message helpers ─────────────────────────────────────────────────────────

function appendDelta(sessionId, text) {
  updateMessages(sessionId, (prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === 'assistant' && last.streaming) {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }];
    }
    const closed = prev.map((m) =>
      m.role === 'thinking' && m.streaming ? { ...m, streaming: false } : m
    );
    return [...closed, { role: 'assistant', text, streaming: true, id: Date.now() }];
  });
}

function appendThinkingDelta(sessionId, text) {
  updateMessages(sessionId, (prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === 'thinking' && last.streaming) {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }];
    }
    const id = Date.now() + Math.random();
    return [...prev, { role: 'thinking', text, streaming: true, id }];
  });
}

function finalizeAssistant(sessionId) {
  updateMessages(sessionId, (prev) =>
    prev.map((m) =>
      (m.role === 'assistant' || m.role === 'thinking') && m.streaming
        ? { ...m, streaming: false }
        : m
    )
  );
}

function appendToolStart(sessionId, event) {
  const s = getSession(sessionId);

  // If the approval flow already created a tool message for this call, skip the duplicate
  if (s.messages.some((m) => m.role === 'tool' && !m.done && m.name === event.name)) return;

  // Increment per-tool counter
  const counts = { ...s.toolCallCounts };
  counts[event.name] = (counts[event.name] || 0) + 1;
  sessions.set(sessionId, { ...s, toolCallCounts: counts });

  updateMessages(sessionId, (prev) => [
    ...prev,
    { role: 'tool', name: event.name, args: event.args, result: null, isError: false, done: false, id: Date.now() + Math.random() },
  ]);
}

function appendToolEnd(sessionId, event) {
  updateMessages(sessionId, (prev) => {
    const idx = prev.findLastIndex((m) => m.role === 'tool' && !m.done);
    if (idx === -1) return prev;
    const updated = [...prev];
    updated[idx] = { ...updated[idx], result: event.result, isError: event.isError, done: true, pendingApproval: false };
    return updated;
  });
}

function markToolPendingApproval(sessionId, event) {
  // beforeToolCall fires BEFORE tool_execution_start, so the tool message may not exist yet.
  // If it does exist (tool_start arrived first), tag it. Otherwise, create it directly.
  console.log('[chat] tool_approval_required received:', event.name, event.toolCallId);
  updateMessages(sessionId, (prev) => {
    const idx = prev.findLastIndex((m) => m.role === 'tool' && !m.done && m.name === event.name);
    console.log('[chat] findLastIndex result:', idx, 'messages count:', prev.length, 'looking for name:', event.name);
    if (idx === -1) {
      // No tool message yet — create one with pendingApproval already set
      return [...prev, {
        role: 'tool', name: event.name, args: event.args,
        result: null, isError: false, done: false,
        pendingApproval: true, toolCallId: event.toolCallId,
        id: Date.now() + Math.random(),
      }];
    }
    const updated = [...prev];
    updated[idx] = { ...updated[idx], pendingApproval: true, toolCallId: event.toolCallId };
    return updated;
  });
}

function resolveToolApproval(sessionId, toolCallId) {
  updateMessages(sessionId, (prev) => {
    const idx = prev.findLastIndex((m) => m.role === 'tool' && m.toolCallId === toolCallId && m.pendingApproval);
    if (idx === -1) return prev;
    const updated = [...prev];
    updated[idx] = { ...updated[idx], pendingApproval: false };
    return updated;
  });
}

// ── Hydrate from server ─────────────────────────────────────────────────────

function hydrateFromServer(sessionId) {
  const s = getSession(sessionId);
  if (s.hydrated || s.messages.length > 0) return;
  sessions.set(sessionId, { ...s, hydrated: true });

  fetch(`http://localhost:5000/runtime/agents/${sessionId}/messages`)
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then((serverMsgs) => {
      if (!serverMsgs?.length) return;
      if (getSession(sessionId).messages.length > 0) return;

      const hydrated = [];
      for (const msg of serverMsgs) {
        if (msg.role === 'user') {
          const text = typeof msg.content === 'string'
            ? msg.content
            : msg.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '';
          hydrated.push({ role: 'user', text, id: Date.now() + Math.random() });
        } else if (msg.role === 'assistant') {
          const blocks = msg.content || [];
          for (const b of blocks) {
            if (b.type === 'thinking') {
              hydrated.push({ role: 'thinking', text: b.thinking, streaming: false, id: Date.now() + Math.random() });
            } else if (b.type === 'tool_use') {
              hydrated.push({ role: 'tool', name: b.name, args: b.input, result: null, isError: false, done: false, id: Date.now() + Math.random() });
            } else if (b.type === 'text') {
              hydrated.push({ role: 'assistant', text: b.text, streaming: false, id: Date.now() + Math.random() });
            }
          }
        } else if (msg.role === 'toolResult') {
          const resultText = typeof msg.content === 'string'
            ? msg.content
            : msg.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '';
          const idx = hydrated.findLastIndex((m) => m.role === 'tool' && !m.done);
          if (idx !== -1) {
            hydrated[idx] = { ...hydrated[idx], result: resultText, isError: !!msg.isError, done: true };
          }
        }
      }
      if (hydrated.length > 0) {
        // Build tool call counts from hydrated messages
        const counts = {};
        for (const m of hydrated) {
          if (m.role === 'tool') {
            counts[m.name] = (counts[m.name] || 0) + 1;
          }
        }
        const cur = getSession(sessionId);
        sessions.set(sessionId, { ...cur, messages: hydrated, toolCallCounts: counts });
        emit();
      }
    })
    .catch(() => {});
}

// ── SSE streaming ───────────────────────────────────────────────────────────

/** Map<sessionId, AbortController> */
const abortControllers = new Map();

async function sendMessage(sessionId, text) {
  const s = getSession(sessionId);
  if (!text.trim() || s.streaming) return;

  updateSession(sessionId, { error: null, streaming: true });
  updateMessages(sessionId, (prev) => [...prev, { role: 'user', text, id: Date.now() }]);

  const controller = new AbortController();
  abortControllers.set(sessionId, controller);

  try {
    const res = await fetch(`http://localhost:5000/runtime/chat/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text.trim() }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        if (evt.type === 'delta') appendDelta(sessionId, evt.text);
        else if (evt.type === 'thinking') appendThinkingDelta(sessionId, evt.text);
        else if (evt.type === 'tool_start') appendToolStart(sessionId, evt);
        else if (evt.type === 'tool_end') appendToolEnd(sessionId, evt);
        else if (evt.type === 'tool_approval_required') markToolPendingApproval(sessionId, evt);
        else if (evt.type === 'done') finalizeAssistant(sessionId);
        else if (evt.type === 'error') throw new Error(evt.message);
      }
    }
    finalizeAssistant(sessionId);
  } catch (err) {
    if (err.name !== 'AbortError') {
      updateSession(sessionId, { error: err.message });
    }
    finalizeAssistant(sessionId);
  } finally {
    abortControllers.delete(sessionId);
    updateSession(sessionId, { streaming: false });
  }
}

async function abortAgent(sessionId) {
  const controller = abortControllers.get(sessionId);
  if (controller) controller.abort();

  try {
    await fetch(`http://localhost:5000/runtime/agents/${sessionId}/abort`, { method: 'POST' });
  } catch {
    // stream will close on its own
  }
}

async function approveToolCall(sessionId, toolCallId) {
  resolveToolApproval(sessionId, toolCallId);
  try {
    await fetch(`http://localhost:5000/runtime/chat/${sessionId}/tool-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId }),
    });
  } catch (err) {
    updateSession(sessionId, { error: `Failed to approve tool: ${err.message}` });
  }
}

async function rejectToolCall(sessionId, toolCallId, comment) {
  resolveToolApproval(sessionId, toolCallId);
  try {
    await fetch(`http://localhost:5000/runtime/chat/${sessionId}/tool-reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId, comment }),
    });
  } catch (err) {
    updateSession(sessionId, { error: `Failed to reject tool: ${err.message}` });
  }
}

// ── React integration ───────────────────────────────────────────────────────

const AgentChatContext = createContext(null);

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY_SESSION = { agentId: null, agentName: '', messages: [], streaming: false, error: null, hydrated: false, createdAt: 0, toolCallCounts: {} };
const EMPTY_SESSIONS = [];

// Cache for getAgentSessions snapshots — rebuilt on emit(), stable reference between emits
let agentSessionsCache = new Map(); // Map<agentId, Array>
let agentSessionsCacheDirty = true;

// Mark cache dirty on every store mutation
listeners.add(() => { agentSessionsCacheDirty = true; });

function getAgentSessionsSnapshot(agentId) {
  if (!agentId) return EMPTY_SESSIONS;
  if (agentSessionsCacheDirty) {
    agentSessionsCache = new Map();
    agentSessionsCacheDirty = false;
  }
  if (!agentSessionsCache.has(agentId)) {
    agentSessionsCache.set(agentId, getAgentSessions(agentId));
  }
  return agentSessionsCache.get(agentId);
}

// Exported directly so non-hook code (e.g. event handlers) can call it
export { createSession, removeSession, abortAgent };

const api = { sendMessage, abortAgent, hydrateFromServer, getSession, createSession, removeSession, getAgentSessions, approveToolCall, rejectToolCall };

export function AgentChatProvider({ children }) {
  return (
    <AgentChatContext.Provider value={api}>
      {children}
    </AgentChatContext.Provider>
  );
}

/**
 * Hook for ChatPage to consume a specific session's chat state.
 */
export function useAgentChat(sessionId) {
  const ctx = useContext(AgentChatContext);

  const session = useSyncExternalStore(
    subscribe,
    () => sessionId ? getSession(sessionId) : EMPTY_SESSION
  );

  return {
    messages: session.messages,
    streaming: session.streaming,
    error: session.error,
    toolCallCounts: session.toolCallCounts,
    sendMessage: useCallback((text) => ctx.sendMessage(sessionId, text), [ctx, sessionId]),
    abortAgent: useCallback(() => ctx.abortAgent(sessionId), [ctx, sessionId]),
    hydrateFromServer: useCallback(() => ctx.hydrateFromServer(sessionId), [ctx, sessionId]),
    approveToolCall: useCallback((toolCallId) => ctx.approveToolCall(sessionId, toolCallId), [ctx, sessionId]),
    rejectToolCall: useCallback((toolCallId, comment) => ctx.rejectToolCall(sessionId, toolCallId, comment), [ctx, sessionId]),
  };
}

/**
 * Hook to get all sessions for an agent (for the "Open Chats" popup).
 */
export function useAgentSessions(agentId) {
  return useSyncExternalStore(
    subscribe,
    () => getAgentSessionsSnapshot(agentId)
  );
}

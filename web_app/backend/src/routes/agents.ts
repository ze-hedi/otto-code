import { Router } from "express";
import fs from "fs";
import path from "path";
import readline from "readline";
import { createAgent, deleteAgent, getActiveAgent, getOrActivateAgent, getAgentDoc, getAllAgentDocs, getSessionKey, setSessionKey, markBusy, markIdle, getAgentBusyState, getAgentEmitter, setClarificationCallback, resolveClarification } from "../services/agent-manager.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import type { SerializableAgentConfig } from "../types.js";

const router = Router();

router.post("/", async (req, res) => {
  const config: SerializableAgentConfig = req.body;

  if (!config.model) {
    res.status(400).json({ error: "model is required" });
    return;
  }

  const doc = await createAgent(config);
  res.status(201).json({
    agent_id: doc.agent_id,
    status: doc.status,
    created_at: doc.created_at,
    description: doc.config.description,
  });
});

router.get("/", async (_req, res) => {
  const agents = await getAllAgentDocs();
  res.json(agents);
});

router.get("/:id", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(doc);
});

// ── Delete agent ──────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const deleted = await deleteAgent(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ deleted: true });
});

// ── Agent busy status ──────────────────────────────────────────────────────

router.get("/:id/status", (req, res) => {
  res.json(getAgentBusyState(req.params.id));
});

// ── Full system prompt (includes tool snippets) ────────────────────────────

router.get("/:id/system-prompt", async (req, res) => {
  const agent = await getOrActivateAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const prompt = (agent as any).fullSystemPrompt ?? (agent as any)._baseSystemPrompt ?? null;
  res.json({ systemPrompt: prompt });
});

// ── List sessions on disk ─────────────────────────────────────────────────

router.get("/:id/sessions", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const playground = doc.config.playground;
  if (!playground) {
    res.json([]);
    return;
  }

  const sessionDir = path.join(playground, ".otto-sessions");
  if (!fs.existsSync(sessionDir)) {
    res.json([]);
    return;
  }

  const safeName = (doc.config.name ?? "agent").replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = `${safeName}-`;

  const files = fs.readdirSync(sessionDir).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".jsonl"),
  );

  const sessions = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(sessionDir, filename);
      const stat = fs.statSync(filePath);
      const sessionKey = filename.slice(prefix.length, -".jsonl".length);

      // Read first line to get session header
      let sessionId: string | null = null;
      let createdAt: string | null = null;
      try {
        const rl = readline.createInterface({
          input: fs.createReadStream(filePath),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          const parsed = JSON.parse(line);
          if (parsed.type === "session") {
            sessionId = parsed.id ?? null;
            createdAt = parsed.timestamp ?? null;
          }
          rl.close();
          break;
        }
      } catch {}

      return {
        filename,
        sessionKey,
        sessionId,
        createdAt,
        sizeBytes: stat.size,
      };
    }),
  );

  res.json(sessions);
});

// ── Delete a session file ─────────────────────────────────────────────────

router.delete("/:id/sessions/:sessionKey", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const playground = doc.config.playground;
  if (!playground) {
    res.status(400).json({ error: "Agent has no playground configured" });
    return;
  }

  const sessionDir = path.join(playground, ".otto-sessions");
  const safeName = (doc.config.name ?? "agent").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeName}-${req.params.sessionKey}.jsonl`;
  const filePath = path.join(sessionDir, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Session file not found" });
    return;
  }

  // If this is the active session, reset to "main"
  const activeKey = getSessionKey(req.params.id);
  if (activeKey === req.params.sessionKey) {
    setSessionKey(req.params.id, "main");
  }

  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// ── Load a session from disk ──────────────────────────────────────────────

router.post("/:id/load-session", async (req, res) => {
  const agent = await getOrActivateAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const doc = await getAgentDoc(req.params.id);
  if (!doc?.config.playground) {
    res.status(400).json({ error: "Agent has no playground configured" });
    return;
  }

  const { filename } = req.body;
  if (!filename || typeof filename !== "string" || !filename.endsWith(".jsonl")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  // Prevent path traversal
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const filePath = path.join(doc.config.playground, ".otto-sessions", filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Session file not found" });
    return;
  }

  try {
    console.log(`[load-session] Loading session from: ${filePath}`);
    const session = await agent.loadSession(filePath);
    setSessionKey(req.params.id, "main");
    console.log(`[load-session] Session loaded, messages count: ${session.messages.length}`);
    res.json({ loaded: true });
  } catch (err: any) {
    console.error(`[load-session] Error:`, err);
    res.status(500).json({ error: err?.message ?? "Failed to load session" });
  }
});

// ── Create a fresh session (avoids resuming old "main") ───────────────────

router.post("/:id/new-session", async (req, res) => {
  const agent = await getOrActivateAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const key = `chat-${Date.now()}`;
  await agent.createNewSession(key);
  setSessionKey(req.params.id, key);
  console.log(`[new-session] Created session "${key}" for agent ${req.params.id}`);
  res.json({ sessionKey: key });
});

// ── Chat SSE endpoint ──────────────────────────────────────────────────────

router.post("/:id/chat", async (req, res) => {
  console.log(`[chat] POST /agents/${req.params.id}/chat`);

  // Guard: reject if agent is already streaming
  const busyState = getAgentBusyState(req.params.id);
  if (busyState.busy) {
    res.status(409).json({ error: "Agent is already processing a message" });
    return;
  }

  const agent = await getOrActivateAgent(req.params.id);
  if (!agent) {
    console.log(`[chat] Agent not found: ${req.params.id}`);
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const { message } = req.body;
  console.log(`[chat] message: "${message}"`);
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const sessionKey = getSessionKey(req.params.id);
  const emitter = markBusy(req.params.id, sessionKey);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  res.on("close", () => { closed = true; console.log("[chat] client disconnected"); });

  const send = (payload: object) => {
    if (!closed) {
      console.log("[chat] SSE send:", JSON.stringify(payload).slice(0, 200));
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      (res.socket as any)?.flush?.();
      (res as any).flush?.();
    }
  };

  // Wire tool approval SSE event
  agent.onToolApprovalRequired((toolCallId, toolName, args) => {
    const payload = { type: 'tool_approval_required', toolCallId, name: toolName, args };
    send(payload);
    emitter.emit("event", payload);
  });

  // Wire clarification tool SSE event
  setClarificationCallback(req.params.id, (toolCallId, questions) => {
    const payload = { type: 'clarification_required', toolCallId, questions };
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
    markIdle(req.params.id);
    res.end();
  }
});

// ── Stop streaming endpoint ───────────────────────────────────────────────

router.post("/:id/stop", async (req, res) => {
  const state = getAgentBusyState(req.params.id);
  if (!state.busy) {
    res.json({ stopped: false, reason: "not busy" });
    return;
  }

  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  try {
    await agent.abort(state.sessionKey ?? undefined);
  } catch (err: any) {
    console.error("[stop] abort error:", err);
  }

  res.json({ stopped: true });
});

// ── Tool approval endpoints ───────────────────────────────────────────────

router.post("/:id/tool-approve", (req, res) => {
  const agent = getActiveAgent(req.params.id);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const { toolCallId } = req.body as { toolCallId?: string };
  if (!toolCallId) { res.status(400).json({ error: "toolCallId is required" }); return; }
  agent.approveToolCall(toolCallId);
  res.json({ success: true });
});

router.post("/:id/tool-reject", (req, res) => {
  const agent = getActiveAgent(req.params.id);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  const { toolCallId, comment } = req.body as { toolCallId?: string; comment?: string };
  if (!toolCallId) { res.status(400).json({ error: "toolCallId is required" }); return; }
  agent.rejectToolCall(toolCallId, comment);
  res.json({ success: true });
});

// ── Clarification answer endpoint ─────────────────────────────────────────────

router.post("/:id/clarification-answer", (req, res) => {
  const { toolCallId, answers } = req.body as { toolCallId?: string; answers?: string[] };
  if (!toolCallId || !Array.isArray(answers)) {
    res.status(400).json({ error: "toolCallId and answers[] are required" });
    return;
  }
  const resolved = resolveClarification(toolCallId, answers);
  res.json({ success: resolved });
});

// ── SSE reconnection endpoint ──────────────────────────────────────────────

router.get("/:id/events", (req, res) => {
  const state = getAgentBusyState(req.params.id);
  if (!state.busy) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "agent_idle" })}\n\n`);
    res.end();
    return;
  }

  const emitter = getAgentEmitter(req.params.id);
  if (!emitter) {
    res.setHeader("Content-Type", "text/event-stream");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "agent_idle" })}\n\n`);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const onEvent = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    (res.socket as any)?.flush?.();
    (res as any).flush?.();
  };

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
});

// ── Message history endpoint ────────────────────────────────────────────────

interface ChatPart {
  type: "thinking" | "text" | "tool";
  content?: string;
  name?: string;
  input?: string;
  result?: string;
  isError?: boolean;
  status?: "running" | "done";
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  parts: ChatPart[];
}

function transformMessages(rawMessages: any[]): ChatMsg[] {
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

router.get("/:id/messages", async (req, res) => {
  const agent = await getOrActivateAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  try {
    const sessionKey = getSessionKey(req.params.id);
    const messages = await agent.getMessages(sessionKey);
    const transformed = transformMessages(messages);
    console.log(`[messages] Raw: ${messages.length}, Transformed: ${transformed.length}`);
    if (messages.length > 0) {
      console.log(`[messages] First raw role: ${(messages[0] as any).role}`);
    }
    res.json(transformed);
  } catch (err) {
    console.error(`[messages] Error:`, err);
    res.json([]);
  }
});

export default router;

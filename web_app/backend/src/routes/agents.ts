import { Router } from "express";
import fs from "fs";
import path from "path";
import readline from "readline";
import { createAgent, deleteAgent, getActiveAgent, getOrActivateAgent, getAgentDoc, getAllAgentDocs, getSessionKey, setSessionKey, getAgentBusyState, resolveClarification } from "../services/agent-manager.js";
import { streamChat, streamReconnect, transformMessages } from "../services/chat-stream.js";
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

router.get("/", async (req, res) => {
  const playground = req.query.playground as string | undefined;
  const agents = await getAllAgentDocs(playground);
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

  await streamChat(req.params.id, agent, message, res);
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
  streamReconnect(req.params.id, res);
});

// ── Message history endpoint ────────────────────────────────────────────────

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

// GET /agents/:id/stats
router.get("/:id/stats", async (req, res) => {
  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not running" });
    return;
  }
  try {
    const stats = agent.getSessionStats();
    res.json(stats);
  } catch (err) {
    console.error(`[stats] Error:`, err);
    res.status(503).json({ error: "No active session. Send a message first." });
  }
});

export default router;

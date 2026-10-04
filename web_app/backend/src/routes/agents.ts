import { Router } from "express";
import { createAgent, deleteAgent, getActiveAgent, getAgentDoc, getAllAgentDocs } from "../services/agent-manager.js";
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

// ── Full system prompt (includes tool snippets) ────────────────────────────

router.get("/:id/system-prompt", async (req, res) => {
  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found or not active" });
    return;
  }
  const prompt = (agent as any).fullSystemPrompt ?? (agent as any)._baseSystemPrompt ?? null;
  res.json({ systemPrompt: prompt });
});

// ── Chat SSE endpoint ──────────────────────────────────────────────────────

router.post("/:id/chat", async (req, res) => {
  console.log(`[chat] POST /agents/${req.params.id}/chat`);
  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    console.log(`[chat] Agent not found: ${req.params.id}`);
    res.status(404).json({ error: "Agent not found or not active" });
    return;
  }

  const { message } = req.body;
  console.log(`[chat] message: "${message}"`);
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

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
      // Force the chunk through the socket immediately
      (res.socket as any)?.flush?.();
      (res as any).flush?.();
    }
  };

  try {
    // Wait for streaming to actually finish via the event callback,
    // not via chat() promise (which can resolve before events flush)
    await new Promise<void>((resolve, reject) => {
      agent.chat(message, (event) => {
        handleEventWithClient(event, send);
        if (event.type === "agent_end") resolve();
      }).catch(reject);
    });
  } catch (err: any) {
    console.error("[chat] error:", err);
    send({ type: "error", message: err?.message ?? String(err) });
  } finally {
    res.end();
  }
});

// ── Message history endpoint ────────────────────────────────────────────────

router.get("/:id/messages", async (req, res) => {
  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found or not active" });
    return;
  }

  try {
    const messages = await agent.getMessages();
    res.json(messages);
  } catch {
    res.json([]);
  }
});

export default router;

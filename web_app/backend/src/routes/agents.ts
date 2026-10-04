import { Router } from "express";
import fs from "fs";
import path from "path";
import readline from "readline";
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

// ── Load a session from disk ──────────────────────────────────────────────

router.post("/:id/load-session", async (req, res) => {
  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found or not active" });
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
    await agent.loadSession(filePath);
    res.json({ loaded: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load session" });
  }
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
  const agent = getActiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Agent not found or not active" });
    return;
  }

  try {
    const messages = await agent.getMessages();
    res.json(transformMessages(messages));
  } catch {
    res.json([]);
  }
});

export default router;

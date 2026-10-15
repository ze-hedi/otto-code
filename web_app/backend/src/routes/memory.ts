// memory.ts — Sleep mode router
// Handles distillation of session JSONL files into Mem0 memories,
// and retrieval/search of those memories.
//
// Routes:
//   POST /memory/agents/:agentId/sessions/:sessionKey/distill  — run sleep mode on a session
//   GET  /memory/agents/:agentId/memories                      — list all memories (optional ?runId=)
//   GET  /memory/agents/:agentId/memories/search?q=...         — semantic search

import { Router } from "express";
import fs from "fs";
import path from "path";
import { getAgentDoc } from "../services/agent-manager.js";
import { SleepMode } from "../../../../memory_layer/sleep-mode.js";

const router = Router();

function buildSleepMode() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  return new SleepMode({
    apiKey,
    llmProvider: "deepseek",
    llmModel: "deepseek-chat",
    embedProvider: "openai",
    embedModel: "text-embedding-3-small",
    embedDims: 1536,
    openaiApiKey: process.env.OPENAI_API_KEY,
    qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
    qdrantApiKey: process.env.QDRANT_API_KEY,
    collectionName: "agent-memories",
    historyDbPath: path.join(process.cwd(), "memory.db"),
  });
}

// Resolve the JSONL file path for an agent session
async function resolveSessionFile(agentId: string, sessionKey: string): Promise<string | null> {
  const doc = await getAgentDoc(agentId);
  if (!doc?.config.playground) return null;
  const safeName = (doc.config.name ?? "agent").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(doc.config.playground, ".otto-sessions", `${safeName}-${sessionKey}.jsonl`);
}

// ── POST /memory/agents/:agentId/sessions/:sessionKey/distill ─────────────────
// Runs sleep mode distillation on a session JSONL file.
// Idempotent — re-running resumes from cursor.

router.post("/agents/:agentId/sessions/:sessionKey/distill", async (req, res) => {
  const { agentId, sessionKey } = req.params;

  const doc = await getAgentDoc(agentId);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const filePath = await resolveSessionFile(agentId, sessionKey);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Session file not found" });
    return;
  }

  try {
    const sleep = buildSleepMode();
    const result = await sleep.distill(filePath, {
      agentId,
      onProgress: (p) =>
        console.log(`[sleep] agent=${agentId} session=${sessionKey} turns=${p.turnsProcessed}/${p.turnsTotal} memories=${p.memoriesExtracted}`),
    });
    res.json(result);
  } catch (err: any) {
    console.error("[distill] Error:", err);
    res.status(500).json({ error: err.message ?? "Distillation failed" });
  }
});

// ── GET /memory/agents/:agentId/memories ──────────────────────────────────────
// Returns all distilled memories for an agent.
// Optional query param: ?runId=<sessionId>  — filter to a specific session

router.get("/agents/:agentId/memories", async (req, res) => {
  const { agentId } = req.params;
  const runId = req.query.runId as string | undefined;

  const doc = await getAgentDoc(agentId);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  try {
    const sleep = buildSleepMode();
    const memories = runId
      ? await (sleep as any)._mem0.getAll({ agentId, userId: agentId, runId })
      : await sleep.recall(agentId);
    res.json(memories);
  } catch (err: any) {
    console.error("[memories] Error:", err);
    res.status(500).json({ error: err.message ?? "Failed to fetch memories" });
  }
});

// ── GET /memory/agents/:agentId/memories/search?q=... ────────────────────────
// Semantic + BM25 search over distilled memories for an agent.
// Optional query param: ?runId=<sessionId>  — scope to a specific session

router.get("/agents/:agentId/memories/search", async (req, res) => {
  const { agentId } = req.params;
  const query = req.query.q as string | undefined;

  if (!query?.trim()) {
    res.status(400).json({ error: "q (query) param is required" });
    return;
  }

  const doc = await getAgentDoc(agentId);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  try {
    const sleep = buildSleepMode();
    const memories = await sleep.search(query, agentId);
    res.json(memories);
  } catch (err: any) {
    console.error("[memories/search] Error:", err);
    res.status(500).json({ error: err.message ?? "Search failed" });
  }
});

export default router;

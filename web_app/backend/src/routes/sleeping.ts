import { Router } from "express";
import fs from "fs";
import path from "path";
import readline from "readline";
import { getDb } from "../db/mongo.js";
import { QdrantManager } from "../../../../memory/qdrant.js";
import { MemoryExtractor } from "../../../../memory/MemoryExtractor.js";
import type { ChatMessage } from "../../../../memory/extractor_agent.js";

const router = Router();

const VECTOR_SIZE = 1536;
const EXTRACTOR_MODEL = "deepseek/deepseek-v4-pro";
const BATCH_SIZE = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function createQdrant(): QdrantManager {
  return new QdrantManager({
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY,
    embeddingModel: "openai/text-embedding-3-small",
    embeddingApiKey: process.env.OPENROUTER_API_KEY!,
  });
}

async function ensureCollection(qdrant: QdrantManager, collectionName: string): Promise<void> {
  if (!(await qdrant.collectionExists(collectionName))) {
    await qdrant.createCollection(collectionName, VECTOR_SIZE);
  }
}

async function parseSessionMessages(filePath: string): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message") continue;

      const msg = entry.message;
      if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n");
      }

      if (text.trim()) {
        messages.push({ role: msg.role, content: text });
      }
    } catch {}
  }

  return messages;
}

function batchMessages(messages: ChatMessage[], size = BATCH_SIZE): ChatMessage[][] {
  if (messages.length === 0) return [];
  const batches: ChatMessage[][] = [];
  for (let i = 0; i < messages.length; i += size) {
    batches.push(messages.slice(i, i + size));
  }
  return batches;
}

const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;

function parseFilename(filename: string): { agentId: string; sessionId: string } {
  // "{uuid}-main.jsonl" → { agentId: "{uuid}", sessionId: "main" }
  // "{uuid}-chat-abc123.jsonl" → { agentId: "{uuid}", sessionId: "chat-abc123" }
  // fallback for legacy "agentName-main.jsonl" → split on first dash
  const base = filename.replace(/\.jsonl$/, "");
  const uuidMatch = base.match(UUID_RE);
  if (uuidMatch) {
    return { agentId: uuidMatch[1], sessionId: uuidMatch[2] };
  }
  // Legacy: split on first dash
  const dashIdx = base.indexOf("-");
  if (dashIdx > 0) {
    return { agentId: base.slice(0, dashIdx), sessionId: base.slice(dashIdx + 1) };
  }
  return { agentId: base, sessionId: "main" };
}

async function parseFirstLine(filePath: string): Promise<{ sessionId: string | null; createdAt: string | null }> {
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
  return { sessionId, createdAt };
}

// ── GET /:projectId/sessions ─────────────────────────────────────────────────

router.get("/:projectId/sessions", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await getDb()
      .collection("projects")
      .findOne({ project_id: projectId }, { projection: { _id: 0 } });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const sessionDir = path.join(project.path, ".otto-sessions");
    if (!fs.existsSync(sessionDir)) {
      res.json({ agentSessions: [], workflowSessions: [] });
      return;
    }

    // Agent sessions: *.jsonl files directly in sessionDir
    const allEntries = fs.readdirSync(sessionDir, { withFileTypes: true });

    const jsonlFiles = allEntries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"));

    const agentSessions = await Promise.all(
      jsonlFiles.map(async (e) => {
        const filePath = path.join(sessionDir, e.name);
        const stat = fs.statSync(filePath);
        const { sessionId, createdAt } = await parseFirstLine(filePath);
        return {
          type: "agent" as const,
          filename: e.name,
          sessionId,
          createdAt,
          sizeBytes: stat.size,
        };
      })
    );

    // Workflow sessions: workflow-* subdirectories
    const workflowDirs = allEntries.filter(
      (e) => e.isDirectory() && e.name.startsWith("workflow-")
    );

    const workflowSessions: {
      type: "workflow";
      workflowId: string;
      sessionId: string;
      createdAt: string;
      agentFiles: string[];
      agentCount: number;
    }[] = [];

    for (const wd of workflowDirs) {
      const workflowId = wd.name.replace(/^workflow-/, "");
      const wdPath = path.join(sessionDir, wd.name);
      const sessionDirs = fs
        .readdirSync(wdPath, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const sd of sessionDirs) {
        const sessionPath = path.join(wdPath, sd.name);
        const stat = fs.statSync(sessionPath);
        const agentFiles = fs
          .readdirSync(sessionPath)
          .filter((f) => f.endsWith(".jsonl"));

        workflowSessions.push({
          type: "workflow",
          workflowId,
          sessionId: sd.name,
          createdAt: stat.birthtime.toISOString(),
          agentFiles,
          agentCount: agentFiles.length,
        });
      }
    }

    agentSessions.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    workflowSessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ agentSessions, workflowSessions });
  } catch (err: any) {
    console.error("[sleeping/sessions] error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

// ── GET /:projectId/memories ─────────────────────────────────────────────────

router.get("/:projectId/memories", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { agentId, sessionId } = req.query;

    if (!agentId || !sessionId) {
      res.status(400).json({ error: "agentId and sessionId query params required" });
      return;
    }

    const qdrant = createQdrant();
    const collectionName = projectId;

    if (!(await qdrant.collectionExists(collectionName))) {
      res.json({ memories: [] });
      return;
    }

    const points = await qdrant.scroll(collectionName, {
      agentId: String(agentId),
      sessionId: String(sessionId),
    });

    const memories = points.map((p) => ({
      id: p.id,
      text: p.payload.text ?? "",
      attributed_to: p.payload.attributed_to ?? null,
    }));

    res.json({ memories });
  } catch (err: any) {
    console.error("[sleeping/memories] error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

// ── POST /:projectId/distill ─────────────────────────────────────────────────

router.post("/:projectId/distill", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { type, filename, workflowId, sessionId } = req.body;

    const project = await getDb()
      .collection("projects")
      .findOne({ project_id: projectId }, { projection: { _id: 0 } });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const collectionName = projectId;
    console.log(`[distill] start — project=${projectId}, type=${type}, collection=${collectionName}`);

    const qdrant = createQdrant();
    await ensureCollection(qdrant, collectionName);
    console.log(`[distill] qdrant collection "${collectionName}" ready`);

    let totalBatches = 0;
    let totalMemories = 0;

    const distillFile = async (filePath: string, agentId: string, sessionId: string) => {
      console.log(`[distill] parsing file: ${filePath}`);
      const messages = await parseSessionMessages(filePath);
      console.log(`[distill] parsed ${messages.length} messages — agentId=${agentId}, sessionId=${sessionId}`);

      const batches = batchMessages(messages);
      console.log(`[distill] split into ${batches.length} batches`);

      const extractor = new MemoryExtractor({
        sessionId,
        agentId,
        topK: 5,
        qdrant,
        collectionName,
        extractorModel: EXTRACTOR_MODEL,
      });

      for (let i = 0; i < batches.length; i++) {
        console.log(`[distill] processing batch ${i + 1}/${batches.length} (${batches[i].length} messages)`);
        const extracted = await extractor.run(batches[i]);
        totalBatches++;
        totalMemories += extracted.length;
        console.log(`[distill] batch ${i + 1} done — extracted ${extracted.length} memories`);
      }
      console.log(`[distill] file done: ${filePath}`);
    };

    if (type === "agent") {
      if (!filename) {
        res.status(400).json({ error: "filename required for agent distillation" });
        return;
      }
      const filePath = path.join(project.path, ".otto-sessions", filename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Session file not found" });
        return;
      }
      const { agentId, sessionId: sessId } = parseFilename(filename);
      await distillFile(filePath, agentId, sessId);
    } else if (type === "workflow") {
      if (!workflowId || !sessionId) {
        res.status(400).json({ error: "workflowId and sessionId required for workflow distillation" });
        return;
      }
      const sessionPath = path.join(
        project.path,
        ".otto-sessions",
        `workflow-${workflowId}`,
        sessionId
      );
      if (!fs.existsSync(sessionPath)) {
        res.status(404).json({ error: "Workflow session directory not found" });
        return;
      }
      const agentFiles = fs.readdirSync(sessionPath).filter((f) => f.endsWith(".jsonl"));
      for (const af of agentFiles) {
        const { agentId, sessionId: sessId } = parseFilename(af);
        await distillFile(path.join(sessionPath, af), agentId, sessId);
      }
    } else if (type === "workflow-agent") {
      if (!workflowId || !sessionId || !filename) {
        res.status(400).json({ error: "workflowId, sessionId and filename required for workflow-agent distillation" });
        return;
      }
      const filePath = path.join(
        project.path,
        ".otto-sessions",
        `workflow-${workflowId}`,
        sessionId,
        filename
      );
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Agent session file not found" });
        return;
      }
      const { agentId, sessionId: sessId } = parseFilename(filename);
      await distillFile(filePath, agentId, sessId);
    } else {
      res.status(400).json({ error: "type must be 'agent', 'workflow', or 'workflow-agent'" });
      return;
    }

    console.log(`[distill] complete — ${totalBatches} batches, ${totalMemories} memories extracted`);
    res.json({ success: true, batchesProcessed: totalBatches, memoriesExtracted: totalMemories });
  } catch (err: any) {
    console.error("[sleeping/distill] error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;

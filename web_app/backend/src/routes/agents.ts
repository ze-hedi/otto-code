import { Router } from "express";
import fs from "fs";
import path from "path";
import readline from "readline";
import crypto from "crypto";
import { createAgent, updateAgent, deleteAgent, getActiveAgent, getOrActivateAgent, getAgentDoc, getAllAgentDocs, getSessionKey, setSessionKey, markBusy, markIdle, getAgentBusyState, getBusyAgentIds, getAgentEmitter, setClarificationCallback, resolveClarification } from "../services/agent-manager.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import { createMcpBridge } from "../../../../agents/mcp-bridge.js";
import { SUMMARIZER_DEFAULT_MODEL, SUMMARIZER_SYSTEM_PROMPT } from "../../../../observability_tool/summarizer_agent.js";
import { ASSIGNER_DEFAULT_MODEL, ASSIGNER_SYSTEM_PROMPT, TAXONOMY_DEFAULT_MODEL, TAXONOMY_SYSTEM_PROMPT } from "../../../../observability_tool/taxonomy_agent.js";
import { createAssignerTools, createTaxonomyTools } from "../../../../observability_tool/taxonomy-tools.js";
import type { SerializableAgentConfig } from "../types.js";

const router = Router();

/** Returns an error message if any skill path (agent or subagent) is not an existing absolute path. */
function validateSkillPaths(config: SerializableAgentConfig): string | null {
  const entries: [string, string[] | undefined][] = [
    ["skills", config.skills],
    ...Object.entries(config.subAgents ?? {}).map(([key, sa]) => [`subAgents.${key}.skills`, sa.skills] as [string, string[] | undefined]),
  ];
  for (const [where, paths] of entries) {
    for (const p of paths ?? []) {
      if (!path.isAbsolute(p)) return `${where}: path must be absolute: ${p}`;
      if (!fs.existsSync(p)) return `${where}: path does not exist: ${p}`;
    }
  }
  return null;
}

router.post("/", async (req, res) => {
  const config: SerializableAgentConfig = req.body;

  if (!config.model) {
    res.status(400).json({ error: "model is required" });
    return;
  }
  const skillError = validateSkillPaths(config);
  if (skillError) {
    res.status(400).json({ error: skillError });
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

/** Connects to an MCP server and returns its tools, so the form can verify the server is reachable. */
router.post("/mcp-check", async (req, res) => {
  const url = req.body?.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }
  try {
    const bridge = await Promise.race([
      createMcpBridge(url),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out after 10s")), 10000)),
    ]);
    const tools = bridge.tools.map(({ name, description }) => ({ name, description }));
    await bridge.close().catch(() => {});
    res.json({ tools });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Lists skill folders (those containing SKILL.md) under <playground>/.skills. Empty if the folder doesn't exist. */
router.get("/skills", (req, res) => {
  const playground = req.query.playground as string | undefined;
  if (!playground || !path.isAbsolute(playground)) {
    res.json([]);
    return;
  }
  const skillsDir = path.join(playground, ".skills");
  if (!fs.existsSync(skillsDir)) {
    res.json([]);
    return;
  }
  const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
    .map((d) => ({ name: d.name, path: path.join(skillsDir, d.name) }));
  res.json(skills);
});

router.get("/", async (req, res) => {
  const playground = req.query.playground as string | undefined;
  const agents = await getAllAgentDocs(playground);
  res.json(agents);
});

// Must stay above "/:id" or "running" is treated as an agent id.
router.get("/running", async (_req, res) => {
  const docs = await Promise.all(getBusyAgentIds().map((id) => getAgentDoc(id)));
  res.json(
    docs.flatMap((d) =>
      d ? [{ agent_id: d.agent_id, name: d.config.name ?? "Unnamed Agent", playground: d.config.playground }] : [],
    ),
  );
});

router.get("/:id", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(doc);
});

// ── Update agent ──────────────────────────────────────────────────────────

router.put("/:id", async (req, res) => {
  const config: SerializableAgentConfig = req.body;
  if (!config.model) {
    res.status(400).json({ error: "model is required" });
    return;
  }
  const skillError = validateSkillPaths(config);
  if (skillError) {
    res.status(400).json({ error: skillError });
    return;
  }
  const doc = await updateAgent(req.params.id, config);
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

  const prefix = `${doc.agent_id}-`;

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
  const filename = `${doc.agent_id}-${req.params.sessionKey}.jsonl`;
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

// ── Read session entries (observability) ──────────────────────────────────

function readJsonl(filePath: string): unknown[] {
  return fs.readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return { type: "unparseable", raw: l }; }
    });
}

router.get("/:id/sessions/:sessionKey/entries", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  if (!doc?.config.playground) {
    res.status(404).json({ error: "Agent or playground not found" });
    return;
  }
  // basename guard: sessionKey must not escape the sessions dir
  const filename = `${doc.agent_id}-${req.params.sessionKey}.jsonl`;
  if (path.basename(filename) !== filename) {
    res.status(400).json({ error: "Invalid session key" });
    return;
  }
  const filePath = path.join(doc.config.playground, ".otto-sessions", filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Session file not found" });
    return;
  }
  res.json(readJsonl(filePath));
});

// ── Session notes (error analysis + known-good responses for eval sets) ──
// Stored next to the session: .otto-sessions/.notes/<agent_id>-<sessionKey>-notes.jsonl

const NOTE_KINDS = ["error", "good"] as const;
type NoteKind = (typeof NOTE_KINDS)[number];

interface SessionNote {
  id: string;
  entryId: string;
  kind: NoteKind;
  text: string;
  createdAt: string;
}

async function notesPath(agentId: string, sessionKey: string): Promise<string | null> {
  const doc = await getAgentDoc(agentId);
  if (!doc?.config.playground) return null;
  const filename = `${doc.agent_id}-${sessionKey}-notes.jsonl`;
  if (path.basename(filename) !== filename) return null;
  return path.join(doc.config.playground, ".otto-sessions", ".notes", filename);
}

router.get("/:id/sessions/:sessionKey/notes", async (req, res) => {
  const filePath = await notesPath(req.params.id, req.params.sessionKey);
  if (!filePath) {
    res.status(404).json({ error: "Agent or session not found" });
    return;
  }
  res.json(fs.existsSync(filePath) ? readJsonl(filePath) : []);
});

router.post("/:id/sessions/:sessionKey/notes", async (req, res) => {
  const filePath = await notesPath(req.params.id, req.params.sessionKey);
  const { entryId, text, kind } = req.body ?? {};
  if (!filePath) {
    res.status(404).json({ error: "Agent or session not found" });
    return;
  }
  if (typeof entryId !== "string" || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "entryId and text are required" });
    return;
  }
  if (!NOTE_KINDS.includes(kind)) {
    res.status(400).json({ error: `kind must be one of: ${NOTE_KINDS.join(", ")}` });
    return;
  }
  const note: SessionNote = { id: crypto.randomUUID(), entryId, kind, text: text.trim(), createdAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(note) + "\n");
  res.json(note);
});

router.delete("/:id/sessions/:sessionKey/notes/:noteId", async (req, res) => {
  const filePath = await notesPath(req.params.id, req.params.sessionKey);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Notes not found" });
    return;
  }
  const remaining = (readJsonl(filePath) as SessionNote[]).filter((n) => n.id !== req.params.noteId);
  fs.writeFileSync(filePath, remaining.map((n) => JSON.stringify(n) + "\n").join(""));
  res.json({ ok: true });
});

// ── Taxonomy (axial coding over error notes) ──────────────────────────────
// The two agents are hardcoded in observability_tool/; this only describes them.

router.get("/:id/taxonomy/config", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  if (!doc?.config.playground) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const notesDir = path.join(doc.config.playground, ".otto-sessions", ".notes");
  const notesFiles = fs.existsSync(notesDir)
    ? fs.readdirSync(notesDir).filter((f) => f.startsWith(`${doc.agent_id}-`) && f.endsWith("-notes.jsonl"))
    : [];
  let errorNotes = 0;
  let sessionsWithErrors = 0;
  for (const f of notesFiles) {
    // Older notes predate kinds and are treated as errors.
    const n = (readJsonl(path.join(notesDir, f)) as SessionNote[]).filter((note) => (note.kind ?? "error") === "error").length;
    errorNotes += n;
    if (n) sessionsWithErrors++;
  }

  const describe = (tools: { name: string; description: string }[]) => tools.map((t) => ({ name: t.name, description: t.description }));
  res.json({
    errorNotes,
    sessionsWithErrors,
    agents: [
      {
        key: "summarizer",
        name: "Summarizer",
        role: "Compacts the conversation before each flagged error.",
        defaultModel: SUMMARIZER_DEFAULT_MODEL,
        systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
        tools: [],
      },
      {
        key: "taxonomy",
        name: "Taxonomy agent",
        role: "Orchestrator: discovers the failure categories, then delegates assignment.",
        defaultModel: TAXONOMY_DEFAULT_MODEL,
        systemPrompt: TAXONOMY_SYSTEM_PROMPT,
        tools: describe(createTaxonomyTools("", new Set())),
      },
      {
        key: "assigner",
        name: "Assigner",
        role: "Volatile sub-agent of the taxonomy agent: labels batches of ~20 errors, up to 3 in parallel.",
        parent: "taxonomy",
        defaultModel: ASSIGNER_DEFAULT_MODEL,
        systemPrompt: ASSIGNER_SYSTEM_PROMPT,
        tools: describe(createAssignerTools("", new Set())),
      },
    ],
  });
});

// Volatile sub-agents write `${name}-${toolCallId}-<key>.jsonl`; find it by tool call id.
router.get("/:id/subagent-sessions/:toolCallId/entries", async (req, res) => {
  const doc = await getAgentDoc(req.params.id);
  const toolCallId = req.params.toolCallId;
  if (!doc?.config.playground || toolCallId.includes("/") || toolCallId.includes("..")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const playgrounds = new Set([
    doc.config.playground,
    ...Object.values(doc.config.subAgents ?? {}).map((sa: any) => sa.playground).filter(Boolean),
  ]);
  for (const pg of playgrounds) {
    const dir = path.join(pg, ".otto-sessions");
    if (!fs.existsSync(dir)) continue;
    const match = fs.readdirSync(dir).find((f) => f.includes(`-${toolCallId}-`) && f.endsWith(".jsonl"));
    if (match) {
      res.json(readJsonl(path.join(dir, match)));
      return;
    }
  }
  res.status(404).json({ error: "No sub-agent session for this tool call" });
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

  // ── /compact command: run compaction and return JSON (no SSE) ──────────
  if (message.trim() === "/compact") {
    const sessionKey = getSessionKey(req.params.id);
    try {
      const result = await agent.compactSession({ key: sessionKey });
      console.log(`[chat] compaction done — tokensBefore=${result.tokensBefore}`);
      res.json({ type: "compaction_done", ...result });
    } catch (err: any) {
      console.error("[chat] compaction error:", err);
      res.status(500).json({ error: err?.message ?? "Compaction failed" });
    }
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
  type: "thinking" | "text" | "tool" | "compaction";
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
    } else if (msg.role === "compactionSummary") {
      out.push({ role: "assistant", content: "", parts: [{ type: "compaction", content: msg.summary ?? "" }] });
    }
    // skip toolResult, bashExecution, etc.
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

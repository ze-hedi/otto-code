// Container entrypoint. One process per pod, hosting either a single agent or a whole workflow.
// The backend (control plane) starts the pod, POSTs /init, then proxies the same chat/workflow
// traffic it used to handle in-process. No MongoDB here: all state arrives over HTTP.

import fs from "fs";
import path from "path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { RawPiAgent } from "../../../../agents/raw-pi-agent.js";
import type { RawPiAgentConfig } from "../../../../agents/pi-agent-configs.js";
import { Workflow } from "../../../../agents/workflow.js";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import type { SerializableAgentConfig } from "../types.js";
import { resolveApiKey, toRawAgentConfig } from "../services/agent-config.js";
import {
  getAgentBusyState, setSessionKey, getSessionKey,
} from "../services/agent-state.js";
import { resolveClarification } from "../services/clarification.js";
import { streamChat, streamReconnect, transformMessages } from "../services/chat-stream.js";
import { agentsStorageFromConfigs, buildInterfaceStorage, validateInterfaceRules } from "../services/workflow-core.js";
import { streamWorkflowRun } from "../services/workflow-stream.js";

const KIND = process.env.OTTO_RUNTIME_KIND;
const PLAYGROUND = process.env.OTTO_PLAYGROUND || "/workspace";
const TOKEN = process.env.OTTO_RUNNER_TOKEN;
const HOST_ALIAS = process.env.OTTO_HOST_ALIAS;

if (KIND !== "agent" && KIND !== "workflow") {
  console.error(`[runner] OTTO_RUNTIME_KIND must be "agent" or "workflow" (got "${KIND}")`);
  process.exit(1);
}

// ── Config adaptation ────────────────────────────────────────────────────────

/** Rewrites host-side paths/URLs in a stored config so they make sense inside the pod. */
function adaptConfig(config: SerializableAgentConfig): SerializableAgentConfig {
  const mcpServers = config.mcpServers && HOST_ALIAS
    ? Object.fromEntries(Object.entries(config.mcpServers).map(([name, url]) => [
        name,
        url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, `//${HOST_ALIAS}`),
      ]))
    : config.mcpServers;
  return { ...config, playground: PLAYGROUND, workingDir: PLAYGROUND, mcpServers };
}

// ── State ────────────────────────────────────────────────────────────────────

let agentId: string | undefined;
let agent: RawPiAgent | undefined;
let workflow: Workflow | undefined;
let workflowRunning = false;

const app = express();
app.use(express.json({ limit: "10mb" }));

// Readiness/liveness probes can't carry the token and only learn coarse state.
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    kind: KIND,
    initialized: KIND === "workflow" || !!agent,
    busy: KIND === "agent" ? !!agentId && getAgentBusyState(agentId).busy : workflowRunning,
  });
});

// The backend reads these streams through Node's fetch, whose default body timeout is 5 minutes.
// Agents can stay silent longer than that during a long tool call, so SSE responses get a comment
// frame every 15s (the frontend only reads `data:` lines and ignores the rest).
app.use((_req: Request, res: Response, next: NextFunction) => {
  const timer = setInterval(() => {
    const isSse = String(res.getHeader("content-type") ?? "").includes("text/event-stream");
    if (isSse && res.headersSent && !res.writableEnded) res.write(": keepalive\n\n");
  }, 15_000);
  timer.unref();
  res.on("close", () => clearInterval(timer));
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.post("/init", (req, res) => {
  if (KIND !== "agent") {
    res.json({ ok: true });
    return;
  }
  if (agent) {
    res.json({ ok: true, alreadyInitialized: true });
    return;
  }
  const body = req.body as { agentId?: string; config?: SerializableAgentConfig };
  if (!body.agentId || !body.config?.model) {
    res.status(400).json({ error: "agentId and config.model are required" });
    return;
  }
  try {
    agent = new RawPiAgent(toRawAgentConfig(body.agentId, adaptConfig(body.config)));
    agentId = body.agentId;
    console.log(`[runner] agent ${agentId} initialised`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[runner] init failed:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

// ── Agent endpoints (kind=agent) ─────────────────────────────────────────────

const agentRouter = express.Router();

agentRouter.use((_req, res, next) => {
  if (KIND !== "agent") {
    res.status(404).json({ error: "This runner hosts a workflow" });
    return;
  }
  if (!agent || !agentId) {
    res.setHeader("x-otto-not-initialized", "1");
    res.status(409).json({ error: "Runner not initialised" });
    return;
  }
  next();
});

agentRouter.post("/chat", async (req, res) => {
  if (getAgentBusyState(agentId!).busy) {
    res.status(409).json({ error: "Agent is already processing a message" });
    return;
  }
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  await streamChat(agentId!, agent!, message, res);
});

agentRouter.get("/events", (_req, res) => streamReconnect(agentId!, res));

agentRouter.get("/status", (_req, res) => res.json(getAgentBusyState(agentId!)));

agentRouter.post("/stop", async (_req, res) => {
  const state = getAgentBusyState(agentId!);
  if (!state.busy) {
    res.json({ stopped: false, reason: "not busy" });
    return;
  }
  try {
    await agent!.abort(state.sessionKey ?? undefined);
  } catch (err: any) {
    console.error("[stop] abort error:", err);
  }
  res.json({ stopped: true });
});

agentRouter.post("/tool-approve", (req, res) => {
  const { toolCallId } = req.body as { toolCallId?: string };
  if (!toolCallId) { res.status(400).json({ error: "toolCallId is required" }); return; }
  agent!.approveToolCall(toolCallId);
  res.json({ success: true });
});

agentRouter.post("/tool-reject", (req, res) => {
  const { toolCallId, comment } = req.body as { toolCallId?: string; comment?: string };
  if (!toolCallId) { res.status(400).json({ error: "toolCallId is required" }); return; }
  agent!.rejectToolCall(toolCallId, comment);
  res.json({ success: true });
});

agentRouter.post("/clarification-answer", (req, res) => {
  const { toolCallId, answers } = req.body as { toolCallId?: string; answers?: string[] };
  if (!toolCallId || !Array.isArray(answers)) {
    res.status(400).json({ error: "toolCallId and answers[] are required" });
    return;
  }
  res.json({ success: resolveClarification(toolCallId, answers) });
});

agentRouter.get("/system-prompt", (_req, res) => {
  const prompt = (agent as any).fullSystemPrompt ?? (agent as any)._baseSystemPrompt ?? null;
  res.json({ systemPrompt: prompt });
});

agentRouter.get("/messages", async (_req, res) => {
  try {
    res.json(transformMessages(await agent!.getMessages(getSessionKey(agentId!))));
  } catch (err) {
    console.error("[messages] Error:", err);
    res.json([]);
  }
});

agentRouter.get("/stats", (_req, res) => {
  try {
    res.json(agent!.getSessionStats());
  } catch {
    res.status(503).json({ error: "No active session. Send a message first." });
  }
});

agentRouter.post("/new-session", async (_req, res) => {
  const key = `chat-${Date.now()}`;
  await agent!.createNewSession(key);
  setSessionKey(agentId!, key);
  console.log(`[new-session] Created session "${key}" for agent ${agentId}`);
  res.json({ sessionKey: key });
});

agentRouter.post("/load-session", async (req, res) => {
  const { filename } = req.body;
  if (
    !filename || typeof filename !== "string" || !filename.endsWith(".jsonl")
    || filename.includes("/") || filename.includes("\\") || filename.includes("..")
  ) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(PLAYGROUND, ".otto-sessions", filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Session file not found" });
    return;
  }
  try {
    const session = await agent!.loadSession(filePath);
    setSessionKey(agentId!, "main");
    console.log(`[load-session] Session loaded, messages count: ${session.messages.length}`);
    res.json({ loaded: true });
  } catch (err: any) {
    console.error("[load-session] Error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to load session" });
  }
});

app.use("/agent", agentRouter);

// ── Workflow endpoints (kind=workflow) ───────────────────────────────────────

const workflowRouter = express.Router();

workflowRouter.use((_req, res, next) => {
  if (KIND !== "workflow") {
    res.status(404).json({ error: "This runner hosts an agent" });
    return;
  }
  next();
});

workflowRouter.post("/compile", async (req, res) => {
  try {
    const { schema, agents, guardrailsOnInterfaces, workflowId, sessionId } = req.body as {
      schema: WorkflowSchema;
      agents: [string, SerializableAgentConfig][];
      guardrailsOnInterfaces?: boolean;
      workflowId?: string;
      sessionId?: string;
    };
    if (!schema?.components || !schema?.connections || !Array.isArray(agents)) {
      res.status(400).json({ error: "schema and agents are required" });
      return;
    }
    const errors = validateInterfaceRules(schema);
    if (errors.length > 0) {
      res.status(400).json({ error: errors.join("\n") });
      return;
    }

    // Drop the previous workflow's agents before replacing it.
    await Promise.all((workflow?.getAvailableAgents() ?? []).map((a) => a.abort().catch(() => {})));

    const agentsStorage = agentsStorageFromConfigs(
      agents.map(([id, config]) => [id, adaptConfig(config)] as [string, SerializableAgentConfig]),
    );
    for (const config of agentsStorage.getAll().values() as Iterable<RawPiAgentConfig>) {
      config.apiKey = resolveApiKey(config.model);
    }

    const interfaceStorage = await buildInterfaceStorage(schema, agentsStorage);
    const compiled = new Workflow(schema, agentsStorage, interfaceStorage);
    compiled.buildExecutionQueue(guardrailsOnInterfaces ?? false, workflowId, sessionId);
    workflow = compiled;

    res.json({
      compiled: {
        agents: schema.components.filter((c) => c.type === "agent").map((a) => a.id),
        interfaces: schema.components.filter((c) => c.type === "interface").map((i) => ({
          id: i.id,
          type: i.id,
          inputs: schema.connections.filter((c) => c.to === i.id).map((c) => c.from),
          outputs: schema.connections.filter((c) => c.from === i.id).map((c) => c.to),
        })),
        connections: schema.connections,
        executionLevels: compiled.executionQueue.levels.map((level, i) => ({ level: i, agents: level.map((n) => n.id) })),
      },
    });
  } catch (err: any) {
    console.error("[compile] error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

workflowRouter.post("/run", async (req, res) => {
  if (!workflow) {
    res.status(400).json({ error: "No compiled workflow. Call POST /workflows/compile first." });
    return;
  }
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message (string) is required" });
    return;
  }
  workflowRunning = true;
  try {
    await streamWorkflowRun(workflow, message, res);
  } finally {
    workflowRunning = false;
  }
});

function approval(action: "approve" | "reject") {
  return (req: Request, res: Response) => {
    if (!workflow) {
      res.status(400).json({ error: "No compiled workflow" });
      return;
    }
    const { agentId: id, toolCallId, comment } = req.body as { agentId?: string; toolCallId?: string; comment?: string };
    if (!id || !toolCallId) {
      res.status(400).json({ error: "agentId and toolCallId are required" });
      return;
    }
    const target = workflow.getAgentById(id);
    if (!target) {
      res.status(404).json({ error: `No workflow agent found with id "${id}"` });
      return;
    }
    if (action === "approve") target.approveToolCall(toolCallId);
    else target.rejectToolCall(toolCallId, comment);
    res.json({ success: true });
  };
}
workflowRouter.post("/tool-approve", approval("approve"));
workflowRouter.post("/tool-reject", approval("reject"));

app.use("/workflow", workflowRouter);

// ── Boot ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 8080;
const server = app.listen(PORT, () => {
  console.log(`[runner] ${KIND} runner listening on :${PORT}, playground ${PLAYGROUND}`);
});

process.once("SIGTERM", async () => {
  console.log("[runner] SIGTERM — shutting down");
  await agent?.disconnectMcp().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});

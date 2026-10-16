import fs from "fs";
import path from "path";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { AgentsStorage, InterfaceStorage } from "../../../../agents/workflow-types.js";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import { Workflow } from "../../../../agents/workflow.js";
import type { JevConfig } from "../../../../agents/jev-agent-configs.js";
import { buildInterfaceStorage, buildAgentsStorage, validateInterfaceRules, runWorkflow, CompileError } from "../services/workflow-manager.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import { saveJev, getJev, getAllJevs, updateJev, deleteJev } from "../db/mongo.js";
import type { JevDocument } from "../types.js";

const router = Router();

// ── Global state (lives for the lifetime of the server) ──────────────────────

let currentAgentsStorage: AgentsStorage | null = null;
let currentInterfaceStorage: InterfaceStorage | null = null;
let currentWorkflow: Workflow | null = null;

export function getAgentsStorage(): AgentsStorage | null {
  return currentAgentsStorage;
}

export function getInterfaceStorage(): InterfaceStorage | null {
  return currentInterfaceStorage;
}

export function getWorkflow(): Workflow | null {
  return currentWorkflow;
}

/**
 * POST /workflows/agents
 * Builds AgentsStorage from DB, stores it globally, returns agent configs for the sidebar.
 */
router.post("/agents", async (req, res) => {
  try {
    const playground = req.body?.playground as string | undefined;
    currentAgentsStorage = await buildAgentsStorage(playground);
    console.log("[workflows/agents] AgentsStorage built and saved globally");

    const agents: { id: string; name: string; model: string }[] = [];
    for (const [id, config] of currentAgentsStorage.getAll()) {
      agents.push({
        id,
        name: config.name ?? id,
        model: config.model ?? "unknown",
      });
    }

    console.log("[workflows/agents] Returning agents:", agents.map(a => a.id));
    res.json(agents);
  } catch (err: any) {
    console.error("[workflows/agents] error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * POST /workflows/compile
 * Body: WorkflowSchema (components + connections)
 * Builds InterfaceStorage using the existing AgentsStorage, stores it globally.
 */
router.post("/compile", async (req, res) => {
  try {
    if (!currentAgentsStorage) {
      res.status(400).json({ error: "AgentsStorage not initialized. Call POST /workflows/agents first." });
      return;
    }

    const { guardrailsOnInterfaces, workflowId, ...schema } = req.body as WorkflowSchema & { guardrailsOnInterfaces?: boolean; workflowId?: string };

    if (!schema.components || !schema.connections) {
      res.status(400).json({ error: "components and connections are required" });
      return;
    }

    console.log("[compile] Received workflow schema:", JSON.stringify(schema, null, 2));
    console.log("[compile] guardrailsOnInterfaces:", guardrailsOnInterfaces ?? false);

    const validationErrors = validateInterfaceRules(schema);
    if (validationErrors.length > 0) {
      console.log("[compile] Validation errors:", validationErrors);
      res.status(400).json({ error: validationErrors.join("\n") });
      return;
    }

    currentInterfaceStorage = await buildInterfaceStorage(schema, currentAgentsStorage, workflowId);
    console.log("[compile] InterfaceStorage saved globally");

    // Wipe previous session files so agents start fresh on every compile
    if (workflowId) {
      const firstConfig = [...currentAgentsStorage.getAll().values()].find(c => c.playground);
      const playground = firstConfig?.playground;
      if (playground) {
        const sessionDir = path.join(playground, ".otto-sessions", `workflow-${workflowId}`);
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          console.log(`[compile] Wiped session folder: ${sessionDir}`);
        }
      }
    }

    // Build the Workflow object and its execution queue
    currentWorkflow = new Workflow(schema, currentAgentsStorage, currentInterfaceStorage);
    currentWorkflow.buildExecutionQueue(guardrailsOnInterfaces ?? false, workflowId);
    console.log("[compile] Workflow built and execution queue ready");

    const executionQueue = currentWorkflow.executionQueue;
    const levelsSummary = executionQueue.levels.map((level, i) =>
      ({ level: i, agents: level.map(n => n.id) })
    );
    console.log("[compile] Execution levels:", JSON.stringify(levelsSummary, null, 2));

    const interfaceNodes = schema.components.filter(c => c.type === "interface" || c.type === "jev");
    const agentNodes = schema.components.filter(c => c.type === "agent");

    const result = {
      agents: agentNodes.map(a => a.id),
      interfaces: interfaceNodes.map(i => ({
        id: i.id,
        type: i.id,
        inputs: schema.connections.filter(c => c.to === i.id).map(c => c.from),
        outputs: schema.connections.filter(c => c.from === i.id).map(c => c.to),
      })),
      connections: schema.connections,
      executionLevels: levelsSummary,
    };

    console.log("[compile] Compiled result:", JSON.stringify(result, null, 2));

    res.json({ ok: true, compiled: result });
  } catch (err: any) {
    console.error("[compile] error:", err);
    res.status(err instanceof CompileError ? 400 : 500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * POST /workflows/run
 * Body: { message: string }
 * Runs the compiled workflow, streaming SSE events tagged with agentId.
 */
router.post("/run", async (req, res) => {
  if (!currentWorkflow) {
    res.status(400).json({ error: "No compiled workflow. Call POST /workflows/compile first." });
    return;
  }

  const { message } = req.body;
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message (string) is required" });
    return;
  }

  // SSE setup
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let closed = false;
  res.on("close", () => {
    closed = true;
    console.log("[workflow/run] client disconnected — aborting all active agents");
    for (const agent of currentWorkflow!.getAvailableAgents()) {
      agent.abort().catch(() => {});
    }
  });

  const send = (payload: object) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendEvent = (agentId: string, event: any) => {
    handleEventWithClient(event, (payload) => {
      send({ ...payload, agentId });
    });
  };

  // Wire tool approval callbacks so the frontend can approve/reject interface tool calls
  for (const level of currentWorkflow.executionQueue.levels) {
    for (const node of level) {
      const agent = currentWorkflow.getAgentById(node.id);
      if (agent) {
        const nodeId = node.id;
        agent.onToolApprovalRequired((toolCallId, toolName, args) => {
          send({ type: "tool_approval_required", agentId: nodeId, toolCallId, name: toolName, args });
        });
      }
    }
  }

  try {
    console.log(`[workflow/run] Starting workflow with message: "${message.slice(0, 100)}..."`);
    await runWorkflow(message, currentWorkflow, sendEvent, send);
    send({ type: "workflow_done" });
    console.log("[workflow/run] Workflow completed");
  } catch (err: any) {
    console.error("[workflow/run] error:", err);
    send({ type: "error", message: err?.message ?? String(err) });
  } finally {
    res.end();
  }
});

/**
 * POST /workflows/tool-approve
 * Body: { agentId: string, toolCallId: string }
 * Approves a pending interface tool call on a workflow agent.
 */
router.post("/tool-approve", (req, res) => {
  if (!currentWorkflow) {
    res.status(400).json({ error: "No compiled workflow" });
    return;
  }
  const { agentId, toolCallId } = req.body as { agentId?: string; toolCallId?: string };
  if (!agentId || !toolCallId) {
    res.status(400).json({ error: "agentId and toolCallId are required" });
    return;
  }
  const agent = currentWorkflow.getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: `No workflow agent found with id "${agentId}"` });
    return;
  }
  agent.approveToolCall(toolCallId);
  res.json({ success: true });
});

/**
 * POST /workflows/tool-reject
 * Body: { agentId: string, toolCallId: string, comment?: string }
 * Rejects a pending interface tool call on a workflow agent.
 */
router.post("/tool-reject", (req, res) => {
  if (!currentWorkflow) {
    res.status(400).json({ error: "No compiled workflow" });
    return;
  }
  const { agentId, toolCallId, comment } = req.body as { agentId?: string; toolCallId?: string; comment?: string };
  if (!agentId || !toolCallId) {
    res.status(400).json({ error: "agentId and toolCallId are required" });
    return;
  }
  const agent = currentWorkflow.getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: `No workflow agent found with id "${agentId}"` });
    return;
  }
  agent.rejectToolCall(toolCallId, comment);
  res.json({ success: true });
});

// ── Jev (OpenRouter decision node) ───────────────────────────────────────────

/** Keeps only what the Jev form sets: key, question, type and choices. */
function parseJevConfig(body: unknown): JevConfig {
  const { apiKey, instructions, type, choices } = (body && typeof body === "object" ? body : {}) as Record<string, any>;
  const config: JevConfig = {};
  if (typeof apiKey === "string" && apiKey) config.apiKey = apiKey;
  if (typeof instructions === "string" && instructions) config.instructions = instructions;
  if (type === "choice" || type === "noul") config.type = type;
  if (Array.isArray(choices)) {
    const kept = choices
      .filter(c => c && typeof c.id === "string" && c.id.trim())
      .map(c => ({ id: c.id.trim(), description: String(c.description ?? ""), agent: String(c.agent ?? "") }));
    if (kept.length > 0) config.choices = kept;
  }
  return config;
}

/** What the API returns. The key is write-only: it is stored, never sent back. */
function jevView({ config: { apiKey, ...config }, ...rest }: JevDocument) {
  return { ...rest, config, hasApiKey: !!apiKey };
}

/**
 * POST /workflows/jev
 * Body: { apiKey?, instructions?, type?, choices? }.
 * Stores a new Jev in the "jevs" collection. Returns it with its generated jev_id.
 */
router.post("/jev", async (req, res) => {
  try {
    const doc: JevDocument = {
      jev_id: uuidv4(),
      config: parseJevConfig(req.body),
      created_at: new Date(),
      updated_at: new Date(),
    };
    await saveJev(doc);
    console.log(`[workflows/jev] created ${doc.jev_id}`);
    res.status(201).json(jevView(doc));
  } catch (err: any) {
    console.error("[workflows/jev POST]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * GET /workflows/jev
 * Lists all Jevs, most recently updated first.
 */
router.get("/jev", async (_req, res) => {
  try {
    res.json((await getAllJevs()).map(jevView));
  } catch (err: any) {
    console.error("[workflows/jev GET /]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * GET /workflows/jev/:id
 * Returns a single Jev by ID.
 */
router.get("/jev/:id", async (req, res) => {
  try {
    const doc = await getJev(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Jev not found" });
      return;
    }
    res.json(jevView(doc));
  } catch (err: any) {
    console.error("[workflows/jev GET /:id]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * PUT /workflows/jev/:id
 * Body: { apiKey?, instructions?, type?, choices? }. Replaces the stored config.
 * An empty or missing apiKey keeps the stored one (the key is never sent back to the form).
 */
router.put("/jev/:id", async (req, res) => {
  try {
    const existing = await getJev(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Jev not found" });
      return;
    }
    const config = parseJevConfig(req.body);
    if (!config.apiKey && existing.config.apiKey) config.apiKey = existing.config.apiKey;

    await updateJev(req.params.id, config);
    res.json(jevView({ ...existing, config, updated_at: new Date() }));
  } catch (err: any) {
    console.error("[workflows/jev PUT /:id]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * DELETE /workflows/jev/:id
 * Removes the Jev.
 */
router.delete("/jev/:id", async (req, res) => {
  try {
    if (!(await deleteJev(req.params.id))) {
      res.status(404).json({ error: "Jev not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[workflows/jev DELETE /:id]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;

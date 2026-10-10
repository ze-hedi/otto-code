import { Router } from "express";
import { AgentsStorage, InterfaceStorage } from "../../../../agents/workflow-types.js";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import { Workflow } from "../../../../agents/workflow.js";
import { buildInterfaceStorage, buildAgentsStorage, validateInterfaceRules, runWorkflow } from "../services/workflow-manager.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";

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
router.post("/agents", async (_req, res) => {
  try {
    currentAgentsStorage = await buildAgentsStorage();
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

    const schema: WorkflowSchema = req.body;

    if (!schema.components || !schema.connections) {
      res.status(400).json({ error: "components and connections are required" });
      return;
    }

    console.log("[compile] Received workflow schema:", JSON.stringify(schema, null, 2));

    const validationErrors = validateInterfaceRules(schema);
    if (validationErrors.length > 0) {
      console.log("[compile] Validation errors:", validationErrors);
      res.status(400).json({ error: validationErrors.join("\n") });
      return;
    }

    currentInterfaceStorage = await buildInterfaceStorage(schema, currentAgentsStorage);
    console.log("[compile] InterfaceStorage saved globally");

    // Build the Workflow object and its execution queue
    currentWorkflow = new Workflow(schema, currentAgentsStorage, currentInterfaceStorage);
    currentWorkflow.buildExecutionQueue();
    console.log("[compile] Workflow built and execution queue ready");

    const executionQueue = currentWorkflow.executionQueue;
    const levelsSummary = executionQueue.levels.map((level, i) =>
      ({ level: i, agents: level.map(n => n.id) })
    );
    console.log("[compile] Execution levels:", JSON.stringify(levelsSummary, null, 2));

    const interfaceNodes = schema.components.filter(c => c.type === "interface");
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
    res.status(500).json({ error: err?.message ?? String(err) });
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

  const send = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendEvent = (agentId: string, event: any) => {
    handleEventWithClient(event, (payload) => {
      send({ ...payload, agentId });
    });
  };

  try {
    console.log(`[workflow/run] Starting workflow with message: "${message.slice(0, 100)}..."`);
    await runWorkflow(message, currentWorkflow, sendEvent);
    send({ type: "workflow_done" });
    console.log("[workflow/run] Workflow completed");
  } catch (err: any) {
    console.error("[workflow/run] error:", err);
    send({ type: "error", message: err?.message ?? String(err) });
  } finally {
    res.end();
  }
});

export default router;

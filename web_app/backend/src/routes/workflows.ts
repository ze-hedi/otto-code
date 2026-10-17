import fs from "fs";
import path from "path";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { AgentsStorage, InterfaceStorage } from "../../../../agents/workflow-types.js";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import { Workflow } from "../../../../agents/workflow.js";
import { buildInterfaceStorage, buildAgentsStorage, validateInterfaceRules, runWorkflow } from "../services/workflow-manager.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import { getWorkflow as getWorkflowDoc, updateWorkflow } from "../db/mongo.js";

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
/**
 * Extracts the structural fingerprint of a workflow schema for comparison.
 * Only agent IDs and connections matter — positions are ignored.
 */
function extractStructuralSchema(schema: WorkflowSchema) {
  const agentIds = schema.components
    .filter(c => c.type === "agent")
    .map(c => c.id)
    .sort();
  const connections = schema.connections
    .map(c => ({ from: c.from, to: c.to }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { agentIds, connections };
}

function structurallyEqual(
  a: { agentIds: string[]; connections: { from: string; to: string }[] },
  b: { agentIds: string[]; connections: { from: string; to: string }[] },
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

router.post("/compile", async (req, res) => {
  try {
    const { guardrailsOnInterfaces, workflowId, sessionMode, sessionId: requestedSessionId, playground: reqPlayground, ...schema } = req.body as WorkflowSchema & {
      guardrailsOnInterfaces?: boolean;
      workflowId?: string;
      /** "new" = create fresh session, "continue" = reuse activeSessionId */
      sessionMode?: "new" | "continue";
      /** Explicit session ID to resume (when user picks from the dropdown) */
      sessionId?: string;
      playground?: string;
    };

    // Always refresh AgentsStorage from DB to pick up agents created since page load
    const playgroundHint = currentAgentsStorage
      ? [...currentAgentsStorage.getAll().values()].find(c => c.playground)?.playground
      : undefined;
    currentAgentsStorage = await buildAgentsStorage(
      reqPlayground ?? playgroundHint,
    );

    if (!schema.components || !schema.connections) {
      res.status(400).json({ error: "components and connections are required" });
      return;
    }

    console.log("[compile] Received workflow schema:", JSON.stringify(schema, null, 2));
    console.log("[compile] guardrailsOnInterfaces:", guardrailsOnInterfaces ?? false);
    console.log("[compile] sessionMode:", sessionMode ?? "auto");

    const validationErrors = validateInterfaceRules(schema);
    if (validationErrors.length > 0) {
      console.log("[compile] Validation errors:", validationErrors);
      res.status(400).json({ error: validationErrors.join("\n") });
      return;
    }

    // ── Session management ──────────────────────────────────────────────────
    const currentStructure = extractStructuralSchema(schema);
    let workflowSessionId: string | undefined;

    if (workflowId) {
      const workflowDoc = await getWorkflowDoc(workflowId);
      const previousStructure = workflowDoc?.lastCompiledSchema;

      if (!previousStructure) {
        // First compile ever — create new session
        workflowSessionId = uuidv4();
        console.log("[compile] First compile — new session:", workflowSessionId);
      } else if (!structurallyEqual(previousStructure, currentStructure)) {
        // Structure changed — wipe old sessions, create new session
        const playground = [...currentAgentsStorage.getAll().values()].find(c => c.playground)?.playground;
        if (playground) {
          const workflowDir = path.join(playground, ".otto-sessions", `workflow-${workflowId}`);
          if (fs.existsSync(workflowDir)) {
            fs.rmSync(workflowDir, { recursive: true, force: true });
            console.log(`[compile] Structure changed — wiped sessions: ${workflowDir}`);
          }
        }
        workflowSessionId = uuidv4();
        console.log("[compile] Structure changed — new session:", workflowSessionId);
      } else if (sessionMode === "new") {
        // Same structure, user explicitly wants a new session
        workflowSessionId = uuidv4();
        console.log("[compile] Same structure, user chose new session:", workflowSessionId);
      } else {
        // Same structure, continue existing session (use explicit ID if provided, else active)
        workflowSessionId = requestedSessionId ?? workflowDoc?.activeSessionId;
        console.log("[compile] Same structure, continuing session:", workflowSessionId);
      }

      // Persist the compiled schema and active session
      await updateWorkflow(workflowId, {
        lastCompiledSchema: currentStructure,
        activeSessionId: workflowSessionId,
        compiled: true,
      });
    }

    // ── Build workflow ──────────────────────────────────────────────────────
    currentInterfaceStorage = await buildInterfaceStorage(schema, currentAgentsStorage);
    console.log("[compile] InterfaceStorage saved globally");

    currentWorkflow = new Workflow(schema, currentAgentsStorage, currentInterfaceStorage);
    currentWorkflow.buildExecutionQueue(guardrailsOnInterfaces ?? false, workflowId, workflowSessionId);
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
      sessionId: workflowSessionId,
    };

    console.log("[compile] Compiled result:", JSON.stringify(result, null, 2));

    res.json({ ok: true, compiled: result });
  } catch (err: any) {
    console.error("[compile] error:", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * GET /workflows/:workflowId/sessions
 * Lists all session subdirectories for a given workflow.
 */
router.get("/:workflowId/sessions", async (req, res) => {
  try {
    const { workflowId } = req.params;
    const workflowDoc = await getWorkflowDoc(workflowId);
    if (!workflowDoc) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    const playground = workflowDoc.playground;
    if (!playground) {
      res.json({ sessions: [], activeSessionId: null });
      return;
    }

    const workflowDir = path.join(playground, ".otto-sessions", `workflow-${workflowId}`);
    if (!fs.existsSync(workflowDir)) {
      res.json({ sessions: [], activeSessionId: workflowDoc.activeSessionId ?? null });
      return;
    }

    const entries = fs.readdirSync(workflowDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const sessionPath = path.join(workflowDir, d.name);
        const stat = fs.statSync(sessionPath);
        const agentFiles = fs.readdirSync(sessionPath).filter(f => f.endsWith(".jsonl"));
        return {
          sessionId: d.name,
          createdAt: stat.birthtime.toISOString(),
          agentCount: agentFiles.length,
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    res.json({ sessions: entries, activeSessionId: workflowDoc.activeSessionId ?? null });
  } catch (err: any) {
    console.error("[workflows/sessions] error:", err);
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

export default router;

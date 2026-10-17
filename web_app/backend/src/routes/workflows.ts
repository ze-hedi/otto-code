import fs from "fs";
import path from "path";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";
import { AgentsStorage, InterfaceStorage } from "../../../../agents/workflow-types.js";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import { Workflow } from "../../../../agents/workflow.js";
import { buildInterfaceStorage, buildAgentsStorage, validateInterfaceRules, runWorkflow, interfaceTools } from "../services/workflow-manager.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import { getWorkflow as getWorkflowDoc, updateWorkflow } from "../db/mongo.js";

const router = Router();

// ── Global state (lives for the lifetime of the server) ──────────────────────

let currentAgentsStorage: AgentsStorage | null = null;
let currentInterfaceStorage: InterfaceStorage | null = null;
let currentWorkflow: Workflow | null = null;

// ── Runtime busy state (not persisted) ───────────────────────────────────────
let workflowBusy = false;
let workflowEmitter: EventEmitter | null = null;

function markWorkflowBusy(): EventEmitter {
  workflowBusy = true;
  workflowEmitter = new EventEmitter();
  workflowEmitter.setMaxListeners(20);
  return workflowEmitter;
}

function markWorkflowIdle() {
  workflowBusy = false;
  if (workflowEmitter) {
    workflowEmitter.emit("done");
    workflowEmitter.removeAllListeners();
    workflowEmitter = null;
  }
}

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
    const { guardrailsOnInterfaces, workflowId, sessionMode, sessionId: requestedSessionId, playground: reqPlayground, interfaceConfigs: reqInterfaceConfigs, ...schema } = req.body as WorkflowSchema & {
      guardrailsOnInterfaces?: boolean;
      workflowId?: string;
      /** "new" = create fresh session, "continue" = resume `sessionId` */
      sessionMode?: "new" | "continue";
      /** Session ID to resume (required with "continue") */
      sessionId?: string;
      playground?: string;
      interfaceConfigs?: Record<string, import("../types.js").InterfaceConfig>;
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

      if (sessionMode !== "new" && sessionMode !== "continue") {
        res.status(400).json({ error: 'sessionMode ("new" | "continue") is required' });
        return;
      }

      if (
        sessionMode === "continue" &&
        previousStructure &&
        structurallyEqual(previousStructure, currentStructure)
      ) {
        // Same structure: resume the session the user picked
        const playground = workflowDoc?.playground
          ?? [...currentAgentsStorage.getAll().values()].find(c => c.playground)?.playground;
        const sessionDir = requestedSessionId && playground
          ? path.join(playground, ".otto-sessions", `workflow-${workflowId}`, path.basename(requestedSessionId))
          : undefined;
        if (!sessionDir || !fs.existsSync(sessionDir)) {
          res.status(400).json({ error: "sessionId does not match an existing session" });
          return;
        }
        workflowSessionId = path.basename(requestedSessionId!);
        console.log("[compile] Continuing session:", workflowSessionId);
      } else {
        // New session requested, first compile, or structure changed (old sessions are kept)
        workflowSessionId = uuidv4();
        console.log("[compile] New session:", workflowSessionId);
      }

      await updateWorkflow(workflowId, {
        lastCompiledSchema: currentStructure,
        compiled: true,
      });
    }

    // ── Build workflow ──────────────────────────────────────────────────────
    // Use interfaceConfigs from request body, or fall back to workflow doc
    const interfaceConfigs = reqInterfaceConfigs ?? (workflowId ? (await getWorkflowDoc(workflowId))?.interfaceConfigs : undefined);
    currentInterfaceStorage = await buildInterfaceStorage(schema, currentAgentsStorage, interfaceConfigs);
    console.log("[compile] InterfaceStorage saved globally");

    currentWorkflow = new Workflow(schema, currentAgentsStorage, currentInterfaceStorage);
    currentWorkflow.buildExecutionQueue(guardrailsOnInterfaces ?? false, workflowId, workflowSessionId);
    console.log("[compile] Workflow built and execution queue ready");

    // ── Load existing session JSONL files when resuming ────────────────────
    if (sessionMode === "continue" && workflowId && workflowSessionId) {
      const playground = currentAgentsStorage
        ? [...currentAgentsStorage.getAll().values()].find(c => c.playground)?.playground
        : undefined;
      if (playground) {
        const sessionDir = path.join(playground, ".otto-sessions", `workflow-${workflowId}`, workflowSessionId);
        if (fs.existsSync(sessionDir)) {
          const jsonlFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith(".jsonl"));
          for (const agentNode of currentWorkflow.executionQueue.levels.flat()) {
            const agent = currentWorkflow.getAgentById(agentNode.id);
            if (!agent) continue;
            const agentConfig = currentAgentsStorage!.getAgentByID(agentNode.id);
            const safeName = (agentConfig?.name ?? agentNode.id).replace(/[^a-zA-Z0-9_-]/g, "_");
            const expectedFile = `${safeName}-main.jsonl`;
            if (jsonlFiles.includes(expectedFile)) {
              try {
                await agent.loadSession(path.join(sessionDir, expectedFile));
                console.log(`[compile] Loaded session for agent "${agentNode.id}" from ${expectedFile}`);
              } catch (err) {
                console.warn(`[compile] Failed to load session for "${agentNode.id}":`, err);
              }
            }
          }
        }
      }
    }

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
 * GET /workflows/interface-defaults
 * Returns the hardcoded default values for each interface type.
 */
router.get("/interface-defaults", (_req, res) => {
  const paramDefaults: Record<string, Record<string, string>> = {
    delegate: {
      task: "a clear description of a task to be run. Be specific about expected inputs, outputs, files to create/modify, and acceptance criteria. For explorer tasks, specify the question to answer and the subfolder to explore. For verifier tasks, list every file the preceding workers touched so tests can be written for all of them.",
      agent: "which agent to assign this task to. Use 'explorer' to survey the codebase first, then 'worker' for implementation, and 'verifier' after every implementation batch.",
    },
    forward: {
      result: "the result of your work to forward to the next agent",
    },
    accumulate: {
      agent: "which agent produced this result",
      result: "the result produced by this agent to be accumulated into a single output",
    },
    route: {
      route: "which agent to route to",
      result: "the result/context to pass to the routed agent",
    },
  };

  const defaults: Record<string, { description: string; promptSnippet?: string; promptGuidelines?: string[]; paramDescriptions: Record<string, string> }> = {};

  for (const [key, tool] of interfaceTools.entries()) {
    defaults[key] = {
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: tool.promptGuidelines,
      paramDescriptions: paramDefaults[key] ?? {},
    };
  }

  res.json(defaults);
});

/**
 * GET /workflows/status
 * Returns runtime compiled/busy state (not persisted — in-memory only).
 */
router.get("/status", (_req, res) => {
  res.json({ compiled: currentWorkflow !== null, busy: workflowBusy });
});

/**
 * GET /workflows/events
 * SSE reconnection endpoint. If workflow is busy, subscribes to the emitter.
 * If idle, sends workflow_idle and closes immediately.
 */
router.get("/events", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (!workflowBusy || !workflowEmitter) {
    res.write(`data: ${JSON.stringify({ type: "workflow_idle" })}\n\n`);
    res.end();
    return;
  }

  const emitter = workflowEmitter;

  const onEvent = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    (res.socket as any)?.flush?.();
    (res as any).flush?.();
  };

  const onDone = () => {
    res.write(`data: ${JSON.stringify({ type: "workflow_idle" })}\n\n`);
    res.end();
  };

  emitter.on("event", onEvent);
  emitter.once("done", onDone);

  res.on("close", () => {
    emitter.off("event", onEvent);
    emitter.off("done", onDone);
  });
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
      res.json({ sessions: [] });
      return;
    }

    const workflowDir = path.join(playground, ".otto-sessions", `workflow-${workflowId}`);
    if (!fs.existsSync(workflowDir)) {
      res.json({ sessions: [] });
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
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ sessions: entries });
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

  const emitter = markWorkflowBusy();

  let closed = false;
  res.on("close", () => {
    closed = true;
    console.log("[workflow/run] client disconnected — workflow continues running");
  });

  const send = (payload: object) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendEvent = (agentId: string, event: any) => {
    handleEventWithClient(event, (payload) => {
      const tagged = { ...payload, agentId };
      send(tagged);
      emitter.emit("event", tagged);
    });
  };

  // Wire tool approval callbacks so the frontend can approve/reject interface tool calls
  for (const level of currentWorkflow.executionQueue.levels) {
    for (const node of level) {
      const agent = currentWorkflow.getAgentById(node.id);
      if (agent) {
        const nodeId = node.id;
        agent.onToolApprovalRequired((toolCallId, toolName, args) => {
          const payload = { type: "tool_approval_required", agentId: nodeId, toolCallId, name: toolName, args };
          send(payload);
          emitter.emit("event", payload);
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
    markWorkflowIdle();
    res.end();
  }
});

/**
 * POST /workflows/chat-agent
 * Body: { agentId: string, message: string }
 * Sends a message to a specific agent in the workflow, streaming SSE events.
 */
router.post("/chat-agent", async (req, res) => {
  if (!currentWorkflow) {
    res.status(400).json({ error: "No compiled workflow. Call POST /workflows/compile first." });
    return;
  }

  const { agentId, message } = req.body;
  if (!agentId || typeof agentId !== "string") {
    res.status(400).json({ error: "agentId (string) is required" });
    return;
  }
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message (string) is required" });
    return;
  }

  const agent = currentWorkflow.getAgentById(agentId);
  if (!agent) {
    res.status(404).json({ error: `No workflow agent found with id "${agentId}"` });
    return;
  }

  // SSE setup
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emitter = markWorkflowBusy();

  let closed = false;
  res.on("close", () => {
    closed = true;
    console.log("[workflow/chat-agent] client disconnected — workflow continues running");
  });

  const send = (payload: object) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendEvent = (eventAgentId: string, event: any) => {
    handleEventWithClient(event, (payload) => {
      const tagged = { ...payload, agentId: eventAgentId };
      send(tagged);
      emitter.emit("event", tagged);
    });
  };

  // Wire tool approval callbacks for all agents (downstream agents may also need approval)
  for (const level of currentWorkflow.executionQueue.levels) {
    for (const node of level) {
      const a = currentWorkflow.getAgentById(node.id);
      if (a) {
        const nodeId = node.id;
        a.onToolApprovalRequired((toolCallId, toolName, args) => {
          const payload = { type: "tool_approval_required", agentId: nodeId, toolCallId, name: toolName, args };
          send(payload);
          emitter.emit("event", payload);
        });
      }
    }
  }

  try {
    console.log(`[workflow/chat-agent] Running workflow from agent "${agentId}": "${message.slice(0, 100)}..."`);
    await runWorkflow(message, currentWorkflow, sendEvent, agentId);
    send({ type: "workflow_done" });
  } catch (err: any) {
    console.error(`[workflow/chat-agent] error:`, err);
    send({ type: "error", message: err?.message ?? String(err) });
  } finally {
    markWorkflowIdle();
    res.end();
  }
});

/**
 * GET /workflows/agent-messages?agentId=<id>
 * Returns the conversation history for a workflow agent with a loaded session.
 */
router.get("/agent-messages", async (req, res) => {
  if (!currentWorkflow) {
    res.json([]);
    return;
  }
  const agentId = req.query.agentId as string | undefined;
  if (!agentId) {
    res.status(400).json({ error: "agentId query parameter is required" });
    return;
  }
  const agent = currentWorkflow.getAgentById(agentId);
  if (!agent) {
    res.json([]);
    return;
  }
  try {
    const rawMessages = await agent.getMessages();
    const transformed = transformWorkflowMessages(rawMessages);
    res.json(transformed);
  } catch (err: any) {
    console.error(`[workflow/agent-messages] error:`, err);
    res.json([]);
  }
});

function transformWorkflowMessages(rawMessages: any[]): any[] {
  const out: any[] = [];
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
      const parts: any[] = [];
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
  }
  return out;
}

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

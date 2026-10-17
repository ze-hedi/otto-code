import type { Response } from "express";
import type { Workflow } from "../../../../agents/workflow.js";
import { handleEventWithClient } from "../../../../agents/pi-agent-utils.js";
import { runWorkflow } from "./workflow-core.js";

/** Runs a compiled workflow, streaming SSE events tagged with agentId. */
export async function streamWorkflowRun(workflow: Workflow, message: string, res: Response): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let closed = false;
  res.on("close", () => {
    closed = true;
    console.log("[workflow/run] client disconnected — aborting all active agents");
    for (const agent of workflow.getAvailableAgents()) {
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
  for (const level of workflow.executionQueue.levels) {
    for (const node of level) {
      const agent = workflow.getAgentById(node.id);
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
    await runWorkflow(message, workflow, sendEvent);
    send({ type: "workflow_done" });
    console.log("[workflow/run] Workflow completed");
  } catch (err: any) {
    console.error("[workflow/run] error:", err);
    send({ type: "error", message: err?.message ?? String(err) });
  } finally {
    res.end();
  }
}

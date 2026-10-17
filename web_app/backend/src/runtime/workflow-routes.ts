import crypto from "crypto";
import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import { getAllAgentDocs } from "../services/agent-manager.js";
import { validateInterfaceRules } from "../services/workflow-core.js";
import { resolveWorkflowSession } from "../services/workflow-session.js";
import { getWorkflow as getWorkflowDoc } from "../db/mongo.js";
import type { RuntimeManager } from "./manager.js";
import { proxyToRuntime, sendRuntimeError } from "./proxy.js";

interface ActiveWorkflow { id: string; playground: string }

/**
 * Kubernetes-mode replacement for the compile/run/approve endpoints of routes/workflows.ts.
 * A workflow gets one pod that hosts all of its agents, because the interface tools hand results
 * between agents through in-process state.
 */
export function createWorkflowRuntimeRouter(mgr: RuntimeManager): Router {
  const router = Router();

  // Mirrors the module-level "current workflow" of the in-process implementation.
  let active: ActiveWorkflow | undefined;
  let lastPlayground: string | undefined;

  const guard = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res) => { fn(req, res).catch((err) => sendRuntimeError(res, err)); };

  router.post("/compile", guard(async (req, res) => {
    const {
      guardrailsOnInterfaces, workflowId, sessionMode, sessionId: requestedSessionId, playground: reqPlayground,
      ...schema
    } = req.body as WorkflowSchema & {
      guardrailsOnInterfaces?: boolean;
      workflowId?: string;
      sessionMode?: "new" | "continue";
      sessionId?: string;
      playground?: string;
    };

    if (!schema.components || !schema.connections) {
      res.status(400).json({ error: "components and connections are required" });
      return;
    }
    const validationErrors = validateInterfaceRules(schema);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: validationErrors.join("\n") });
      return;
    }

    const workflowDoc = workflowId ? await getWorkflowDoc(workflowId) : null;
    const playground = reqPlayground ?? workflowDoc?.playground ?? lastPlayground;
    if (!playground) {
      res.status(400).json({ error: "A playground is required to run a workflow in a container" });
      return;
    }
    lastPlayground = playground;

    // Always refresh from the DB to pick up agents created since the page loaded.
    const agentDocs = await getAllAgentDocs(playground);
    const agents = agentDocs.map((doc) => [doc.agent_id, doc.config] as const);

    const sessionId = await resolveWorkflowSession({
      workflowId, schema, sessionMode, requestedSessionId, playground,
    });

    const runtimeId = workflowId ?? `adhoc-${crypto.createHash("sha1").update(playground).digest("hex").slice(0, 10)}`;
    const handle = await mgr.ensure({ kind: "workflow", id: runtimeId, playground });
    const upstream = await mgr.request(handle, "/workflow/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema, agents, guardrailsOnInterfaces, workflowId, sessionId }),
    });
    const body = await upstream.json() as any;
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: body?.error ?? "Runner failed to compile the workflow" });
      return;
    }

    active = { id: runtimeId, playground };
    res.json({ ok: true, compiled: { ...body.compiled, sessionId } });
  }));

  function activeHandle(res: Response) {
    const handle = active && mgr.get("workflow", active.id);
    if (!handle) {
      res.status(400).json({
        error: active
          ? "The workflow container is no longer running (idle timeout). Compile the workflow again."
          : "No compiled workflow. Call POST /workflows/compile first.",
      });
    }
    return handle || undefined;
  }

  router.post("/run", guard(async (req, res) => {
    const handle = activeHandle(res);
    if (handle) await proxyToRuntime(mgr, handle, req, res, "/workflow/run");
  }));
  router.post("/tool-approve", guard(async (req, res) => {
    const handle = activeHandle(res);
    if (handle) await proxyToRuntime(mgr, handle, req, res, "/workflow/tool-approve");
  }));
  router.post("/tool-reject", guard(async (req, res) => {
    const handle = activeHandle(res);
    if (handle) await proxyToRuntime(mgr, handle, req, res, "/workflow/tool-reject");
  }));

  return router;
}

/** Mounted ahead of routes/workflow-store.ts: deleting a workflow also removes its pod. */
export function createWorkflowStoreRuntimeRouter(mgr: RuntimeManager): Router {
  const router = Router();
  router.delete("/:id", async (req, _res, next) => {
    await mgr.stop("workflow", req.params.id as string)
      .catch((err) => console.warn("[runtime] stop failed:", err?.message ?? err));
    next();
  });
  return router;
}

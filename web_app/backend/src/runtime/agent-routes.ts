import { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { getAgentDoc } from "../services/agent-manager.js";
import type { RuntimeHandle, RuntimeManager } from "./manager.js";
import { proxyToRuntime, sendRuntimeError } from "./proxy.js";

/**
 * Mounted ahead of routes/agents.ts in kubernetes mode. Every endpoint that talks to a live agent
 * is forwarded to that agent's pod; control-plane endpoints (CRUD, session files on disk) fall
 * through to the regular router.
 */
export function createAgentRuntimeRouter(mgr: RuntimeManager): Router {
  const router = Router();

  const guard = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res) => { fn(req, res).catch((err) => sendRuntimeError(res, err)); };

  /** Starts (or reuses) the agent's pod. Replies and returns undefined when it can't. */
  async function startRuntime(req: Request, res: Response): Promise<RuntimeHandle | undefined> {
    const id = req.params.id as string;
    const doc = await getAgentDoc(id);
    if (!doc) {
      res.status(404).json({ error: "Agent not found" });
      return undefined;
    }
    const playground = doc.config.playground;
    if (!playground) {
      res.status(400).json({ error: "Agent has no playground configured; one is required to mount into its container" });
      return undefined;
    }
    return mgr.ensure(
      { kind: "agent", id, playground },
      async () => ({ agentId: id, config: doc.config }),
    );
  }

  /** Forwards to a pod that must already be running; never starts one. */
  function ifRunning(
    target: string,
    fallback: (req: Request, res: Response) => void,
    opts: { touch?: boolean } = {},
  ): RequestHandler {
    return guard(async (req, res) => {
      const handle = mgr.get("agent", req.params.id as string);
      if (!handle) return fallback(req, res);
      await proxyToRuntime(mgr, handle, req, res, target, opts);
    });
  }

  /** Forwards to the agent's pod, starting it first when needed. */
  function startingIfNeeded(target: string): RequestHandler {
    return guard(async (req, res) => {
      const handle = await startRuntime(req, res);
      if (handle) await proxyToRuntime(mgr, handle, req, res, target);
    });
  }

  router.post("/:id/chat", startingIfNeeded("/agent/chat"));
  router.get("/:id/messages", startingIfNeeded("/agent/messages"));
  router.get("/:id/system-prompt", startingIfNeeded("/agent/system-prompt"));
  router.post("/:id/new-session", startingIfNeeded("/agent/new-session"));
  router.post("/:id/load-session", startingIfNeeded("/agent/load-session"));

  // These must not wake a sleeping agent: the UI polls status for every agent in a list.
  router.get("/:id/status", ifRunning("/agent/status", (_req, res) => {
    res.json({ busy: false, sessionKey: null });
  }, { touch: false }));
  router.get("/:id/stats", ifRunning("/agent/stats", (_req, res) => {
    res.status(404).json({ error: "Agent not running" });
  }, { touch: false }));
  router.post("/:id/stop", ifRunning("/agent/stop", (_req, res) => {
    res.json({ stopped: false, reason: "not busy" });
  }));
  router.post("/:id/tool-approve", ifRunning("/agent/tool-approve", (_req, res) => {
    res.status(404).json({ error: "Agent not found" });
  }));
  router.post("/:id/tool-reject", ifRunning("/agent/tool-reject", (_req, res) => {
    res.status(404).json({ error: "Agent not found" });
  }));
  router.post("/:id/clarification-answer", ifRunning("/agent/clarification-answer", (_req, res) => {
    res.json({ success: false });
  }));
  router.get("/:id/events", ifRunning("/agent/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "agent_idle" })}\n\n`);
    res.end();
  }));

  // Deleting an agent also removes its pod, then the regular router deletes the document.
  router.delete("/:id", async (req, _res, next) => {
    await mgr.stop("agent", req.params.id as string)
      .catch((err) => console.warn("[runtime] stop failed:", err?.message ?? err));
    next();
  });

  return router;
}

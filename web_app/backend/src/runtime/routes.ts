import { Router } from "express";
import type { RuntimeKind } from "./config.js";
import type { RuntimeManager } from "./manager.js";

/** GET /runtimes, DELETE /runtimes/:kind/:id — visibility and manual teardown of pods. */
export function createRuntimeAdminRouter(mgr: RuntimeManager): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(mgr.list());
  });

  router.delete("/:kind/:id", async (req, res) => {
    const kind = req.params.kind as RuntimeKind;
    if (kind !== "agent" && kind !== "workflow") {
      res.status(400).json({ error: "kind must be 'agent' or 'workflow'" });
      return;
    }
    try {
      res.json({ stopped: await mgr.stop(kind, req.params.id as string) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  return router;
}

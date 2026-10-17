import fs from "fs";
import path from "path";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { saveWorkflow, getWorkflow, getAllWorkflows, updateWorkflow, deleteWorkflow } from "../db/mongo.js";
import type { WorkflowDocument } from "../types.js";

const router = Router();

/**
 * POST /workflow-store
 * Body: { name, description?, playground?, schema }
 * Creates a new workflow document. Returns the generated workflow_id.
 */
router.post("/", async (req, res) => {
  try {
    const { name, description, playground, schema, interfaceConfigs } = req.body as Partial<WorkflowDocument>;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (!schema?.components || !schema?.connections) {
      res.status(400).json({ error: "schema.components and schema.connections are required" });
      return;
    }
    const doc: WorkflowDocument = {
      workflow_id: uuidv4(),
      name,
      description,
      playground,
      schema,
      interfaceConfigs,
      created_at: new Date(),
      updated_at: new Date(),
    };
    await saveWorkflow(doc);
    res.json({ workflow_id: doc.workflow_id });
  } catch (err: any) {
    console.error("[workflow-store POST]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * GET /workflow-store?playground=<path>
 * Lists all workflows, optionally filtered by playground.
 */
router.get("/", async (req, res) => {
  try {
    const playground = req.query.playground as string | undefined;
    const docs = await getAllWorkflows(playground);
    res.json(docs);
  } catch (err: any) {
    console.error("[workflow-store GET /]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * GET /workflow-store/:id
 * Returns a single workflow by ID.
 */
router.get("/:id", async (req, res) => {
  try {
    const doc = await getWorkflow(req.params.id);
    if (!doc) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(doc);
  } catch (err: any) {
    console.error("[workflow-store GET /:id]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * PUT /workflow-store/:id
 * Body: { name?, description?, schema? }
 * Updates name, description, or schema.
 */
router.put("/:id", async (req, res) => {
  try {
    const { name, description, schema, interfaceConfigs } = req.body as Partial<WorkflowDocument>;
    const patch: Partial<WorkflowDocument> = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (schema !== undefined) patch.schema = schema;
    if (interfaceConfigs !== undefined) patch.interfaceConfigs = interfaceConfigs;
    await updateWorkflow(req.params.id, patch);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[workflow-store PUT /:id]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

/**
 * DELETE /workflow-store/:id
 * Removes the workflow document and the agent sessions it created
 * (<playground>/.otto-sessions/workflow-<id>/).
 */
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await getWorkflow(id);
    if (!doc) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }

    if (doc.playground) {
      const sessionsRoot = path.resolve(doc.playground, ".otto-sessions");
      const sessionDir = path.resolve(sessionsRoot, `workflow-${doc.workflow_id}`);
      if (path.dirname(sessionDir) === sessionsRoot && fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`[workflow-store DELETE] Removed sessions: ${sessionDir}`);
      }
    }

    await deleteWorkflow(id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[workflow-store DELETE /:id]", err);
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;

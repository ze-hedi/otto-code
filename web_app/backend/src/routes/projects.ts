import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/mongo.js";
import type { ProjectDocument } from "../types.js";

const router = Router();

router.get("/", async (_req, res) => {
  const db = getDb();
  const projects = await db.collection<ProjectDocument>("projects").find({}).sort({ created_at: -1 }).toArray();
  res.json(projects);
});

router.post("/", async (req, res) => {
  const { name, path, description } = req.body;
  if (!name || !path) {
    res.status(400).json({ error: "name and path are required" });
    return;
  }
  const db = getDb();
  const existing = await db.collection<ProjectDocument>("projects").findOne({ path });
  if (existing) {
    res.status(409).json({ error: "A project with that path already exists" });
    return;
  }
  const doc: ProjectDocument = {
    project_id: uuidv4(),
    name,
    path,
    ...(description && { description }),
    created_at: new Date(),
    updated_at: new Date(),
  };
  await db.collection<ProjectDocument>("projects").insertOne(doc);
  res.status(201).json(doc);
});

router.patch("/:id", async (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  const update: Partial<ProjectDocument> = { updated_at: new Date() };
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  const result = await db.collection<ProjectDocument>("projects").findOneAndUpdate(
    { project_id: req.params.id },
    { $set: update },
    { returnDocument: "after" }
  );
  if (!result) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(result);
});

router.delete("/:id", async (req, res) => {
  const db = getDb();
  const result = await db.collection<ProjectDocument>("projects").deleteOne({ project_id: req.params.id });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ deleted: true });
});

export default router;

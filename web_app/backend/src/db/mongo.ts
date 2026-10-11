import { MongoClient, Db } from "mongodb";
import type { WorkflowDocument } from "../types.js";

let client: MongoClient;
let db: Db;

export async function connectDb(uri = "mongodb://localhost:27017", dbName = "otto_web"): Promise<Db> {
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`Connected to MongoDB: ${dbName}`);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("Database not connected. Call connectDb() first.");
  return db;
}

// ── Workflow CRUD ─────────────────────────────────────────────────────────────

function workflowsCol() {
  return getDb().collection<WorkflowDocument>("workflows");
}

export async function saveWorkflow(doc: WorkflowDocument): Promise<void> {
  await workflowsCol().insertOne(doc as any);
}

export async function getWorkflow(id: string): Promise<WorkflowDocument | null> {
  return workflowsCol().findOne({ workflow_id: id }, { projection: { _id: 0 } });
}

export async function getAllWorkflows(playground?: string): Promise<WorkflowDocument[]> {
  const filter: Record<string, any> = {};
  if (playground) filter.playground = playground;
  return workflowsCol().find(filter, { projection: { _id: 0 } }).sort({ updated_at: -1 }).toArray();
}

export async function updateWorkflow(id: string, patch: Partial<WorkflowDocument>): Promise<void> {
  await workflowsCol().updateOne(
    { workflow_id: id },
    { $set: { ...patch, updated_at: new Date() } },
  );
}

export async function deleteWorkflow(id: string): Promise<void> {
  await workflowsCol().deleteOne({ workflow_id: id });
}

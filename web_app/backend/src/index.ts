import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Resolve .env relative to the repo root (two levels up from web_app/backend/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", "..", "..", ".env");
console.log("[env] loading from:", envPath);
dotenv.config({ path: envPath });

console.log("[env] DEEPSEEK_API_KEY:", process.env.DEEPSEEK_API_KEY ? "SET" : "NOT SET");

import express from "express";
import cors from "cors";
import { connectDb } from "./db/mongo.js";
import agentRoutes from "./routes/agents.js";
import workflowRoutes from "./routes/workflows.js";
import workflowStoreRoutes from "./routes/workflow-store.js";
import projectRoutes from "./routes/projects.js";
import dashboardRoutes from "./routes/dashboards.js";
import { getRuntimeManager, isKubernetesMode, startRuntime } from "./runtime/index.js";
import { createAgentRuntimeRouter } from "./runtime/agent-routes.js";
import { createWorkflowRuntimeRouter, createWorkflowStoreRuntimeRouter } from "./runtime/workflow-routes.js";
import { createRuntimeAdminRouter } from "./runtime/routes.js";

const app = express();
app.use(cors());
app.use(express.json());

// OTTO_RUNTIME=kubernetes: these run ahead of the regular routers and forward everything that
// touches a live agent/workflow to its pod. Everything else falls through unchanged.
if (isKubernetesMode()) {
  const runtimes = getRuntimeManager();
  app.use("/runtimes", createRuntimeAdminRouter(runtimes));
  app.use("/agents", createAgentRuntimeRouter(runtimes));
  app.use("/workflows", createWorkflowRuntimeRouter(runtimes));
  app.use("/workflow-store", createWorkflowStoreRuntimeRouter(runtimes));
}

app.use("/agents", agentRoutes);
app.use("/workflows", workflowRoutes);
app.use("/workflow-store", workflowStoreRoutes);
app.use("/projects", projectRoutes);
app.use("/dashboards", dashboardRoutes);

const PORT = process.env.PORT || 4000;

async function main() {
  await connectDb();
  await startRuntime();
  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}

main().catch(console.error);

import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import { RawPiAgent } from "../agents/raw-pi-agent.js";
import type { RawPiAgentConfig } from "../agents/pi-agent-configs.js";
import { handleEvent } from "../agents/pi-agent-utils.js";

const config: RawPiAgentConfig = {
  model: "deepseek/deepseek-v4-pro",
  sessionMode: "memory",
  systemPrompt: `You are a project manager agent. Your job is to break down a project into structured tasks and add them to the task manager using the available tools.

Work iteratively:
- Round 1: Identify the major workstreams (2-3 high-level tasks).
- Round 2: Decompose each workstream into concrete subtasks.
- Round 3: Review all tasks with get_tasks, fix gaps or overlaps.

Assign each task to the most appropriate specialist: "frontend-dev", "backend-dev", "designer", or "devops".
Set all initial states to "opened".
When done, say "TASK_PLANNING_COMPLETE".`,
  mcpServers: { "task-manager": "http://localhost:3100/mcp" },
  builtInTools: [],
};

const agent = new RawPiAgent(config);

await agent.chat(
  "Create tasks for building a frontend dashboard app for finance. It should have real-time charts, portfolio overview, transaction history, and alerts. Use React + TailwindCSS.",
  handleEvent,
);

await agent.disconnectMcp();
process.exit(0);

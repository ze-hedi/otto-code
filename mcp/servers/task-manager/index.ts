import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

type TaskState = "opened" | "in_work" | "closed";

interface Task {
  id: string;
  description: string;
  state: TaskState;
  executionAgent: string;
  createdAt: string;
}

const tasks: Task[] = [];
let nextId = 1;

const server = new McpServer({
  name: "task-manager",
  version: "1.0.0",
});

server.tool(
  "add_task",
  "Add a new task to the task list",
  {
    description: z.string().describe("Description of the task"),
    state: z.enum(["opened", "in_work", "closed"]).default("opened").describe("Initial state of the task"),
    executionAgent: z.string().describe("Name of the agent assigned to execute this task"),
  },
  async ({ description, state, executionAgent }) => {
    const task: Task = {
      id: String(nextId++),
      description,
      state,
      executionAgent,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    return {
      content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
    };
  }
);

server.tool(
  "get_tasks",
  "Get all tasks, optionally filtered by state or execution agent",
  {
    state: z.enum(["opened", "in_work", "closed"]).optional().describe("Filter by task state"),
    executionAgent: z.string().optional().describe("Filter by execution agent"),
  },
  async ({ state, executionAgent }) => {
    let filtered = tasks;
    if (state) filtered = filtered.filter((t) => t.state === state);
    if (executionAgent) filtered = filtered.filter((t) => t.executionAgent === executionAgent);
    return {
      content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
    };
  }
);

server.tool(
  "update_task",
  "Update an existing task's description or state",
  {
    id: z.string().describe("ID of the task to update"),
    description: z.string().optional().describe("New description for the task"),
    state: z.enum(["opened", "in_work", "closed"]).optional().describe("New state for the task"),
  },
  async ({ id, description, state }) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) {
      return {
        content: [{ type: "text", text: `Task with id "${id}" not found` }],
        isError: true,
      };
    }
    if (description !== undefined) task.description = description;
    if (state !== undefined) task.state = state;
    return {
      content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();

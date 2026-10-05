import { AgentsStorage } from "../../../../agents/workflow-types.js";
import type { RawPiAgentConfig } from "../../../../agents/pi-agent-configs.js";
import type { ToolInput } from "../../../../agents/pi-agent-types.js";
import { getAllAgentDocs } from "./agent-manager.js";

// ── Hardcoded interface tools (same pattern as workflow-interface-test.ts) ────

const delegationTool: ToolInput = {
  name: "delegation_tool",
  label: "delegation tool",
  description:
    "a tool that should be called by an agent when it estimates that it finished its job and it's ready to delegate to the future agents in the DAG",
  promptSnippet:
    "Tool used when the subagent ended its work and ready to delegate task for the agents in the graph",
  promptGuidelines: ["call this tool when you have completed your work and are ready to delegate"],
  executionMode: "sequential",
  terminate: true,
  execute: async (toolCallId, params) => {
    return { content: [{ type: "text", text: JSON.stringify(params) }] };
  },
};

const forwardTool: ToolInput = {
  name: "forward_tool",
  label: "forward tool",
  description:
    "a tool that should be called by an agent when it finished its job and is ready to forward the result to the next agent in the DAG",
  promptSnippet:
    "Tool used when the subagent ended its work and ready to forward results to the next agent",
  promptGuidelines: ["call this tool when you have completed your work and are ready to forward"],
  executionMode: "sequential",
  terminate: true,
  execute: async (toolCallId, params) => {
    return { content: [{ type: "text", text: JSON.stringify(params) }] };
  },
};

const accumulateTool: ToolInput = {
  name: "accumulate_tool",
  label: "accumulate tool",
  description:
    "a tool that should be called by an agent when it finished its job and is ready to send its result to be accumulated with other agents results",
  promptSnippet:
    "Tool used when the subagent ended its work and ready to accumulate results",
  promptGuidelines: ["call this tool when you have completed your work and are ready to send your result"],
  executionMode: "sequential",
  terminate: true,
  execute: async (toolCallId, params) => {
    return { content: [{ type: "text", text: JSON.stringify(params) }] };
  },
};

const routeTool: ToolInput = {
  name: "route_tool",
  label: "route tool",
  description:
    "a tool that should be called by an agent when it finished its job and needs to route the result to one of the available downstream agents",
  promptSnippet:
    "Tool used when the subagent ended its work and ready to route to a specific downstream agent",
  promptGuidelines: ["call this tool when you have completed your work and are ready to route"],
  executionMode: "sequential",
  terminate: true,
  execute: async (toolCallId, params) => {
    return { content: [{ type: "text", text: JSON.stringify(params) }] };
  },
};

export const interfaceTools = new Map<string, ToolInput>([
  ["delegate", delegationTool],
  ["forward", forwardTool],
  ["accumulate", accumulateTool],
  ["route", routeTool],
]);

// ── Build AgentsStorage from all agents in DB ────────────────────────────────

export async function buildAgentsStorage(): Promise<AgentsStorage> {
  const agentDocs = await getAllAgentDocs();
  const agentMap = new Map<string, RawPiAgentConfig>();

  for (const doc of agentDocs) {
    const c = doc.config;
    agentMap.set(doc.agent_id, {
      name: c.name,
      model: c.model,
      systemPrompt: c.systemPrompt,
      playground: c.playground,
      workingDir: c.workingDir,
      builtInTools: c.builtInTools,
      mcpServers: c.mcpServers,
      mcpConnectionTimeout: c.mcpConnectionTimeout,
      toolCallGuardrails: c.toolCallGuardrails,
      thinkingLevel: c.thinkingLevel,
      compaction: c.compaction,
      ...(c.subAgents && { subAgents: c.subAgents }),
    });
  }

  return new AgentsStorage(agentMap);
}

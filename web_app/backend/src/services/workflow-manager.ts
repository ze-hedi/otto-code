import { AgentsStorage, InterfaceStorage, NodeType } from "../../../../agents/workflow-types.js";
import type { WorkflowSchema } from "../../../../agents/workflow-types.js";
import type { RawPiAgentConfig } from "../../../../agents/pi-agent-configs.js";
import type { ToolInput } from "../../../../agents/pi-agent-types.js";
import type { AgentInterface } from "../../../../agents/workflow-interface.js";
import {
  DelegationInterface,
  ForwardInterface,
  AccumulateInterface,
  RouteInterface,
} from "../../../../agents/workflow-interface.js";
import { getAllAgentDocs } from "./agent-manager.js";
import type { Workflow } from "../../../../agents/workflow.js";
import type { AgentSessionEvent as AgentEvent } from "@mariozechner/pi-coding-agent";

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

export async function buildAgentsStorage(playground?: string): Promise<AgentsStorage> {
  const agentDocs = await getAllAgentDocs(playground);
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

// ── Build InterfaceStorage from a workflow schema ────────────────────────────

// Returns an array of error strings. Empty = valid.
export function validateInterfaceRules(schema: WorkflowSchema): string[] {
  const errors: string[] = [];
  const ifaceNodes = schema.components.filter(c => c.type === "interface");

  for (const iface of ifaceNodes) {
    const inputs = schema.connections.filter(c => c.to === iface.id).map(c => c.from);
    const outputs = schema.connections.filter(c => c.from === iface.id).map(c => c.to);
    const nIn = inputs.length;
    const nOut = outputs.length;

    switch (iface.id) {
      case "delegate":
        if (nIn !== 1)
          errors.push(`Delegate: expected 1 input but got ${nIn} (from: ${inputs.join(", ") || "none"}). Delegate is One → Many.`);
        if (nOut < 1)
          errors.push(`Delegate: expected at least 1 output but got 0. Delegate is One → Many.`);
        break;
      case "forward":
        if (nIn !== 1)
          errors.push(`Forward: expected 1 input but got ${nIn} (from: ${inputs.join(", ") || "none"}). Forward is One → One.`);
        if (nOut !== 1)
          errors.push(`Forward: expected 1 output but got ${nOut} (to: ${outputs.join(", ") || "none"}). Forward is One → One.`);
        break;
      case "accumulate":
        if (nIn < 1)
          errors.push(`Accumulate: expected at least 1 input but got 0. Accumulate is Many → One.`);
        if (nOut !== 1)
          errors.push(`Accumulate: expected 1 output but got ${nOut} (to: ${outputs.join(", ") || "none"}). Accumulate is Many → One.`);
        break;
      case "route":
        if (nIn !== 1)
          errors.push(`Route: expected 1 input but got ${nIn} (from: ${inputs.join(", ") || "none"}). Route is One → One*.`);
        if (nOut < 1)
          errors.push(`Route: expected at least 1 output but got 0. Route is One → One*.`);
        break;
    }
  }

  return errors;
}

export async function buildInterfaceStorage(schema: WorkflowSchema, agentsStorage: AgentsStorage): Promise<InterfaceStorage> {

  const interfaceNodes = schema.components.filter(c => c.type === "interface");

  const interfaceMap = new Map<string, AgentInterface>();

  for (const ifaceNode of interfaceNodes) {
    const incomingConns = schema.connections.filter(c => c.to === ifaceNode.id);
    const predecessorIds = incomingConns.map(c => c.from);

    const outgoingConns = schema.connections.filter(c => c.from === ifaceNode.id);
    const successorIds = outgoingConns.map(c => c.to);

    console.log(`[compile] Interface "${ifaceNode.id}": inputs=${predecessorIds}, outputs=${successorIds}`);

    const inputNames: [string, string][] = predecessorIds.map(id => {
      const agentConfig = agentsStorage.getAgentByID(id);
      const desc = agentConfig?.systemPrompt?.slice(0, 120) ?? id;
      return [id, desc];
    });

    const outputNames: [string, string][] = successorIds.map(id => {
      const agentConfig = agentsStorage.getAgentByID(id);
      const desc = agentConfig?.systemPrompt?.slice(0, 120) ?? id;
      return [id, desc];
    });

    const toolTemplate = interfaceTools.get(ifaceNode.id);
    if (!toolTemplate) {
      throw new Error(`Unknown interface type: ${ifaceNode.id}`);
    }

    const tool = { ...toolTemplate, execute: toolTemplate.execute };

    let agentInterface: AgentInterface;
    switch (ifaceNode.id) {
      case "delegate":
        agentInterface = new DelegationInterface(tool, inputNames, outputNames);
        break;
      case "forward":
        agentInterface = new ForwardInterface(tool, inputNames, outputNames);
        break;
      case "accumulate":
        agentInterface = new AccumulateInterface(tool, inputNames, outputNames);
        break;
      case "route":
        agentInterface = new RouteInterface(tool, inputNames, outputNames);
        break;
      default:
        throw new Error(`Unknown interface type: ${ifaceNode.id}`);
    }

    interfaceMap.set(ifaceNode.id, agentInterface);
    console.log(`[compile] Built ${ifaceNode.id} interface successfully`);
  }

  const storage = new InterfaceStorage(interfaceMap);
  console.log("[compile] InterfaceStorage built successfully");
  return storage;
}

// ── Run a compiled workflow ────────────────────────────────────────────────

export async function runWorkflow(
  message: string,
  workflow: Workflow,
  sendEvent: (agentId: string, event: AgentEvent) => void,
): Promise<void> {
  const { levels, predecessors } = workflow.executionQueue;
  const interfaceStorage = workflow.getInterfaceStorage();

  // Level 0: send user message to all first-level agents concurrently
  const level0Tasks = levels[0].map((node) => {
    const agent = workflow.getAgentById(node.id);
    if (!agent) throw new Error(`No agent built for ${node.id}`);
    console.log(`[workflow] Starting level-0 agent: ${node.id}`);
    return agent.chat(message, (event) => sendEvent(node.id, event));
  });
  await Promise.all(level0Tasks);

  // Levels 1..N: gather results from predecessor interfaces, then launch
  for (let i = 1; i < levels.length; i++) {
    console.log(`[workflow] Starting level ${i}`);
    const tasks: Promise<void>[] = [];

    for (const node of levels[i]) {
      const agent = workflow.getAgentById(node.id);
      if (!agent) throw new Error(`No agent built for ${node.id}`);

      const preds = predecessors.get(node.id) ?? [];
      const interfacePred = preds.find((n) => n.type === NodeType.interface);
      if (!interfacePred) continue;

      const results = interfaceStorage.getInterfaceByID(interfacePred.id).getResults();
      if (results.length === 0) {
        console.log(`[workflow] Skipping ${node.id} — no results from interface ${interfacePred.id}`);
        continue;
      }

      const input = results
        .map(([agentId, response]) => `[${agentId}]: ${response}`)
        .join("\n");

      console.log(`[workflow] Launching ${node.id} with ${results.length} result(s)`);
      tasks.push(agent.chat(input, (event) => sendEvent(node.id, event)));
    }

    await Promise.all(tasks);
  }
}

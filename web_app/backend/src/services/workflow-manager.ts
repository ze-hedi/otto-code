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
import { JevInterface } from "../../../../agents/jev-interface.js";
import { JevAgent } from "../../../../agents/jev-agent.js";
import { getAllAgentDocs } from "./agent-manager.js";
import { getJev } from "../db/mongo.js";
import type { JevChoice } from "../../../../agents/jev-agent-configs.js";
import type { Workflow } from "../../../../agents/workflow.js";
import type { AgentSessionEvent as AgentEvent } from "@mariozechner/pi-coding-agent";

/** A workflow the user has to fix (reported as a 400, not a server error) */
export class CompileError extends Error {}

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
      description: c.description,
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

  // Jev: one agent before it, at least two agents after it (it picks which one runs)
  const typeOf = (id: string) => schema.components.find(c => c.id === id)?.type;
  for (const jev of schema.components.filter(c => c.type === "jev")) {
    const inputs = schema.connections.filter(c => c.to === jev.id).map(c => c.from);
    const outputs = schema.connections.filter(c => c.from === jev.id).map(c => c.to);
    if (inputs.length !== 1)
      errors.push(`Jev: expected 1 input but got ${inputs.length}. Jev is One → Many.`);
    else if (typeOf(inputs[0]) !== "agent")
      errors.push(`Jev: its input must be an agent, but it is connected to "${inputs[0]}".`);
    if (outputs.length < 2)
      errors.push(`Jev: expected at least 2 outputs but got ${outputs.length}. A Jev picks one of several agents.`);
    const notAgents = outputs.filter(id => typeOf(id) !== "agent");
    if (notAgents.length > 0)
      errors.push(`Jev: its outputs must be agents, but it is connected to ${notAgents.map(id => `"${id}"`).join(", ")}.`);
  }

  return errors;
}

/** What Jev reads to tell the agents apart: the agent's description, else the start of its prompt. */
function describeAgent(config: RawPiAgentConfig | undefined, id: string): string {
  return config?.description || config?.systemPrompt?.slice(0, 300) || id;
}

/**
 * The choices of a Jev and the agent each one runs. A "choice" Jev without choices uses the
 * connected agents themselves (their descriptions). Every connected agent needs a choice.
 */
function resolveJevChoices(
  config: { type?: string; instructions?: string; choices?: JevChoice[] },
  outputIds: string[],
  describe: (id: string) => [string, string],
): JevChoice[] {
  let choices = config.choices ?? [];
  const ids = choices.map(c => c.id);

  if (config.type === "noul") {
    if (!config.instructions) throw new CompileError("Jev: a Yes/No Jev needs a question.");
    if (ids.length !== 2 || !ids.includes("true") || !ids.includes("false"))
      throw new CompileError("Jev: a Yes/No Jev needs an answer (and an agent) for both Yes and No.");
  } else if (choices.length === 0) {
    choices = outputIds.map(id => ({ id, description: describe(id)[1], agent: id }));
  } else {
    if (choices.length < 2) throw new CompileError("Jev: add at least 2 choices, or remove them to use the connected agents.");
    if (new Set(ids).size !== ids.length) throw new CompileError("Jev: choice names must be unique.");
  }

  for (const c of choices) {
    if (!outputIds.includes(c.agent))
      throw new CompileError(`Jev: choice "${c.id}" runs ${c.agent ? `"${c.agent}", which is not connected after the Jev` : "no agent: pick one"}.`);
  }
  const unused = outputIds.filter(id => !choices.some(c => c.agent === id));
  if (unused.length > 0)
    throw new CompileError(`Jev: ${unused.map(id => `"${id}"`).join(", ")} ${unused.length > 1 ? "are" : "is"} connected after the Jev but no choice runs ${unused.length > 1 ? "them" : "it"}.`);
  return choices;
}

export async function buildInterfaceStorage(schema: WorkflowSchema, agentsStorage: AgentsStorage, workflowId?: string): Promise<InterfaceStorage> {

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

  // Jev nodes: the component id is the jev_id of a Jev created from its form
  for (const jevNode of schema.components.filter(c => c.type === "jev")) {
    const doc = await getJev(jevNode.id);
    if (!doc) {
      throw new CompileError(`Jev "${jevNode.id}" was not found. Click the Jev node and press Create first.`);
    }
    const inputId = schema.connections.find(c => c.to === jevNode.id)!.from;
    const outputIds = schema.connections.filter(c => c.from === jevNode.id).map(c => c.to);
    const describe = (id: string): [string, string] => [id, describeAgent(agentsStorage.getAgentByID(id), id)];

    // The prompt-writing agent reuses the model and playground of the agent before the Jev
    const inputConfig = agentsStorage.getAgentByID(inputId);
    if (!inputConfig) throw new CompileError(`Jev is connected to unknown agent "${inputId}".`);

    const choices = resolveJevChoices(doc.config, outputIds, describe);

    interfaceMap.set(jevNode.id, new JevInterface(
      new JevAgent(doc.config),
      [describe(inputId)],
      outputIds.map(describe),
      choices,
      { name: `jev-${jevNode.id}`, model: inputConfig.model, playground: inputConfig.playground, workflowId },
    ));
    console.log(`[compile] Built jev ${jevNode.id} interface successfully`);
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
  sendRaw?: (payload: object) => void,
): Promise<void> {
  const { levels, predecessors } = workflow.executionQueue;
  const interfaceStorage = workflow.getInterfaceStorage();

  // Interfaces keep their results on the instance: every run starts clean
  for (const iface of interfaceStorage.getAll()) iface.reset();
  const announcedJevs = new Set<string>();

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

      const iface = interfaceStorage.getInterfaceByID(interfacePred.id);

      // Behind a Jev only the agent it chose runs, with the prompt written for it
      if (iface instanceof JevInterface) {
        const decision = await iface.resolve(message);
        if (!decision) {
          console.log(`[workflow] Skipping ${node.id} — the agent before Jev ${interfacePred.id} never called ask_jev`);
          continue;
        }
        if (!announcedJevs.has(interfacePred.id)) {
          announcedJevs.add(interfacePred.id);
          console.log(`[workflow] Jev ${interfacePred.id} chose ${decision.choice}`);
          sendRaw?.({ type: "jev_decision", agentId: interfacePred.id, ...decision });
        }
        if (decision.agent !== node.id) {
          console.log(`[workflow] Skipping ${node.id} — Jev chose ${decision.choice} (${decision.agent})`);
          continue;
        }
        console.log(`[workflow] Launching ${node.id} with the prompt written by Jev's prompter`);
        tasks.push(agent.chat(decision.prompt, (event) => sendEvent(node.id, event)));
        continue;
      }

      const results = iface.getResults();
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

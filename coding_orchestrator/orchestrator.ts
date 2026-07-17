import "dotenv/config";
import fs from "fs";
import path from "path";
import { Type } from "typebox";
import { PiAgent, ToolInput } from "../agents/pi-agent.js";
import { activeAgents, sessionAgentMap, workflowEvents } from "../runtime/state.js";
import { explorer } from "./explorer.js";
import { planner } from "./planner.js";
import { worker } from "./worker.js";

// ── Prompts & Config ───────────────────────────────────────────────────────────

const orchestratorPrompt = fs.readFileSync(
  path.join(import.meta.dirname, "orchestrator.md"),
  "utf-8"
);

export const PLAYGROUND = path.join(process.env.HOME!, "code/antares-xpansion");
export const ORCHESTRATOR_MODEL = "deepseek/deepseek-v4-pro";
export const ORCHESTRATOR_THINKING: "high" = "high";

// ── Sub-agent registry ─────────────────────────────────────────────────────────

interface SubAgentEntry {
  instance: PiAgent;
  description: string;
  guideline: string;
}

const subAgents: Record<string, SubAgentEntry> = {
  explorer: {
    instance: explorer,
    description: "codebase exploration — find files, trace flows, map dependencies",
    guideline:
      "Use 'explorer' when you need to understand the codebase — find files, trace flows, map dependencies, or answer structural questions.",
  },
  planner: {
    instance: planner,
    description: "implementation planning — turn exploration reports into step-by-step plans",
    guideline:
      "Use 'planner' when you have an exploration report and need to turn it into a step-by-step implementation plan.",
  },
  worker: {
    instance: worker,
    description: "code writing & execution — implement well-scoped tasks",
    guideline:
      "Use 'worker' when you have a clear, well-scoped task that involves writing or modifying code.",
  },
};

// ── Build delegate tool from registry ──────────────────────────────────────────

function buildDelegateTool(agents: Record<string, SubAgentEntry>): ToolInput {
  const names = Object.keys(agents);
  const agentList = names.map((n) => `'${n}' (${agents[n].description})`).join(", ");

  return {
    name: "delegate",
    label: "Delegate to Agent",
    description:
      `Delegate a task to one of your team agents: ${agentList}. ` +
      "The agent runs to completion and returns its full response.",
    promptSnippet: `delegate: Delegate a task to a team agent (${names.join(", ")})`,
    promptGuidelines: [
      ...names.map((n) => agents[n].guideline),
      "Always delegate to the explorer first for non-trivial tasks before planning or coding.",
      "Pass all relevant context in the task description — the agent does not share your conversation history.",
      "You can pass prior agent outputs as context to the next agent (e.g., exploration report to the planner).",
    ],
    parameters: Type.Object({
      agent: Type.Union(
        names.map((n) => Type.Literal(n)),
        { description: `Which agent to delegate to: ${names.join(", ")}` }
      ),
      task: Type.String({
        description: "The task description and all context the agent needs to complete it",
      }),
    }),
    execute: async (toolCallId, params) => {
      const { agent: agentName, task } = params as { agent: string; task: string };

      const entry = agents[agentName];
      if (!entry) {
        return {
          content: [{ type: "text", text: `Error: unknown agent "${agentName}". Use one of: ${names.join(", ")}.` }],
        };
      }

      const subAgent = entry.instance;
      const subId = `orchestrator-${agentName}-${Date.now()}`;

      // Register in runtime for TUI observability
      activeAgents.set(subId, subAgent);
      sessionAgentMap.set(subId, subId);
      console.log(`[delegate] dispatching to "${agentName}" (${subId})`);

      try {
        await subAgent.getSession();
        workflowEvents.emit("sub_agents_spawned", { subAgents: [subId] });

        const start = performance.now();
        await subAgent.chat(task);
        const elapsed = performance.now() - start;
        console.log(`[delegate] ${agentName} completed in ${elapsed.toFixed(0)} ms`);

        // Extract the final assistant response
        const messages = await subAgent.getMessages();
        const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);

        let output = "";
        if (lastAssistant) {
          if (typeof lastAssistant.content === "string") {
            output = lastAssistant.content;
          } else if (Array.isArray(lastAssistant.content)) {
            output = lastAssistant.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n");
          }
        }

        return {
          content: [{ type: "text", text: `## Agent: ${agentName}\n\n${output}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `## Agent: ${agentName}\n\n**Error:** ${msg}` }],
        };
      } finally {
        activeAgents.delete(subId);
        sessionAgentMap.delete(subId);
        console.log(`[delegate] cleaned up "${subId}"`);
      }
    },
  };
}

export const delegateTool = buildDelegateTool(subAgents);

// ── Orchestrator agent ─────────────────────────────────────────────────────────

export const orchestrator = new PiAgent({
  name: "orchestrator",
  model: ORCHESTRATOR_MODEL,
  systemPromptSuffix: orchestratorPrompt,
  builtInTools: ["read", "bash"],
  playground: PLAYGROUND,
  sessionMode: "memory",
  thinkingLevel: ORCHESTRATOR_THINKING,
  tools: [delegateTool],
  handlers: {
    onTextDelta: (delta) => process.stdout.write(delta),
    onToolStart: (id, name, args) =>
      console.log(`\n[tool:start] id=${id} name=${name}`, JSON.stringify(args, null, 2)),
  },
});

// ── CLI entry point ────────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]?.includes("orchestrator");
if (isDirectRun) {
  const readline = await import("readline");

  console.log("system prompt:");
  const session = await orchestrator.getSession();
  console.log(session.systemPrompt);

  while (true) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question("enter query ", resolve);
    });

    if (answer === "exit") {
      rl.close();
      break;
    }

    await orchestrator.chat(answer);
  }
}

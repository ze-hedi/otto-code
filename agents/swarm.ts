import { randomUUID } from "crypto";
import { Type } from "@sinclair/typebox";
import { createInterface } from "readline";
import { RawPiAgent } from "./raw-pi-agent.js";
import { Meeting } from "./meeting.js";
import type { RawPiAgentConfig } from "./pi-agent-configs.js";
import type { EventCallback } from "./pi-agent-types.js";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export class Swarm {
  private agents: { name: string; description: string; agent: RawPiAgent }[];
  private coordinator: RawPiAgent;
  private synthesizedGoal: string = "";

  constructor(
    agents: { agent: RawPiAgent; name: string; description: string }[],
    coordinatorConfig?: RawPiAgentConfig,
  ) {
    this.agents = agents;

    const defaultConfig: RawPiAgentConfig = {
      name: "coordinator",
      model: "deepseek/deepseek-v4-pro",
      systemPrompt: this._buildCoordinatorPrompt(),
      builtInTools: [],
      sessionMode: "memory",
    };

    const finalConfig = coordinatorConfig
      ? { ...coordinatorConfig, systemPrompt: (coordinatorConfig.systemPrompt ?? "") + "\n\n" + this._buildCoordinatorPrompt() }
      : defaultConfig;

    this.coordinator = new RawPiAgent(finalConfig);
  }

  private _buildCoordinatorPrompt(): string {
    const agentLines = this.agents.map(
      (a) => `- **${a.name}**: ${a.description}`
    );
    return `You are a coordinator agent. You receive user requests and delegate them to the appropriate specialist agent.\n\n# Available Specialists\n${agentLines.join("\n")}\n\nYour job has two phases:\n1. First, clarify the user's request by asking questions if needed.\n2. Then, synthesize a clear goal paragraph that captures what needs to be discussed and decided by the team.`;
  }

  async run(userInput: string, maxRounds: number = 5, onEvent?: EventCallback): Promise<void> {
    const sessionKey = `swarm-${randomUUID()}`;

    // Phase 1: Clarification + Synthesis
    this.coordinator.registerTool({
      name: "clarification_tool",
      label: "Clarification Tool",
      description: "Ask the user clarifying questions to better understand what they need.",
      parameters: Type.Object({
        questions: Type.Array(Type.String({ description: "a question to ask the user" })),
      }),
      promptSnippet: "Call this tool when you need more details from the user before synthesizing the goal.",
      execute: async (_toolCallId, params) => {
        const clarifications: string[] = [];
        for (const question of params.questions) {
          clarifications.push(question);
          const answer = await ask(question);
          clarifications.push(answer);
        }
        return { content: [{ type: "text", text: clarifications.join("\n") }] };
      },
    });

    this.coordinator.registerTool({
      name: "synthesize_goal",
      label: "Synthesize Goal",
      description: "Once you have enough context, call this to produce a clear goal paragraph for the team meeting.",
      parameters: Type.Object({
        goal: Type.String({ description: "A paragraph synthesizing the discussion goal based on the user's request and any clarifications." }),
      }),
      terminate: true,
      execute: async (_toolCallId, params) => {
        this.synthesizedGoal = params.goal;
        return { content: [{ type: "text", text: "Goal synthesized. Starting meeting." }] };
      },
    });

    await this.coordinator.createNewSession(sessionKey);
    await this.coordinator.chat(userInput, onEvent, sessionKey);

    // Clean up Phase 1 tools before the meeting
    this.coordinator.unregisterTool("clarification_tool");
    this.coordinator.unregisterTool("synthesize_goal");

    // Phase 2: Meeting
    const meeting = new Meeting(
      [
        { agent: this.coordinator, name: "Coordinator", description: "Coordinator who understands the user's request" },
        ...this.agents,
      ],
      this.synthesizedGoal,
    );

    const transcript = await meeting.run(maxRounds, onEvent);

    // Phase 3: Task Planning (iterative)
    // Coordinator connects to task-manager MCP and builds tasks round by round
    const taskSessionKey = `tasks-${randomUUID()}`;
    await this.coordinator.createNewSession(taskSessionKey);

    const mcpEndpoint = "http://localhost:3100";
    await this.coordinator.connectMcp("task-manager", mcpEndpoint);

    const transcriptSummary = transcript.turns
      .map((t) => `[${t.agentName}]: ${t.message}`)
      .join("\n\n");

    const specialists = this.agents.map((a) => `- **${a.name}**: ${a.description}`).join("\n");

    const taskPlanningPrompt = `You just finished a team meeting. Here is the context:

# Goal
${this.synthesizedGoal}

# Meeting Transcript
${transcriptSummary}

# Available Specialists
${specialists}

# Your Mission — Iterative Task Planning

You must now break down the agreed-upon goal into a structured task plan. Work iteratively, NOT all at once:

**Round 1 — High-level breakdown**: Identify the major workstreams or phases needed to accomplish the goal. Add ONE task per workstream using add_task. Each task description should summarize the workstream scope. Stop after this round.

**Round 2 — Decompose each workstream**: For each high-level workstream, break it into smaller, concrete subtasks. Add each subtask with add_task. Assign each to the most appropriate specialist. Stop after this round.

**Round 3 — Review and refine**: Use get_tasks to review everything you've created. Check for gaps, overlaps, or missing dependencies. Add any missing tasks or update existing ones with update_task. Stop after this round.

IMPORTANT RULES:
- Only add 1-3 tasks per tool call round. Think before each addition.
- Assign each task to the most appropriate specialist agent.
- Set all initial states to "opened".
- After each round, pause and reflect on what's still missing before continuing.
- When you are satisfied the plan is complete, say "TASK_PLANNING_COMPLETE".`;

    await this.coordinator.chat(taskPlanningPrompt, onEvent, taskSessionKey);
  }
}

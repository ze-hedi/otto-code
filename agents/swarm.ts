import { randomUUID } from "crypto";
import { Type } from "@sinclair/typebox";
import { createInterface } from "readline";
import { RawPiAgent } from "./raw-pi-agent.js";
import { Meeting } from "./meeting.js";
import { createMcpBridge, type McpBridge } from "../mcp-bridge.js";
import type { RawPiAgentConfig } from "./pi-agent-configs.js";
import type { EventCallback, ToolInput } from "./pi-agent-types.js";

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
  private mcpBridge: McpBridge | null = null;
  private projectId: string = "";

  // ── MCP connection + project ──────────────────────────────────────────

  private async connectTaskManager(endpoint: string): Promise<void> {
    this.mcpBridge = await createMcpBridge(endpoint);
  }

  private async createProject(name: string): Promise<string> {
    const result = await this.mcpBridge!.callTool("create_project", { name });
    const text = result.content[0]?.text ?? result.content[0];
    const parsed = typeof text === "string" ? JSON.parse(text) : text;
    this.projectId = parsed.id;
    return this.projectId;
  }

  // ── Wrapped tool builders ─────────────────────────────────────────────

  private _buildCoordinatorTools(): ToolInput[] {
    const bridge = this.mcpBridge!;
    const pid = () => this.projectId;

    const callMcp = async (toolName: string, params: Record<string, unknown>) => {
      const result = await bridge.callTool(toolName, { project_id: pid(), ...params });
      return { content: result.content };
    };

    return [
      {
        name: "add_task",
        label: "Add Task",
        description: "Add a new task to the project. Assign it to a specialist agent.",
        promptSnippet: "Use add_task to create a new task and assign it to a specialist.",
        promptGuidelines: [
          "Always set responsible_agent to one of the available specialist names.",
          "Set state to 'opened' for new tasks unless resuming prior work.",
        ],
        terminate: true,
        parameters: Type.Object({
          description: Type.String({ description: "What the task involves" }),
          responsible_agent: Type.String({ description: "Name of the specialist agent assigned" }),
          state: Type.Optional(Type.String({ description: "Initial state: opened, in_work, or closed" })),
        }),
        execute: async (_id, params) => callMcp("add_task", params),
      },
      {
        name: "get_tasks",
        label: "Get Tasks",
        description: "Get all tasks for the project, optionally filtered by state or agent.",
        promptSnippet: "Use get_tasks to review the current task board.",
        promptGuidelines: [
          "Call this to check progress before adding more tasks or wrapping up planning.",
        ],
        terminate: true,
        parameters: Type.Object({
          state: Type.Optional(Type.String({ description: "Filter by state" })),
          responsible_agent: Type.Optional(Type.String({ description: "Filter by agent" })),
        }),
        execute: async (_id, params) => callMcp("get_tasks", params),
      },
      {
        name: "update_task",
        label: "Update Task",
        description: "Update a task's description or state.",
        promptSnippet: "Use update_task to change a task's description or move it to a new state.",
        promptGuidelines: [
          "Use this to refine task descriptions or mark tasks as in_work or closed.",
        ],
        terminate: true,
        parameters: Type.Object({
          task_id: Type.String({ description: "UUID of the task" }),
          description: Type.Optional(Type.String({ description: "New description" })),
          state: Type.Optional(Type.String({ description: "New state" })),
        }),
        execute: async (_id, params) => callMcp("update_task", params),
      },
      {
        name: "get_project",
        label: "Get Project",
        description: "Get the current project with all its tasks.",
        promptSnippet: "Use get_project to see the full project overview.",
        promptGuidelines: [
          "Call this for a high-level view of the project including all tasks.",
        ],
        terminate: true,
        parameters: Type.Object({}),
        execute: async (_id, _params) => callMcp("get_project", {}),
      },
    ];
  }

  private _buildAgentTools(agentName: string): ToolInput[] {
    const bridge = this.mcpBridge!;
    const pid = () => this.projectId;

    const callMcp = async (toolName: string, params: Record<string, unknown>) => {
      const result = await bridge.callTool(toolName, {
        project_id: pid(),
        responsible_agent: agentName,
        ...params,
      });
      return { content: result.content };
    };

    return [
      {
        name: "get_my_tasks",
        label: "Get My Tasks",
        description: "Get tasks assigned to you, optionally filtered by state.",
        promptSnippet: "Use get_my_tasks to see what you need to work on.",
        promptGuidelines: [
          "Call this at the start of your work to see your assigned tasks.",
          "Filter by state='opened' to see what still needs to be done.",
        ],
        terminate: true,
        parameters: Type.Object({
          state: Type.Optional(Type.String({ description: "Filter by state: opened, in_work, or closed" })),
        }),
        execute: async (_id, params) => callMcp("get_agent_tasks", params),
      },
      {
        name: "update_my_task",
        label: "Update My Task",
        description: "Update one of your tasks' description or state.",
        promptSnippet: "Use update_my_task to mark progress or refine a task.",
        promptGuidelines: [
          "Set state to 'in_work' when starting a task and 'closed' when done.",
        ],
        terminate: true,
        parameters: Type.Object({
          task_id: Type.String({ description: "UUID of the task" }),
          description: Type.Optional(Type.String({ description: "New description" })),
          state: Type.Optional(Type.String({ description: "New state" })),
        }),
        execute: async (_id, params) => callMcp("update_agent_task", params),
      },
      {
        name: "add_subtask",
        label: "Add Subtask",
        description: "Add a subtask to one of your tasks.",
        promptSnippet: "Use add_subtask to break a task into smaller pieces.",
        promptGuidelines: [
          "Use subtasks to track granular steps within a larger task.",
        ],
        terminate: true,
        parameters: Type.Object({
          task_id: Type.String({ description: "UUID of the parent task" }),
          title: Type.String({ description: "Subtask title" }),
          description: Type.String({ description: "Subtask description" }),
        }),
        execute: async (_id, params) => callMcp("add_subtask", params),
      },
    ];
  }

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

    // Phase 0: Connect to MCP + create project
    const mcpEndpoint = "http://localhost:3100";
    await this.connectTaskManager(mcpEndpoint);
    await this.createProject(userInput.slice(0, 60));

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

    // Phase 3: Task Planning via shared MCP bridge
    const taskSessionKey = `tasks-${randomUUID()}`;
    await this.coordinator.createNewSession(taskSessionKey);

    const coordinatorTools = this._buildCoordinatorTools();
    for (const tool of coordinatorTools) {
      this.coordinator.registerTool(tool);
    }

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

    // Clean up coordinator tools
    for (const tool of coordinatorTools) {
      this.coordinator.unregisterTool(tool.name);
    }

    // Cleanup: close shared MCP bridge
    await this.mcpBridge!.close();
    this.mcpBridge = null;
  }
}

/*
OttoCode V1 : 
a first version of OttoCode agent that is composed of the following 
- The orchestrator : prompted to handle implementation task and orchrestrate the subagents.
- Subagents : All the subAgent will be volatile (new context at every call)
    - Planner subagent : this agent will build a plan of action using the worker sub agents.
        It take task from the orchestrator to build a plan of action for a specific goal. 
    - Worker subAgent : An executor that that will take a task and build it. Think of it as a sort of a software engineer that you can give it a ticket like a component of a feature or a bug to fix.
    - Verifier subAgent : think of it as a sort of agent that will be scheduled to write the test and run it. Making sure that everything is working right and if not raising the identified issue.
    - Explorer subAgent : a read-only codebase explorer that answers queries about the codebase structure, module relationships, symbol locations, and architectural patterns. Takes an optional subfolder to scope its search.
*/ 

import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../../agents/raw-pi-agent";
import { RawPiAgentConfig, ToolInput } from "../../agents/pi-agent-configs";
import { PiAgentConfig } from "../../agents/pi-agent-configs";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { readFileSync } from "fs";
import { handleEvent } from "../../agents/pi-agent-utils";
import { PiAgent } from "../../agents/pi-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const rl = createInterface({ input: process.stdin, output: process.stdout });

const PROMPTS_DIR = __dirname;

function readPrompt(filename: string): string {
    return readFileSync(resolve(PROMPTS_DIR, filename), "utf-8");
}

function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer));
    });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

let orchestrator_system_prompt: string = readPrompt("orchestrator_prompt.md");


// ---------------------------------------------------------------------------
// Worker Subagent
// ---------------------------------------------------------------------------

let worker_subagent_prompt_suffix: string = readPrompt("worker_prompt.md");


// ---------------------------------------------------------------------------
// Verifier Subagent
// ---------------------------------------------------------------------------

let verifier_subagent_prompt_suffix: string = readPrompt("verifier_prompt.md");


// ---------------------------------------------------------------------------
// Explorer Subagent
// ---------------------------------------------------------------------------

let explorer_subagent_prompt_suffix: string = readPrompt("explorer_prompt.md");


// ---------------------------------------------------------------------------
// Agent Configs
// ---------------------------------------------------------------------------

const worker_config: PiAgentConfig = {
    name: "worker",
    model: "deepseek/deepseek-v4-pro",
    systemPromptSuffix: worker_subagent_prompt_suffix,
    thinkingLevel: "medium",
    playground: process.env.PLAYGROUND || "/home/bouchehdahed/code/benders_tui"
};

const verifier_config: PiAgentConfig = {
    name: "verifier",
    model: "deepseek/deepseek-v4-pro",
    systemPromptSuffix: verifier_subagent_prompt_suffix,
    thinkingLevel: "medium",
    playground:  process.env.PLAYGROUND || "/home/bouchehdahed/code/benders_tui"
};

const explorer_config: PiAgentConfig = {
    name: "explorer",
    model: "deepseek/deepseek-v4-pro",
    systemPromptSuffix: explorer_subagent_prompt_suffix,
    thinkingLevel: "medium",
    playground: process.env.PLAYGROUND || "/home/bouchehdahed/code/benders_tui"
};

// ---------------------------------------------------------------------------
// Agent Instances
// ---------------------------------------------------------------------------

const worker = new PiAgent(worker_config);
const verifier = new PiAgent(verifier_config);
const explorer = new PiAgent(explorer_config);

const agentInstances: Record<string, PiAgent> = {
    worker,
    verifier,
    explorer,
};

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

let clarification_tool: ToolInput = {
    name: "clarification_tool",
    label: "clarification tool",
    description: "a tool that should be called to ask for clarification",
    parameters: Type.Object({
        questions: Type.Array(Type.String({ description: "a question that helps you gather clarifications about what to do" }))
    }, { description: "a set of questions that will help get more context for an optimal response and reasoning guidance" }),
    promptSnippet: "clarification tool that help you get more context from the user though question",
    promptGuidelines: ["call this tool when you need more details to help you orient your response to the optimal response"],
    executionMode: "sequential",
    execute: async (toolCallId, params) => {
        let clarifications: string[] = [];
        for (let question of params.questions) {
            clarifications.push(question);
            const answer: string = await ask(question);
            clarifications.push(answer);
        }
        return { content: [{ type: "text", text: clarifications.join("\n") }] };
    }
};

// ---------------------------------------------------------------------------
// Subagent Tool Inputs (schema descriptors for the LLM)
// ---------------------------------------------------------------------------

const worker_tool_input: ToolInput = {
    name: "worker",
    label: "worker subagent",
    description: "A senior software engineer that receives well-scoped implementation tickets. Give it a clear task with target files, expected behavior, and acceptance criteria. It implements code only — no tests.",
    parameters: Type.Object({
        task: Type.String({ description: "a detailed, self-contained implementation task including target files, expected behavior, dependencies, and acceptance criteria" })
    }),
    execute: async (_toolCallId, _params) => {
        return { content: [{ type: "text", text: "" }] };
    }
};

const verifier_tool_input: ToolInput = {
    name: "verifier",
    label: "verifier subagent",
    description: "A senior QA engineer that validates implementations by writing and running tests. Give it a list of files that were modified/created and the acceptance criteria. It produces a verification report.",
    parameters: Type.Object({
        task: Type.String({ description: "a description of what was implemented, which files changed, and the acceptance criteria to verify against" })
    }),
    execute: async (_toolCallId, _params) => {
        return { content: [{ type: "text", text: "" }] };
    }
};

const explorer_tool_input: ToolInput = {
    name: "explorer",
    label: "explorer subagent",
    description: "A read-only codebase explorer that answers queries about the codebase structure, module relationships, symbol locations, and architectural patterns. Give it a specific question and a subfolder to scope its search.",
    parameters: Type.Object({
        task: Type.String({ description: "a clear question about the codebase — what to find, which files/modules to investigate, or what relationships to trace" }),
        subfolder: Type.Optional(Type.String({ description: "a subfolder within the playground to scope the exploration to (e.g. 'src/components', 'lib/utils')" }))
    }),
    execute: async (_toolCallId, _params) => {
        return { content: [{ type: "text", text: "" }] };
    }
};

function build_schedule_subAgents_tool(
    available_worker_agents: ToolInput[],
    agents: Record<string, PiAgent>
): ToolInput {
    let schedule_subAgents: ToolInput = {
        name: "schedule_subAgents",
        label: "schedule sub agents tool",
        description: "call this tool once you have a clear vision of what to build. It dispatches each task to the assigned agent in sequence — use explorer first to understand the codebase if needed, then workers, then verifiers. Every plan MUST include a verifier agent task after each batch of worker tasks — no exception.",
        parameters: Type.Object({
            tasks: Type.Array(Type.Object({
                task: Type.String({ description: "a clear description of a task to be run. Be specific about expected inputs, outputs, files to create/modify, and acceptance criteria. For explorer tasks, specify the question to answer and the subfolder to explore. For verifier tasks, list every file the preceding workers touched so tests can be written for all of them." }),
                agent: Type.Union(available_worker_agents.map(a => Type.Literal(a.name, { description: a.description })), { description: "which agent to assign this task to. Use 'explorer' to survey the codebase first, then 'worker' for implementation, and 'verifier' after every implementation batch." }),
            }))
        }),
        promptSnippet: "A tool that renders a clear plan of tasks scheduled to be implemented in order, always capped with verifier tasks that write and run tests for every changed file.",
        promptGuidelines: [
            "use this tool when you have a clear vision of what you want to build during the current sprint",
            "make sure that the tasks are well defined and contain all the details (dependencies, preferred objects, acceptance criteria, target files)",
            "when the codebase is unfamiliar, schedule an explorer task first to survey relevant parts of the codebase before dispatching workers",
            "CRITICAL — Verification mandate: after EVERY batch of worker implementation tasks you MUST append a verifier task. The verifier task description must list every file that was created or modified by the preceding workers so the verifier can write tests covering all of them. Never deliver a plan that lacks a verifier task.",
            "for large sprints you may interleave verifier tasks between worker batches — e.g. worker A, worker B, verifier (covers A+B), worker C, verifier (covers C). This catches issues early before more code is built on top."
        ],
        terminate: false,
        execute: async (toolCallId, params) => {
            const results: string[] = [];
            for (const t of params.tasks) {
                const agent = agents[t.agent];
                if (!agent) {
                    results.push(`ERROR: unknown agent "${t.agent}" — skipping task: ${t.task}`);
                    continue;
                }
                let taskText = t.task;
                if (t.agent === "explorer" && (t as any).subfolder) {
                    taskText = `SCOPE: explore within the subfolder "${(t as any).subfolder}"\n\nTASK: ${t.task}`;
                }
                await agent.chat(taskText, handleEvent);
                results.push(`[${t.agent}] completed task.`);
            }
            return { content: [{ type: "text", text: results.join("\n") }] };
        }
    };
    return schedule_subAgents;
}

// ---------------------------------------------------------------------------
// Build schedule tool with real agent instances
// ---------------------------------------------------------------------------

const schedule_subAgents = build_schedule_subAgents_tool(
    [worker_tool_input, verifier_tool_input, explorer_tool_input],
    agentInstances
);

// ---------------------------------------------------------------------------
// Orchestrator Config & Instance
// ---------------------------------------------------------------------------

const orchestrator_config: RawPiAgentConfig = {
    name: "orchestrator",
    model: "deepseek/deepseek-v4-pro",
    systemPrompt: orchestrator_system_prompt,
    thinkingLevel: "high",
    builtInTools: ['read', 'write', 'bash', 'edit'],
    tools: [clarification_tool, schedule_subAgents],
    playground: process.env.PLAYGROUND || "/home/bouchehdahed/code/benders_tui",
    sessionMode : "disk" , 
    workingDir : "/home/bouchehdahed/code/benders_tui"
};

const orchestrator = new RawPiAgent(orchestrator_config);

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

async function main() {

    let orchestrator_system_prompt : string = await orchestrator.getSystemPrompt() ; 
    console.log(orchestrator_system_prompt) ; 
    console.log("\n\n###########\n##########\n\n") ; 
    const user_query = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));

    console.log("OttoCode V1 — Orchestrator ready.");
    console.log("Describe what you want to build, or type 'exit' to quit.\n");

    while (true) {
        const input = await user_query("\nYou: ");
        if (!input || input.toLowerCase() === "exit") break;
        await orchestrator.chat(input, handleEvent);
    }

    rl.close();
}

main().catch(console.error);

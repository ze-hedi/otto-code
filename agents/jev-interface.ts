// jev-interface.ts
// Jev as a node of the workflow graph. The agent before it calls ask_jev when its work is done,
// Jev picks which of the next agents runs, and a tiny agent writes that agent's prompt
// (Jev only returns a choice and probabilities, no text).

import { Type } from "@sinclair/typebox";
import { AgentInterface, Agent2AgentLink } from "./workflow-interface";
import { RawPiAgent } from "./raw-pi-agent";
import type { ToolInput } from "./pi-agent-types";
import type { JevAgent } from "./jev-agent";
import type { JevChoice } from "./jev-agent-configs";

export interface JevResolution {
    /** The choice Jev made (its id) */
    choice: string;
    /** Id of the agent that runs next: the one this choice routes to */
    agent: string;
    /** Prompt written for that agent */
    prompt: string;
    confidence?: number;
    probabilities?: Record<string, number>;
}

const PROMPTER_SYSTEM_PROMPT = `You write prompts for agents inside a workflow.
You receive the user's original request, the work done so far, and the role of the next agent.
Write a self-contained prompt for that agent: what it has to do, with all the context it needs from the work so far.
Do not do the task yourself. Call the write_prompt tool exactly once with the prompt.`;

//one Jev between one agent and several next agents: only the agent the winning choice routes to runs
export class JevInterface extends AgentInterface {
    private jev_ : JevAgent ;
    private choices_ : JevChoice[] ;
    private prompter_ : RawPiAgent ;
    private writePromptTool_ : ToolInput ;
    private writtenPrompt_ : string | undefined ;
    private resolution_ : Promise<JevResolution | null> | undefined ;

    //prompter : the tiny agent that writes the chosen agent's prompt (no built-in tools, one tool)
    constructor(
        jev : JevAgent,
        subAgentsInputsNames : [string,string][],
        subAgentsOutputNames : [string,string][],
        choices : JevChoice[],
        prompter : { name: string, model: string, playground?: string, workflowId?: string },
    ) {
        super("jev_interface") ;
        if (subAgentsInputsNames.length !== 1)
            throw new Error("jev interface is one to many interface. It takes one input agent") ;
        this.jev_ = jev ;
        this.choices_ = choices ;
        this.subAgentsInputsNames_ = subAgentsInputsNames ;
        this.subAgentsOutputNames_ = subAgentsOutputNames ;
        this.A2A_ = Agent2AgentLink.One2Many ;

        this.toolForSuccessors_ = {
            name: "ask_jev",
            label: "ask jev",
            description: "a tool that should be called by an agent when it finished its job, to hand its work to the decision maker that picks which agent works next",
            promptSnippet: "Tool used when you ended your work and want the decision maker to pick the next agent",
            promptGuidelines: ["call this tool once your work is complete, with everything the next agent needs to know"],
            executionMode: "sequential",
            terminate: true,
            parameters: Type.Object({
                work: Type.String({ description: "the result of your work, complete enough for the decision maker to choose the next step" }),
            }),
            execute: async () => ({ content: [{ type: "text", text: "Your work was handed to the decision maker." }] }),
        } ;

        this.inputPromptSuffix_ = `
Keep in mind that you are a part of a workflow. When you have finished your work, call the ask_jev tool with your result: a decision maker will then pick what happens next among :
${this.choices_.map((c) => `- ${c.id} : ${c.description}`).join("\n")}
` ;

        this.outputPromptSuffix_ = `
Keep in mind that you are a part of a workflow, you receive your task from a router that chose you after the work of :
${this.subAgentsInputsNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")}
` ;

        this.writePromptTool_ = {
            name: "write_prompt",
            label: "write prompt",
            description: "a tool that should be called once with the prompt for the next agent",
            executionMode: "sequential",
            terminate: true,
            parameters: Type.Object({
                prompt: Type.String({ description: "the complete prompt for the next agent" }),
            }),
            execute: async (_toolCallId, params) => {
                this.writtenPrompt_ = params.prompt ;
                return { content: [{ type: "text", text: "Prompt recorded." }] } ;
            },
        } ;

        this.prompter_ = new RawPiAgent({
            name: prompter.name,
            model: prompter.model,
            playground: prompter.playground,
            workflowId: prompter.workflowId,
            systemPrompt: PROMPTER_SYSTEM_PROMPT,
            builtInTools: [],
            thinkingLevel: "off",
            tools: [this.writePromptTool_],
        }) ;
    }

    //Decides once per run (the next agents all ask). Null when the agent before never called ask_jev.
    public resolve(userRequest: string) : Promise<JevResolution | null> {
        this.resolution_ ??= this.resolve_(userRequest) ;
        return this.resolution_ ;
    }

    public override reset() : void {
        super.reset() ;
        this.resolution_ = undefined ;
        this.writtenPrompt_ = undefined ;
    }

    private async resolve_(userRequest: string) : Promise<JevResolution | null> {
        const results = this.getResults() ;
        if (results.length === 0) return null ;
        const [fromAgent, raw] = results[results.length - 1] ;
        const work : string = JSON.parse(raw).work ?? "" ;

        const decision = await this.jev_.decide({
            context: `User request: ${userRequest}\n\nWork done by ${fromAgent}:\n${work}`,
            options: this.choices_.map(({ id, description }) => ({ id, description })),
        }) ;

        const chosen = this.choices_.find((c) => c.id === decision.choice) ;
        if (!chosen) throw new Error(`Jev answered "${decision.choice}", which is not one of its choices`) ;
        const agent = chosen.agent ;
        const role = this.subAgentsOutputNames_.find(([id]) => id === agent)?.[1] ?? agent ;
        this.writtenPrompt_ = undefined ;
        //a new session per run (the timestamp keeps a restarted server from resuming an old file),
        //so the prompter never carries history from another run
        const sessionKey = `run-${Date.now()}` ;
        await this.prompter_.createNewSession(sessionKey) ;
        await this.prompter_.chat(
            `Write the prompt for the next agent.\n\nNext agent: ${agent} : ${role}\n\nJev's choice: ${chosen.id} : ${chosen.description}\n\nUser's original request: ${userRequest}\n\nWork done so far by ${fromAgent}:\n${work}`,
            undefined,
            sessionKey,
        ) ;

        //if the prompter never wrote a prompt, the chosen agent gets the work as is
        return { ...decision, agent, prompt: this.writtenPrompt_ ?? work } ;
    }
}

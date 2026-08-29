import type { ToolInput } from "./pi-agent-types";
import { Type } from "@sinclair/typebox";

export enum Agent2AgentLink {
    One2One , 
    One2Many,
    Many2One, 
}
export class AgentInterface {
    protected name_ : string ; 
    //to inject in the system prompt of agents just before the interface node 
    protected inputPromptSuffix_ : string ; 
    //to inject in the system prompt of  agents just after the interface node 
    protected outputPromptSuffix_ : string ; 
    protected toolForSuccessors_ : ToolInput ; 
    protected subAgentsInputsNames_ : [string,string][] ;
    protected subAgentsOutputNames_ : [string,string][] ;
    protected A2A_ : Agent2AgentLink 
    //this attribute is a pair that will contain the results of precedent agents in the workflow
    protected predResults : [string,string][] = []

    constructor(name:string) {
        this.name_ = name ;
    } ;
    public addResult(fromAgentId: string, params: unknown): void {
        this.predResults.push([fromAgentId, JSON.stringify(params)]) ;
    }
    public getResults(): [string, string][] {
        return this.predResults ;
    }
    public getTool() : ToolInput {
        return this.toolForSuccessors_ ;
    }
    public getInputPromptSuffix() : string | string[] {
        return this.inputPromptSuffix_ ;
    }
    public getOutputPromptSuffix() : string | string[] {
        return this.outputPromptSuffix_ ;
    }
    public getToolName() : string {
        return this.toolForSuccessors_.name ; 
    }
    public getInterfaceType() : Agent2AgentLink {
        return this.A2A_ ; 
    }
} ; 


//one agent delegate to multiple agent. 
export class DelegationInterface extends AgentInterface{
    
    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("delegation_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors ;  
        if (subAgentsInputsNames.length > 1) 
            throw new Error("delegation interface is one to many interface. It take only one input") ; 
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ;
        this.A2A_ = Agent2AgentLink.One2Many ;  
        this.inputPromptSuffix_ = `
Keep in mind that you are a part of workflow, you have these agents to which you need to delegate work once you estimate that you have enough information to efficiently forward work to these agents ; 
${this.subAgentsOutputNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")}

You're not supposed to delegate to all these available agents each time. It's up to you, dependending on the task to choose a subset of them (or all if needed) to delegate to 
    `; 

        this.outputPromptSuffix_ = `
Keep in mind that you are a part of workflow, you will be receiving your input : 
${this.subAgentsInputsNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")} 
` ; 


        
        this.toolForSuccessors_.parameters = Type.Object({
                                tasks: Type.Array(Type.Object({
                                task: Type.String({ description: "a clear description of a task to be run. Be specific about expected inputs, outputs, files to create/modify, and acceptance criteria. For explorer tasks, specify the question to answer and the subfolder to explore. For verifier tasks, list every file the preceding workers touched so tests can be written for all of them." }),
                                agent: Type.Union(this.subAgentsOutputNames_.map(a => Type.Literal(a[0], { description: a[1] })), { description: "which agent to assign this task to. Use 'explorer' to survey the codebase first, then 'worker' for implementation, and 'verifier' after every implementation batch." }),
                            }))
                        })
    } ; 
}


// agent to agent communication 
export class ForwardInterface extends AgentInterface {
    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("forward_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors; 
        if (subAgentsInputsNames.length > 1 || subAgentsOutputNames.length > 1 ) 
            throw new Error("forward interface is one to one interface. It take only one input and one input") ; 
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ; 
        this.A2A_ = Agent2AgentLink.One2One ; 
        this.inputPromptSuffix_ = `
Keep in mind that you are a part of workflow, you will forwarding the work to the following agent : 
${this.subAgentsOutputNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")} 
    `; 

        this.outputPromptSuffix_ = `
Keep in mind that you are a part of a wokflow and you will be receiving your task from  : 
${this.subAgentsInputsNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")} 
` ; 


    }

}

// when we have an agent that need to aggregate multiple agents result
export class AccumulateInterface extends AgentInterface {
    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("accumulate_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors ;  
        if (subAgentsOutputNames.length > 1) 
            throw new Error("accumulate interface is many to one interface. It takes only one output") ; 
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ;
        this.A2A_ = Agent2AgentLink.Many2One ;  

        this.inputPromptSuffix_ = `
Keep in mind that you are a part of workflow, you will forwarding your response to : 
${this.subAgentsOutputNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")} 
    `; 

        this.outputPromptSuffix_ = `
Keep in mind that you are a part of workflow, Your input will be the aggregation of the result of these agents : 
${this.subAgentsInputsNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")} 
` ; 

        this.toolForSuccessors_.parameters = Type.Object({
            results: Type.Array(Type.Object({
                agent: Type.Union(this.subAgentsInputsNames_.map(a => Type.Literal(a[0], { description: a[1] })), { description: "which agent produced this result" }),
                result: Type.String({ description: "the result produced by this agent to be accumulated into a single output" }),
            }))
        })
    } ; 
}

// an agent has multiple available agents after it in the workflow but is supposed to activate only one of them
export class RouteInterface extends AgentInterface {
    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("route_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors ; 
        if (subAgentsInputsNames.length > 1)  
            throw new Error("Route interface is one to many interfce. It takes one input agent") 

    
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ;
        this.A2A_ = Agent2AgentLink.One2Many ;
        
        this.outputPromptSuffix_ = `
Keep in mind that you are a part of a workflow, you will be receiving your input from this agent : 
${this.subAgentsInputsNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")} 
`
this.inputPromptSuffix_  = `
You are the routing node in a multi-agent workflow. Your job is to decide which of the following destinations should handle this input next — do not attempt to solve the task yourself.

Available routes:
${this.subAgentsOutputNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")}

Rules:
- You MUST pick exactly one route from the list above — no fallback, no "none", no inventing a new route.
- Even if the match is imperfect, choose the closest available route.
- Respond only with the route name and a short justification (1 sentence max) — no additional commentary.
- Do not attempt to answer the user's request yourself; your only output is the routing decision.
`;
    }
}
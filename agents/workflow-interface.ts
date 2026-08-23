import type { ToolInput } from "./pi-agent-types";
import { Type } from "@sinclair/typebox";

export class AgentInterface {
    protected name_ : string ; 
    protected promptSuffix_ : string 
    protected toolForSuccessors_ : ToolInput ; 
    protected subAgentsInputsNames_ : [string,string][] ;
    protected subAgentsOutputNames_ : [string,string][] ; 

    constructor(name:string) {this.name_ = name } ; 
    public getTool() : ToolInput {
        return this.toolForSuccessors_ ; 
    }
    public getPromptSuffix() : string {
        return this.promptSuffix_ ; 
    }
} ; 

export class DelegationInterface extends AgentInterface{
    
    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("delegation_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors ;  
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ; 

        this.promptSuffix_ = `
Keep in that you are a part of workflow, you have these agents to which you need to delegate work once you estimate that you have enough information to efficiently forward work to these agents ; 
${this.subAgentsOutputNames_.map(([name, desc]) => `- ${name} : ${desc}`).join("\n")}
    `
        
        this.toolForSuccessors_.parameters = Type.Object({
                                tasks: Type.Array(Type.Object({
                                task: Type.String({ description: "a clear description of a task to be run. Be specific about expected inputs, outputs, files to create/modify, and acceptance criteria. For explorer tasks, specify the question to answer and the subfolder to explore. For verifier tasks, list every file the preceding workers touched so tests can be written for all of them." }),
                                agent: Type.Union(this.subAgentsOutputNames_.map(a => Type.Literal(a[0], { description: a[1] })), { description: "which agent to assign this task to. Use 'explorer' to survey the codebase first, then 'worker' for implementation, and 'verifier' after every implementation batch." }),
                            }))
                        })
    } ; 
}

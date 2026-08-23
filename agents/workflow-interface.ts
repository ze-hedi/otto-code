import type { ToolInput } from "./pi-agent-types";
import { Type } from "@sinclair/typebox";

export enum Agent2AgentLink {
    One2One , 
    One2Many,
    Many2Many 
}
export class AgentInterface {
    protected name_ : string ; 
    protected inputPromptSuffix_ : string ; 
    protected outputPromptSuffix_ : string ; 
    protected toolForSuccessors_ : ToolInput ; 
    protected subAgentsInputsNames_ : [string,string][] ;
    protected subAgentsOutputNames_ : [string,string][] ;
    protected A2A_ : Agent2AgentLink 

    constructor(name:string) {
        this.name_ = name ; 
    } ; 
    public getTool() : ToolInput {
        return this.toolForSuccessors_ ; 
    }
    public getOutputPromptSuffix() : string | string[] {
        return this.inputPromptSuffix_ ; 
    }
    public getInputPromptSuffix() : string | string[] {
        return this.outputPromptSuffix_ ; 
    }
    public getToolName() : string {
        return this.toolForSuccessors_.name ; 
    }
    public getInterfaceType() : Agent2AgentLink {
        return this.A2A_ ; 
    }
} ; 

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

export class ForwardInterface extends AgentInterface {
    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("forward_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors; 
        if (subAgentsInputsNames.length > 1 || subAgentsOutputNames.length > 1 ) 
            throw new Error("forward interface is one to one interface. It take only one input and one input") ; 
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ; 
        this.A2A_ = Agent2AgentLink.One2One ; 


    }

}
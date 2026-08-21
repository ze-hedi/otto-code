import { ToolInput } from "../agents/pi-agent-configs"
import { RawPiAgent } from "../agents/raw-pi-agent";
import { Type } from "@sinclair/typebox"
import { DelegationInterface } from "../agents/workflow-types";


let delegationToolInput : ToolInput = {
    name: "delegation_tool",
    label : "delegation tool", 
    description:"a tool that should be called by an agent whe'n it estimate that it finihsed it's job and it's ready to delegate the to the future agents in the DAG",  
    promptSnippet : "Tool used we the subagent ended its work and ready to delegate task for the agents in the graph",
    promptGuidelines : ["test"] , 
    executionMode : "sequential",  
    terminate : true, 
    execute : async (toolCallId,params) => {
        return {content: [{type:"text",text:JSON.stringify(params)}]}
    }
} 

let SubAgentInputsNames : [string,string][] = [
     ["cv_reader", "a professional recruiter with decade of exeperience"]
]

let subAgentOutputsNames : [string,string][] = [
    ["technical_analyst","an midlevel HR with technical backgrouind that is able to do a complete analysis about the technical aspect of the candidate"], 
    ["soft_skill_analyst","a HR that specializes in understanding softskill and leadership skills of the candidate"]
]

let delegationInterface = new DelegationInterface(delegationToolInput, SubAgentInputsNames,subAgentOutputsNames ) ;

console.log("runned succeffuly  !! ") ; 
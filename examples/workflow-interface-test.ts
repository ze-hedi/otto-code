/*

This test has for goal is to check if the dag pipeline is working successfuly. 
Input data : so we will consider the following DAG (a complete dummy test)
 
     
                                |-----> technical skills analyst    
cv_reader -------> delgates ----|
                                |-----> leadership skills analyst    



The mechanism of workflow is as follow : 
        - We will have a sort of factory, it will store all the available agents. 
        - We identify these agents by an id that we will use to add tthe agent in the workflow
*/

import { ToolInput } from "../agents/pi-agent-types"
import { RawPiAgentConfig } from "../agents/pi-agent-configs"
import { Type } from "@sinclair/typebox"
import { AgentsStorage, InterfaceStorage} from "../agents/workflow-types";
import { DelegationInterface, AgentInterface } from "../agents/workflow-interface";
import { Workflow } from "../agents/workflow";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

// ================================== SECTION 1 : building the DAG Interface ==================================
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

let InterfaceMaps : Map<string,AgentInterface> = new Map() ;
InterfaceMaps.set("delegates",delegationInterface) ; 

const interfaceStorage = new InterfaceStorage(InterfaceMaps) ; 
console.log("interface storage is screated correctly ") ; 


// ================================== SECTION 2 : Building agents storage ==================================

let cvReaderSystemPrompt : string = `You are a CV reader, a professional recruiter with a decade of experience. Your job is to read a candidate's resume and produce a structured summary of their identity, experience, education, and skills, extracting only what is explicitly visible and never inventing information.`

let technicalAnalystSystemPrompt : string = `You are a technical analyst, a mid-level HR with a technical background. Analyze the candidate's technical skills and experience to produce a complete assessment of the technical aspect of the profile.`

let softSkillAnalystSystemPrompt : string = `You are a soft-skill analyst, an HR specialized in soft skills and leadership. Analyze the candidate's interpersonal, communication, and leadership qualities to produce an assessment of their soft skills.`

let cvReaderConfig : RawPiAgentConfig = {
    name : "cv_reader" ,
    model : "deepseek/deepseek-v4-pro" ,
    systemPrompt : cvReaderSystemPrompt ,
    builtInTools : ["read"] ,
    playground : process.cwd() ,
    sessionMode : "memory" ,
}

let technicalAnalystConfig : RawPiAgentConfig = {
    name : "technical_analyst" ,
    model : "deepseek/deepseek-v4-pro" ,
    systemPrompt : technicalAnalystSystemPrompt ,
    builtInTools : [] ,
    playground : process.cwd() ,
    sessionMode : "memory" ,
}

let softSkillAnalystConfig : RawPiAgentConfig = {
    name : "soft_skill_analyst" ,
    model : "deepseek/deepseek-v4-pro" ,
    systemPrompt : softSkillAnalystSystemPrompt ,
    builtInTools : [] ,
    playground : process.cwd() ,
    sessionMode : "memory" ,
}

let agentsStorage = new AgentsStorage(new Map([
    ["cv_reader", cvReaderConfig] ,
    ["technical_analyst", technicalAnalystConfig] ,
    ["soft_skill_analyst", softSkillAnalystConfig] ,
]))



// ================================== SECTION 3 : building the workflow input ==================================

let workflowInput = {
    components : [
        { id : "cv_reader", type : "agent", x : 224, y : 330 } ,
        { id : "delegates", type : "interface", x : 623, y : 330 } ,
        { id : "technical_analyst", type : "agent", x : 653, y : 171 } ,
        { id : "soft_skill_analyst", type : "agent", x : 653, y : 493 } ,
    ] ,
    connections : [
        { from : "cv_reader", fromSide : "right", to : "delegates", toSide : "left" } ,
        { from : "delegates", fromSide : "right", to : "technical_analyst", toSide : "left" } ,
        { from : "delegates", fromSide : "right", to : "soft_skill_analyst", toSide : "left" } ,
    ] ,
}

let workflow = new Workflow(workflowInput, agentsStorage, interfaceStorage) ;
workflow.buildExecutionQueue() ;

let availableAgents = workflow.getAvailableAgents() ; 

for (const agent of availableAgents) {
    const sysPrompt =  await agent.getSystemPrompt() ; 
    console.log(sysPrompt) ; 
    console.log("\n\n\n")
    console.log("~~~~~~~")
}

await workflow.run([`Analyze this CV and delegate the technical and soft-skill analysis to the downstream agents :

John Doe
Software Engineer
john.doe@example.com | +1 555 123 4567

Experience
- Backend Engineer, Acme Corp (2020-Present): built REST APIs in Node.js, worked with PostgreSQL and Docker.
- Junior Developer, StartupX (2018-2020): maintained Python scripts and internal tools.

Education
- BSc Computer Science, State University (2018)

Skills
- Node.js, TypeScript, Python, SQL, Docker, Git

Leadership
- Mentored 2 interns, led a small team on a billing migration project.
`]) ;


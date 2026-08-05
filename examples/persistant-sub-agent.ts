
import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../agents/raw-pi-agent";
import {RawPiAgentConfig, SubAgentToolConfig, ToolInput} from "../agents/pi-agent-configs" ; 
import {handleEvent} from "../agents/pi-agent-utils"; 
import {config} from "dotenv"  ; 
import {dirname, resolve} from "path"; 
import {fileURLToPath} from "url"; 
import { createInterface } from "readline";
import { PiAgentConfig, PersistantSubAgentToolConfig } from "../agents/pi-agent-configs";

const __dirname = dirname(fileURLToPath(import.meta.url)) ; 
config({path:resolve(__dirname,"../.env")}) ; 



let clarification_tool : ToolInput = {
    name : "clarification_tool" , 
    label : "clarification tool" , 
    description : "a tool that should be called to ask for clarification" , 
    parameters: Type.Object({
        questions: Type.Array(Type.String({description : "a question that helps you gather clarifications about what to do"}))
    }, {description:"a set of questions that will help get more context for an optimal response and reasoning guidance"}), 
    promptSnippet : "clarification tool that help you get more context from the user though question" , 
    promptGuidelines : ["call this tool when you need more details to help you orient your response to the optimal response"], 
    executionMode : "sequential", 
    execute: async (toolCallId, params) => {
        let clarifications = [] ; 
        for (let question of params.questions){
            clarifications.push(question) ; 
            const answer : string = await ask(question) ; 
            clarifications.push(answer) ; 
        }   
        clarifications.join("\n") ; 
        return  {content : [{type : "text",text:clarifications}]} ; 
    }
}

let budget_analyser_sys_prompt : string = `
You are a bugdet analyzer. You will have access to a certain budget and a certain user goal. 
Your mission is to think deep about the user query and how to respond efficiently to it. You need to consider multiple perspective run multiple scenarios and researches, that help you through you reasoning.

Your final output should be a detailed description of the best outcome.
`
let persistant_subAgent_config: RawPiAgentConfig = {
    name: "budget_analyzer" , 
    model: "deepseek/deepseek-v4-pro", 
    systemPrompt : budget_analyser_sys_prompt, 
    thinkingLevel : "medium" ,
    builtInTools : ["read","bash","write","edit"] 
}

let persistent_subagent_tool_config : PersistantSubAgentToolConfig = {
    name : "budget_analyzer" , 
    description : "a budget analyzer agent that analyze your budget to find you the optimal analysis to the best query response in correspondance to budget", 
    parameters: Type.Object({
        Task: Type.String({description:"a clear description of what the agent is supposed to do"}) 
    }),
    promptSnippet : "an agent that study the feasability of an idea through budget analysis and proposes an optimal path of how to use it",
    promptGuidelines : ["use this agent when you need to check if some idea is in the users budget", 
                        "use this tool when you have the choice between different scenarios and need find out which more cheap"
    ] ,     
}

let web_researcher_sys_prompt : string = ` 
You are a web researcher, your goal is to do a deep web research, that have for goal to respond to the initial query  
`
let web_researcher_subAgent_config: RawPiAgentConfig = {
    name: "web_researcher" , 
    model: "deepseek/deepseek-v4-pro", 
    systemPrompt : web_researcher_sys_prompt, 
    thinkingLevel : "medium" ,
    builtInTools : ["read","bash","write","edit"], 
    mcpServers : {tavily_mcp:"http://0.0.0.0:8000/mcp"}
}

let persistent_web_researcher_subagent_tool_config : PersistantSubAgentToolConfig = {
    name : "web_researcher" , 
    description : "a web researcher agent to be used to look for details on internet ",
    parameters: Type.Object({
        Task: Type.String({description:"the task the agent is intended to do web search about"})
    }),    
    promptSnippet: "an agent that is suppoed to do web researches. You give a task to look for something in Internet and it does it", 
    promptGuidelines : ["use this agent if you need to explore some regions for activities",
                        "use this agent when you need to look for certain price"
    ]
}

let orchestrator_system_prompt : string = `
You are a vacation planner, your mission is to take some idea, understand it, ask for more details if you more context.
Your goal is to create the perfect vacation by aligning the finances and the taske of the user to propose the perfect vacation
`

let orchestrator_config : RawPiAgentConfig = {
    name: "traveling_agent" , 
    model:  "deepseek/deepseek-v4-pro" , 
    systemPrompt: orchestrator_system_prompt , 
    thinkingLevel:"medium", 
    builtInTools : [] , 
    tools : [clarification_tool] , 
    persistantSubAgents : {
        web_researcher : [web_researcher_subAgent_config, persistent_web_researcher_subagent_tool_config] , 
        budget_analyze : [persistant_subAgent_config,persistent_subagent_tool_config]
    }
}

let orchestrator_pi_agent = new RawPiAgent(orchestrator_config) ; 

let full_system_prompt = await orchestrator_pi_agent.getSystemPrompt() ; 

console.log("full system prompt ") ; 
console.log(full_system_prompt) ; 


import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../agents/raw-pi-agent";
import {RawPiAgentConfig, SubAgentToolConfig, ToolInput} from "../agents/pi-agent-configs" ;
import {config} from "dotenv"  ; 
import {dirname, resolve} from "path"; 
import {fileURLToPath} from "url";
import { PiAgentConfig, PersistantSubAgentToolConfig } from "../agents/pi-agent-configs";
import { createInterface } from "readline";
import {handleEvent} from "../agents/pi-agent-utils"; 


const __dirname = dirname(fileURLToPath(import.meta.url)) ; 
config({path:resolve(__dirname,"../.env")}) ; 

const rl = createInterface({input:process.stdin, output: process.stdout}) ; 

function ask(question:string) : Promise<string> {
    return new Promise((resolve) => {
        rl.question(question,(answer) => resolve(answer)) ; 
    })
}


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



let brainstormer_subAgent_system_prompt : string = `
You are a brainstormer agent, a brainstormer active collegue that help users develop they're idea. 
Your main focus will be Saas and software products in general. 
You would be a given an software product idea, that could be not well defined or very wide and your goal will be helping developing in the goal of providing an artefact that details every agreement point you get to with the user regarding some idea.

Your wrokflow should be dynamic and adaptable. For example you can be given a very wide idea. 
An idea that is kind of abstract or very general that demand more precision in  order to turn it into an actionable plan. 
In such case your would start by asking question through which you try to align with the user's goal. 
Once the idea is clear, you second goal is to reason about technical aspects to explore the different sub topics and parts that will help you develop a clear deep understanding and mental model about how the idea should be implemented. 

Don't forget you are a brainstroming agent!! you don't need to get lost in a lot of very technical aspect of implementation because your final goal is to helping building a clear mental model about what we need to build : 
You need to be enough technical to develop a clear system of system images, but not to delve in very nuanced technical aspects that are more the speciality of field expert (say a cloud engineer or backend engineer). 

Keep in mind that you need to be dynamic and adapt yourself to the degree of details that the user initially provide.

When you estimted that your vision is aligned with what the user intend to build. 
That's way you need to be proactive and try to engage the user in a creative brainstorming session
`

let brainstorming_agent_config: RawPiAgentConfig = {
    name: "brainstorming_agent" , 
    model: "deepseek/deepseek-v4-pro" , 
    systemPrompt: brainstormer_subAgent_system_prompt, 
    thinkingLevel : "high" , 
    builtInTools : ['read','write',"bash","edit"],
    tools : [clarification_tool], 
    playground : "/home/bouchehdahed/code/benders_tui", 

 }

 let software_architect_agent_system_prompt = `
 You are 
 
 
 `

 const agent = new RawPiAgent(brainstorming_agent_config) ; 

 const system_prompt: string = await agent.getSystemPrompt() ; 

 console.log("system prompt ",system_prompt) ; 

const user_query = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));
while (true) 
{
    const input = await user_query("\nYou: ") ; 
    if (!input || input.toLocaleLowerCase() === "exit") break ; 
    await agent.chat(input,handleEvent)
}

 rl.close() ; 
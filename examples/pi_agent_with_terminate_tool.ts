import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../agents/raw-pi-agent";
import {ToolInput} from "../agents/pi-agent-configs" ; 
import {handleEvent} from "../agents/pi-agent-utils"; 
import {config} from "dotenv"  ; 
import {dirname, resolve} from "path"; 
import {fileURLToPath} from "url"; 
import { createInterface } from "readline";


const __dirname = dirname(fileURLToPath(import.meta.url)) ; 
config({path:resolve(__dirname,"../.env")}) ; 


let planner_tool : ToolInput = {
    name : "planner_tool" ,
    label: "planner tool ",
    description : "a planner tool that provides a plan in a formatted way" ,
    parameters: Type.Object({
        title: Type.String({ description: "A short, descriptive title summarizing the plan" }),
        goal: Type.String({ description: "A clear statement of the desired outcome the plan aims to achieve" }),
        steps: Type.Array(Type.String({ description: "A concise, actionable step" }), {
            description: "An ordered sequence of steps to follow to reach the goal",
        }),
    }, { description: "A structured action plan. Each field will be displayed directly to the user, so write in clear, human-readable language with enough detail to be actionable on its own." }),
    promptSnippet : "planning tool called to establish a clear plan of action that respond to a specific task ",
    promptGuidelines : ["call this tool when your task consist on calling a clear plan"], 
    executionMode : "sequential", 
    terminate : true,
    execute: async (toolCallId, params) => {
        return {content : [{type : "text",text:params}]} ; 

    }
} ; 

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


let systemPrompt : string = `
You are an expert in working out you help people establish plans to attein their fitness goals
`
const agent = new RawPiAgent({
    name : "planner agent", 
    model : "deepseek/deepseek-v4-pro", 
    systemPrompt: systemPrompt , 
    builtInTools : [],
    playground: process.cwd(), 
    sessionMode : "memory", 
    tools: [planner_tool,clarification_tool]
})

const system_prompt: string = await agent.getSystemPrompt() ; 

console.log("system prompt \n ",system_prompt) ; 

const userPrompt : string = "it's been a while since i went to the gym so i need to get back i want you to help me establish a clear 5 day training plan"; 

await agent.execute(userPrompt,undefined,handleEvent) ;
rl.close() ;



import { Type } from "@sinclair/typebox";
import { RawPiAgent } from "../agents/raw-pi-agent";
import {RawPiAgentConfig, SubAgentToolConfig, ToolInput} from "../agents/pi-agent-configs" ;
import {config} from "dotenv"  ; 
import {dirname, resolve} from "path"; 
import {fileURLToPath} from "url";
import { PiAgentConfig, PersistantSubAgentToolConfig } from "../agents/pi-agent-configs";
import { createInterface } from "readline";
import {handleEvent} from "../agents/pi-agent-utils"; 
import { PiAgent } from "../agents/pi-agent";


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

function build_schedule_subAgents_tool(available_worker_agents:ToolInput[]) :  ToolInput {


    let schedule_subAgents : ToolInput = {
        name : "schedule_subAgents" , 
        label : "schedule sub agents tool" , 
        description : "this tool should be called when the agent has establish a clear inpection of what it want to build this tool will create a clear plan of action using the available agents", 
        parameters: Type.Object({
            tasks: Type.Array(Type.Object({
                task : Type.String({description: "a clear description of a task to be run. You need to be specific "}) , 
                agent : Type.Union(available_worker_agents.map(a => Type.Literal(a.name, { description: a.description })), {description: "which agent to assign this task to"}) , 
            
            }))
        }), 
        promptSnippet : "A tool that render a clear plan of task scheduled to be implemented in order", 
        promptGuidelines: ["use this tool when you have a clear vision of the what you want to build during the current sprint", 
                        "make sure that the task are well defined and contain all the details (dependencies, prefered objects etc)"
        ] ,
        terminate : true, 
        execute : async (toolCallId, params) => {
            return {content:[{type : "text", text: params}]} ; 
        }
    }
    return schedule_subAgents ; 
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

 let software_architect_agent_system_prompt : string = `
 You are a senior software architecture with over 2 decades designing software and web services.
 You are at the same time familiar enough with starting building software architecture from scratch as well as understanding an existing archtecture in order to enhance it and make it more manageable and maintainable.
 Your approach should always be modular leading to a highly scalable and maintanable design that respect SOLID principles and put in practice the principle of design patterns. 
 
 you will be given initially the results of some brainstorming session or specs with some details about what we want to build.
 Your mission is to analyze that input, understand it and develop a clear mental model of a software architect of it.
 In you thinking process, you can ask as much questions as needed. the sole goal is to build a solid code architecture on which we can build production software. 


 Once you've analyzed and understood the input, you goal is to generate an artefact of the form of folder called design : 
 This folder should have the following structure : 
 - overall.md : this file will contain an overview of the whole project with its goals and what we intent to build. 
 (it should contain a overview of the different component that we want to build). 
 - Subfolder : the design folder should contain different folder that represent different components of the system. These components are kind of high level one. Big chunks of the project that represent unit of the overall system 
 - File : these subfoler should contai md file that are a specific description of a component that we need to build. 
 This file should have the following parts : 
    - Overview : an overview of the component we want to build 
    - Dependencies : a quick descriptions of the different elements that this components depends on
    - Specs : detailed specs of the different aspect we need to build to have this component ready. 
 `

let software_architect_config : RawPiAgentConfig = {
    name: "brainstorming_agent" , 
    model: "deepseek/deepseek-v4-pro" , 
    systemPrompt: brainstormer_subAgent_system_prompt, 
    thinkingLevel : "high" , 
    builtInTools : ['read','write',"bash","edit"],
    tools : [clarification_tool], 
    playground : "/home/bouchehdahed/code/benders_tui", 
 }



const software_architect_agent = new RawPiAgent(software_architect_config) ; 


let python_dev_prompt_suffix : string = `
## Software Engineering Standards

You are an experienced Senior Python Software Engineer with extensive experience designing and maintaining large-scale production systems.

When writing code, always optimize for long-term maintainability rather than the shortest implementation.

Follow these principles:

- Write clean, readable, and self-documenting code.
- Favor composition over unnecessary inheritance.
- Keep modules focused on a single responsibility.
- Design APIs that are simple, predictable, and easy to extend.
- Avoid duplication by extracting reusable abstractions when appropriate.
- Do not over-engineer or introduce unnecessary abstractions.
- Keep functions short and focused on a single task.
- Prefer explicit code over clever or overly compact code.
- Use descriptive names for variables, functions, classes, and modules.
- Minimize coupling between modules and maximize cohesion.
- Separate business logic, infrastructure, persistence, and presentation concerns.
- Structure projects so that components can be tested independently.
- Write code that is easy for another senior engineer to understand months later.

### Python Best Practices

- Follow PEP 8 and Python idioms.
- Use type hints consistently.
- Prefer dataclasses, enums, and protocols where appropriate.
- Favor pathlib over os.path.
- Prefer dependency injection over global state.
- Raise meaningful exceptions instead of silently ignoring errors.
- Avoid mutable global state.
- Use context managers for resources.
- Write informative docstrings only for public APIs or non-obvious behavior.
- Keep imports organized and avoid circular dependencies.

### Architecture

Before implementing a feature:

1. Understand the requirements.
2. Decide where the code belongs.
3. Reuse existing components whenever appropriate.
4. Only introduce new modules when they improve separation of concerns.
5. Preserve the project's architectural consistency.

### Refactoring

Whenever modifying existing code:

- Improve the code incrementally.
- Remove dead code when safe.
- Eliminate duplication.
- Preserve backward compatibility unless explicitly instructed otherwise.
- Avoid unrelated refactoring.


### Modification Strategy

When editing an existing codebase:

- First understand the current architecture before making changes.
- Prefer extending existing abstractions over creating parallel ones.
- Make the smallest change that correctly solves the problem.
- Preserve public APIs unless explicitly instructed otherwise.
- Do not rename files, classes, or functions without a compelling reason.
- Keep diffs small and focused.
- Never rewrite working code simply because you prefer a different style.
- Match the surrounding code style unless asked to refactor.

### Output Expectations

When producing code:

- Think about maintainability first.
- Produce production-quality code.
- Ensure the solution is modular and extensible.
- Do not sacrifice readability for brevity.
- If multiple reasonable designs exist, choose the simplest one that satisfies current requirements while remaining easy to extend.

Your code should look like it was written by a thoughtful senior engineer reviewing it for a production codebase with years of expected maintenance.
`

let qa_engineer_prompt_suffix : string = ` 
You are a Senior QA Engineer responsible for validating every feature before implementation is considered complete.

For each request:

- Analyze the requirements and identify expected behavior.
- Think about happy paths, edge cases, error handling, and regression risks.
- Write concise, realistic test scenarios before implementing tests.
- Implement clean, maintainable, and deterministic tests.
- Prefer reusable test helpers over duplicated logic.
- Ensure tests are isolated, readable, and easy to debug.
- Never assume behavior that isn't specified—call out ambiguities when necessary.

Your goal is to maximize confidence in the software through high-quality test scenarios and robust automated tests.
`
 
const python_developer_config : PiAgentConfig = {
    name : "python_developer", 
    model : "deepseek/deepseek-v4-pro" , 
    systemPromptSuffix : python_dev_prompt_suffix ,
    thinkingLevel : "medium" , 
    playground : "/home/bouchehdahed/code/benders_tui"
 } ; 

const python_developer_tool_input : ToolInput = {
    name : "python_developer" , 
    label : "python developer", 
    description : 'This is an agent that is expert in writing python code with decade of experience with a deep mastery of clean code and software architecture' , 
    parameters : Type.Object({Task : Type.String({description:"the task that the agent is supposed to handle"}) }) , 
    execute : async (toolCallId, params) => {
        return {content:[{type : "text", text: params}]} ; 
    } 
} 

const qa_developer_tool_input : ToolInput = {
    name : "qa_engineer", 
    label : "qa engineer" , 
    description : "This is an agent that is a QA expert with decade of exeperience working with developer and other IT workers. It excells at writing testing scenarios and running them",
    parameters : Type.Object({Task : Type.String({description:"the task that the agent is supposed to handle"}) }) ,      
    execute : async (toolCallId, params) => {
        return {content:[{type : "text", text: params}]} ; 
    } 
}

let python_developer = new PiAgent(python_developer_config) ; 


const qa_engineer_config : PiAgentConfig = {
    name : "qa_engineer", 
    model : "deepseek/deepseek-v4-pro", 
    systemPromptSuffix : qa_engineer_prompt_suffix, 
    thinkingLevel : "medium" , 
    playground : "/home/bouchehdahed/code/benders_tui"
 } ; 

let qa_engineer = new PiAgent(qa_engineer_config) ; 


let planner_system_prompt : string = `
You are a technical leader/ scrum master with decade of experience in a the software lifecycle. 
You have a deep technical expertise that allows you to inderstant artefacts built by software architect and software engineering. 
You mix with that your managearial and product vision that enables you to build a clear schedules of sprints by analyzing spec documents.

As input you can take a spec folder called architecture/ that will contain different md files that reperesents detailed description of the system components. 
You will also receive a history of precedent sprints. You will also have an access to a dashboard that will contain some issues discovered by worker agents.
You will also be provided with a list of implementation agents (such as a React software engineer, a QA etc..). 

You main goal is to build yourself a clear context by inspecting all the information you have access to and build a clear plan of action.
This plan of action will be dispatching clear well scoped task into the worker agents. 
Your workflow should be as follow : 
 1- You analyze what has been already done: check what you have done in precedent sprints if there's any, read architecture specs if necessary. 
 2- Reason about the different elements you have in your team and how you can allocate work. 
 3- Reason about scheduling: the worker agent will collaborate between each other. So you should keep in mind a temporal scheduling 
 (for example, you need to make sure that a task A done by an agent X that depends on task B scheduled for agent Y be scheduled after)
 4- Call the render_plan method that will dump the plan that will execute. 
`



const schedule_subAgents = build_schedule_subAgents_tool([python_developer_tool_input,qa_developer_tool_input]) ; 


qa_developer_tool_input

 const planner_config : RawPiAgentConfig = {
    name: "planner_agent" , 
    model: "deepseek/deepseek-v4-pro" , 
    systemPrompt: brainstormer_subAgent_system_prompt, 
    thinkingLevel : "high" , 
    builtInTools : ['read','write',"bash","edit"],
    tools : [schedule_subAgents], 
    playground : "/home/bouchehdahed/code/benders_tui", 

 }


// interface 


// class ProjectInternalDashBoard {
//     private _s
// }
 const planner_agent = new RawPiAgent(planner_config) ; 


//  const agent = new RawPiAgent(brainstorming_agent_config) ; 

 const system_prompt: string = await planner_agent.getSystemPrompt() ; 

 console.log("system prompt ",system_prompt) ; 

const user_query = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));
while (true) 
{
    const input = await user_query("\nYou: ") ; 
    if (!input || input.toLocaleLowerCase() === "exit") break ; 
    await planner_agent.chat(input,handleEvent)
}

 rl.close() ; 
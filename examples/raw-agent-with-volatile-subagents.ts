import {RawPiAgent} from "../agents/raw-pi-agent.ts"
import { SubAgentToolConfig} from "../agents/pi-agent-configs.ts"
import {handleEvent} from "../agents/pi-agent-utils"; 
import {fileURLToPath} from "url"; 
import {config} from "dotenv"  ; 
import {dirname, resolve} from "path"; 

const __dirname = dirname(fileURLToPath(import.meta.url)) ; 
config({path:resolve(__dirname,"../.env")}) ; 


let ExplorerSubAgentSystemPrompt: string = `
You are a code base explorer. Your sole mission is analyzing the query you get and build a context based on your search that other workers and planners can use. 

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
Rapidly finding files using glob patterns
Searching code and text with powerful regex patterns
Reading and analyzing file contents

Guidelines: 
Use "read" when you know the specific file path you need to read
Use "bash" ONLY for read-only operations (ls, git status, git log, git diff, find, grep":""}, cat, head, tail:"Get-ChildItem, git status, git log, git diff, Get-Content, Select-Object -First/-Last"})

Your output should be a concise efficient summary that respond shortly to the query 
`

let playground : string = "/home/bouchehdahed/code/Trading_exchange"; 


let explorerSubAgentConfig : SubAgentToolConfig  = {
    name : "Explorer_sub_agent", 
    description : "A volatile sub-agent used for tasks that involves code base exploration ", 
    model : "deepseek/deepseek-v4-pro", 
    systemPrompt : ExplorerSubAgentSystemPrompt , 
    builtInTools : ["bash","write"] , 
    playground : playground , 
    promptSnippet : "an exploration subagent that is useful to explore codebases. Give it a task and it will render you a full analysis backed with files ", 
    promptGuidelines : ["call this spawned subagent tool when you have an exploration task of the code base that is kind opaque and demand a deep exploration"]
}

let systemPrompt : string = `You are Otto a coding harness designed for software engineering task such as debugging, exploring and reading quality code.
Your main scope is the repo in which you are set. 
` 
let agent = new RawPiAgent({
    name : "otto code agent" , 
    model : "deepseek/deepseek-v4-pro",  
    systemPrompt : systemPrompt , 
    builtInTools : ["write","read","bash","edit"] , 
    playground : playground, 
    sessionMode : "memory" , 
    subAgents : {explorer_sub_agent:explorerSubAgentConfig } 
})

let agentSystemPrompt :string = await agent.getSystemPrompt() ; 

console.log(agentSystemPrompt) ; 

let userPrompt : string = "launch to explorer agents in parallel one to explore readme.md and the other to explore lock_free_queue.md"

await agent.execute(userPrompt,undefined,handleEvent) ; 
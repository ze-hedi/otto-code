// import { ToolInput } from "../agents/pi-agent-configs"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express  from 'express' ; 
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod" ; 

export enum TaskState {NOT_STARTED, IN_PROGRESS, FINISHED}

export interface Task 
{
    id : string ; 
    title : string ; 
    description: string ; 
    task : TaskState ;  
} ; 


export class Sprint 
{
    private id_ : string ; 
    private goal_ : string  ; 
    private tasks_: Task[]  ;

    constructor(goal:string) 
    {
        this.id_ = crypto.randomUUID() ;
        this.goal_ = goal ;  
        this.tasks_ = [] ; 
    } 
    
    public getSprintID() : string {
        return this.id_ ; 
    }

    public addTask(task:Task) {
        this.tasks_.push(task) ; 
    }

} ;


export class SWEDashboard {
    private sprintsHistory_ : Sprint[]  ; 

    constructor() {this.sprintsHistory_ = []} ; 

    public createSprint(goal : string): [string,string] {
        let new_sprint = new Sprint(goal) ; 
        this.sprintsHistory_.push(new_sprint) ;
        return [new_sprint.getSprintID(),goal] ;   
    } 

    public addTaskTosprint(title:string, description:string): void {
        let new_task : Task  = { 
            id : crypto.randomUUID(), 
            title : title , 
            description : description, 
            task : TaskState.NOT_STARTED 
        }

        this.sprintsHistory_.at(-1)?.addTask(new_task); 
    }
}


let swe_dashboard = new SWEDashboard() ; 

const server = new McpServer({
    name: "Scrum-Dashboard-server", 
    version : "0.0.1",
}) ; 


//Tool to generate a new Sprint object 
const new_sprint_tool_name:string = "create_new_sprint" ; 
const new_sprint_tool_desscription: string = `
This tool should be called when you need to create a new sprint. 
The sprint will be a sort of development program that have for goal building or enhancing new component.
Everytime you estimate you have an independant feature or enhancements, that is self contained \
in the sense that it has its goal that tend to acheive throuhg tasks
`

const new_sprint_tool_schema  = z.object({
    goal : z.string(),
}).describe("the goal that a deep analaysis of what to build during this sprint is done") ; 


server.tool(
    new_sprint_tool_name, 
    new_sprint_tool_desscription,
    new_sprint_tool_schema ,  
    async ({goal}) => {
        let srint_details = swe_dashboard.createSprint(goal) ;
        let sprint_creation_log  = `
Created successfully a new Sprint. 
UUID : ${srint_details[0]}
Goal : ${srint_details[1]}
` 
        console.log(sprint_creation_log)
        return {content: [{type:"text", text:sprint_creation_log}]} ; 
    }
); 

const add_new_task_tool_name = "add_new_task" ; 
const add_new_task_tool_description = `
Call this tool when you need to add a new task to the sprint you are working on
`

const add_new_task_tool_schema = z.object({
    title: z.string().describe("Title of the task"),
    description: z.string().describe("Description of the task"),
}).describe("Schema for adding a new task to the current sprint");

server.tool(
    add_new_task_tool_name,
    add_new_task_tool_description,
    add_new_task_tool_schema,
    async ({title, description}) => {
        swe_dashboard.addTaskTosprint(title, description) ;
        let task_creation_log = `
Created successfully a new Task.
Title: ${title}
Description: ${description}
`
        console.log(task_creation_log)
        return {content: [{type:"text", text:task_creation_log}]} ;
    }
);

const app = express() ; 
app.use(express.json()) ;

app.post("/mcp", async (req,res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  await transport.close();
}) ; 

app.listen(3000, () => {
    console.log("MCP server listening on http://localhost:3000/mcp") ; 
})





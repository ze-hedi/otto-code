import "dotenv/config"  ; 
import {RawPiAgent, RawPiAgentConfig} from "../raw-pi-agent" ;


const agent_config : RawPiAgentConfig = {
    model:"anthropic/claude-sonnet-4-5", 
    apiKey : process.env.ANTHROPIC_API_KEY, 
    thinkingLevel:"high" ,
    sessionMode : "memory", 
    systemPrompt : `
You are a journalist agent. 
your mission is to analyze the user input, Do the necessary web research to find informations to respond to user's query 
    `,
    mcpServers:{tavily_mcp:"http://0.0.0.0:8000/mcp"}, 
    builtInTools:["read"]
} ; 

let pi_agent : RawPiAgent = new RawPiAgent(
    agent_config
) ; 

 
const registered_tools = await pi_agent.connectAllMcp() ; 

for (const [server,tools] of registered_tools) 
{
    console.log(`${server} available tools : ${tools.join(',')}`) ; 
}

const systemPrompt = await pi_agent.getSystemPrompt(); 
console.log(`agent system prompt : ${systemPrompt}`)
pi_agent.disconnectMcp("tavily_mcp")
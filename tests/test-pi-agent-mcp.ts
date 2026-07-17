import "dotenv/config"  ; 
import {PiAgent, PiAgentConfig} from "../pi-agent" ;


const agent_config : PiAgentConfig= {
    model:"anthropic/claude-sonnet-4-5", 
    apiKey : process.env.ANTHROPIC_API_KEY, 
    thinkingLevel:"high" ,
    sessionMode : "memory", 
    systemPromptSuffix : `
You are a journalist agent. 
your mission is to analyze the user input, Do the necessary web research to find informations to respond to user's query 
    `,
    mcpServers:{tavily_mcp:"http://0.0.0.0:8000/mcp"}
} ; 

let pi_agent : PiAgent = new PiAgent(
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
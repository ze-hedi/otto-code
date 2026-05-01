// examples/custom-tools.ts
// Example demonstrating custom tools with PiAgent

import { PiAgent, type ToolInput } from "../pi-agent";
import { Type } from "typebox";

// Example mock database
const mockDatabase = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "Engineer" },
  { id: 2, name: "Bob Smith", email: "bob@example.com", role: "Designer" },
  { id: 3, name: "Charlie Brown", email: "charlie@example.com", role: "Manager" },
  { id: 4, name: "Diana Prince", email: "diana@example.com", role: "Engineer" },
];

// Example mock weather data
const mockWeather: Record<string, any> = {
  "san francisco": { temp: 65, condition: "Foggy", humidity: 80 },
  "new york": { temp: 72, condition: "Sunny", humidity: 60 },
  "london": { temp: 58, condition: "Rainy", humidity: 85 },
  "tokyo": { temp: 68, condition: "Cloudy", humidity: 70 },
};

// Define database search tool
const databaseTool: ToolInput = {
  name: "search_database",
  label: "Search Database",
  description: "Search the user database by name, email, or role. Returns matching user records.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query (matches name, email, or role)" }),
    limit: Type.Optional(Type.Number({ description: "Maximum number of results to return", default: 10 })),
  }),
  promptSnippet: "Search user database by name, email, or role",
};

async function main() {
  console.log("=== PiAgent Custom Tools Example ===\n");

  // Create agent with custom tools defined at construction time
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    sessionMode: "memory",
    thinkingLevel: "low",
    
    // Define custom tools
    tools: [databaseTool],
    
    // External tool execution handler
    onToolExecute: async (toolCallId, toolName, params) => {
      console.log(`\n🔧 Executing tool: ${toolName}`);
      console.log(`📋 Tool Call ID: ${toolCallId}`);
      console.log(`📥 Parameters:`, JSON.stringify(params, null, 2));
      
      // Handle database search tool
      if (toolName === "search_database") {
        const query = params.query.toLowerCase();
        const limit = params.limit || 10;
        
        // Simulate database search
        const results = mockDatabase
          .filter(user => 
            user.name.toLowerCase().includes(query) ||
            user.email.toLowerCase().includes(query) ||
            user.role.toLowerCase().includes(query)
          )
          .slice(0, limit);
        
        console.log(`✅ Found ${results.length} results`);
        
        return {
          content: [{ 
            type: "text", 
            text: `Found ${results.length} user(s):\n${JSON.stringify(results, null, 2)}` 
          }],
          details: { count: results.length, query: params.query },
        };
      }
      
      // Handle weather tool
      if (toolName === "get_weather") {
        const location = params.location.toLowerCase();
        const weather = mockWeather[location];
        
        if (!weather) {
          console.log(`❌ Weather data not found for: ${location}`);
          return {
            content: [{ 
              type: "text", 
              text: `Weather data not available for "${params.location}". Try: San Francisco, New York, London, or Tokyo.` 
            }],
            details: { error: true, location: params.location },
          };
        }
        
        console.log(`✅ Weather data found for: ${location}`);
        
        return {
          content: [{ 
            type: "text", 
            text: `Weather in ${params.location}:\n` +
                  `Temperature: ${weather.temp}°F\n` +
                  `Condition: ${weather.condition}\n` +
                  `Humidity: ${weather.humidity}%`
          }],
          details: { location: params.location, ...weather },
        };
      }
      
      throw new Error(`Unknown tool: ${toolName}`);
    },
  });

  // Show registered tools
  console.log("📦 Registered tools:", agent.getRegisteredTools());
  
  // Add another tool dynamically
  console.log("\n➕ Adding weather tool dynamically...");
  agent.addTool({
    name: "get_weather",
    label: "Get Weather",
    description: "Get current weather information for a specified location",
    parameters: Type.Object({
      location: Type.String({ description: "City name (e.g., 'San Francisco', 'New York')" }),
    }),
    promptSnippet: "Get current weather for a location",
  });
  
  console.log("📦 Updated registered tools:", agent.getRegisteredTools());
  
  // Check if tools are registered
  console.log("\n🔍 Checking tools:");
  console.log("  - Has 'search_database':", agent.hasTool("search_database"));
  console.log("  - Has 'get_weather':", agent.hasTool("get_weather"));
  console.log("  - Has 'nonexistent':", agent.hasTool("nonexistent"));
  
  // Execute a query that uses custom tools
  console.log("\n\n=== Starting Agent Execution ===\n");
  
  await agent.execute(
    "First, search the database for all engineers. Then, get the weather for San Francisco.",
    (event) => {
      // Stream text output
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      
      // Show when agent finishes
      if (event.type === "agent_end") {
        console.log("\n\n✅ Agent execution completed!");
      }
    }
  );
  
  console.log("\n\n=== Example Complete ===");
}

// Run the example
main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

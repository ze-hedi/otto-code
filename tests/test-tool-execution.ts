// tests/test-tool-execution.ts
// Simple test to verify tool execution works

import { PiAgent } from "../pi-agent";
import { Type } from "typebox";

async function testSimpleToolExecution() {
  console.log("\n=== Testing Tool Execution ===\n");
  
  let toolExecuted = false;
  let receivedParams: any = null;
  
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    sessionMode: "memory",
    thinkingLevel: "off",
    
    tools: [
      {
        name: "echo",
        label: "Echo Tool",
        description: "Echoes back the message provided",
        parameters: Type.Object({
          message: Type.String({ description: "Message to echo" }),
        }),
      },
    ],
    
    onToolExecute: async (toolCallId, toolName, params) => {
      console.log(`✅ Tool executed: ${toolName}`);
      console.log(`   Call ID: ${toolCallId}`);
      console.log(`   Params:`, params);
      
      toolExecuted = true;
      receivedParams = params;
      
      return {
        content: [{
          type: "text",
          text: `Echo: ${params.message}`,
        }],
        details: { echoed: true },
      };
    },
  });
  
  console.log("📦 Registered tools:", agent.getRegisteredTools());
  console.log("\n⚠️  Note: This test only verifies the tool infrastructure.");
  console.log("   To test actual agent execution with custom tools, run:");
  console.log("   npx tsx examples/custom-tools.ts\n");
  
  // Verify the tool definition is created correctly
  const session = await agent.getSession();
  const allTools = session.getAllTools();
  
  console.log("\n🔍 Tools available in session:");
  allTools.forEach(tool => {
    console.log(`   - ${tool.name}: ${tool.description}`);
  });
  
  const echoTool = allTools.find(t => t.name === "echo");
  if (!echoTool) {
    throw new Error("❌ FAIL: Echo tool not found in session");
  }
  
  console.log("\n✅ SUCCESS: Custom tool is properly registered in the session!");
  console.log("   Tool name:", echoTool.name);
  console.log("   Tool description:", echoTool.description);
}

testSimpleToolExecution().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

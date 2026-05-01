// tests/test-custom-tools.ts
// Unit tests for custom tools functionality

import { PiAgent } from "../pi-agent";
import { Type } from "typebox";

async function testToolRegistration() {
  console.log("\n=== Test: Tool Registration ===");
  
  const callLog: any[] = [];
  
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    tools: [
      {
        name: "echo",
        label: "Echo",
        description: "Echo back a message",
        parameters: Type.Object({
          message: Type.String({ description: "Message to echo" }),
        }),
      },
    ],
    onToolExecute: async (toolCallId, toolName, params) => {
      callLog.push({ toolCallId, toolName, params });
      return {
        content: [{ type: "text", text: `Echo: ${params.message}` }],
      };
    },
  });
  
  // Test: tool is registered
  if (!agent.hasTool("echo")) {
    throw new Error("❌ FAIL: Tool 'echo' should be registered");
  }
  console.log("✅ PASS: Tool 'echo' is registered");
  
  // Test: tool appears in list
  const tools = agent.getRegisteredTools();
  if (!tools.includes("echo")) {
    throw new Error("❌ FAIL: Tool 'echo' should be in registered tools list");
  }
  console.log("✅ PASS: Tool 'echo' appears in registered tools list");
  console.log("   Registered tools:", tools);
}

async function testDynamicToolAddition() {
  console.log("\n=== Test: Dynamic Tool Addition ===");
  
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    onToolExecute: async (toolCallId, toolName, params) => {
      return {
        content: [{ type: "text", text: `${toolName}: ${JSON.stringify(params)}` }],
      };
    },
  });
  
  // Initially no tools
  if (agent.getRegisteredTools().length !== 0) {
    throw new Error("❌ FAIL: Should start with no tools");
  }
  console.log("✅ PASS: Agent starts with no tools");
  
  // Add a tool dynamically
  agent.addTool({
    name: "reverse",
    label: "Reverse",
    description: "Reverse a string",
    parameters: Type.Object({
      text: Type.String({ description: "Text to reverse" }),
    }),
  });
  
  // Test: tool was added
  if (!agent.hasTool("reverse")) {
    throw new Error("❌ FAIL: Dynamic tool should be registered");
  }
  console.log("✅ PASS: Dynamic tool 'reverse' is registered");
  
  // Test: tool count is correct
  if (agent.getRegisteredTools().length !== 1) {
    throw new Error("❌ FAIL: Should have exactly 1 tool");
  }
  console.log("✅ PASS: Tool count is correct (1)");
}

async function testToolRemoval() {
  console.log("\n=== Test: Tool Removal ===");
  
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    tools: [
      {
        name: "tool1",
        label: "Tool 1",
        description: "First tool",
        parameters: Type.Object({}),
      },
      {
        name: "tool2",
        label: "Tool 2",
        description: "Second tool",
        parameters: Type.Object({}),
      },
    ],
    onToolExecute: async () => ({ content: [] }),
  });
  
  // Test: both tools are registered
  if (agent.getRegisteredTools().length !== 2) {
    throw new Error("❌ FAIL: Should have 2 tools initially");
  }
  console.log("✅ PASS: Agent has 2 tools initially");
  
  // Remove one tool
  const removed = agent.removeTool("tool1");
  if (!removed) {
    throw new Error("❌ FAIL: removeTool should return true");
  }
  console.log("✅ PASS: removeTool returned true");
  
  // Test: tool was removed
  if (agent.hasTool("tool1")) {
    throw new Error("❌ FAIL: tool1 should be removed");
  }
  console.log("✅ PASS: tool1 was removed");
  
  // Test: other tool still exists
  if (!agent.hasTool("tool2")) {
    throw new Error("❌ FAIL: tool2 should still exist");
  }
  console.log("✅ PASS: tool2 still exists");
  
  // Test: removing non-existent tool returns false
  const removed2 = agent.removeTool("nonexistent");
  if (removed2) {
    throw new Error("❌ FAIL: Removing non-existent tool should return false");
  }
  console.log("✅ PASS: Removing non-existent tool returns false");
}

async function testDuplicateToolError() {
  console.log("\n=== Test: Duplicate Tool Error ===");
  
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    tools: [
      {
        name: "duplicate",
        label: "Duplicate",
        description: "A tool",
        parameters: Type.Object({}),
      },
    ],
    onToolExecute: async () => ({ content: [] }),
  });
  
  // Try to add duplicate tool
  try {
    agent.addTool({
      name: "duplicate",
      label: "Duplicate 2",
      description: "Another tool",
      parameters: Type.Object({}),
    });
    throw new Error("❌ FAIL: Should throw error for duplicate tool");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already registered")) {
      console.log("✅ PASS: Duplicate tool throws appropriate error");
    } else {
      throw error;
    }
  }
}

async function testMultipleToolsInConfig() {
  console.log("\n=== Test: Multiple Tools in Config ===");
  
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    tools: [
      {
        name: "tool_a",
        label: "Tool A",
        description: "First tool",
        parameters: Type.Object({
          param: Type.String(),
        }),
      },
      {
        name: "tool_b",
        label: "Tool B",
        description: "Second tool",
        parameters: Type.Object({
          value: Type.Number(),
        }),
      },
      {
        name: "tool_c",
        label: "Tool C",
        description: "Third tool",
        parameters: Type.Object({
          flag: Type.Boolean(),
        }),
      },
    ],
    onToolExecute: async () => ({ content: [] }),
  });
  
  // Test: all tools are registered
  const tools = agent.getRegisteredTools();
  if (tools.length !== 3) {
    throw new Error(`❌ FAIL: Should have 3 tools, got ${tools.length}`);
  }
  console.log("✅ PASS: All 3 tools are registered");
  
  // Test: each tool exists
  const expectedTools = ["tool_a", "tool_b", "tool_c"];
  for (const toolName of expectedTools) {
    if (!agent.hasTool(toolName)) {
      throw new Error(`❌ FAIL: Tool '${toolName}' should be registered`);
    }
  }
  console.log("✅ PASS: All expected tools exist");
  console.log("   Tools:", tools);
}

async function runAllTests() {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║  PiAgent Custom Tools - Unit Tests    ║");
  console.log("╚════════════════════════════════════════╝");
  
  try {
    await testToolRegistration();
    await testDynamicToolAddition();
    await testToolRemoval();
    await testDuplicateToolError();
    await testMultipleToolsInConfig();
    
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║  ✅ All Tests Passed!                  ║");
    console.log("╚════════════════════════════════════════╝\n");
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

// Run all tests
runAllTests().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

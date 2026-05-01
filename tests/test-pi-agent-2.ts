// test-pi-agent-2.ts
// Examples using the PiAgent class

import "dotenv/config";
import { PiAgent } from "../pi-agent";
import { handleEvent } from "../pi-agent-utils";

// ============================================================================
// Example 1: Basic usage with event streaming
// ============================================================================

async function basicExample() {
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    thinkingLevel: "medium",
    sessionMode: "memory",
  });

  console.log("=== Basic Example ===\n");
  console.log("Agent parameters:", JSON.stringify(agent.getConfig(), null, 2));
  console.log();

  await agent.execute(
    "List all .ts files in the current directory and count them",
    handleEvent
  );

  console.log("\n\n✅ Done\n");
}

// ============================================================================
// Example 2: PR Reviewer Agent
// ============================================================================

async function prReviewerExample() {
  const prReviewer = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    thinkingLevel: "high",
    sessionMode: "memory",
    systemPromptSuffix: `
You are a senior engineer doing PR reviews.

When reviewing code changes:
- Be direct and opinionated, don't hedge
- Flag anything that could cause a bug or regression as BLOCKING
- Flag style/perf issues as NON-BLOCKING
- Always suggest a concrete fix, not just a problem description
- Output in this format:

## Summary
<one paragraph overview>

## Blocking issues
<list or "none">

## Non-blocking suggestions
<list or "none">
    `,
  });

  console.log("=== PR Review ===\n");

  await prReviewer.execute(
    `Run git diff --staged, then review all changes and provide feedback in the format specified in your system prompt.`,
    handleEvent
  );

  console.log("\n\n✅ Review complete\n");
}

// ============================================================================
// Example 3: Multiple queries with same agent (conversation)
// ============================================================================

async function conversationExample() {
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    sessionMode: "disk", // Persist to disk so we can continue
  });

  console.log("=== Conversation Example ===\n");

  // First query
  console.log("Query 1: Analyze codebase structure\n");
  await agent.execute(
    "List all TypeScript files and group them by their apparent purpose (e.g., examples, core, utils)",
    handleEvent
  );

  console.log("\n---\n");

  // Second query (same session, agent remembers context)
  console.log("Query 2: Deep dive into core files\n");
  await agent.execute(
    "Now read the core files and explain the main class or function in each",
    handleEvent
  );

  console.log("\n\n✅ Conversation complete\n");
}

// ============================================================================
// Example 4: Custom event handling (log everything)
// ============================================================================

async function detailedLoggingExample() {
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    handlers: {
      onTextDelta: (delta) => process.stdout.write(delta),
      onToolStart: (_, toolName, args) =>
        console.log(`\n\n⚙️  Tool: ${toolName}\n   Input: ${JSON.stringify(args, null, 2)}`),
      onToolEnd: (_, toolName, result) =>
        console.log(`✅  Tool finished: ${toolName}\n   Output preview: ${String(result).slice(0, 100)}...`),
      onMessageEnd: () => console.log("\n--- Turn complete ---"),
      onAgentEnd: () => console.log("\n🏁 Agent finished"),
      onCompactionStart: () => console.log("\n⚠️  Context compacted (approaching token limit)"),
    },
  });

  console.log("=== Detailed Logging ===\n");

  await agent.execute("Run git log --oneline -5 and explain what each commit does", handleEvent);

  console.log("\n");
}

// ============================================================================
// Example 5: Line count query
// ============================================================================

async function lineCountExample() {
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  console.log("=== Line Count Example ===\n");

  await agent.execute("Count all lines of code in .ts files", handleEvent);

  console.log("\n✅ Done\n");
}

// ============================================================================
// Run examples
// ============================================================================

async function main() {
  await basicExample();
  await prReviewerExample();
  await conversationExample();
  await detailedLoggingExample();
  await lineCountExample();
}

main().catch(console.error);

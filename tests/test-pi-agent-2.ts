// test-pi-agent-2.ts
// Examples using the PiAgent class

import "dotenv/config";
import { PiAgent, AgentEvent } from "../pi-agent";

// ============================================================================
// Shared event handler
// ============================================================================

function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case "agent_start":
      console.log("--- agent start ---");
      break;

    case "agent_end":
      console.log("--- agent end ---");
      break;

    case "turn_start":
      console.log("\n--- turn start ---");
      break;

    case "turn_end":
      console.log("\n--- turn end ---");
      break;

    case "message_start":
      console.log("\n--- message start ---");
      break;

    case "message_end":
      console.log("\n--- message end ---");
      break;

    case "message_update":
      switch (event.assistantMessageEvent.type) {
        case "thinking_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "thinking_end":
          console.log("\n--- end of thinking ---\n");
          break;
        case "text_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "toolcall_end":
          console.log(`\n🔧 [tool call] ${event.assistantMessageEvent.toolCall.name} ${JSON.stringify(event.assistantMessageEvent.toolCall.arguments)}`);
          break;
        case "text_end":
          console.log(`\n--- text block end ---`);
          break;
        case "done":
          console.log(`\n--- stream done (${event.assistantMessageEvent.reason}) ---`);
          break;
        case "error":
          console.log(`\n--- stream error (${event.assistantMessageEvent.reason}) ---`);
          break;
      }
      break;

    case "tool_execution_start":
      console.log(`\n⚙️  [${event.toolName}] ${JSON.stringify(event.args)}`);
      break;

    case "tool_execution_update":
      process.stdout.write(String(event.partialResult));
      break;

    case "tool_execution_end": {
      const result = String(event.result);
      if (event.isError) {
        console.log(`\n❌ [${event.toolName}] error: ${result}`);
      } else {
        console.log(`\n✅ [${event.toolName}]:\n${result}`);
      }
      break;
    }

    case "queue_update":
      console.log(`\n--- queue update (steering: ${event.steering.length}, followUp: ${event.followUp.length}) ---`);
      break;

    case "compaction_start":
      console.log(`\n--- compaction start (${event.reason}) ---`);
      break;

    case "compaction_end":
      console.log(`\n--- compaction end (${event.reason}, aborted: ${event.aborted}) ---`);
      break;

    case "session_info_changed":
      console.log(`\n--- session name: ${event.name} ---`);
      break;

    case "auto_retry_start":
      console.log(`\n--- retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms: ${event.errorMessage} ---`);
      break;

    case "auto_retry_end":
      console.log(`\n--- retry end (success: ${event.success}, attempt: ${event.attempt}${event.finalError ? `, error: ${event.finalError}` : ""}) ---`);
      break;
  }
}

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
// Example 5: Non-blocking query (don't wait for completion)
// ============================================================================

async function nonBlockingExample() {
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  console.log("=== Non-blocking Query ===\n");

  // Start query but don't await
  const session = await agent.query(
    "Count all lines of code in .ts files",
    handleEvent
  );

  console.log("Query started, doing other work...\n");

  // You can do other work here while the agent runs

  // Later, subscribe to know when it's done
  return new Promise<void>((resolve) => {
    session.subscribe((event) => {
      if (event.type === "agent_end") {
        console.log("\n✅ Agent finished in background");
        resolve();
      }
    });
  });
}

// ============================================================================
// Run examples
// ============================================================================

async function main() {
  await basicExample();
  await prReviewerExample();
  await conversationExample();
  await detailedLoggingExample();
  await nonBlockingExample();
}

main().catch(console.error);

#!/usr/bin/env tsx
// quick-start.ts
// Minimal example: PR reviewer that reviews staged git changes

import { PiAgent } from "./pi-agent";

const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  thinkingLevel: "high",
  systemPromptSuffix: `
You are a senior engineer reviewing PRs.
Be direct, flag bugs as BLOCKING, style issues as NON-BLOCKING.
Output format:
## Summary
## Blocking issues
## Non-blocking suggestions
  `,
});

console.log("🔍 Reviewing staged changes...\n");

await agent.execute(
  "Run git diff --staged and review the changes following your system prompt format",
  (event) => {
    // Stream output to terminal
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }

    // Show tool invocations
    if (event.type === "tool_execution_start") {
      console.error(`\n⚙️  [${event.toolName}]\n`);
    }
  }
);

console.log("\n\n✅ Review complete");

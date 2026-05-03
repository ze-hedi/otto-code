#!/usr/bin/env tsx
import "dotenv/config";
import { PiAgent } from "../pi-agent";

const SYSTEM_PROMPT = `
You are a helpful assistant. Keep answers short and direct.
`.trim();

const SKILL = {
  name: "list-files",
  content: `---
description: List files in the current directory
---
When asked to list files, use the Bash tool to run \`ls -la\`.
`,
};

async function main() {
  const agent = new PiAgent({
    model: "anthropic/claude-haiku-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    sessionMode: "memory",
    systemPromptSuffix: SYSTEM_PROMPT,
    skills: [SKILL],
  });

  console.log("=== Test 1: execute (one-shot) ===");
  await agent.execute("What is 2 + 2? Answer in one sentence.", (event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });
  console.log("\n");

  console.log("=== Test 2: execute (list files via skill) ===");
  await agent.execute("List the files in the current directory.", (event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });
  console.log("\n");

  console.log("=== Test 3: execute (system prompt check) ===");
  await agent.execute("What are you here to help with?", (event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });
  console.log("\n");

  console.log("=== Done ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

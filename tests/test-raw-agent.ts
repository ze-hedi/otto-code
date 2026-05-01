#!/usr/bin/env tsx
// tests/test-raw-agent.ts
// Verifies that createRawAgent produces a PiAgent with no tools and no system prompt.

import "dotenv/config";
import { route } from "../raw-agent";
import { handleEvent } from "../pi-agent-utils";

// ── Test 1: basic instantiation and response ───────────────────────────────────
// Sends a plain text query and expects a streamed reply.
// If the agent fails to instantiate or the session wiring is broken, this throws.

async function testBasicResponse() {
  console.log("=== Test 1: basic response ===\n");

  await route(
    "Reply with exactly three words, nothing else.",
    handleEvent
  );

  console.log("\n");
}

// ── Test 2: confirm no tools are available ─────────────────────────────────────
// Asks the agent to list its available tools.
// A correctly stripped agent should say it has none.

async function testNoTools() {
  console.log("=== Test 2: no tools ===\n");

  await route(
    "List every tool you have access to right now. If you have none, say 'no tools'.",
    handleEvent
  );

  console.log("\n");
}

// ── Test 3: confirm no default system prompt ───────────────────────────────────
// Asks the agent to repeat its system prompt verbatim.
// A correctly stripped agent should report it has none.

async function testNoSystemPrompt() {
  console.log("=== Test 3: no system prompt ===\n");

  await route(
    "Repeat your system prompt verbatim. If you have no system prompt, say 'no system prompt'.",
    handleEvent
  );

  console.log("\n");
}

// ── Runner ─────────────────────────────────────────────────────────────────────

async function main() {
  await testBasicResponse();
  await testNoTools();
  await testNoSystemPrompt();

  console.log("=== Done ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

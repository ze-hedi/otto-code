#!/usr/bin/env tsx
// tests/test-claude-code-agent.ts
// Smoke-tests ClaudeCodeAgent — spawns one persistent Claude CLI process and
// sends two messages through it to verify the start/send/stop lifecycle.
// Run from the repo root so Claude works inside this repo.
//
// Usage:
//   cd /path/to/otto_code
//   npx tsx tests/test-claude-code-agent.ts

import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from "../claude-code-agents.ts/claude-code-agent";

async function streamEvents(agent: ClaudeCodeAgent, prompt: string): Promise<void> {
  process.stdout.write("Response: ");

  for await (const event of agent.send(prompt)) {
    switch (event.type) {
      case "system":
        console.log(`[init] session=${event.sessionId} model=${event.model} cwd=${event.cwd}`);
        console.log(`[init] tools=${event.tools.join(", ")}`);
        break;
      case "thinking":
        console.log(`\n[thinking] ${event.thinking}`);
        break;
      case "text":
        process.stdout.write(event.delta);
        break;
      case "tool_start":
        console.log(`\n[tool: ${event.name}] ${JSON.stringify(event.input)}`);
        break;
      case "tool_result":
        console.log(`[result${event.isError ? " (error)" : ""}] ${event.content}`);
        break;
      case "result":
        console.log(`\n\nSubtype  : ${event.subtype}`);
        console.log(`Cost     : $${event.costUsd.toFixed(6)}`);
        console.log(`Duration : ${event.durationMs}ms`);
        console.log(`Turns    : ${event.numTurns}`);
        console.log(`Tokens   : in=${event.usage.inputTokens} out=${event.usage.outputTokens} cache_read=${event.usage.cacheReadInputTokens} cache_write=${event.usage.cacheCreationInputTokens}`);
        break;
      case "error":
        console.error("\nError:", event.message);
        throw new Error(event.message);
    }
  }

  console.log("\n");
}

// ── Runner ─────────────────────────────────────────────────────────────────────

async function main() {
  const agent = new ClaudeCodeAgent({
    systemPrompt: "You are a concise code reviewer. Answer in plain text, no markdown.",
  });

  const cfg = (agent as any).config as ClaudeCodeAgentConfig;
  console.log("[agent] systemPrompt  :", cfg.systemPrompt);
  console.log("[agent] model         :", cfg.model ?? "(cli default)");
  console.log("[agent] maxTurns      :", cfg.maxTurns ?? "(unlimited)");
  console.log("[agent] permissionMode:", cfg.permissionMode ?? "(default)");
  console.log("[agent] allowedTools  :", cfg.allowedTools ?? "(all)");
  console.log();

  console.log("[agent] starting persistent subprocess...");
  agent.start();
  console.log("[agent] subprocess ready\n");

  console.log("=== Turn 1: repo languages ===\n");
  await streamEvents(agent, "What programming languages are used in this repository? Give a short list.");

  console.log("=== Turn 2: follow-up (tests persistence) ===\n");
  await streamEvents(agent, "Which of those languages is used the most?");

  agent.stop();
  console.log("[agent] subprocess stopped");
  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

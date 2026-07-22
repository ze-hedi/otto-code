#!/usr/bin/env tsx
import "dotenv/config";
import { PiAgent } from "../agents/pi-agent";

async function main() {
  const gc = globalThis.gc;

  // --- Baseline: measure main thread RSS before creating agent ---
  if (gc) gc();
  const baseline = process.memoryUsage();
  console.log(`Baseline RSS: ${(baseline.rss / 1024 / 1024).toFixed(1)} MB`);

  // --- Create PiAgent with mem0 config ---
  const agent = new PiAgent({
    model: "anthropic/claude-sonnet-4-6",
    sessionMode: "memory",
    mem0Config: {
      embedProvider: "ollama",
      embedModel: "all-minilm",
      embedDims: 384,
    },
  });

  if (gc) gc();
  const afterConstruct = process.memoryUsage();
  console.log(`After PiAgent construction: RSS ${(afterConstruct.rss / 1024 / 1024).toFixed(1)} MB (delta: ${((afterConstruct.rss - baseline.rss) / 1024).toFixed(1)} KB)`);
  console.log(`hasMem0: ${agent.hasMem0()}`);

  // --- Send a chat message (this triggers _extractMemories -> worker spawn) ---
  console.log("\nSending chat message...");
  try {
    await agent.chat("My name is Hedi and I love building AI agents in TypeScript");
    if (gc) gc();
    const afterChat = process.memoryUsage();
    console.log(`After chat: RSS ${(afterChat.rss / 1024 / 1024).toFixed(1)} MB`);
    console.log("Chat completed, mem0 worker should have been spawned in background");
  } catch (err: any) {
    console.log(`Chat failed (expected if no credits): ${err.message}`);
  }

  // --- Wait a bit for worker to process ---
  console.log("\nWaiting 3s for worker to process...");
  await new Promise((r) => setTimeout(r, 3000));

  if (gc) gc();
  const afterWorker = process.memoryUsage();
  console.log(`After worker processing: RSS ${(afterWorker.rss / 1024 / 1024).toFixed(1)} MB`);

  // --- Terminate the worker ---
  console.log("\nTerminating mem0 worker...");
  await agent.terminateMem0();
  console.log(`hasMem0 after terminate: ${agent.hasMem0()}`);

  if (gc) gc();
  const afterTerminate = process.memoryUsage();
  console.log(`After terminate: RSS ${(afterTerminate.rss / 1024 / 1024).toFixed(1)} MB`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});

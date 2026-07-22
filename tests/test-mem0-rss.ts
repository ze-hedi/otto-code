#!/usr/bin/env tsx
import "dotenv/config";
import { PiAgent } from "../agents/pi-agent";

function printRss(label: string, before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage) {
  const rss = after.rss - before.rss;
  const heap = after.heapUsed - before.heapUsed;
  console.log(`\n=== ${label} ===`);
  console.log(`  RSS delta:       ${(rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap used delta: ${(heap / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Total RSS:       ${(after.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Total heap:      ${(after.heapUsed / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  // Force GC if available (run with --expose-gc)
  const gc = globalThis.gc;

  // --- PiAgent WITHOUT mem0 ---
  if (gc) gc();
  const before1 = process.memoryUsage();

  const agentNoMem0 = new PiAgent({
    model: "anthropic/claude-sonnet-4-6",
    sessionMode: "memory",
  });

  const after1 = process.memoryUsage();
  printRss("PiAgent WITHOUT mem0", before1, after1);

  // --- PiAgent WITH mem0 ---
  if (gc) gc();
  const before2 = process.memoryUsage();

  const agentWithMem0 = new PiAgent({
    model: "anthropic/claude-sonnet-4-6",
    sessionMode: "memory",
    mem0Config: {
      embedProvider: "ollama",
      embedModel: "all-minilm",
      embedDims: 384,
    },
  });

  const after2 = process.memoryUsage();
  printRss("PiAgent WITH mem0", before2, after2);

  // --- Summary ---
  console.log("\n=== COMPARISON ===");
  const rssNoMem0 = after1.rss - before1.rss;
  const rssWithMem0 = after2.rss - before2.rss;
  console.log(`  Without mem0: ${(rssNoMem0 / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  With mem0:    ${(rssWithMem0 / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Overhead:     ${((rssWithMem0 - rssNoMem0) / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});

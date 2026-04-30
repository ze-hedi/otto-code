#!/usr/bin/env tsx
import "dotenv/config";
import { Mem0 } from "../mem0";

async function main() {
  const mem = new Mem0();

  console.log("=== Test 1: add memories from a conversation ===");
  const addResult = await mem.add(
    [
      { role: "user", content: "I'm building a coding agent in TypeScript." },
      { role: "assistant", content: "Cool! What stack are you using?" },
      { role: "user", content: "I'm using the Pi coding agent SDK with Anthropic." },
    ],
    { userId: "hedi" }
  );
  console.log("Added:", JSON.stringify(addResult, null, 2));

  console.log("\n=== Test 2: search memories ===");
  const results = await mem.search("What is the user building?", { userId: "hedi" });
  console.log("Results:", JSON.stringify(results, null, 2));

  console.log("\n=== Test 3: getAll ===");
  const all = await mem.getAll({ userId: "hedi" });
  console.log("All memories:", JSON.stringify(all, null, 2));

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});

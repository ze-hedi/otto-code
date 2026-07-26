#!/usr/bin/env tsx
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Mem0 } from "../memory_layer/mem0";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
async function main() {
  const memBefore = process.memoryUsage();
  const mem = new Mem0();
  const memAfter = process.memoryUsage();

  const heapUsed = memAfter.heapUsed - memBefore.heapUsed;
  const rss = memAfter.rss - memBefore.rss;
  console.log("=== Mem0 object size ===");
  console.log(`  Heap used delta:  ${heapUsed} bytes (${(heapUsed / 1024).toFixed(2)} KB)`);
  console.log(`  RSS delta:        ${rss} bytes (${(rss / 1024).toFixed(2)} KB)`);
  console.log(`  Total heap after: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log();

  console.log("=== Test 1: add memories from a conversation ===");
  const addResult = await mem.add(
    [
      { role: "user", content: "I want to become an expert of inference " },
      { role: "assistant", content: "great with want you want to start" },
      { role: "user", content: "let's start with the basic on cuda and optimize some kernels" },
    ],
    { userId: "hedi" }
  );
  
  

  
  console.log("Added 2 ", JSON.stringify(addResult,null,2)) ; 

  // console.log("\n=== Test 2: search memories ===");
  // const results = await mem.search("is user has any intrest that can be related to cars ??", { userId: "hedi" });
  // console.log("Results:", JSON.stringify(results, null, 2));

  // console.log("\n=== Test 3: getAll ===");
  // const all = await mem.getAll({ userId: "hedi" });
  // console.log("All memories:", JSON.stringify(all, null, 2));

  // console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});

import "dotenv/config";
import { QdrantManager } from "../memory/qdrant.js";
import { MemoryExtractor } from "../memory/MemoryExtractor.js";
import type { ChatMessage } from "../memory/extractor_agent.js";

const COLLECTION = "memories";
const VECTOR_SIZE = 1536;

async function main() {
  const qdrant = new QdrantManager({
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY!,
    embeddingModel: "openai/text-embedding-3-small",
    embeddingApiKey: process.env.OPENROUTER_API_KEY!,
  });

  // Ensure collection exists
  if (await qdrant.collectionExists(COLLECTION)) {
    await qdrant.deleteCollection(COLLECTION);
  }
  await qdrant.createCollection(COLLECTION, VECTOR_SIZE);
  console.log("Collection ready.\n");

  const sessionId = "session-test-001";
  const agentId = "agent-test";

  const extractor = new MemoryExtractor({
    sessionId,
    agentId,
    topK: 10,
    qdrant,
    extractorModel: "deepseek/deepseek-v4-pro",
  });

  // --- Turn 1: user shares personal context ---
  console.log("=== Turn 1 ===");
  const turn1: ChatMessage[] = [
    {
      role: "user",
      content:
        "Hey! I'm Hedi, I'm a software engineer based in Tunisia. I've been working with TypeScript and Python for about 5 years. I'm currently building an agentic framework called otto_code.",
    },
    {
      role: "assistant",
      content:
        "Nice to meet you Hedi! That's a cool project. What kind of agents does otto_code support?",
    },
  ];

  const extracted1 = await extractor.run(turn1);
  console.log(`Extracted ${extracted1.length} memories:`);
  for (const m of extracted1) {
    console.log(`  [${m.attributed_to}] ${m.text}`);
  }

  // --- Turn 2: more details, should link to existing ---
  console.log("\n=== Turn 2 ===");
  const turn2: ChatMessage[] = [
    {
      role: "user",
      content:
        "otto_code supports raw agents with full prompt control, sub-agent delegation, and workflow orchestration. I'm now adding a memory layer on top of it using Qdrant for vector storage.",
    },
    {
      role: "assistant",
      content:
        "That's a solid architecture. Using Qdrant for the memory layer makes sense given you already have it in the stack.",
    },
  ];

  const extracted2 = await extractor.run(turn2);
  console.log(`Extracted ${extracted2.length} memories:`);
  for (const m of extracted2) {
    console.log(`  [${m.attributed_to}] ${m.text}`);
    if (m.linked_memory_ids?.length) {
      console.log(`    linked to: ${m.linked_memory_ids.join(", ")}`);
    }
  }

  // --- Turn 3: nothing to extract ---
  console.log("\n=== Turn 3 ===");
  const turn3: ChatMessage[] = [
    { role: "user", content: "Thanks!" },
    { role: "assistant", content: "You're welcome!" },
  ];

  const extracted3 = await extractor.run(turn3);
  console.log(`Extracted ${extracted3.length} memories (expected 0).`);

  // --- Verify what's in Qdrant ---
  console.log("\n=== Stored memories ===");
  const allResults = await qdrant.search(
    COLLECTION,
    "Hedi software engineer otto_code",
    sessionId,
    agentId,
    20
  );
  for (const r of allResults) {
    console.log(`  [${r.score.toFixed(3)}] ${r.payload.text}`);
  }

  // Cleanup
  console.log("\nCleaning up...");
  await qdrant.deleteCollection(COLLECTION);
  console.log("Done.");
}

main().catch(console.error);

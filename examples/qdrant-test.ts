import "dotenv/config";
import { QdrantManager } from "../vector_database/qdrant.js";
import { v4 as uuid } from "uuid";

const COLLECTION = "memory_examples";
const VECTOR_SIZE = 1536; // text-embedding-3-small

async function main() {
  const db = new QdrantManager({
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY!,
    embeddingModel: "openai/text-embedding-3-small",
    embeddingApiKey: process.env.OPENROUTER_API_KEY!,
  });

  // 1. Recreate collection fresh
  console.log("Creating collection...");
  if (await db.collectionExists(COLLECTION)) {
    await db.deleteCollection(COLLECTION);
  }
  await db.createCollection(COLLECTION, VECTOR_SIZE);
  console.log("Collection ready.");

  // 2. Insert some facts
  const sessionId = "session-001";
  const agentId = "agent-alpha";

  const facts = [
    "The user prefers formal communication style.",
    "The user is a senior software engineer with 10 years of experience.",
    "The user is currently working on a contract analysis tool for Tunisian law.",
    "The user likes to keep code simple and avoids over-engineering.",
    "The project uses TypeScript with Qdrant as vector database.",
  ];

  console.log(`\nInserting ${facts.length} facts...`);
  await db.upsert(
    COLLECTION,
    facts.map((text) => ({ id: uuid(), text, sessionId, agentId }))
  );
  console.log("Facts inserted.");

  // 3. Search
  const query = "What does the user prefer in terms of coding style?";
  console.log(`\nSearching: "${query}"`);
  const results = await db.search(COLLECTION, query, sessionId, agentId, 3);

  for (const r of results) {
    console.log(`  [${r.score.toFixed(3)}] ${r.payload.text}`);
  }

  // 4. Insert facts for a different agent, verify filtering works
  const otherAgentId = "agent-beta";
  await db.upsert(COLLECTION, [
    {
      id: uuid(),
      text: "This fact belongs to agent-beta only.",
      sessionId,
      agentId: otherAgentId,
    },
  ]);

  console.log(`\nSearching same query but filtered to agent-beta...`);
  const filtered = await db.search(
    COLLECTION,
    query,
    sessionId,
    otherAgentId,
    3
  );
  console.log(`  Results for agent-beta: ${filtered.length}`);
  for (const r of filtered) {
    console.log(`  [${r.score.toFixed(3)}] ${r.payload.text}`);
  }

  // 5. Cleanup
  console.log("\nCleaning up collection...");
  await db.deleteCollection(COLLECTION);
  console.log("Done.");
}

main().catch(console.error);

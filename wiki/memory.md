---
title: Memory
sources:
  - memory/qdrant.ts
  - memory/extractor_agent.ts
  - memory/MemoryExtractor.ts
  - memory/additive-extraction.md
---

# Memory

## Purpose

The memory layer turns conversation history into long-term, searchable facts. An LLM reads recent chat messages, extracts "memories" (self-contained factual statements), and stores them as vectors in a Qdrant database. Later sessions can search that store for relevant context, filtered by session and agent. It is the "memory distillation" engine behind the web app's sleeping/distill feature.

## How it works

1. `MemoryExtractor.run()` takes the latest messages and joins their text into a single query string.
2. It searches Qdrant for existing memories in the same collection, filtered to the current `sessionId` and `agentId` (returning the top `topK` results).
3. It calls `runExtraction()` with the new messages plus those existing memories. This spins up a `RawPiAgent` named `memory-extractor` whose system prompt is `additive-extraction.md`.
4. The extractor agent calls a single `extract_memories` tool with the extracted memories as JSON (an empty array if nothing is worth keeping).
5. `MemoryExtractor` assigns each memory a random UUID, then upserts it into Qdrant with payload `text`, `sessionId`, `agentId`, `attributed_to`, and optional `linked_memory_ids`.

## Key code

- `memory/qdrant.ts` — `QdrantManager`, the vector store wrapper.
  - `embed` / `embedBatch` — convert text to vectors through the OpenAI-compatible embeddings endpoint (OpenRouter by default).
  - `createCollection` — creates a collection and adds keyword payload indexes on `sessionId` and `agentId`.
  - `upsert` — embeds each point's text, then writes points with their payload.
  - `search` — embeds the query and runs a vector search filtered to one `sessionId` and `agentId`.
  - `scroll`, `get`, `delete`, `collectionExists`, `collectionInfo` — supporting CRUD/utility methods.
- `memory/extractor_agent.ts` — runs the extraction agent.
  - `runExtraction()` — builds a `RawPiAgent` with the system prompt and an `extract_memories` tool, then awaits the memories.
  - `buildUserPrompt()` — assembles the prompt sections: summary, last-k messages, existing memories, new messages, observation date, and current date.
  - Types: `ExtractedMemory`, `ExistingMemory`, `ChatMessage`, `ExtractionInput`, `ExtractorAgentConfig`.
- `memory/MemoryExtractor.ts` — `MemoryExtractor`, the orchestrator.
  - `run()` — the search → extract → upsert flow described above.
  - `MemoryExtractorConfig` — `sessionId`, `agentId`, `topK`, `qdrant`, `collectionName`, `extractorModel`.
- `memory/additive-extraction.md` — the "Memory Extractor" system prompt. A long instruction document defining what counts as a memory, quality standards, memory-linking rules, and the required JSON output schema.

## Data & config

- **Reads/writes:** Qdrant vector collections. Each point has a vector plus payload `text`, `sessionId`, `agentId`, `attributed_to`, and optional `linked_memory_ids`.
- **Embeddings:** via an OpenAI-compatible API, default base URL `https://openrouter.ai/api/v1`. The web app uses model `openai/text-embedding-3-small` with vector size `1536`, distance `Cosine`.
- **Extractor model:** default `anthropic/claude-haiku-4-5`; overridable via `extractorModel`. The web app passes `deepseek/deepseek-v4-pro`.
- **Env vars (web app integration):** `QDRANT_URL`, `QDRANT_API_KEY`, `OPENROUTER_API_KEY`.

## Gotchas

- `MemoryExtractor.run()` passes the same messages as both `newMessages` and `lastKMessages`, and does not set `summary`, `observationDate`, or `customInstructions`. Those fields are supported by `runExtraction()` but currently unwired here.
- Extraction goes through an LLM, so results are non-deterministic and depend on the configured model.
- Deduplication is prompt-guided: the agent is told to skip memories already present in "existing memories", but there is no hard database-level dedup.
- `examples/qdrant-test.ts` imports `QdrantManager` from `../vector_database/qdrant.js`, but no `vector_database/` folder exists in the repo — that example looks stale. `examples/memory-extractor-test.ts` imports from `../memory/qdrant.js`, which is correct.

## Related

- [Web App backend routes](web_app/backend-routes.md) — the sleeping/distill endpoint that instantiates `MemoryExtractor` and `QdrantManager`.
- [RawPiAgent](agents/raw-pi-agent.md) — the agent primitive `extractor_agent.ts` builds on.
- [Web App](web_app/entry.md) — the app that consumes this memory layer.

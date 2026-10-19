# mem0 Architecture

## Overview

mem0 is a JavaScript memory system that extracts facts from conversations and stores them in a vector database with deduplication. It provides hybrid retrieval (semantic + keyword + entity-aware) and pluggable backends for vector stores, LLMs, and embedders.

## File Organization

| File | Role |
|------|------|
| `index.js` | Public API, re-exports all classes |
| `memory.js` | Main `Memory` class — orchestrates all operations (~1,269 lines) |
| `config.js` | ConfigManager for merging user/default configs |
| `factory.js` | Factory classes for creating embedders, LLMs, vector stores, history managers |
| `types.js` | Zod schema for configuration validation |
| `embedders.js` | Embedding providers (OpenAI, Ollama, LMStudio, Google, Azure, Langchain) |
| `llms.js` | LLM providers (OpenAI, Claude, Groq, Mistral, DeepSeek, Google, Ollama, etc.) |
| `vector-stores.js` | Vector DB backends (SQLite, Qdrant, Redis, Supabase, PGVector, Langchain) |
| `storage.js` | History managers for tracking memory changes (SQLite, Memory, Supabase) |
| `prompts.js` | Prompt generation and JSON extraction for fact extraction |
| `scoring.js` | BM25 keyword search, entity extraction, hybrid scoring |
| `utils.js` | Vision message parsing |
| `telemetry.js` | Anonymous usage tracking |

## Core Flow: Adding Memories (`add()`)

```
[Messages In]
    |
[Normalize & Validate]
    |
[Embed & Retrieve Similar Memories]
    |-- Vector store search (top 10 by default)
    '-- UUID mapping
    |
[LLM Fact Extraction]
    |-- System prompt (from prompts/additive-extraction.md)
    '-- User prompt (context + messages + existing memories)
    |
[JSON Parse & Validate]
    |-- Extract JSON from LLM response
    '-- Schema: {id, text, attributed_to, linked_memory_ids}
    |
[Deduplication]
    |-- MD5 hash of each memory text
    |-- Compare against existing memory hashes
    '-- Filter exact duplicates
    |
[Embed & Insert into Vector Store]
    |-- Batch embed unique memory texts
    '-- Insert vectors + metadata payloads
    |
[History Tracking]
    '-- Log ADD action with timestamps
    |
[Entity Extraction & Linking]
    |-- Extract quoted strings, proper nouns, compound nouns
    |-- Embed entities
    |-- Search entity store for similar (cosine > 0.95 = merge)
    '-- Link entities to memory IDs
    |
[Return Results]
    '-- Array of {id, memory, metadata}
```

### Step 1: Message Reception & Validation

The `add(messages, config)` method accepts a string or array of `{role, content}` message objects. It requires at least one scope identifier: `userId`, `agentId`, or `runId`. Vision/image messages are parsed via `parse_vision_messages()`.

### Step 2: Retrieve Similar Memories

The new messages are joined and embedded. The vector store is searched with this embedding (plus scope filters) to retrieve the top `retrievalTopK` (default 10) similar existing memories. These are mapped by UUID for the LLM prompt.

### Step 3: LLM Fact Extraction

A prompt is built containing:
- Last k messages (conversation history, truncated to 300 chars each)
- Recently extracted memories
- Existing similar memories (with UUIDs)
- The new incoming messages
- Observation date and current date
- Custom instructions (if provided)

The LLM returns structured JSON matching `AdditiveExtractionSchema`: an array of objects with `id`, `text`, `attributed_to` ("user" or "assistant"), and optional `linked_memory_ids`.

### Step 4: Deduplication

Each extracted memory text is MD5-hashed and compared against:
1. Hashes of existing similar memories from the vector store
2. A `seenHashes` set for within-batch deduplication

Exact text duplicates are skipped. Note: this is hash-based, not semantic — near-duplicates with different wording will both be stored.

### Step 5: Embed & Insert

Unique memory texts are batch-embedded via `embedder.embedBatch()` (with fallback to individual embedding on failure). Vectors are inserted into the vector store along with metadata payloads containing `user_id`, `agent_id`, `run_id`, `data`, `hash`, timestamps, etc.

### Step 6: History Tracking

Each inserted memory gets a history record logged with action "ADD", timestamps (`createdAt`, `updatedAt`), and payload containing previous/new values.

### Step 7: Entity Extraction & Linking

Entities are extracted from each memory text through multiple methods:

1. **Quoted entities**: `"double quoted"` and `'single quoted'` strings
2. **Proper nouns**: consecutive capitalized word sequences
3. **Compound nouns**: via `compromise` NLP library (or regex fallback for CamelCase and lowercase compounds)

Post-processing: case-insensitive dedup, strip punctuation/markdown, filter artifacts, type prioritization (PROPER > COMPOUND > QUOTED > NOUN), substring filtering.

Entities are stored in a separate vector store. If a similar entity already exists (cosine similarity >= 0.95), its `linkedMemoryIds` array is updated. Otherwise a new entity record is inserted.

## Search Flow (`search()`)

```
[Query String]
    |
[Parallel Processing]
    |-- Semantic Search:
    |     |-- Embed query
    |     '-- Vector similarity search (top 60 candidates)
    |
    |-- Keyword Search (BM25):
    |     |-- Lemmatize query (tokenize, stem, remove stop words)
    |     |-- BM25 scoring on textLemmatized field
    |     '-- Normalize via sigmoid to [0, 1]
    |
    '-- Entity Boost:
          |-- Extract entities from query
          |-- Search entity store (similarity >= 0.5)
          '-- Boost = similarity * 0.5 * memory-count-damping
    |
[Hybrid Scoring]
    |-- Combined = (semantic + bm25 + entityBoost) / maxPossible
    |-- Filter by threshold (default 0.1)
    '-- Sort & limit to topK
    |
[Results Out]
    '-- Array of {id, memory, score, metadata, filters}
```

### Semantic Search

The query is embedded and searched against the vector store using cosine similarity. An `internalLimit` of `max(topK * 4, 60)` candidates are retrieved.

### BM25 Keyword Search

The query is lemmatized: lowercased, tokenized, stop words removed, Porter stemming applied (with simple suffix fallback). BM25 scores are computed against the `textLemmatized` field and normalized to [0, 1] via sigmoid with dynamic parameters.

### Entity Boost

Entities are extracted from the query and searched against the entity store. For each match with similarity >= 0.5, linked memories receive a boost:

```
boost = similarity * 0.5 * (1 / (1 + 0.001 * (numLinked - 1)^2))
```

The damping factor prevents entities linked to many memories from dominating.

### Hybrid Scoring

All three scores are combined and normalized:

```
finalScore = (semantic + bm25 + entityBoost) / maxPossible
```

Results below the threshold (default 0.1) are filtered out, then sorted and limited to `topK`.

## Update & Delete

- **`update(memoryId, data)`**: Re-embeds the new text, updates the vector store, logs an UPDATE action in history, removes and re-links entities.
- **`delete(memoryId)`**: Removes from vector store, logs a DELETE action, removes memory references from entity store.
- **`deleteAll(config)`**: Filters by scope (user_id/agent_id/run_id) and deletes each matching memory.

## Pluggable Backends

All backends are instantiated via factory classes based on configuration.

### Vector Stores

| Store | Backend | Notes |
|-------|---------|-------|
| Memory | SQLite (better-sqlite3) | In-process, cosine similarity computed in memory |
| Qdrant | Qdrant REST API | Remote, advanced filtering (AND/OR/NOT) |
| Redis | Redis client | Cache-friendly, TTL support |
| Supabase | Postgres pgvector | Cloud-hosted |
| PGVector | PostgreSQL | pgvector extension |
| Langchain | Langchain abstraction | Framework integration |

All implement the same interface: `insert`, `search`, `keywordSearch`, `get`, `update`, `delete`, `list`.

### Filtering

Filters support exact match (`{user_id: "u1"}`), comparison operators (`{score: {gte: 0.8}}`), and logical operators (`{AND: [...]}`, `{OR: [...]}`, `{NOT: [...]}`).

### LLM Providers

OpenAI, Claude (Anthropic), Groq, Mistral, DeepSeek, Google, Ollama, LMStudio, and more. All expose `generateResponse(messages, responseFormat, tools)`.

### Embedder Providers

OpenAI, Ollama, LMStudio, Google, Azure, Langchain. All expose `embed(text)` and `embedBatch(texts)`.

### History Managers

| Manager | Backend | Notes |
|---------|---------|-------|
| SQLiteManager | SQLite file | Persistent, tables: `memory_history`, `messages` |
| MemoryHistoryManager | In-memory Map | Session-only, lost on exit |
| SupabaseHistoryManager | Postgres | Cloud-based |
| DummyHistoryManager | No-op | History disabled |

## Configuration

Default config:
- **Embedder**: OpenAI (`text-embedding-3-small`)
- **LLM**: OpenAI (`gpt-5-mini`)
- **Vector store**: Memory (SQLite)
- **History store**: SQLite

Config is deep-merged (user over defaults), validated via Zod schema, and dimensions are auto-detected from the embedder if not specified.

## Key Design Decisions

- **Hash-based deduplication** (MD5): fast and exact, but near-duplicates with different wording are both stored
- **Separate entity store**: acts as a contextual index to boost retrieval, not a replacement for the main memory store
- **Session scoping**: all operations require at least one of `userId`/`agentId`/`runId` to prevent cross-contamination
- **Graceful degradation**: LLM failures return empty arrays, entity linking errors are logged but don't block insertion, history write failures don't block the main flow

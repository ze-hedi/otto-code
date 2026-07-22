# mem0 `add()` Mechanism

## Overview

A single `mem0.add()` call triggers a multi-step pipeline that extracts facts from a conversation, deduplicates them against existing memories, embeds them, and stores them in Qdrant. It does **not** store raw messages — only distilled facts.

## Step-by-Step Flow

### 1. Parse Input

Messages are normalized into `{role, content}` format. If you pass a plain string, it's wrapped as a single `user` message. Scoping fields (`userId`, `agentId`, `runId`) are attached as both filters and metadata.

### 2. Embed the Raw Input

All message contents are concatenated into one string and sent to the **embedding model** (OpenAI `text-embedding-3-small` by default, or Ollama `all-minilm` for local). This embedding is **not stored** — it's only used for the next step.

> API call: OpenAI embeddings

### 3. Search Qdrant for Existing Memories

The raw input embedding is used to search Qdrant for the **top 10 most similar existing memories** within the same scope (same `user_id`/`agent_id`/`run_id`). These are fetched so the LLM knows what's already been remembered.

> API call: Qdrant search

### 4. Fetch Session History from SQLite

The last 10 messages from the local SQLite database (`memory.db`) are retrieved for the same session scope. These give the LLM conversational context to resolve pronouns and references (e.g. "he" or "that project").

> Local DB read

### 5. LLM Extraction (the core step)

A prompt is sent to **Claude Sonnet** containing:
- The existing memories from step 3
- The new messages you're adding
- The last 10 session messages from step 4
- Custom instructions (if configured)

The LLM's job is to extract **self-contained factual statements** from the conversation. It returns structured JSON — a list of memory objects, each with:
- `text`: the distilled fact
- `event`: always `ADD` (additive extraction model)
- `linked_memory_ids`: UUIDs of related existing memories (if any)

The prompt instructs the LLM to:
- Extract facts from **both** user and assistant messages
- Capture full context, not atomic fragments (e.g. "User switched from almond milk to oat milk after developing a sensitivity" rather than just "User prefers oat milk")
- Skip duplicates of existing memories
- Link new facts to related existing ones
- Resolve relative dates to absolute ones
- Ignore greetings, filler, and vague acknowledgments

> API call: Anthropic (Claude Sonnet)

### 6. Deduplication via Hash

Each extracted fact is MD5-hashed. If the hash matches any existing memory in Qdrant or any other fact in the current batch, it is **skipped**. This prevents storing the exact same fact twice, even across multiple `add()` calls.

```
hash("User is building a coding agent in TypeScript") → "db0fa551..."
if existingHashes.has(hash) → skip
```

This is why re-running `add()` with the same conversation returns `results: []` — the facts hash to the same values and are deduplicated.

### 7. Embed Each New Fact

The extracted fact texts (not the original messages) are **batch-embedded** via the embedding model. These are the vectors that actually get stored in Qdrant.

> API call: OpenAI embeddings (skipped if no new facts survived dedup)

### 8. Insert into Qdrant

Each new memory is inserted as a point in the `memories` collection with:
- **Vector**: the fact's embedding from step 7
- **Payload**:
  - `data`: the fact text
  - `hash`: MD5 hash for future dedup
  - `textLemmatized`: lemmatized version for BM25 search
  - `user_id` / `agent_id` / `run_id`: scope fields
  - `createdAt` / `updatedAt`: timestamps
  - Any custom metadata passed in

> API call: Qdrant insert

### 9. Save History to SQLite

An `ADD` record is written to the local SQLite history database for each new memory. This enables `mem0.history(memoryId)` to show how a memory evolved over time. The original messages are also saved for future session context (step 4).

> Local DB write

## How Contradictions Are Handled

mem0 uses an **additive** model — it does not UPDATE or DELETE old facts in place. Instead:

1. The LLM sees existing memories and extracts **contextually rich facts** that capture transitions (e.g. "User switched from React to Vue")
2. New facts are **linked** to related existing ones via `linked_memory_ids`
3. On `search()`, the most relevant facts surface by vector similarity — newer, richer facts naturally rank higher because they contain more context

## Cost Per `add()` Call

Each call makes at minimum **4 external API calls**:

| Step | Service | Purpose |
|------|---------|---------|
| 2 | OpenAI | Embed raw input for similarity search |
| 3 | Qdrant | Search existing memories |
| 5 | Anthropic | LLM fact extraction |
| 7 | OpenAI | Embed extracted facts |
| 8 | Qdrant | Insert new points |

Steps 7 and 8 are skipped if all facts are deduplicated (empty results).

---

## Full LLM System Prompt (used in Step 5)

The following is the exact system prompt sent to Claude Sonnet during memory extraction:

```
# ROLE

You are a Memory Extractor — a precise, evidence-bound processor responsible for
extracting rich, contextual memories from conversations. Your sole operation is ADD:
identify every piece of memorable information and produce self-contained, contextually
rich factual statements.

You extract from BOTH user and assistant messages. User messages reveal personal facts,
preferences, plans, and experiences. Assistant messages contain recommendations, plans,
suggestions, and actionable information the user may later reference.

Accuracy and completeness are critical. Every piece of memorable information must be
captured — a missed extraction means lost context that degrades future personalization.
When a conversation covers multiple topics, extract each one separately. Do not let a
dominant topic cause you to miss secondary information.

# INPUTS

## New Messages

The current conversation turn(s) with "role" (user/assistant) and "content".

Both roles contain extractable information:
- **User messages**: Personal facts, preferences, plans, experiences, things done / never
  done before, opinions, requests, implicit preferences revealed through questions
- **Assistant messages**: Specific recommendations given, plans or schedules created,
  information researched, solutions provided, agreements reached

Attribute correctly: use "User" for user-stated facts. For assistant-generated content,
frame in terms of the user's context (e.g., "User was recommended X" or "User's plan
includes X as discussed in conversation").

Do NOT extract:
- Vague assistant characterizations ("you seem passionate", "that sounds stressful")
  unless the user explicitly confirms them
- Generic assistant acknowledgments ("Sure!", "Great question!")
- Assistant meta-commentary about its own capabilities


## Summary

A narrative summary of the user's profile from prior conversations. May be empty for new
users. Use it to enrich extractions — it holds established context like names, locations,
and relationships.


## Recently Extracted Memories

Memories already captured from recent messages in this session (up to 20). This is your
primary deduplication reference — do not re-extract information already captured here.


## Existing Memories

Memories currently in the system relevant to this conversation. Formatted as:
[{"id": "uuid-string", "text": "..."}, ...]

Use these ONLY for deduplication and linking — do NOT extract new memories from Existing
Memories. Your extractions must come exclusively from New Messages. If new information in
New Messages is semantically equivalent to an Existing Memory with no meaningful new
context, skip it.

When a new memory is related to an Existing Memory — same topic, overlapping entities,
updated/shifted preference, follow-up event, or continuation of a narrative — include the
Existing Memory's ID in the new memory's "linked_memory_ids" array. Your ADD output IDs
remain sequential ("0", "1", ...) but linked_memory_ids uses the UUIDs from this list.

IMPORTANT: An existing memory about an entity (e.g., "User has a dog named Max") does NOT
mean all information about that entity has been captured. New events, activities,
experiences, or details about a known entity MUST still be extracted as separate memories
and linked back. Only skip extraction when the specific fact or event itself is already
captured — not merely because the entity appears in an existing memory.


## Last k Messages

Recent messages (up to 20) preceding New Messages. Use to resolve references and pronouns
in New Messages.


## Observation Date

When the conversation actually took place (e.g., "2023-05-24"). This is your ONLY temporal
anchor for resolving time references.

Resolve ALL relative references against Observation Date:
- "yesterday" → day before Observation Date
- "last week" → week preceding Observation Date
- "next month" → month following Observation Date
- "recently" → shortly before Observation Date
- "just finished", "today" → on or near Observation Date

CRITICAL: "User went to Paris last week" is useless 6 months later. "User went to Paris
the week of May 15, 2023" is meaningful forever. Always ground relative references to
specific dates.


## Current Date

Today's system date. May be years after Observation Date. Do NOT use this to resolve
temporal references in messages — only Observation Date grounds user and assistant
statements.


## Optional Inputs

- **includes**: Topics to focus on
- **excludes**: Topics to skip
- **custom_instructions**: User-defined rules (highest priority)
- **feedback_str**: Adjust extraction based on this feedback


# GUIDELINES

## What to Extract

Extract ALL memorable information from both user and assistant messages. Think broadly:

**From user messages:**
- Personal details, preferences, plans, relationships, professional context
- Health/wellness, opinions, hobbies, emotional states
- Entity attributes (breed, model, color, make, size)
- Implicit preferences revealed through requests
- **Shared content and reference material** — when a user shares documents, case studies,
  articles, data, specifications, stat blocks, code, or any structured information, extract
  the key factual data FROM that content.
- Firsts and milestones — 'first call-out', 'just started', 'recently joined', etc.
- Specific foods, meals, and who was present
- Inspiration and motivation — what inspired someone to start something, who encouraged them

**From assistant messages (ONLY when genuinely new):**
- Specific recommendations given (books, restaurants, products, services)
- Plans or schedules created for the user
- Information researched or provided (facts, instructions, solutions)
- Agreements reached during conversation
- **Personal facts shared by named speakers** — in multi-speaker conversations, the
  "assistant" role may represent a real person sharing their own life

Do NOT extract from assistant messages that merely restate, summarize, or confirm what
the user already said.

Do NOT extract: greetings, filler, vague acknowledgments, or content too generic to be
useful.

**When in doubt, extract.** A slightly redundant memory is far less costly than a missing
one. The deduplication system downstream will handle true duplicates.


## Memory Quality Standards

### Contextually Rich, Not Atomic
Capture the full picture — fact AND surrounding context — in a single unified memory.

Bad: "User has a dog"
Good: "User has a dog named Poppy and their morning walks together are the highlight
of their day"

This applies especially to **transitions and changes**:

Bad: "User prefers oat milk lattes"
Good: "User switched from almond milk to oat milk lattes after developing an almond
sensitivity"

### Self-Contained
Every memory must be understandable on its own. Replace all pronouns with specific names
or "User."

### Concise but Complete (15-80 words, up to 100 for detail-rich content)
1-2 sentences per memory. NEVER sacrifice a proper noun, title, date, or specific detail
to meet a word count — completeness beats brevity.

### Temporally Grounded
Preserve exact dates, durations, and temporal relationships. Convert relative → absolute
using Observation Date (NOT Current Date).

### Numerically Precise
Preserve exact quantities as stated. "416 pages" stays "416 pages", not "about 400 pages."

### Preserve Specific Details — Never Generalize Concrete Information
Proper nouns, titles, qualifiers, and specific attributes must survive extraction.

### Meaning-Preserving
Capture the EXACT meaning of what was said:
- "Didn't get to bed until 2 AM" = went TO BED at 2 AM, NOT "slept until 2 AM"
- "I used to love hiking" = no longer loves hiking, NOT currently loves hiking


## Integrity Rules

- **No Fabrication**: Every detail must trace to the inputs.
- **No Implicit Attribute Inference**: Don't infer gender, age, ethnicity from names.
- **Correct Attribution**: Distinguish user-stated facts from assistant-provided information.
- **No Echo Extraction**: Don't re-extract what the assistant merely restated from the user.
- **No Within-Response Duplication**: Each fact appears exactly ONCE in output.
- **No Meta-Extraction**: Extract CONTENT, not a description of the action.
  - WRONG: "User shared a case summary for optimization"
  - RIGHT: "The Bajimaya v Reward Homes case involved construction starting in 2014..."
- **No Detail Contamination from Context**: Don't merge details from Existing Memories
  into new extractions unless the new message explicitly references them.


## Memory Linking

When extracting a new memory, check if it relates to any Existing Memory. Link when:
- **Same entity/topic**: New fact about a person, place, or thing already mentioned
- **Updated preference**: A changed or evolved opinion on something previously captured
- **Continuation**: Follow-up event or next step in a previously captured narrative
- **Contradiction**: New information that conflicts with an existing memory

Do NOT link memories that merely share a vague theme.


# OUTPUT FORMAT

Return ONLY valid JSON. No text, reasoning, explanations, or wrappers.

{
  "memory": [
    {"id": "0", "text": "First extracted memory", "attributed_to": "user",
     "linked_memory_ids": ["uuid-of-related-existing-memory"]},
    {"id": "1", "text": "Second extracted memory", "attributed_to": "assistant"}
  ]
}

## Fields

- **id** (string, required): Sequential integers as strings starting at "0".
- **text** (string, required): A contextually rich, self-contained factual statement
  (15-80 words).
- **attributed_to** (string, required): "user" or "assistant".
- **linked_memory_ids** (array of strings, optional): IDs of related Existing Memories.

If nothing is worth extracting, return: {"memory": []}
```

### Agent-Scoped Suffix

When memories are scoped to an `agentId` (not a `userId`), this suffix is appended:

```
## Entity Context

The primary entity is an AI agent. Frame memories from the agent's perspective:
- For user-stated facts, frame as agent knowledge: "Agent was informed that [fact]"
  or "Agent learned that [fact]"
- For agent actions, use direct statements: "Agent recommended [X]" or "Agent
  specializes in [domain]"
- For agent configuration or instructions, capture directly: "Agent is configured to
  [behavior]"

The attributed_to field should still reflect the original source: "user" for facts
the user stated, "assistant" for things the agent said or did.
```

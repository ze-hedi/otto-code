# Session .jsonl File Format

The session file is an append-only JSONL (one JSON object per line) that records **every event** in the conversation. Nothing is ever deleted or overwritten. The in-memory view (`getMessages()`) is reconstructed from this file by `buildSessionContext()`.

## Session Modes

The `PiAgent` supports three session modes:

| Mode | Behavior |
|------|----------|
| `memory` | No file written. All state is in-memory only. Lost when the process exits. |
| `disk` | Creates a `.jsonl` file at `<sessionDir>/<agentName>_<timestamp>.jsonl`. Full persistence. |
| `continue` | Loads the most recent session file and continues from where it left off. |

## Entry Types

Every line in the `.jsonl` is a session entry with a common structure:

```json
{
  "type": "<entry_type>",
  "id": "<uuid>",
  "parentId": "<uuid_of_parent_entry>",
  "timestamp": "2026-07-30T10:00:00.000Z",
  ...entry-specific fields
}
```

The `id`/`parentId` links form a **tree** (not a linear list), enabling branching conversations.

### Entry type reference

#### `message`
A conversation message (user, assistant, or toolResult).

```json
{
  "type": "message",
  "id": "a1b2c3",
  "parentId": "prev-id",
  "timestamp": "...",
  "message": {
    "role": "user" | "assistant" | "toolResult" | "bashExecution",
    "content": [...],
    ...role-specific fields
  }
}
```

For `toolResult` messages specifically:
```json
{
  "message": {
    "role": "toolResult",
    "toolCallId": "call_123",
    "toolName": "bash",
    "content": [{ "type": "text", "text": "output" }],
    "details": { "exitCode": 0 },
    "isError": false
  }
}
```

#### `compaction`
Created when compaction runs. Contains the LLM-generated summary and a pointer to which messages are kept.

```json
{
  "type": "compaction",
  "id": "c1",
  "parentId": "prev-id",
  "timestamp": "...",
  "summary": "## Goal\n...",
  "firstKeptEntryId": "a14",
  "tokensBefore": 50000,
  "details": {
    "readFiles": ["src/index.ts", ...],
    "modifiedFiles": ["src/main.ts", ...]
  },
  "fromHook": false
}
```

- `firstKeptEntryId`: the entry ID from which messages are preserved (not summarized)
- `tokensBefore`: estimated context tokens before compaction ran
- `fromHook`: `true` if compaction was triggered by an extension, `false` if automatic

#### `thinking_level_change`
Records when the thinking level was changed mid-session.

```json
{ "type": "thinking_level_change", "thinkingLevel": "high" }
```

#### `model_change`
Records when the model was switched mid-session.

```json
{ "type": "model_change", "provider": "anthropic", "modelId": "claude-sonnet-4-6" }
```

#### `custom`
Extension-defined entries. Opaque data blob.

```json
{ "type": "custom", "customType": "my-extension", "data": { ... } }
```

#### `custom_message`
Extension-defined messages that appear in the conversation context.

```json
{ "type": "custom_message", "customType": "...", "content": [...], "display": "...", "details": { ... } }
```

#### `branch_summary`
Created when navigating to a different branch in the session tree.

```json
{ "type": "branch_summary", "fromId": "branch-point-id", "summary": "...", "details": { ... } }
```

#### `label`
A label attached to a specific entry (for UI display).

```json
{ "type": "label", "targetId": "entry-to-label", "label": "checkpoint" }
```

#### `session_info`
Session metadata (e.g. display name).

```json
{ "type": "session_info", "name": "My coding session" }
```

## How buildSessionContext() Reconstructs the View

When loading a session (or after compaction), `buildSessionContext()` in `session-manager.js` walks the entry tree and builds the message array that becomes `agent.state.messages`.

### Without compaction

Simple: iterate all entries in path order, emit messages from `message`, `custom_message`, and `branch_summary` entries.

### With compaction

Three-phase reconstruction:

```
Step 1: Emit compactionSummary message (from the compaction entry's summary field)
Step 2: Emit "kept" messages — entries from firstKeptEntryId up to the compaction entry
Step 3: Emit messages after the compaction entry
```

Everything before `firstKeptEntryId` is **skipped** — those messages only exist in the file, not in the reconstructed view.

### Visual example

```
.jsonl file contents (disk):

  {"type":"message","id":"a1","message":{"role":"user",...}}          ← skipped (before firstKeptEntryId)
  {"type":"message","id":"a2","message":{"role":"assistant",...}}     ← skipped
  {"type":"message","id":"a3","message":{"role":"toolResult",...}}    ← skipped
  {"type":"message","id":"a4","message":{"role":"user",...}}          ← skipped
  {"type":"message","id":"a5","message":{"role":"assistant",...}}     ← skipped
  {"type":"message","id":"a6","message":{"role":"user",...}}          ← KEPT (firstKeptEntryId = "a6")
  {"type":"message","id":"a7","message":{"role":"assistant",...}}     ← KEPT
  {"type":"compaction","id":"c1","summary":"## Goal\n...","firstKeptEntryId":"a6","tokensBefore":50000}
  {"type":"message","id":"a8","message":{"role":"user",...}}          ← new after compaction
  {"type":"message","id":"a9","message":{"role":"assistant",...}}     ← new after compaction

buildSessionContext() returns:

  [compactionSummary, user(a6), assistant(a7), user(a8), assistant(a9)]
```

## Compaction Trigger and Flow

### When it triggers

Two paths:

1. **Overflow**: The LLM returns a context overflow error. Triggers immediate compaction + retry.
2. **Threshold**: After each turn, if `contextTokens > contextWindow - reserveTokens` (default reserve: 16,384 tokens).

### Cut point selection

Walks backwards from the newest message, accumulating estimated token counts (chars/4 heuristic) until `keepRecentTokens` (default: 20,000) are accumulated. Cuts at a valid boundary (user or assistant message, never a toolResult).

### Split turns

If the cut point falls in the middle of a turn (e.g. between an assistant message and its tool results), the SDK generates two summaries:
1. A **history summary** for everything before the turn
2. A **turn prefix summary** for the first part of the split turn

These are merged into one compaction summary.

### Multiple compactions

If the session is long enough, compaction can trigger multiple times. Each new compaction:
- Receives the previous compaction's summary as `previousSummary`
- Uses an **update prompt** to merge old and new information
- The new compaction entry replaces the previous one as the active compaction in `buildSessionContext()`

## Recovering Pre-Compaction Messages

Since the `.jsonl` is append-only, all original messages are preserved on disk even after compaction. To access them, parse the file directly:

```ts
import { readFileSync } from "fs";

const lines = readFileSync(sessionFilePath, "utf-8").trim().split("\n");
const allEntries = lines.map(line => JSON.parse(line));

// Get all actual messages (including pre-compaction ones)
const allMessages = allEntries
  .filter(e => e.type === "message")
  .map(e => e.message);

// Get compaction entries
const compactions = allEntries.filter(e => e.type === "compaction");
```

There is no SDK method that returns "all messages including compacted ones" — `getMessages()` always returns the post-compaction view.

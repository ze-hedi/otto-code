# pi-agent: Read Tool & Context Management

How pi-agent handles large file reads without blowing up the context window.
Three independent layers work together.

---

## Layer 1 — The read tool enforces hard limits at the source

The tool never returns more than:
- **2000 lines** OR **50 KB** — whichever is hit first

When truncated, it appends an actionable hint directly in the output the LLM sees:
```
[Showing lines 1-2000 of 8432. Use offset=2001 to continue.]
```

The schema supports pagination natively:
```typescript
{ path: string, offset?: number, limit?: number }
```

The LLM is expected to loop — read → see the continuation hint → call read again with `offset=N`.
It is instructed to do this by the system prompt:
> "When you need the full file, continue with offset until complete."

Edge case: if a single line exceeds 50 KB, the tool tells the LLM to use bash instead:
```
[Line N is Xbytes, exceeds 50KB limit. Use bash: sed -n 'Np' path | head -c 50000]
```

---

## Layer 2 — Compaction summarizes history before the window fills

After **every LLM response**, the session checks token usage. The trigger:

```
contextTokens > contextWindow - 16,384
```

When it fires:
1. Walk **backwards** from the most recent message, accumulating token estimates.
2. Stop once the **last 20,000 tokens** of messages have been identified to keep.
3. Everything older gets **summarized by the LLM** into this structured format:
   ```
   ## Goal
   ## Constraints & Preferences
   ## Progress (Done / In Progress / Blocked)
   ## Key Decisions
   ## Next Steps
   ## Critical Context
   ```
   Plus an XML block tracking which files were read vs. modified:
   ```xml
   <read-files>src/foo.ts</read-files>
   <modified-files>src/bar.ts</modified-files>
   ```
4. The original messages are deleted; the summary takes their place.

If compaction triggers mid-turn (cutting in the middle of a tool call sequence), it generates
**two summaries in parallel** — one for history, one for the turn prefix — to avoid losing
context mid-task.

There is also a **hard overflow recovery**: if the LLM itself returns a context overflow error,
compaction fires immediately and retries. This only happens once per session — a second overflow
is fatal.

---

## Layer 3 — Bash output is also capped and offloaded

Large bash outputs are truncated to 2000 lines / 100 KB, and the full output is written to a
temp file (`pi-bash-{id}.log`) so the LLM can reference it if needed. Bash messages can also
be marked `excludeFromContext` (the `!!` prefix) to skip them entirely from LLM context.

---

## The full flow

```
read(large_file)
  └─ truncate at 2000 lines / 50KB
  └─ append "[Use offset=2001 to continue]"
       │
       ▼
LLM processes response
  └─ token check after every turn
       │ contextTokens > contextWindow - 16K?
       ▼
  compaction fires
  └─ keep last 20K tokens
  └─ summarize everything older → structured summary + file ops log
  └─ replace old messages with summary
       │
       ▼
LLM continues with clean context
  └─ knows what files were read/modified (from summary)
  └─ can still paginate with offset if it needs more of the file
```

---

## Key takeaway

The design is **LLM-cooperative, not LLM-proof**. The tool gives the model the ability to
paginate, and the system prompt tells it to paginate — but if the model reads a file once and
moves on, it only ever sees the first 2000 lines. The compaction layer is the real safety net:
automatic, token-aware, and always on. Even a very long multi-file analysis session won't OOM —
it will progressively summarize its own history.

---

## Default thresholds (from source)

| Setting | Default |
|---|---|
| Read line limit | 2,000 lines |
| Read byte limit | 50 KB |
| Compaction reserve tokens | 16,384 |
| Keep recent tokens | 20,000 |
| Bash output cap | 2,000 lines / 100 KB |

These can be overridden via `compaction` settings in `PiAgentConfig`.

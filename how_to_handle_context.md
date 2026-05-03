# How to Handle Context in PiAgent

## How the session works

`PiAgent` holds a private `currentSession: AgentSession | null` field (pi-agent.ts:218).
It is `null` until the first call to `execute()` or `chat()`, at which point `_createSession()` runs and assigns it (pi-agent.ts:575).

All context management capabilities live on this `AgentSession` object, provided by `@mariozechner/pi-coding-agent`.

---

## What is available on `currentSession`

### Compaction

| Method / Property | What it does |
|---|---|
| `compact(customInstructions?)` | Manually trigger compaction. Accepts an optional prompt to guide the summary. Returns `CompactionResult`. |
| `abortCompaction()` | Cancel a compaction that is in progress. |
| `setAutoCompactionEnabled(enabled)` | Toggle automatic compaction on/off at runtime. |
| `autoCompactionEnabled` | Boolean getter — whether auto-compaction is currently active. |
| `isCompacting` | Boolean getter — whether compaction is running right now. |

**Default compaction settings (active by default):**
- `reserveTokens: 16384` — tokens kept free for the next turn
- `keepRecentTokens: 20000` — most recent tokens always preserved

**Three auto-compaction triggers:**
- `threshold` — proactive, fires before the limit is hit
- `overflow` — reactive, fires after the limit is exceeded then retries
- `manual` — triggered by calling `compact()` directly

---

### Context inspection

| Method / Property | What it does |
|---|---|
| `getContextUsage()` | Returns token usage details for the current context window. Returns `undefined` if no turn has completed yet. |
| `getSessionStats()` | Returns full session statistics: total tokens used, cost, number of turns, etc. |
| `messages` | Array of all `AgentMessage` objects in the current session history. |

---

### Session info

| Method / Property | What it does |
|---|---|
| `sessionId` | Unique ID for the current session. |
| `sessionName` | Display name for the session (if set). |
| `setSessionName(name)` | Set a display name for the session. |
| `sessionFile` | Path to the session file on disk (only meaningful in `disk` / `continue` mode). |

---

### Model and thinking level

| Method / Property | What it does |
|---|---|
| `setModel(model)` | Swap the model mid-session. |
| `setThinkingLevel(level)` | Change thinking level: `"off" \| "low" \| "medium" \| "high" \| "xhigh"`. |
| `thinkingLevel` | Current thinking level getter. |
| `supportsThinking()` | Whether the current model supports extended thinking. |
| `cycleModel(direction?)` | Cycle to the next/previous model in the registry. |
| `cycleThinkingLevel()` | Cycle through available thinking levels. |

---

## Compaction internals

### Model used

The compaction LLM call uses **the same model configured for the agent** (`PiAgentConfig.model`). There is no separate or hardcoded model — `generateSummary()` receives the model instance as a parameter and calls it directly.

### System prompt

Defined in:
```
node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/utils.js:150
```

```
You are a context summarization assistant. Your task is to read a conversation
between a user and an AI coding assistant, then produce a structured summary
following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the
conversation. ONLY output the structured summary.
```

### Structured output format

Every compaction summary follows this fixed structure:
- **Goal** — what the user is trying to achieve
- **Constraints & Preferences** — rules and preferences expressed during the session
- **Progress** — what has been done so far
- **Key Decisions** — important choices made
- **Next Steps** — what remains to be done
- **Critical Context** — anything that must not be lost

### User prompts (4 scenarios)

| Prompt | When used |
|---|---|
| `SUMMARIZATION_PROMPT` | First compaction of a conversation |
| `UPDATE_SUMMARIZATION_PROMPT` | Merging new context into an existing summary |
| `TURN_PREFIX_SUMMARIZATION_PROMPT` | Cut point falls mid-turn (split-turn handling) |
| `BRANCH_SUMMARY_PROMPT` | Navigating away from a session branch |

---

## Compaction events

These events are already handled in `pi-agent-utils.ts` and forwarded through the event system:

```
compaction_start  →  { type: "compaction_start", reason: "manual" | "threshold" | "overflow" }
compaction_end    →  { type: "compaction_end", reason, result, aborted, willRetry, errorMessage? }
```

You can react to them in the event callback passed to `execute()` or `chat()`.

---

## Persistent compaction settings

Configurable via `settings.json` files — no code needed:

- Global: `~/.pi/agent/settings.json`
- Project-level: `.pi/settings.json`

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

---

## How to expose these through the wrapper

`currentSession` is private. To use any of the above from outside the class, methods need to be added to `PiAgent` that delegate to `this.currentSession`.

Pattern for every new method:

```typescript
// 1. Private guard (add once)
private requireSession(): AgentSession {
  if (!this.currentSession) throw new Error('No active session. Call execute() first.');
  return this.currentSession;
}

// 2. Public delegating method (one per capability)
compact(customInstructions?: string) {
  return this.requireSession().compact(customInstructions);
}

getContextUsage() {
  return this.requireSession().getContextUsage();
}

// etc.
```

All methods throw a descriptive error if called before `execute()` has run.

---

## What NOT to expose (and why)

| Capability | Reason to skip |
|---|---|
| `exportToHtml / exportToJsonl` | Not context management — separate concern |
| `navigateTree / getUserMessagesForForking` | Session branching — different feature |
| `executeBash / recordBashResult` | Direct bash execution — not needed through wrapper |
| `steer / followUp / sendUserMessage` | Already covered by `execute()` / `chat()` |
| `bindExtensions / extensionRunner` | Internal extension system — not relevant |

---

## Cross-session memory (beyond built-in compaction)

The built-in compaction handles within-session context only. For persistent memory across sessions, the pattern is:

1. On `agent_end` event — extract key facts from `currentSession.messages` and push to mem0
2. On next session start — retrieve relevant memories from mem0 and inject via `systemPromptSuffix` in `PiAgentConfig`

`mem0.ts` already exists in the codebase for this purpose.

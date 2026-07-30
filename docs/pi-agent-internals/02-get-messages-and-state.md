# getMessages() and Agent State

How the in-memory message array (`agent.state.messages`) works, what `getMessages()` returns, and how it differs from both the LLM context and the disk session.

## What getMessages() Returns

`getMessages()` returns `agent.state.messages` — the **living context array**. This is the SDK's internal working set of messages that gets transformed before each LLM call.

It contains messages with these roles:

| Role | Description |
|------|-------------|
| `user` | User prompts |
| `assistant` | LLM responses (includes `content`, `usage`, `stopReason`, `model`, `provider`) |
| `toolResult` | Tool execution results (`content`, `details`, `isError`, `toolCallId`, `toolName`) |
| `bashExecution` | Shell command executions (`command`, `output`, `exitCode`, `excludeFromContext`) |
| `compactionSummary` | Compaction summary replacing older messages (`summary`, `tokensBefore`) |
| `branchSummary` | Branch summary when navigating session tree (`summary`, `fromId`) |
| `custom` | Extension-defined messages (`customType`, `content`, `display`, `details`) |

## How State Changes Over Time

### Normal Operation

Messages accumulate as the conversation progresses:

```
[user, assistant, toolResult, toolResult, user, assistant, ...]
```

### After Compaction

`agent.state.messages` is **replaced entirely**:

```js
// agent-session.js:1307-1308
const sessionContext = this.sessionManager.buildSessionContext();
this.agent.state.messages = sessionContext.messages;
```

The result:

```
Before compaction:
[user₁, assistant₁, toolResult₁, user₂, assistant₂, ..., user₁₀, assistant₁₀]
                                                          ↑ kept from here

After compaction:
[compactionSummary, user₁₀, assistant₁₀]
```

Messages before the cut point are gone from memory. `getMessages()` now returns only the summary + recent messages.

### Steering Messages

Injected between turns by `getSteeringMessages()`. They appear in `agent.state.messages` as regular messages (typically `user` role) before the next assistant response.

### Follow-Up Messages

Similar to steering, but only injected when the agent would otherwise stop (no more tool calls). Also appear as regular messages in the array.

### Error Recovery

When an assistant message has `stopReason: "error"` or `"aborted"`, the SDK removes it from `agent.state.messages` before retrying:

```js
// agent-session.js:1414
this.agent.state.messages = messages.slice(0, -1);
```

This means errored responses are saved to the session file but removed from the working state.

## getMessages() vs LLM Context vs Disk

| Aspect | `getMessages()` | LLM sees | `.jsonl` file |
|--------|-----------------|----------|---------------|
| Pre-compaction messages | No (replaced by summary) | No | Yes (all preserved) |
| `compactionSummary` role | Yes (as-is) | Yes (as `user` msg with `<summary>` tags) | Yes (as `compaction` entry) |
| `bashExecution` role | Yes (as-is) | Yes (as `user` msg with formatted text) | Yes (as message entry) |
| `bashExecution` with `excludeFromContext` | Yes | **No** (dropped) | Yes |
| `toolResult.details` | Yes | **No** (stripped) | Yes |
| `toolResult.content` | Yes | Yes (as `tool_result` block) | Yes |
| Errored assistant messages | **No** (removed on retry) | **No** | Yes |
| Image content | Yes | Depends on `blockImages` setting | Yes |
| Steering/follow-up messages | Yes (once injected) | Yes | Yes |

## Useful Session Stats

`getSessionStats()` computes aggregate statistics from `agent.state.messages`:

```ts
{
  userMessages: number,      // count of role === "user"
  assistantMessages: number, // count of role === "assistant"  
  toolResults: number,       // count of role === "toolResult"
  toolCalls: number,         // count of toolCall content blocks in assistant messages
  totalInput: number,        // sum of input tokens
  totalOutput: number,       // sum of output tokens
  totalCacheRead: number,
  totalCacheWrite: number,
  totalCost: { input, output, cacheRead, cacheWrite, total },
}
```

Note: after compaction, these stats only reflect the **post-compaction** state. Pre-compaction usage data is lost from the working state (though preserved in the `.jsonl`).

## Context Usage

`getContextUsage()` returns token usage from the last assistant message — how much of the context window is being used. This is what drives the compaction trigger:

```
compaction triggers when: contextTokens > contextWindow - reserveTokens (default 16384)
```

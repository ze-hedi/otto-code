# Pi-Agent Internals — Overview

This directory documents how the `@mariozechner/pi-coding-agent` SDK manages the LLM context, message lifecycle, and session persistence. Understanding these internals is essential when building on top of the SDK (e.g. via `PiAgent` wrapper) because what the LLM "sees" is not the same as what `getMessages()` returns, and neither is the same as what's stored on disk.

## Documents

| Doc | What it covers |
|-----|----------------|
| [01-llm-context-pipeline.md](./01-llm-context-pipeline.md) | The full transformation chain from `agent.state.messages` to the actual Anthropic API call. Covers `convertToLlm`, `transformMessages`, `buildParams`, and interception points. |
| [02-get-messages-and-state.md](./02-get-messages-and-state.md) | What `getMessages()` returns, how `agent.state.messages` is mutated by compaction, steering, and follow-ups, and how it differs from the LLM context. |
| [03-session-jsonl.md](./03-session-jsonl.md) | The append-only `.jsonl` session file format: what entry types exist, how `buildSessionContext()` reconstructs the view, and how compaction entries coexist with raw messages. |

## Key Insight

There are **three distinct views** of the conversation:

```
.jsonl file (disk)          →  everything, append-only, never deleted
                                includes raw messages + compaction entries + metadata

agent.state.messages        →  the "living" context, mutated in-place
(getMessages())                after compaction: summary + kept recent messages
                                contains SDK-specific roles (bashExecution, compactionSummary, etc.)

LLM API params.messages     →  the final payload sent to Anthropic
                                SDK roles converted to user/assistant/toolResult
                                details stripped, images optionally blocked
                                errored assistant messages dropped
                                cache_control markers added
```

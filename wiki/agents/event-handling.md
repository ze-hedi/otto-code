---
title: Event handling
sources:
  - agents/pi-agent-utils.ts
---

# Event handling

## Purpose

This module converts the SDK's `AgentSessionEvent` stream into something a consumer can display. It provides two handlers: `handleEventWithClient` for forwarding events to a web frontend over Server-Sent Events, and `handleEvent` for printing a colored, readable transcript to a terminal.

## How it works

1. `handleEventWithClient(event, send)` switches on the event type and calls `send(...)` with reduced payloads: `delta`, `thinking`, `done`, `error`, `tool_start`, `tool_update`, and `tool_end`. It also detects sub-agent events embedded in `tool_execution_update` details and re-emits them as `subagent_event` messages.
2. `handleEvent(event)` writes ANSI-colored output to stdout. It handles thinking/text deltas, tool calls and results, retries, and compaction, truncating long tool results to 500 characters.

## Key code

- `agents/pi-agent-utils.ts`
  - `handleEventWithClient` — SSE-oriented event translation.
  - `handleEvent` — terminal-oriented event rendering.
  - `extractResultText` — pulls text out of a tool result (string, content array, or object) for display.

## Data & config

- None; these are pure functions over events.

## Gotchas

- `handleEventWithClient` logs the entire event via `console.log(event)` on every call, which can be noisy.
- Sub-agent events are only surfaced when a tool's `partialResult.details` has both `subagentEvent` and `event` set (see [sub-agents](sub-agents.md)).
- `handleEvent` uses a module-level `_inThinking` flag to print the `[thinking]` header once per thinking block.

## Related

- [PiAgent](pi-agent.md) — the agent whose events these handlers consume.
- [Sub-agents](sub-agents.md) — the source of nested sub-agent events.

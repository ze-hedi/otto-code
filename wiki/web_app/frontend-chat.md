---
title: Frontend chat
sources:
  - web_app/frontend/src/pages/ChatPage.tsx
  - web_app/frontend/src/pages/WorkflowChatPanel.tsx
  - web_app/frontend/src/components/SessionStatsPanel.tsx
---

# Frontend chat

## Purpose

These components render streaming agent conversations. `ChatPage` is the one-on-one agent chat; `WorkflowChatPanel` is the same experience embedded in the workflow builder, with per-agent tabs. `SessionStatsPanel` is the shared stats drawer used by both.

## How it works

1. The page POSTs a message to `/agents/:id/chat` (or `/workflows/chat-agent`) and reads the response body as an SSE stream.
2. A `processSSEStream` helper (or the inline equivalent in `WorkflowChatPanel`) parses `data: ` lines and turns events into message "parts": `thinking`, `text`, `tool`, `subagent`, `tool_approval`, `clarification`, and `compaction`.
3. On mount, the page loads existing messages, checks the agent/workflow busy status, and reconnects to the `/events` stream if a run is still in progress.
4. Tool-approval and clarification parts render interactive controls that POST back to the approve/reject or clarification-answer endpoints.

## Key code

- `web_app/frontend/src/pages/ChatPage.tsx` — the one-on-one chat page.
  - `processSSEStream` — reads the SSE stream and appends/updates parts. Handles sub-agent events (promoting a tool call to a `subagent` part) and truncates long results.
  - `send()` — posts the message, streams the response, and special-cases the `/compact` command (plain JSON, no SSE).
  - `handleToolApproval` / `submitClarification` — POST approvals, rejections, and clarification answers.
  - `stop()` — aborts the client fetch and POSTs `/agents/:id/stop`.
- `web_app/frontend/src/pages/WorkflowChatPanel.tsx` — the workflow chat panel.
  - Keeps `agentMessages` keyed by agent id, so each workflow agent has its own message history, with an agent tab bar.
  - `applyEvent(ev)` — routes each SSE event to the agent named by `ev.agentId`.
  - `send()` — posts to `/workflows/chat-agent` and streams the whole workflow; a `workflow_done` event marks the run complete.
- `web_app/frontend/src/components/SessionStatsPanel.tsx` — a slide-out panel that fetches `/agents/:id/stats` and displays token counts, cost, message counts, and context usage.

## Data & config

- Reads/writes via the backend at `http://localhost:4000`: `/agents/:id/chat`, `/agents/:id/messages`, `/agents/:id/events`, `/agents/:id/stats`, `/agents/:id/tool-approve|tool-reject`, `/agents/:id/clarification-answer`, `/agents/:id/stop`, and the `/workflows/...` equivalents.

## Gotchas

- Tool results and sub-agent results are truncated to 1500 characters on the client for display.
- `WorkflowChatPanel` reuses `SessionStatsPanel`, which calls `/agents/:id/stats`. That endpoint looks up the agent-manager's active agents, not workflow agents, so stats for workflow agents may show as "not running".
- Reconnecting relies on the backend's in-memory busy state; if the backend restarts mid-run, there is nothing to reconnect to.

## Related

- [Frontend](frontend.md)
- [Workflow builder](frontend-workflow-builder.md)
- [Backend routes](backend-routes.md)

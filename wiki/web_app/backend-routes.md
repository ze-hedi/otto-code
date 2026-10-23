---
title: Backend routes
sources:
  - web_app/backend/src/routes/agents.ts
  - web_app/backend/src/routes/projects.ts
  - web_app/backend/src/routes/dashboards.ts
  - web_app/backend/src/routes/workflow-store.ts
  - web_app/backend/src/routes/sleeping.ts
---

# Backend routes

## Purpose

These Express routers expose the HTTP API the frontend uses. They cover agent CRUD and streaming chat, project and dashboard persistence, workflow-document storage, and the "sleeping mode" memory-distillation features. Each router is mounted by `src/index.ts` under a top-level path.

## How it works

The routers are thin: they parse the request, call into `agent-manager` / `db/mongo` / the `memory/` package, and return JSON. Two of them (`agents.ts` and `sleeping.ts`) also stream SSE. Message history is transformed from the raw agent message shape into a chat-friendly `parts` array before being returned.

## Key code

### `web_app/backend/src/routes/agents.ts` (mounted at `/agents`)
- `POST /` — create an agent (requires `model`). Returns the new `agent_id`.
- `GET /` and `GET /:id` — list agents (optionally filtered by `?playground=`) or fetch one.
- `PUT /:id` / `DELETE /:id` — update (requires `model`) or delete an agent.
- `GET /:id/status` — the agent's busy state.
- `GET /:id/system-prompt` — the agent's full assembled system prompt.
- `GET /:id/sessions` / `DELETE /:id/sessions/:sessionKey` — list or delete session JSONL files on disk.
- `POST /:id/load-session` / `POST /:id/new-session` — load an existing session file, or create a fresh `chat-<timestamp>` session.
- `POST /:id/chat` — SSE chat endpoint. Special-cases the `/compact` message (returns JSON instead of SSE), then streams agent events.
- `POST /:id/stop` — abort an in-flight stream.
- `POST /:id/tool-approve` / `POST /:id/tool-reject` — approve or reject a pending tool call (tool guardrails).
- `POST /:id/clarification-answer` — resolve a pending clarification request.
- `GET /:id/events` — SSE reconnection endpoint; sends `agent_idle` when idle, otherwise replays events from the agent's emitter.
- `GET /:id/messages` — the conversation history, transformed by `transformMessages` into `thinking` / `text` / `tool` / `compaction` parts.
- `GET /:id/stats` — session token/cost/message statistics.

### `web_app/backend/src/routes/projects.ts` (mounted at `/projects`)
- `GET /` — list projects.
- `POST /` — create a project (requires `name` and `path`; returns `409` if the path already exists).
- `PATCH /:id` — update name/description.
- `DELETE /:id` — delete a project.

### `web_app/backend/src/routes/dashboards.ts` (mounted at `/dashboards`)
- `GET /` and `GET /:id` — read dashboards from a **separate** database (`project_dashboard`, collection `dashboards`). Each request opens its own Mongo client and closes it in a `finally` block.

### `web_app/backend/src/routes/workflow-store.ts` (mounted at `/workflow-store`)
- `POST /` — create a workflow document (requires `name` and a `schema` with `components`/`connections`).
- `GET /` — list workflows, optionally filtered by `?playground=`.
- `GET /:id` / `PUT /:id` — read or patch a workflow (name, description, schema, interfaceConfigs).
- `DELETE /:id` — delete the document and its session directory under `<playground>/.otto-sessions/workflow-<id>/`.

### `web_app/backend/src/routes/sleeping.ts` (mounted at `/sleeping`)
- `GET /:projectId/sessions` — list agent session files and workflow session directories under the project's `.otto-sessions` folder.
- `GET /:projectId/memories?agentId=&sessionId=` — read distilled memories from a Qdrant collection named after the project.
- `POST /:projectId/distill` — parse a session JSONL file and run `MemoryExtractor` over it in batches, storing the resulting memories in Qdrant. Supports `type` of `agent`, `workflow`, or `workflow-agent`.

## Data & config

- Mongo collections: `agents`, `projects`, `workflows` (in `otto_web`), and `dashboards` (in `project_dashboard`).
- On-disk session files under `<project.path>/.otto-sessions/` (agent JSONL files and `workflow-<id>/` directories).
- Qdrant (via `memory/qdrant.ts`) for distilled memories, with `QDRANT_URL`, `QDRANT_API_KEY`, `OPENROUTER_API_KEY` (embeddings), and a vector size of 1536.

## Gotchas

- The dashboard router opens a fresh Mongo client per request rather than reusing the shared `getDb()` connection.
- The dashboard database name (`project_dashboard`) is a different database from the main `otto_web` database.
- `POST /agents/:id/chat` returns HTTP `409` if the agent is already streaming; the frontend relies on this to prevent double-sends.

## Related

- [Backend](backend.md)
- [Backend workflows](backend-workflows.md)
- [Frontend chat](frontend-chat.md)

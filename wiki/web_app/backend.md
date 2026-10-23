---
title: Backend
sources:
  - web_app/backend/src/index.ts
  - web_app/backend/src/db/mongo.ts
  - web_app/backend/src/types.ts
  - web_app/backend/src/services/agent-manager.ts
---

# Backend

## Purpose

The backend is an Express server (default port 4000) that is the persistence and runtime layer of the web app. It stores projects, agents, and workflows in MongoDB and manages the lifecycle of the in-memory `RawPiAgent` instances that do the actual agent work. It streams agent output to the frontend over SSE.

## How it works

1. `src/index.ts` loads the repo-root `.env`, creates an Express app with CORS and JSON body parsing, and mounts six routers: `/agents`, `/workflows`, `/workflow-store`, `/projects`, `/dashboards`, and `/sleeping`.
2. On startup it calls `connectDb()` from `src/db/mongo.ts`, then listens on `PORT` (default 4000).
3. `src/services/agent-manager.ts` keeps maps of active `RawPiAgent` instances, session keys, busy state, and per-agent event emitters. When a chat request arrives, the routes use this service to get (or re-hydrate) the agent and stream its events.

## Key code

- `web_app/backend/src/index.ts` — server bootstrap. Loads `.env`, sets up CORS/JSON parsing, mounts the six routers, connects to Mongo, listens on port 4000.
  - `main()` — connects to the database, then starts listening.
- `web_app/backend/src/db/mongo.ts` — Mongo connection and workflow-document CRUD.
  - `connectDb(uri, dbName)` / `getDb()` — open and return the `otto_web` database.
  - `saveWorkflow`, `getWorkflow`, `getAllWorkflows`, `updateWorkflow`, `deleteWorkflow` — helpers for the `workflows` collection.
- `web_app/backend/src/types.ts` — shared TypeScript interfaces for documents and configs.
  - `SerializableAgentConfig` — the JSON-serializable agent config stored in the DB (model, systemPrompt, builtInTools, mcpServers, subAgents, compaction, thinkingLevel, and so on).
  - `AgentDocument`, `WorkflowDocument`, `ProjectDocument` — the Mongo document shapes. `WorkflowDocument.schema` holds the graph components/connections; `lastCompiledSchema` and `compiled` track compile state.
- `web_app/backend/src/services/agent-manager.ts` — the agent lifecycle service.
  - `createAgent` / `updateAgent` / `deleteAgent` — persist agents to Mongo and keep the in-memory map in sync. `updateAgent` disconnects MCP and re-hydrates the agent.
  - `getActiveAgent` / `getOrActivateAgent` — fetch the running agent or rebuild it from the DB document.
  - `resolveApiKey` — maps a model's provider prefix (`anthropic/`, `deepseek/`, `openai/`, `google/`, `openrouter/`) to an environment variable.
  - `makeClarificationTool` / `setClarificationCallback` / `resolveClarification` — an injected `clarification_tool` that pauses the agent and asks the user questions.
  - `markBusy` / `markIdle` / `getAgentBusyState` / `getAgentEmitter` — track streaming state and expose a per-agent event bus for SSE reconnection.

## Data & config

- Reads/writes MongoDB database `otto_web` with collections `agents`, `projects`, and `workflows`. Workflow CRUD lives in `db/mongo.ts`; agents and projects use `getDb()` directly in their route files.
- Reads `.env` at the repo root. API key env vars: `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`.
- `PORT` (default 4000).

## Gotchas

- An agent's `playground` is preserved on update — it cannot be changed after creation (`updateAgent` merges the old playground back in).
- The in-memory agent is torn down and rebuilt on update, so MCP connections are disconnected first.
- `getOrActivateAgent` re-hydrates from the DB, so the API key must be resolvable from the environment at request time.

## Related

- [Backend routes](backend-routes.md)
- [Backend workflows](backend-workflows.md)
- [PiAgent](../agents/pi-agent.md)

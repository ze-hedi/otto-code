---
title: Backend workflows
sources:
  - web_app/backend/src/services/workflow-manager.ts
  - web_app/backend/src/routes/workflows.ts
---

# Backend workflows

## Purpose

This is the server-side half of the workflow feature. It compiles the visual workflow graph (a set of agent and interface nodes) into the `agents/` workflow objects, and runs it level by level while streaming each agent's events to the frontend over SSE.

## How it works

1. The frontend POSTs a workflow schema to `/workflows/compile` (components + connections).
2. `buildAgentsStorage` loads all agents from the DB and wraps them in an `AgentsStorage`. `validateInterfaceRules` checks that each interface node has the right number of inputs/outputs. `buildInterfaceStorage` turns interface nodes into `AgentInterface` objects (delegate/forward/accumulate/route).
3. A `Workflow` is constructed and `buildExecutionQueue` computes the level-by-level execution order.
4. On `/workflows/run` (or `/workflows/chat-agent` for a single agent), `runWorkflow` walks the levels, feeding each agent the results gathered from its predecessor interface node, and streams events tagged with the agent id.

## Key code

### `web_app/backend/src/services/workflow-manager.ts`
- `interfaceTools` — a map of the four hardcoded interface tools: `delegate`, `forward`, `accumulate`, `route`. Each is a `ToolInput` that returns its params as JSON and sets `terminate: true`.
- `buildAgentsStorage(playground?)` — builds an `AgentsStorage` from all agents in the DB.
- `validateInterfaceRules(schema)` — returns error strings when interface wiring is wrong (e.g. delegate must be 1→many, forward 1→1, accumulate many→1, route 1→1*).
- `buildInterfaceStorage(schema, agentsStorage, interfaceConfigs?)` — maps each interface node to the matching `DelegationInterface`/`ForwardInterface`/`AccumulateInterface`/`RouteInterface`, merging any user overrides from `interfaceConfigs`.
- `runWorkflow(message, workflow, sendEvent, startAgentId?)` — runs the starting level, then each subsequent level, gathering predecessor interface results and skipping agents with no input.

### `web_app/backend/src/routes/workflows.ts` (mounted at `/workflows`)
- `POST /agents` — builds the global `AgentsStorage` and returns the agent list for the sidebar.
- `POST /compile` — validates and compiles a schema, handles session create/resume, and builds the execution queue. Stores `lastCompiledSchema` and `compiled` on the workflow document.
- `GET /interface-defaults` — the default description/prompt/param texts for each interface type.
- `GET /status` — whether a workflow is compiled and busy (in-memory only).
- `GET /events` — SSE reconnection endpoint; sends `workflow_idle` when idle.
- `GET /:workflowId/sessions` — lists saved workflow session directories.
- `POST /run` — runs the compiled workflow and streams SSE events tagged with `agentId`.
- `POST /chat-agent` — chats with one workflow agent and runs downstream from it (also handles `/compact`).
- `GET /agent-messages?agentId=` — a workflow agent's transformed message history.
- `POST /tool-approve` / `POST /tool-reject` — approve/reject a pending interface tool call for a workflow agent.

## Data & config

- Reads agents from the `agents` Mongo collection (via `buildAgentsStorage`).
- Reads/writes workflow documents via `db/mongo.ts` (`lastCompiledSchema`, `compiled`).
- Workflow sessions are saved under `<playground>/.otto-sessions/workflow-<workflowId>/<sessionId>/`.
- In-memory global state: `currentAgentsStorage`, `currentInterfaceStorage`, `currentWorkflow`, `workflowBusy`, `workflowEmitter`.

## Gotchas

- Compiled workflow state is **in-memory only** — restarting the backend loses the compiled workflow, though the workflow document (and its sessions) persist.
- Session resume (`sessionMode: "continue"`) only works when the schema's structure (agent ids + connections) matches the last compiled structure; otherwise a new session is created and old sessions are kept.
- If the client disconnects during `/run` or `/chat-agent`, the workflow keeps running; the client can reconnect via `/events`.

## Related

- [Backend](backend.md)
- [Backend routes](backend-routes.md)
- [Workflow](../agents/workflow.md)
- [Workflow builder](frontend-workflow-builder.md)

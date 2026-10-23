---
title: Workflow builder
sources:
  - web_app/frontend/src/pages/WorkflowsListPage.tsx
  - web_app/frontend/src/pages/WorkflowPage.tsx
  - web_app/frontend/src/components/InterfaceFormContent.tsx
---

# Workflow builder

## Purpose

These components let you create, edit, and run workflows visually. `WorkflowsListPage` manages saved workflows and their sessions; `WorkflowPage` is the drag-and-drop canvas where you wire agents and interfaces into a DAG. `InterfaceFormContent` is the small form for customizing an interface node's prompt.

## How it works

1. `WorkflowsListPage` lists saved workflows (from `/workflow-store`) and opens a popup to pick an existing session or start a new one. Choosing one navigates to the workflow page with a `?session=` query param.
2. `WorkflowPage` loads the project path, the agent list (via `POST /workflows/agents`), and the interface defaults. It restores the saved schema (components + connections) onto the canvas.
3. Agents and interface nodes are dragged from the sidebar onto the canvas; handles are dragged between nodes to create connections.
4. Clicking "Compile" shows a guardrails modal, then POSTs the schema to `/workflows/compile`. On success the page shows `WorkflowChatPanel` next to the canvas.

## Key code

- `web_app/frontend/src/pages/WorkflowsListPage.tsx` — lists workflow cards (node count, last update), with create/delete modals and a sessions popup. `createWorkflow` POSTs an empty schema to `/workflow-store`.
- `web_app/frontend/src/pages/WorkflowPage.tsx` — the canvas editor.
  - `INTERFACES` — the four interface node types (`delegate`, `forward`, `accumulate`, `route`) with their link-type labels.
  - `getHandlePos` / `bezierPath` — compute connection endpoints and SVG bezier curves.
  - `onCanvasDrop` — places a dragged agent or interface node at the drop position.
  - `onHandleMouseDown` — starts a drag-to-connect interaction, drawing a temporary dashed line.
  - `buildSchema` — serializes the canvas back into `components` + `connections`.
  - `compileWorkflow` — POSTs to `/workflows/compile`, then syncs the schema back to `/workflow-store/:id` and opens the chat panel.
- `web_app/frontend/src/components/InterfaceFormContent.tsx` — edits an interface node's description, prompt snippet, guidelines, and per-parameter descriptions. Empty fields fall back to the defaults from `/workflows/interface-defaults`.

## Data & config

- Backend endpoints: `/workflows/agents`, `/workflows/compile`, `/workflows/interface-defaults`, `/workflows/status`, `/workflow-store`, `/workflow-store/:id`, and `/projects`.
- Workflow schema shape: `components` (nodes with `id`, `type`, `x`, `y`) and `connections` (with `from`, `fromSide`, `to`, `toSide`).

## Gotchas

- Node positions are stored in the schema, but the compile step (`extractStructuralSchema`) ignores positions — only agent ids and connections matter for deciding whether a session can be resumed.
- The canvas generates a fresh node id per restored component, so connection remapping relies on `agentIdToNodeId`.
- If the workflow is already compiled when the page loads (e.g. after navigating away and back), the guardrails modal is skipped.

## Related

- [Frontend](frontend.md)
- [Frontend chat](frontend-chat.md)
- [Backend workflows](backend-workflows.md)

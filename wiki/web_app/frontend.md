---
title: Frontend
sources:
  - web_app/frontend/vite.config.ts
  - web_app/frontend/index.html
  - web_app/frontend/src/main.tsx
  - web_app/frontend/src/App.tsx
  - web_app/frontend/src/components/AgentFormContent.tsx
  - web_app/frontend/src/pages/ProjectsPage.tsx
  - web_app/frontend/src/pages/CreateProjectForm.tsx
  - web_app/frontend/src/pages/ProjectHomePage.tsx
  - web_app/frontend/src/pages/AgentsListPage.tsx
  - web_app/frontend/src/pages/CreateAgentForm.tsx
  - web_app/frontend/src/pages/EditAgentForm.tsx
  - web_app/frontend/src/pages/HomePage.tsx
---

# Frontend

## Purpose

The frontend is a React 19 + Vite single-page app that provides the browser UI for Otto. It lets you create projects and agents, manage their sessions, and navigate into the chat, workflow-builder, dashboard, and sleeping-mode views. All data comes from the backend at `http://localhost:4000`.

## How it works

1. `src/main.tsx` mounts the app inside a `BrowserRouter`; `src/App.tsx` defines all routes.
2. Each page fetches from the backend with `fetch`. There is no shared API client or state library — state is local `useState` per page.
3. The project/agent forms are driven by the shared `AgentFormContent` component, which POSTs or PUTs to `/agents`.

## Key code

- `web_app/frontend/src/main.tsx` — React entry point; wraps `App` in `StrictMode` and `BrowserRouter`.
- `web_app/frontend/src/App.tsx` — the route table: `/` (projects), `/projects/new`, `/projects/:projectId` (home), `/projects/:projectId/agents`, `/create`, `/agents/:agentId/edit`, `/chat/:agentId`, `/sleeping`, `/workflows`, `/workflows/:workflowId`, and `/dashboards`, `/dashboards/:dashboardId`. `WorkflowRedirect` maps the old `/workflow` path to `/workflows`.
- `web_app/frontend/src/components/AgentFormContent.tsx` — the shared agent create/edit form. Collects name, description, model (from a fixed list plus a custom option), system prompt, playground, thinking level, built-in tools (`read`/`bash`/`edit`/`write`), an extra `clarify` tool, tool guardrails, MCP servers, and volatile sub-agents. Submits `POST /agents` (create) or `PUT /agents/:id` (edit). Also has a read-only mode for viewing agent config.
- `web_app/frontend/src/pages/ProjectsPage.tsx` — the landing page; lists project cards with delete, and links to `/dashboards` and the create form.
- `web_app/frontend/src/pages/CreateProjectForm.tsx` — collects name, playground path, and description; POSTs to `/projects`.
- `web_app/frontend/src/pages/ProjectHomePage.tsx` — a project's landing page with cards for Agents, Workflows, and Sleeping Mode.
- `web_app/frontend/src/pages/AgentsListPage.tsx` — lists agents in a project, with a sessions popup (list/load/delete sessions, start a new chat), plus edit and delete actions.
- `web_app/frontend/src/pages/CreateAgentForm.tsx` / `EditAgentForm.tsx` — thin wrappers around `AgentFormContent`. `CreateAgentForm` locks the playground to the project path; `EditAgentForm` loads the existing config first.
- `web_app/frontend/src/pages/HomePage.tsx` — an unused, legacy page. It links to `/agents` and `/workflow`, which no longer exist in the route table.

## Data & config

- Hardcoded backend base URL: `http://localhost:4000` (in every page and component that fetches).
- No environment-based config for the API URL; it is not centralized.

## Gotchas

- There is no `GET /projects/:id` endpoint; pages fetch the full project list and find the project by id client-side.
- `HomePage.tsx` is dead code — it is not wired into the router and its links point to removed routes.
- `AgentFormContent` hardcodes the built-in tool list and the model list, so the UI only exposes those options even though the backend accepts arbitrary values.

## Related

- [Frontend chat](frontend-chat.md)
- [Workflow builder](frontend-workflow-builder.md)
- [Backend routes](backend-routes.md)

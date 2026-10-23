---
title: Web App
sources:
  - web_app/**
---

# Web App

The web app is the browser-based front end for the Otto agentic platform. It has two halves: an Express + MongoDB backend (`web_app/backend`) and a React + Vite frontend (`web_app/frontend`). The backend persists projects, agents, and workflows in MongoDB and drives `RawPiAgent` instances (from the `agents/` package) over Server-Sent Events (SSE). The frontend is the UI for creating projects and agents, chatting with agents, designing workflow graphs, and distilling session histories into long-term memory.

## How to run

- **Backend:** `cd web_app/backend && npm install && npm run dev` — starts Express on port 4000. Requires MongoDB at `mongodb://localhost:27017` and a `.env` at the repo root with the API keys for the models you use (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`). The "sleeping mode" features additionally need Qdrant (`QDRANT_URL`, `QDRANT_API_KEY`) and an OpenRouter embedding key (`OPENROUTER_API_KEY`).
- **Frontend:** `cd web_app/frontend && npm install && npm run dev` — starts the Vite dev server. It talks to the backend at `http://localhost:4000` (this URL is hardcoded throughout the frontend).

## Parts

- [Backend](backend.md) — the Express server, MongoDB layer, and agent lifecycle service.
- [Backend routes](backend-routes.md) — the REST and SSE endpoints.
- [Backend workflows](backend-workflows.md) — workflow compilation and execution.
- [Frontend](frontend.md) — the app shell, shared form component, and project/agent management pages.
- [Frontend chat](frontend-chat.md) — the streaming chat UI and workflow chat panel.
- [Workflow builder](frontend-workflow-builder.md) — the visual workflow editor.
- [Dashboards & sleeping](frontend-dashboards-sleeping.md) — dashboards and long-term memory distillation.

## How the parts connect

The frontend calls the backend's REST endpoints to create, read, update, and delete projects, agents, and workflows. Chat is streamed over SSE: `POST /agents/:id/chat` and `POST /workflows/run` (plus `/workflows/chat-agent`) stream events that the frontend renders as thinking, text, tool calls, subagents, tool approvals, and clarifications. The backend's agent-manager service wraps the [`RawPiAgent`](../agents/raw-pi-agent.md) class; the workflow-manager service builds the same `Workflow`, `AgentsStorage`, and `InterfaceStorage` objects documented in the [Agents](../agents/entry.md) section. The sleeping route reads session JSONL files and distills them into Qdrant via the `memory/` package.

---
title: Otto Code
sources:
  - agents/
  - memory/
  - web_app/
last_commit: b5deab45812c1c01392113655d1af2153dbc17e4
ignored:
  - "*.db"
  - "*.swp"
  - ".env*"
  - ".gitignore"
  - "node_modules/**"
  - ".claude/**"
  - ".github/**"
  - ".otto-sessions/**"
  - "docs/**"
  - "examples/**"
  - "mcp/**"
  - "slack-clone/**"
  - "tests/**"
  - "tui/**"
  - "web_app/backend/*.jsonl"
  - "web_app/backend/.otto-sessions/**"
  - "web_app/backend/memory.db"
  - "web_app/backend/package.json"
  - "web_app/backend/package-lock.json"
  - "web_app/backend/tsconfig.json"
  - "web_app/frontend/.com.microsoft.*"
  - "web_app/frontend/.gitignore"
  - "web_app/frontend/.oxlintrc.json"
  - "web_app/frontend/.vscode-cpptools*/**"
  - "web_app/frontend/README.md"
  - "web_app/frontend/dist/**"
  - "web_app/frontend/package.json"
  - "web_app/frontend/package-lock.json"
  - "web_app/frontend/public/**"
  - "web_app/frontend/src/**/*.css"
  - "web_app/frontend/src/assets/**"
  - "web_app/frontend/tsconfig*.json"
  - "web_app/storage/**"
  - "package.json"
  - "package-lock.json"
  - "tsconfig.json"
  - "README.md"
  - "TOOL_EXECUTION_GUIDE.md"
  - "to-rethink.md"
  - "result.txt"
  - "quick-start.ts"
---

# Otto Code

Otto Code is an agentic platform built on top of the Pi coding agent SDK (`@mariozechner/pi-coding-agent`). It wraps the SDK in clean TypeScript classes so you can configure an agent once, run it repeatedly, wire several agents together into workflows and swarms, and stream events to a terminal or a web frontend.

This wiki documents three parts of the repository. The `agents/` folder contains the platform's building blocks: the core agent wrapper, sub-agents, MCP bridging, a decision agent, a meeting primitive, a swarm orchestration pattern, and a graph workflow engine. The `memory/` folder contains the long-term memory layer: an LLM-driven extractor and a Qdrant vector store. The `web_app/` folder contains the full-stack web UI: an Express/Mongo backend and a React frontend for managing projects, agents, workflows, and long-term memory. Other parts of the repository (the TUI, the MCP servers, examples) are not yet documented here.

## How to run

- `npm install` — install dependencies.
- `npm run build` or `npm run typecheck` — type-check the TypeScript (`tsc --noEmit`).
- `npm run example:*` — run the included examples (require an Anthropic API key).

## Parts

- [Agents](agents/entry.md) — the building blocks of the platform: the core agent, sub-agents, MCP, decision making, meetings, swarms, and workflows.
- [Memory](memory.md) — the long-term memory layer: an LLM extractor and a Qdrant vector store.
- [Web App](web_app/entry.md) — the full-stack browser UI: an Express/Mongo backend and a React frontend for projects, agents, chat, workflows, and memory distillation.

## How the parts connect

The core [`PiAgent`](agents/pi-agent.md) wraps the SDK and is the base for everything. [`RawPiAgent`](agents/raw-pi-agent.md) extends it to take full control of the system prompt, which is what the higher-level patterns use. [`Workflow`](agents/workflow.md) builds a graph of `RawPiAgent`s connected by interface nodes. [`Meeting`](agents/meeting.md) runs several `RawPiAgent`s in a round-robin discussion, and [`Swarm`](agents/swarm.md) composes a coordinator, a `Meeting`, and an MCP-backed task manager. [`JevAgent`](agents/jev-agent.md) is a standalone decision primitive. [`mcp-bridge`](agents/mcp-bridge.md) is the low-level MCP client shared by the agent and the swarm.

The [Web App](web_app/entry.md) sits on top of these pieces: its [backend](web_app/backend.md) instantiates `RawPiAgent`s to power one-on-one chat, and its [workflow service](web_app/backend-workflows.md) builds the same `Workflow`/`AgentsStorage`/`InterfaceStorage` objects to run multi-agent graphs. The [frontend](web_app/frontend.md) renders those agents' SSE events and lets users build workflow graphs visually.

The [memory layer](memory.md) is used by the web app's [sleeping/distill endpoint](web_app/backend-routes.md), which reads saved session files, runs the LLM extractor, and stores the resulting facts in a Qdrant vector store. The extractor is itself built on [`RawPiAgent`](agents/raw-pi-agent.md).

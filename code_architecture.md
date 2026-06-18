# Otto Code — Architecture Document

> **Last updated:** 2026-06-13  
> **Purpose:** High-level architecture reference for the Otto Code multi-agent coding platform. Describes system design, component responsibilities, data flow, and integration points.

---

## 1. System Overview

**Otto Code** is a multi-agent coding platform — a monorepo that lets users create, configure, orchestrate, and chat with AI coding agents through both a web UI (React SPA) and a terminal UI (Python/Textual). It wraps the `@mariozechner/pi-coding-agent` TypeScript SDK and extends it with:

- **Multi-agent orchestration** — a delegate-pattern orchestrator that fans out tasks to sub-agents in parallel
- **Visual workflow builder** — drag-and-drop DAG editor with topological execution scheduling (Kahn's algorithm)
- **Persistent memory** — vector-based semantic memory via `mem0ai` (Qdrant + OpenAI/Ollama embeddings)
- **External tool proxy** — Docker-based MCP (Model Context Protocol) gateway for tools like Tavily web search
- **Full persistence** — MongoDB-backed agent, tool, project, and orchestrator CRUD

The system has 6 runnable components communicating over HTTP REST and SSE:

| Component | Language | Port | Framework | Role |
|---|---|---|---|---|
| **Database Server** | JavaScript (CJS) | 4000 | Express + Mongoose | Agent/tool/project CRUD persistence |
| **Runtime Server** | TypeScript (ESM) | 5000 | Express | Agent lifecycle, chat (SSE), workflow execution |
| **Frontend SPA** | JavaScript/React | 3000 | React + React Router | Web UI for agent management, workflow builder, chat |
| **TUI** | Python | — | Textual | Terminal-based alternative UI |
| **MCP Gateway** | Python/Docker | 8080 | FastMCP + Nginx | Proxies external MCP tool servers |
| **Core Framework** | TypeScript | — | `@mariozechner/pi-coding-agent` | Shared library consumed by runtime |

### Architecture Diagram

```
                        ┌──────────────────────────┐
                        │     Frontend (React)      │
                        │       Port 3000           │
                        └─────┬──────────┬─────────┘
                              │          │
                    HTTP REST │          │ SSE (streaming)
                              ▼          ▼
┌──────────────────┐   ┌──────────────────────────┐   ┌──────────────────┐
│  Database Server  │◄──│    Runtime Server         │──►│  MCP Gateway      │
│  (Express/Mongo)  │   │    (Express, Port 5000)   │   │  (Docker, :8080)  │
│     Port 4000     │   └────────┬─────────────────┘   │  ┌─────────────┐  │
│                   │            │                      │  │ Tavily      │  │
│  ┌─────────────┐  │   ┌────────▼────────┐           │  │ Search API  │  │
│  │ Agent       │  │   │   PiAgent        │           │  └─────────────┘  │
│  │ ToolSchema  │  │   │   (pi-agent.ts)  │           └──────────────────┘
│  │ Project     │  │   └────────┬────────┘
│  │ Orchestrator│  │            │
│  │ MemoryAgent │  │   ┌────────▼────────┐
│  └─────────────┘  │   │  Orchestrator   │      ┌──────────────────┐
└──────────────────┘   │  (delegate tool) │      │  Mem0 (Vector     │
                        └────────┬────────┘      │  Memory)          │
                                 │                │  Qdrant + SQLite  │
                        ┌────────▼────────┐      └──────────────────┘
                        │  Workflow        │
                        │  Scheduler       │      ┌──────────────────┐
                        │  (Kahn's algo)   │      │  TUI (Textual)   │
                        └─────────────────┘      │  Terminal UI      │
                                                 └──────────────────┘
```

---

## 2. Core Agent Framework (Root TypeScript)

**Location:** `/home/bouchehdahed/code/otto_code/` (root)

The shared foundation consumed by the runtime server. Provides the `PiAgent` class, orchestrator, memory, MCP bridge, and workflow interface tools.

### 2.1 `pi-agent.ts` — Main Agent Wrapper (~1074 lines)

The central abstraction of the entire platform. Wraps `@mariozechner/pi-coding-agent`'s `createAgentSession`.

**Class `PiAgent`:**

| Method | Purpose |
|---|---|
| `constructor(config)` | Accepts model, thinkingLevel, sessionMode, workingDir, playground, apiKey, skills, systemPromptSuffix, tools, compaction, mcpBridge, mem0 |
| `query(prompt)` | Start streaming session; returns `{ session, subscription }` |
| `execute(prompt, callback?)` | One-shot execution with event streaming |
| `chat(prompt, callback?)` | Stateful multi-turn chat |
| `abort()` | Cancel running session |
| `getMessages()` | Full transcript |
| `getConfig()` | Current config |
| `addTool(tool)` / `removeTool(name)` / `hasTool(name)` | Dynamic custom tool management |

**Event system** — Per-call `EventCallback` receives raw `AgentSessionEvent` from the SDK. Utilities in `pi-agent-utils.ts` provide `handleEvent` (console logger) and `handleEventWithClient` (SSE forwarder).

**Built-in tools:** `bash`, `read`, `write`, `edit` (provided by the SDK).

**Dependencies:** `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `typebox`, `mem0.js`, `mcp-bridge.js`.

### 2.2 `mem0.ts` — Vector Memory (~250 lines)

**Class `Mem0`**

Wraps `mem0ai/oss` `Memory` for persistent semantic memory with:
- **LLM:** Anthropic Claude (for memory extraction from conversations)
- **Embedder:** OpenAI `text-embedding-3-small` (1536d) or Ollama `all-minilm` (384d)
- **Vector store:** Qdrant (local or cloud)
- **History DB:** SQLite (`memory.db`)

| Method | Purpose |
|---|---|
| `add(messages, options)` | Extract and store memories from conversation |
| `search(query, options)` | Semantic search over stored memories |
| `getAll(options)` | List all memories scoped to user/agent/run |
| `deleteAll(options)` / `delete(memoryId)` | Delete memories |

Scoped by `userId`, `agentId`, `runId`.

### 2.3 `mcp-bridge.ts` — MCP Client (~52 lines)

**Function `createMcpBridge(endpoint, timeoutMs)`**

Thin wrapper around `@modelcontextprotocol/sdk`. Creates a Streamable HTTP client, connects to an MCP gateway, and returns `{ tools, callTool, close }`. Used by PiAgent to integrate external tools.

### 2.4 `workflow_interfaces_tools.ts` — Structured Output Tools (~126 lines)

Defines 4 **forced-output tools** for inter-agent communication in workflows:

| Tool | Name | Forces the agent to output… |
|---|---|---|
| `briefingTool` | `submit_briefing` | Structured status (title, summary, completedSteps, currentStatus, keyFindings, nextSteps) |
| `reportTool` | `submit_report` | Detailed article (originalQuery, reasoning, steps with rationale/outcome, conclusion, openQuestions) |
| `planTool` | `submit_plan` | Action plan (objective, ordered steps with dependencies and success criteria, estimated effort, risks) |
| `createDelegateTool(agents)` | Dynamically built | Delegate dispatch to specific sub-agents |

Exports `INTERFACE_TOOL_NAMES` — Set of all interface tool names for workflow hook matching.

### 2.5 `pi-agent-utils.ts` — Utility Helpers (~152 lines)

Provides `handleEvent` and `handleEventWithClient` functions for SSE forwarding and console logging of agent events.

---

## 3. Runtime Server — Execution Engine

**Location:** `/home/bouchehdahed/code/otto_code/runtime/`  
**Port:** 5000  
**Start:** `npm start` (runs `tsx server.ts`)

The heart of the system. Instantiates `PiAgent` sessions from agent data sent by the frontend (fetched from the database server). Provides REST + SSE endpoints for agent lifecycle, chat, workflow execution, file browsing, and logging.

### 3.1 Entry Point (`server.ts`)

```typescript
import './load-env.js'; // MUST be first: loads .env before SDK reads env vars
// …express setup, CORS, route mounting…
app.listen(PORT);
```

Mounts route modules:
- `/runtime/*` — Agent lifecycle (run, chat, abort, stats, delete)
- `/runtime/workflow/*` — Workflow DAG compilation and execution
- `/runtime/context/*` — Project context file CRUD
- `/runtime/files/*` — Agent workspace file browser
- `/runtime/logs/*` — Agent event log retrieval

### 3.2 Global State (`state.ts`)

In-memory Maps and shared globals used across all route modules:

| Map | Key | Value | Purpose |
|---|---|---|---|
| `activeAgents` | sessionId | `PiAgent` | All running agent instances |
| `sessionAgentMap` | sessionId | agentId | Which DB agent a session belongs to |
| `agentToSessionMap` | agentId | compositeKey | Reverse lookup (MongoDB _id → session) |
| `sessionFileMap` | filePath | sessionId | Deduplication of disk sessions |
| `sessionHooks` | sessionKey | `SessionHook[]` | Workflow hook callbacks |
| `workflowSessions` | sessionId | `WorkflowSessionState` | Compiled workflow state per session |
| `workflowHistory` | — | `WorkflowRecord[]` | Workflow history records |
| `workflowEvents` | — | `EventEmitter` | SSE broadcast bus for hook events |

### 3.3 Route Modules

| Route File | Key Endpoints | Lines | Purpose |
|---|---|---|---|
| `routes/agent.ts` | `POST /runtime/run`, `POST /runtime/chat/:id`, `POST /runtime/abort/:id`, `GET /runtime/agent/:id/stats`, `GET /runtime/agent/:id/messages`, `DELETE /runtime/agent/:id` | ~400 | Agent lifecycle, streaming chat via SSE, abort, stats/transcript |
| `routes/workflow.ts` | `POST /runtime/workflow/compile`, `POST /runtime/workflow/run`, `POST /runtime/workflow/chat/:nodeId`, `POST /runtime/workflow/run-all`, `POST /runtime/workflow/abort`, `GET /runtime/workflow/events` (SSE) | ~840 | DAG compilation → scheduled execution, incremental recompilation |
| `routes/context.ts` | `GET /runtime/context/list`, `GET /runtime/context/read`, `PUT /runtime/context/write` | ~130 | CRUD for project `context/*.md` files |
| `routes/files.ts` | `GET /runtime/files/:id`, `GET /runtime/files/content/:id` | ~140 | Browse agent workspace, read file contents |
| `routes/logs.ts` | `GET /runtime/logs/:id`, `GET /runtime/logs` | ~85 | Agent event log retrieval |

### 3.4 Workflow Scheduler (`workflow-scheduler.ts`)

**Function `buildExecutionQueue(nodes, connections)`**

Implements **Kahn's algorithm** for topological sort of the workflow DAG:
- Returns `{ levels, predecessors, successors, toolLinks }`
- `levels` — ordered array of parallel node groups (nodes at same depth are runnable in parallel)
- Supports `tool-link` connection type (binding, not execution flow)
- Cycle detection — throws on cycles

**Function `compileGraph(nodes, connections, state)`**

Compiles the visual DAG into executable actors. Supports incremental recompilation (only recompiles changed nodes).

### 3.5 Tool Executor (`tool-executor.ts`)

**Class `ToolExecutor`**

Safely executes user-defined JavaScript functions stored as strings in the database:
- `parseFunction(functionString)` — Parses via `new Function('params', body)`
- `executeFunction(functionString, params, timeout)` — Execution with timeout protection (default 5s)
- Returns PiAgent-compatible format `{ content: [{ type: 'text', text }] }`

### 3.6 Agent Logger (`agent-logger.ts`)

**Class `AgentLogger`**

In-memory log storage: max 1000 entries per agent. Event types: `message_update`, `tool_execution_start`, `tool_execution_end`, `message_end`, `prompt_end`, `error`. Uses `setImmediate` for non-blocking async logging.

### 3.7 Types (`types.ts`)

Shared type definitions:
- `AgentData` — Agent configuration from DB (model, thinkingLevel, sessionMode, workingDir, apiKey, compaction, etc.)
- `AgentFile` — External files (`soul` = system prompt, `skills` = tool definitions)
- `RunRequest` — Request payload
- `FileEntry` — File browser entry

### 3.8 Env Loader (`load-env.ts`)

Loads `.env` from project root. **Must be imported first** in `server.ts` because `@mariozechner/pi-ai` reads env vars at module-load time.

---

## 4. Database Server — Persistence Layer

**Location:** `/home/bouchehdahed/code/otto_code/database/`  
**Port:** 4000  
**Start:** `npm start` (runs `node server.js`)

Express CRUD server backed by MongoDB via Mongoose. Provides REST API for agents, tools, interfaces, orchestrators, memory agents, multi-agent patterns, and projects.

### 4.1 API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agents` | GET, POST | List all / create agent |
| `/api/agents/:id` | GET, PUT, DELETE | Agent CRUD |
| `/api/agents/:id/files` | GET | Get agent soul/skills files |
| `/api/agents/:id/files/:type` | POST, PUT, DELETE | Agent file CRUD |
| `/api/tool-schemas` | GET, POST | Tool schema CRUD |
| `/api/tool-schemas/:id` | GET, PUT, DELETE | Individual tool |
| `/api/interfaces` | GET, POST | Interface CRUD |
| `/api/orchestrators` | GET, POST | Orchestrator CRUD |
| `/api/orchestrators/:id` | GET, PUT, DELETE | Individual orchestrator |
| `/api/memory-agents` | GET, POST | Memory agent CRUD |
| `/api/projects` | GET, POST | Project CRUD |
| `/api/projects/:id` | GET, PUT, DELETE | Individual project |
| `/api/projects/:id/sessions` | POST | Add session to project |
| `/api/search` | GET | Search across agents and tools |

### 4.2 Mongoose Models

| Model | File | Key Fields |
|---|---|---|
| **Agent** | `models/Agent.js` | `name`, `type` (agent/orchestrator), `description`, `model`, `thinkingLevel`, `sessionMode`, `workingDir`, `playground`, `apiKey`, `icon`, `tools[]`, `toolCallGuardrails`, `compaction` |
| **AgentFile** | `models/AgentFile.js` | `agent_id`, `type` (soul/skills), `content` |
| **ToolSchema** | `models/ToolSchema.js` | `name`, `displayName`, `description`, `parameters` (JSON schema), `functionBody`, `timeout` |
| **Interface** | `models/Interface.js` | `name`, `description` |
| **MultiAgentPattern** | `models/MultiAgentPattern.js` | `name`, `description`, `config` |
| **Orchestrator** | `models/Orchestrator.js` | `name`, `description`, `model`, `systemPrompt`, `subAgents[]`, `compaction` |
| **MemoryAgent** | `models/MemoryAgent.js` | `name`, `model`, `embedProvider`, `embedModel`, `openaiApiKey`, `ollamaBaseUrl`, `collectionName`, `qdrantUrl`, `qdrantApiKey`, `customInstructions` |
| **Project** | `models/Project.js` | `name`, `description`, `repos[]` (label, path, agents[], orchestrators[]), `sessions[]` |

### 4.3 Connection (`connection.js`)

Simple Mongoose connection helper. Defaults to `mongodb://localhost:27017/otto_code`. Exports `connect()` and `disconnect()`.

### 4.4 Seed Scripts

- `seed.js` — Seeds initial agents, tools, and configurations
- `seed-sample-tools.js` — Seeds sample tool definitions

---

## 5. Frontend — React SPA

**Location:** `/home/bouchehdahed/code/otto_code/frontend/react-app/`  
**Port:** 3000  
**Start:** `npm start` (Create React App)

Single-page application providing the web UI. Communicates with the database server (port 4000) for CRUD and the runtime server (port 5000) for agent execution and SSE streaming.

### 5.1 Route Map (React Router)

| Path | Page Component | Purpose |
|---|---|---|
| `/` | `WelcomePage` | Landing/intro |
| `/hub` | `Home` | Main hub/navigation |
| `/workspaces` | `ProjectsListPage` | Project listing |
| `/workspaces/new` | `WorkspacesPage` | Create new workspace |
| `/workflows` | `WorkflowsPage` | Workflow listing |
| `/workflow` | `WorkflowBuilder` | Visual DAG editor (drag-drop canvas) |
| `/chat` | `ChatPage` | General chat |
| `/chat/:agentId` | `ChatPage` | Agent-specific chat |
| `/chat/:agentId/:sessionId` | `ChatPage` | Session-specific chat |
| `/agents` | `AgentsPage` | Agent management (CRUD) |
| `/tools` | `ToolsPage` | Tool management (CRUD) |
| `/team-of-agents` | `TeamOfAgentsPage` | Multi-agent team setup |
| `/orchestrators` | `OrchestratorPage` | Orchestrator management |
| `/dashboard/:agentId/:sessionId` | `AgentDashboardPage` | Agent session dashboard |
| `/orch-dashboard/:orchestratorId/:sessionId` | `DashboardPage` | Orchestrator dashboard |

### 5.2 Key Components

| Component | File | Purpose |
|---|---|---|
| `ChatArea` | `components/ChatArea.jsx` | SSE streaming chat with thinking/response/tool panels |
| `WorkflowBuilder` | `WorkflowBuilder.jsx` | Visual drag-drop DAG builder using ReactFlow |
| `WorkflowNode` | `components/WorkflowNode.jsx` | Workflow node rendering (agent/tool nodes) |
| `AgentConfigPanel` | `components/AgentConfigPanel.jsx` | Agent configuration form |
| `AgentForm` | `components/AgentForm.jsx` | Agent creation/editing form |
| `AgentTypeSelector` | `components/agents/AgentTypeSelector.jsx` | PiAgent vs MemoryAgent type selection |
| `Canvas` | `components/Canvas.jsx` | Drag-drop canvas for workflow nodes |
| `Sidebar` | `components/Sidebar.jsx` | Navigation sidebar |
| `Terminal` | `components/Terminal.jsx` | Terminal output view |
| `CodeBrowser` | `components/CodeBrowser.jsx` | File tree browser for agent workspace |
| `ContextPanel` | `components/ContextPanel.jsx` | Project context file editor |
| `SubAgentsPanel` | `components/SubAgentsPanel.jsx` | Orchestrator sub-agent management |
| `ScrumRoomPanel` | `components/ScrumRoomPanel.jsx` | Team collaboration view |
| `ModelSelect` | `components/ModelSelect.jsx` | LLM model selector |
| `ToolForm` / `ToolDetailPanel` | `components/ToolForm.jsx`, `components/ToolDetailPanel.jsx` | Tool creation and detail view |

### 5.3 Context Provider

`AgentChatContext.jsx` — Provides chat state (messages, streaming status, session info) across the component tree via React Context.

---

## 6. TUI — Terminal UI

**Location:** `/home/bouchehdahed/code/otto_code/tui/`  
**Start:** `python app.py` (requires Python 3.10+ and `textual`)

Python-based terminal UI using the **Textual** framework. Alternative to the React frontend.

| File | Purpose |
|---|---|
| `app.py` | Entry point — `TuiApp` class extending `textual.App`, pushes `AgentListScreen` |
| `components/api.py` | `APIClient` — async HTTP client communicating with DB (port 4000) and runtime (port 5000), supports SSE streaming |
| `components/agent_list.py` | `AgentListScreen` — fetches agents from DB, displays list with Textual `ListView`, selects to enter chat |
| `components/chat.py` | `ChatScreen` — streaming chat with agent via SSE, renders text deltas and tool calls |

**Dependencies:** `textual`, `httpx` (async HTTP).

---

## 7. MCP Gateway — External Tool Proxy

**Location:** `/home/bouchehdahed/code/otto_code/mcp/`  
**Port:** 8080  
**Start:** `docker compose up`

Docker-based infrastructure providing external MCP tools to agents. Uses an aggregating gateway pattern where a single endpoint exposes the union of all upstream tool servers, namespaced by prefix.

### Architecture

```
PiAgent (mcp-bridge.ts)
    │  Streamable HTTP → http://localhost:8080/mcp
    ▼
Nginx (port 8080)
    │  /mcp/ → gateway:9000
    ▼
Gateway (FastMCP, port 9000)
    │  Reads config.yaml
    │  For each upstream: client → as_proxy → mount(proxy, prefix=name)
    ├── /tavily → Tavily MCP Server (port 8000)
    │              └── tavily_search, tavily_extract tools
    └── /healthz → health check
```

### Key Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | 3 services: nginx, gateway, tavily on private network `172.28.0.0/24` |
| `docker-compose.override.yml` | Dev mode with hot-reload volume mounts |
| `nginx/nginx.conf` | Reverse proxy config: `proxy_buffering off`, 1h timeouts for SSE |
| `gateway/src/main.py` | FastMCP gateway: reads config, builds proxy mount chain, runs on port 9000 |
| `gateway/src/registry.py` | YAML config loader |
| `gateway/config.yaml` | Upstream registry: `{ name: tavily, prefix: tavily, url: http://tavily:8000/mcp/ }` |
| `servers/tavily/src/server.py` | FastMCP server exposing Tavily search + extract as MCP tools |
| `.env.example` | `TAVILY_API_KEY` |

### How it works

1. Gateway reads `config.yaml` on startup
2. For each upstream, it creates a FastMCP `Client`, wraps it via `FastMCP.as_proxy(client)`, and mounts it under its prefix
3. Nginx proxies `/mcp` to the gateway with SSE-friendly settings
4. PiAgent connects via `mcp-bridge.ts` → Streamable HTTP → Nginx → Gateway
5. When PiAgent lists tools, it sees: `tavily_search`, `tavily_extract`, etc.
6. Tool calls are routed transparently by FastMCP's proxy machinery

---

## 8. Coding Orchestrator — Meta-Agents

**Location:** `/home/bouchehdahed/code/otto_code/coding_orchestrator/`

Self-contained meta-system that uses PiAgent to orchestrate exploration and wiki-creation of other codebases.

| File | Purpose |
|---|---|
| `explorer.ts` | Explorer agent: defines `explore_repos` custom tool that fans out parallel exploration to multiple sub-repos using stateless PiAgent sub-agents. Each sub-agent receives a task and scope directives, returns a structured exploration report |
| `explorer_system_prompt.md` | System prompt for the codebase explorer agent — defines read-only exploration protocol, output format spec (task understanding, relevant files table, flow narrative, conventions, tests, risks, open questions) |
| `wiki_writer.md` | System prompt for the wiki creator agent — compiles exploration reports into `.wiki/` Markdown tree with provenance tracking |

---

## 9. Shared Utilities & Helpers

| File | Location | Purpose |
|---|---|---|
| `quick-start.ts` | Root | Minimal PR reviewer example |
| `test.sh` | Root | Test runner script |
| `otto_settings.json` | Root | Session config for otto terminal multiplexer: 4 panes (MongoDB → DB Server → Runtime → Frontend) |

---

## 10. Data Flow

### Agent Creation & Chat

```
1. User creates agent in React UI
2. Frontend POST /api/agents → Database Server (stores in MongoDB)
3. User clicks "Start" → Frontend POST /runtime/run → Runtime Server
   ├── Runtime reads agent config from DB (GET /api/agents/:id)
   └── Runtime instantiates PiAgent(config), stores in activeAgents map
4. User sends message → Frontend POST /runtime/chat/:id → Runtime Server
   ├── Runtime finds PiAgent in activeAgents
   ├── Calls agent.chat(prompt, SSE callback)
   ├── Streams text_delta, tool_call_start/end events via SSE
   └── Optionally integrates MCP tools via McpBridge
5. Agent session events are logged via AgentLogger
6. Memories are extracted via Mem0 (if configured)
```

### Workflow Execution

```
1. User builds DAG in WorkflowBuilder (ReactFlow canvas)
   ├── Nodes: agent/orchestrator/tool
   ├── Edges: flow (execution order) or tool-link (binding)

2. Frontend POST /runtime/workflow/compile → Runtime
   ├── buildExecutionQueue() runs Kahn's algorithm
   ├── Returns leveled execution plan

3. Frontend POST /runtime/workflow/run → Runtime
   ├── Executes levels sequentially: each level's nodes run in parallel
   ├── For each node: creates PiAgent, feeds predecessor output
   ├── Wire session hooks: when predecessor calls submit_briefing/report/plan,
   │   trigger successor nodes
   └── Broadcasts events via SSE to frontend

4. Results flow through the DAG following predecessor → successor edges
```

---

## 11. Configuration & Environment

### `.env` (Root)

```
ANTHROPIC_API_KEY=sk-ant-...       # Primary LLM (Claude)
OPENAI_API_KEY=sk-...              # Embeddings for mem0
QDRANT_URL=http://localhost:6333   # Vector store for memory
QDRANT_API_KEY=                    # Only needed for Qdrant Cloud
```

### Per-Component Config

| Component | Config Source | Key Settings |
|---|---|---|
| Database | `database/connection.js` | MongoDB URI, defaults to `mongodb://localhost:27017/otto_code` |
| Runtime | `.env` + `load-env.ts` | `ANTHROPIC_API_KEY`, `MCP_ENDPOINT` (default `http://localhost:8080/mcp`) |
| Frontend | `frontend/react-app/package.json` | `proxy` for dev API calls |
| MCP | `mcp/.env` (copy from `.env.example`) | `TAVILY_API_KEY` |
| MCP Gateway | `mcp/gateway/config.yaml` | Upstream servers and prefixes |
| TUI | Hardcoded in `tui/components/api.py` | `DB_API=http://localhost:4000`, `RUNTIME_API=http://localhost:5000` |
| mem0 | `mem0.ts` defaults | `historyDbPath: "memory.db"`, `collectionName: "memories"`, `ollamaBaseUrl: "http://localhost:11434"` |

### `otto_settings.json`

Session config for the otto terminal multiplexer. Starts 4 panes in sequence with delays:
```
Pane 1: mongod --dbpath ~/mongodb-data --port 27017
Pane 2: cd database && npm start        (delay 3s)
Pane 3: cd runtime && npm start
Pane 4: cd frontend/react-app && npm start
```

---

## 12. Startup Sequence

For full system operation:

```bash
# 1. Start MongoDB
mongod --dbpath ~/mongodb-data --port 27017

# 2. Start Qdrant (for mem0 vector store)
# docker run -p 6333:6333 qdrant/qdrant

# 3. Start Database Server (port 4000)
cd database && npm start

# 4. Start Runtime Server (port 5000)
cd runtime && npm start

# 5. Start Frontend (port 3000)
cd frontend/react-app && npm start

# 6. (Optional) Start MCP Gateway for external tools
cd mcp && docker compose up

# 7. (Optional) Start TUI
cd tui && python app.py
```

Or use `otto` terminal multiplexer with the pre-configured `otto_settings.json`.

---

## 13. Testing

**Location:** `/home/bouchehdahed/code/otto_code/tests/`

| Test File | Scope |
|---|---|
| `test-pi-agent.ts` | Basic PiAgent instantiation, query, execute |
| `test-pi-agent-2.ts` | Advanced PiAgent scenarios |
| `test-tool-execution.ts` | ToolExecutor parsing and execution |
| `test-tool-execution.cjs` | CommonJS tool execution variant |
| `test-custom-tools.ts` | Custom tool registration and invocation |
| `test-mem0.ts` | Mem0 memory add/search/delete operations |

**Test runner:** `npm test` → `tsx test-simple.ts`

---

## 14. Conventions & Patterns

### Naming

| Language | Convention | Example |
|---|---|---|
| TypeScript | `kebab-case.ts` | `pi-agent.ts`, `workflow_interfaces_tools.ts` |
| JavaScript (CJS) | `PascalCase.js` or `kebab-case.js` | `Agent.js`, `connection.js` |
| React | `PascalCase.jsx` | `ChatArea.jsx`, `WorkflowBuilder.jsx` |
| Python | `snake_case.py` | `agent_list.py`, `main.py` |
| Route files | single-word lowercase | `agent.ts`, `files.ts`, `logs.ts` |

### Error Handling

- Runtime routes return `{ error: string }` with appropriate HTTP status codes (400, 404, 502)
- PiAgent tool execution returns `{ content: [{ type: 'text', text }] }` format
- Database server returns `{ error: err.message }` with 400 for validation errors
- Agent lifecycle errors are logged via `AgentLogger`

### Architectural Patterns

| Pattern | Where Used | Description |
|---|---|---|
| **Event-driven architecture** | `pi-agent.ts` | 20+ granular event hooks for agent lifecycle |
| **SSE for streaming** | Runtime chat endpoints | Server-Sent Events for real-time token/tool streaming |
| **Global state Maps** | `runtime/state.ts` | In-memory session management across routes |
| **Kahn's algorithm** | `runtime/workflow-scheduler.ts` | Topological sort for DAG execution |
| **Proxy + Mount** | MCP Gateway | FastMCP transparently proxies upstream servers |
| **Dependency injection** | `PiAgent` constructor | Mem0, McpBridge, Skills injected as config |
| **Session deduplication** | `sessionFileMap` | Prevents duplicate disk sessions |

### Module Boundaries

- The runtime server **imports from root-level TypeScript modules** (e.g., `../../pi-agent.js`). These are tightly coupled.
- The frontend and database server are **separate npm projects** with their own `package.json` and `node_modules`.
- The MCP gateway and TUI are **independent processes** with their own dependency managers (Docker/pip).
- The coding orchestrator is a **self-contained meta-system** that uses PiAgent internally.

---

## 15. Dependencies

### Top-Level npm

| Dependency | Purpose |
|---|---|
| `@mariozechner/pi-ai` | LLM model abstraction (Claude, GPT, Groq, etc.) |
| `@mariozechner/pi-coding-agent` | Core agent SDK (sessions, tools, streaming, compaction) |
| `@modelcontextprotocol/sdk` | MCP client (Streamable HTTP transport) |
| `dotenv` | Environment variable loading |
| `mem0ai` | Memory layer (OSS) |
| `typebox` | Runtime type schemas for tools |
| `tsx` | TypeScript executor (dev) |
| `typescript` | TypeScript compiler (dev) |

### Runtime npm

| Dependency | Purpose |
|---|---|
| `express` | HTTP server |
| `cors` | Cross-origin support |
| `typebox` | Schema validation |

### Database npm

| Dependency | Purpose |
|---|---|
| `express` | HTTP server |
| `cors` | Cross-origin support |
| `mongoose` | MongoDB ODM |

### Frontend npm

| Dependency | Purpose |
|---|---|
| `react` | UI framework |
| `react-router-dom` | Client-side routing |
| `reactflow` | Workflow canvas (drag-drop DAG editor) |
| + UI libraries | |

### Python (TUI)

| Dependency | Purpose |
|---|---|
| `textual` | TUI framework |
| `httpx` | Async HTTP client |

### Python (MCP Gateway)

| Dependency | Purpose |
|---|---|
| `fastmcp` | MCP server framework |
| `starlette` | ASGI framework |
| `uvicorn` | ASGI server |
| `tavily-python` | Tavily search API client |

### Infrastructure

| Service | Purpose |
|---|---|
| MongoDB | Agent/tool/project persistence |
| Qdrant | Vector store for semantic memory |
| Docker | MCP gateway deployment |
| Nginx | MCP reverse proxy |
| Ollama | (Optional) local embeddings |

---

## 16. Key File Index

| File | Lines | Role |
|---|---|---|
| `pi-agent.ts` | ~1074 | Core PiAgent class — main abstraction |
| `mem0.ts` | ~250 | Vector memory wrapper |
| `mcp-bridge.ts` | ~52 | MCP client over Streamable HTTP |
| `workflow_interfaces_tools.ts` | ~126 | Structured output tools (briefing, report, plan) |
| `pi-agent-utils.ts` | ~152 | SSE forwarding, console logging |
| `runtime/server.ts` | ~90 | Runtime entry point |
| `runtime/state.ts` | ~110 | Global state maps |
| `runtime/routes/agent.ts` | ~400 | Agent lifecycle endpoints |
| `runtime/routes/workflow.ts` | ~840 | Workflow DAG execution |
| `runtime/workflow-scheduler.ts` | ~180 | Kahn's algorithm DAG scheduler |
| `runtime/tool-executor.ts` | ~120 | Safe JS function execution |
| `runtime/agent-logger.ts` | ~100 | In-memory event logger |
| `database/server.js` | ~600 | Database CRUD API |
| `database/models/Agent.js` | ~60 | Agent Mongoose schema |
| `frontend/react-app/src/App.js` | ~40 | React route definitions |
| `frontend/react-app/src/components/ChatArea.jsx` | — | SSE streaming chat UI |
| `frontend/react-app/src/WorkflowBuilder.jsx` | — | Visual DAG builder |
| `tui/app.py` | ~15 | TUI entry point |
| `tui/components/api.py` | ~50 | Backend API client |
| `mcp/gateway/src/main.py` | ~40 | FastMCP gateway |
| `coding_orchestrator/explorer.ts` | ~220 | Codebase explorer meta-agent |

---

## 17. Risks & Gotchas

1. **Env loading order is critical** — `runtime/load-env.ts` must be imported before any `@mariozechner/pi-ai` module, which reads env vars at import time.
2. **Tight coupling between runtime and root** — Runtime imports from `../../pi-agent.js`, making it hard to separate into independent packages.
3. **Monorepo with mixed module systems** — Top-level TypeScript uses ESM; database server uses CommonJS; frontend is a separate CRA project.
4. **In-memory state** — Runtime state is all in-memory Maps; a server restart loses all active sessions.
5. **Generated files in repo** — `runtime/` contains compiled C++ binaries and JSONL session logs that should be .gitignored.
6. **Static IPs in MCP** — Docker compose uses hardcoded IPs on `172.28.0.0/24` subnet, which may conflict with existing networks.
7. **Frontend has its own build** — The React app is pre-built in `frontend/react-app/build/`, served statically or via CRA dev server.
8. **Empty directories are reserved** — `cli_tools/`, `orchestration/`, `wiki/`, `memories/` are placeholders for future features.
9. **API key handling** — Agent API keys are stored in MongoDB (plain text). The runtime falls back to server `ANTHROPIC_API_KEY` env var.
10. **SQLite `memory.db`** — Shared by multiple mem0 instances; concurrent access patterns should be verified.

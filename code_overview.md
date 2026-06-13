# Otto Code — Codebase Overview

> **Generated:** 2026-06-13  
> **Purpose:** Machine-readable map of the entire codebase for downstream wiki-creator and coding agents. Replaces grep/exploration passes.

---

## 1. High-Level Architecture

**Otto Code** is a multi-agent coding platform — a monorepo with 6 deployable components that together provide an end-to-end system for creating, orchestrating, and managing AI coding agents with a visual workflow builder UI.

### Runtime Stack

| Component | Language | Port | Framework | Role |
|---|---|---|---|---|
| **Core Agent Framework** | TypeScript | — | `@mariozechner/pi-coding-agent` | PiAgent wrapper, orchestrator, MCP bridge, memory |
| **Database Server** | JavaScript (CJS) | 4000 | Express + Mongoose (MongoDB) | Agent/tool/project CRUD persistence |
| **Runtime Server** | TypeScript (ESM) | 5000 | Express | Agent lifecycle, chat, workflow execution, file browsing |
| **Frontend** | JavaScript/React | 3000 | React + React Router | SPA for agent creation, workflow builder, chat UI |
| **TUI** | Python | — | Textual | Terminal-based alternative UI |
| **MCP Gateway** | Python | 8080 | FastMCP + Docker | Proxies external MCP tool servers (e.g. Tavily search) |

### Data Flow

```
Frontend (React) ──HTTP REST──► Database (MongoDB)  ← agent/tool CRUD
       │                              │
       │                              ▼
       └────HTTP REST────► Runtime (Express)  ← fetches agent config from DB
                               │
                               ├── Creates PiAgent instances
                               ├── Manages sessions (memory/disk)
                               ├── Executes workflows (DAG → parallel execution)
                               ├── Bridges to MCP Gateway for external tools
                               └── Integrates mem0 for persistent memory
```

---

## 2. Directory Map

```
otto_code/
├── pi-agent.ts              [1075L] Core PiAgent class — the main wrapper
├── pi-agent-utils.ts        [~200L] Event handlers (SSE forwarder, console logger)
├── pi-orchestrator.ts       [~220L] Multi-agent orchestrator with delegate tool
├── raw-agent.ts             [~105L] Factory for bare/no-tools PiAgent
├── workflow_interfaces_tools.ts [~200L] Structured output tools (briefing, report, plan)
├── mcp-bridge.ts            [~55L]  MCP client over Streamable HTTP
├── mem0.ts                  [~250L] mem0ai wrapper for persistent memory
├── quick-start.ts           [~40L]  Minimal PR reviewer example
├── tsconfig.json                    TypeScript config (ES2022, ESNext)
├── package.json                     NPM deps (pi-ai, pi-coding-agent, MCP SDK, mem0ai)
├── .env.example                     Env template (ANTHROPIC_API_KEY, OPENAI_API_KEY, QDRANT_URL)
├── otto_settings.json               Session config for otto terminal multiplexer
│
├── database/                        [1] Database server — agent/tool CRUD
│   ├── server.js              [~600L] Express API (CRUD for agents, tools, projects)
│   ├── connection.js          [~15L]  Mongoose connection helper
│   ├── index.js               [~5L]   Entry point
│   ├── models/
│   │   ├── Agent.js           [~60L]  Agent schema (Mongoose)
│   │   ├── AgentFile.js       [~15L]  Agent file schema (soul/skills)
│   │   ├── ToolSchema.js      [~25L]  Custom tool definition schema
│   │   ├── Interface.js       [~12L]  Interface definition schema
│   │   ├── MultiAgentPattern.js[~12L] Multi-agent pattern template
│   │   ├── Orchestrator.js    [~18L]  Orchestrator config schema
│   │   ├── MemoryAgent.js     [~30L]  Memory agent config schema
│   │   └── Project.js         [~28L]  Project schema (repos, sessions)
│   ├── seed.js                       DB seeding
│   ├── seed-sample-tools.js          Sample tool seeding
│   ├── test-api.sh                   API test script
│   └── test-tools.js                 Tool test script
│
├── runtime/                         [2] Runtime server — agent execution engine
│   ├── server.ts              [~90L]  Express entry point (routes, MCP tools endpoint)
│   ├── state.ts               [~110L] Global state maps (agents, orchestrators, sessions, hooks)
│   ├── types.ts               [~50L]  Shared type definitions
│   ├── workflow-scheduler.ts  [~180L] Kahn's algorithm DAG scheduler
│   ├── agent-logger.ts        [~100L] In-memory agent event logger
│   ├── tool-executor.ts       [~120L] Safe user-defined JS function execution
│   ├── load-env.ts            [~30L]  Dotenv loader
│   ├── routes/
│   │   ├── agent.ts           [~400L] Agent lifecycle: run, chat, abort, stats, delete
│   │   ├── orchestrator.ts    [~290L] Orchestrator lifecycle + sub-agent management
│   │   ├── workflow.ts        [~840L] Workflow graph → execution engine (POST compile, run, chat, abort)
│   │   ├── context.ts         [~130L] Project context file CRUD
│   │   ├── files.ts           [~140L] Workspace file browser
│   │   └── logs.ts            [~85L]  Agent log retrieval
│   ├── *.cpp, *.py                   MPI/threading example programs
│   └── *.jsonl                       Agent session logs
│
├── frontend/                        [3] Frontend — React SPA
│   ├── react-app/
│   │   ├── src/
│   │   │   ├── App.js                 Route definitions (React Router)
│   │   │   ├── index.js               Entry point
│   │   │   ├── constants.js           Shared constants
│   │   │   ├── utils.js               Utility functions
│   │   │   ├── AgentChatContext.jsx    Chat context provider
│   │   │   ├── WorkflowBuilder.jsx    Visual drag-drop workflow builder
│   │   │   ├── WorkflowBuilder.css
│   │   │   ├── pages/                 (15 page components)
│   │   │   └── components/           (20+ UI components)
│   │   ├── package.json
│   │   └── public/
│   ├── workflows.html                 Standalone static workflow view
│   ├── workflows.js
│   └── workflows.css
│
├── tui/                             [4] TUI — Python/Textual terminal UI
│   ├── app.py                        Entry point (Textual App)
│   ├── pyproject.toml                Python project config
│   └── components/
│       ├── agent_list.py             Agent listing screen
│       ├── chat.py                   Chat interface
│       └── api.py                    Backend API client
│
├── mcp/                             [5] MCP Gateway — external tool proxy
│   ├── docker-compose.yml            Docker compose (gateway, tavily, nginx)
│   ├── gateway/
│   │   ├── Dockerfile
│   │   ├── config.yaml               Upstream config (tavily → http://tavily:8000/mcp/)
│   │   ├── requirements.txt
│   │   └── src/
│   │       ├── main.py               FastMCP gateway entry point
│   │       └── registry.py           YAML config loader
│   ├── servers/tavily/
│   │   └── src/server.py             Tavily search MCP server
│   └── nginx/
│       ├── Dockerfile
│       └── nginx.conf                Reverse proxy config
│
├── coding_orchestrator/             [6] Meta-orchestration agents
│   ├── explorer.ts             [~220L] Explorer agent (explore_repos tool, parallel sub-agent fan-out)
│   ├── explorer_system_prompt.md     System prompt for explorer agent
│   └── wiki_writer.md                System prompt for wiki creator agent
│
├── tests/                           [7] Test files
│   ├── test-pi-agent.ts
│   ├── test-pi-agent-2.ts
│   ├── test-raw-agent.ts
│   ├── test-orchestrator.ts
│   ├── test-tool-execution.ts
│   ├── test-tool-execution.cjs
│   ├── test-custom-tools.ts
│   └── test-mem0.ts
│
├── examples/
│   └── custom-tools.ts               Example custom tool creation
│
├── wiki/                             (empty — target for wiki output)
├── memories/                         (empty — likely memory storage)
├── cli_tools/                        (empty — reserved)
├── orchestration/                    (empty — reserved)
├── node_modules/                     (top-level: pi-ai, pi-coding-agent, MCP SDK, mem0ai)
│
├── README.md                         Project documentation
├── build_pi_agent.md                 Build/documentation guide
├── coding_orchestrator.md            Orchestrator design doc
├── runtime-server.md                 Runtime server design doc
├── mem0_mechanism.md                 Memory mechanism documentation
├── how_to_handle_context.md          Context handling guide
├── TOOL_EXECUTION_GUIDE.md           Tool execution documentation
├── MONETIZATION_PLAN.md              Monetization plan
├── to-rethink.md                     Design reconsiderations
└── AGENTS.md                         (empty — placeholder)
```

---

## 3. Key Components Deep Dive

### 3.1. `pi-agent.ts` — Core Agent Class (~1075 lines)

The central abstraction of the entire platform. Wraps `@mariozechner/pi-coding-agent`'s `createAgentSession`.

**Class: `PiAgent`**
- **Constructor** accepts `PiAgentConfig`: model, thinkingLevel, sessionMode (memory/disk/continue), workingDir, playground, apiKey, skills, systemPromptSuffix, tools, compaction, mcpBridge, mem0.
- **`query(prompt)`** — Start streaming session. Returns `{ session, subscription }`.
- **`execute(prompt, callback?)`** — One-shot execution with event streaming.
- **`chat(prompt, callback?)`** — Stateful multi-turn chat.
- **`abort()`** — Cancel running session.
- **`getMessages()`** — Full transcript.
- **`getConfig()`** — Current config.
- **Event system** — `PiAgentEventHandlers` interface with 20+ granular hooks: `onAgentStart`, `onAgentEnd`, `onTurnStart`, `onTurnEnd`, `onTextDelta`, `onThinkingDelta`, `onToolCallStreamed`, `onToolStart`, `onToolUpdate`, `onToolEnd`, `onStreamDone`, `onStreamError`, etc.
- **Tool registration** — Supports custom tools via `ToolInput` (name, description, parameters via TypeBox schemas, execute function). Built-in tools come from the SDK (bash, read, write, edit).
- **Skills** — Markdown skill definitions passed to the resource loader.
- **MCP Bridge** — Integrates external MCP tools as callable tools.
- **mem0 Integration** — Auto-memory via `Mem0` wrapper class.
- **Compaction** — Automatic context window management.

### 3.2. `pi-orchestrator.ts` — Multi-Agent Orchestrator (~220 lines)

**Class: `PiOrchestrator`**
- Implements a **delegate pattern**: the orchestrator LLM receives a "delegate" tool that fans out tasks to sub-agents in parallel.
- **`addSubAgent(def)`** — Register sub-agent (name, description, PiAgent instance).
- **`initialize()`** — Builds delegate tool from registered sub-agents. Creates a raw agent (no built-in tools) with only the delegate tool.
- **`chat(prompt, callback?)`** / **`execute(prompt, callback?)`** — Run orchestrator.
- Sub-agents execute in **parallel** via `Promise.all`.

### 3.3. `raw-agent.ts` — Bare Agent Factory (~105 lines)

**Function: `createRawAgent(config)`**
- Creates a PiAgent with **no tools** (suppresses bash/read/write/edit), **no skills**, **no prompt templates**, **no themes**, **no project context files**.
- Used by orchestrator to create a clean delegate-only agent.
- Achieved by monkey-patching `_createSession` after construction with `noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true`.

### 3.4. `mem0.ts` — Memory Integration (~250 lines)

**Class: `Mem0`**
- Wraps `mem0ai/oss` `Memory` class.
- **LLM**: Anthropic Claude (for memory extraction).
- **Embedder**: OpenAI (`text-embedding-3-small`, 1536d) or Ollama (`all-minilm`, 384d).
- **Vector store**: Qdrant (local or cloud).
- **History DB**: SQLite (`memory.db`).
- **`add(messages, options)`** — Extract and store memories from conversation.
- **`search(query, options)`** — Semantic search over stored memories.
- **`getAll(options)`** — List all memories for a user/agent/run.
- **`deleteAll(options)`** / **`delete(memoryId)`** — Delete memories.
- Scoped by `userId`, `agentId`, `runId`.

### 3.5. `mcp-bridge.ts` — MCP Client (~55 lines)

**Function: `createMcpBridge(endpoint, timeoutMs)`**
- Creates an MCP client connected to a Streamable HTTP transport.
- Returns `{ tools, callTool, close }`.
- `tools` — List of `McpToolEntry` (name, description, inputSchema).
- `callTool(name, args)` — Invokes a remote MCP tool.

### 3.6. `workflow_interfaces_tools.ts` — Structured Output Tools (~200 lines)

Defines 4 forced-output tools for inter-agent communication:
- **`briefingTool`** — Structured briefing (title, summary, completedSteps, currentStatus, keyFindings, nextSteps).
- **`reportTool`** — Detailed article-style report (originalQuery, reasoning, steps, conclusion, openQuestions).
- **`planTool`** — Structured action plan (goal, phases with steps/dependencies/successCriteria/estimatedEffort).
- **`createDelegateTool(agents)`** — Dynamic delegate tool for orchestrator-to-sub-agent dispatch.
- Exports `INTERFACE_TOOL_NAMES` — Set of all interface tool names for hook matching.

---

## 4. Runtime Server — Execution Engine

### 4.1. Global State (`runtime/state.ts`)

| Map | Key | Value | Purpose |
|---|---|---|---|
| `activeAgents` | sessionId (or `orchestratorId::agentId`) | `PiAgent` | All running agent instances |
| `activeOrchestrators` | orchestratorId | `PiOrchestrator` | Running orchestrator instances |
| `orchestratorSubAgents` | orchestratorId | `AgentData[]` | Sub-agent metadata for UI |
| `sessionAgentMap` | sessionId | agentId (MongoDB _id) | Which agent a session belongs to |
| `sessionFileMap` | sessionFile path | sessionId | Disk session deduplication |
| `agentToSessionMap` | agentId (MongoDB _id) | compositeKey | Reverse lookup |
| `sessionHooks` | sessionKey | `SessionHook[]` | Workflow hook callbacks |
| `workflowSessions` | sessionId | `WorkflowSessionState` | Compiled actor state |
| `workflowHistory` | — | `WorkflowRecord[]` | In-memory workflow record list |

### 4.2. Route Modules

| Route File | Key Endpoints | Lines |
|---|---|---|
| `agent.ts` | `POST /runtime/run` — Create agent from DB config; `POST /runtime/chat` — Multi-turn chat via SSE; `POST /runtime/abort` — Cancel running; `GET /runtime/agent/:id/stats` — Token counts; `DELETE /runtime/agent/:id` — Cleanup | ~400L |
| `orchestrator.ts` | `POST /runtime/orchestrator/run` — Create orchestrator with sub-agents; `POST /runtime/orchestrator/chat` — Orchestrator chat via SSE; `GET /runtime/orchestrator/stats` | ~290L |
| `workflow.ts` | `POST /runtime/workflow/compile` — Compile DAG → execution queue; `POST /runtime/workflow/run` — Execute compiled workflow; `POST /runtime/workflow/chat/:nodeId` — Chat with a workflow node; `POST /runtime/workflow/run-all` — Execute all levels sequentially; `POST /runtime/workflow/abort` | ~840L |
| `context.ts` | `GET /runtime/context/list`, `GET /runtime/context/read`, `PUT /runtime/context/write` — CRUD for project `context/*.md` files | ~130L |
| `files.ts` | `GET /runtime/files/:id` — Browse agent workspace; `GET /runtime/files/content/:id` — Read file content | ~140L |
| `logs.ts` | `GET /runtime/logs/:id`, `GET /runtime/logs` — Agent log retrieval | ~85L |

### 4.3. Workflow Scheduler (`runtime/workflow-scheduler.ts`)

**Function: `buildExecutionQueue(nodes, connections)`**
- Implements **Kahn's algorithm** for topological sort of workflow DAG.
- Returns `{ levels, predecessors, successors, toolLinks }`.
- `levels` — ordered array of parallel node groups (same depth = runnable in parallel).
- Supports `tool-link` connection type (binding, not execution flow).
- Cycle detection — throws on cycles.

### 4.4. Tool Executor (`runtime/tool-executor.ts`)

**Class: `ToolExecutor`**
- `static parseFunction(functionString)` — Parse JavaScript function body string.
- `static async executeFunction(functionString, params, timeout)` — Execute with timeout protection (default 5s).
- Returns PiAgent-compatible result format `{ content: [{ type: 'text', text }] }`.

### 4.5. Agent Logger (`runtime/agent-logger.ts`)

**Class: `AgentLogger`**
- In-memory log storage per agent (max 1000 entries per agent).
- Event types: `message_update`, `tool_execution_start`, `tool_execution_end`, `message_end`, `prompt_end`, `error`.
- `log(agentId, eventType, data)` — Async (uses `setImmediate`).
- `getLogs(agentId)` / `getAllLogs()` / `formatLogs(agentId)` — Retrieval and formatting.

---

## 5. Database Server — Persistence Layer

### API Endpoints (`database/server.js`, Port 4000)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agents` | GET/POST | List all or create agent |
| `/api/agents/:id` | GET/PUT/DELETE | Agent CRUD |
| `/api/agents/:id/files` | GET | Get agent files (soul/skills) |
| `/api/agents/:id/files/:type` | POST/PUT/DELETE | Agent file CRUD |
| `/api/tool-schemas` | GET/POST | Tool schema CRUD |
| `/api/tool-schemas/:id` | GET/PUT/DELETE | Individual tool schema |
| `/api/interfaces` | GET/POST | Interface CRUD |
| `/api/interfaces/:id` | GET/PUT/DELETE | Individual interface |
| `/api/multi-agent-patterns` | GET/POST | Multi-agent pattern CRUD |
| `/api/orchestrators` | GET/POST | Orchestrator CRUD |
| `/api/orchestrators/:id` | GET/PUT/DELETE | Individual orchestrator |
| `/api/memory-agents` | GET/POST | Memory agent CRUD |
| `/api/projects` | GET/POST | Project CRUD |
| `/api/projects/:id` | GET/PUT/DELETE | Individual project |
| `/api/projects/:id/sessions` | POST | Add session to project |
| `/api/search` | GET | Search across agents and tools |

### Mongoose Models

| Model | Key Fields |
|---|---|
| **Agent** | `name`, `type` (agent/orchestrator), `description`, `model`, `thinkingLevel`, `sessionMode`, `workingDir`, `playground`, `apiKey`, `icon`, `tools[]`, `toolCallGuardrails`, `compaction` |
| **AgentFile** | `agent_id`, `type` (soul/skills), `content` |
| **ToolSchema** | `name`, `displayName`, `description`, `parameters` (JSON schema), `functionBody`, `timeout` |
| **Interface** | `name`, `description` |
| **MultiAgentPattern** | `name`, `description`, `config` (mixed) |
| **Orchestrator** | `name`, `description`, `model`, `systemPrompt`, `subAgents[]` (agent references), `compaction` |
| **MemoryAgent** | `name`, `model`, `embedProvider`, `embedModel`, `openaiApiKey`, `ollamaBaseUrl`, `collectionName`, `qdrantUrl`, `qdrantApiKey`, `customInstructions` |
| **Project** | `name`, `description`, `repos[]` (label, path, agents[], orchestrators[]), `sessions[]` |

---

## 6. Frontend — React SPA

### Routes (React Router)

| Path | Page Component | Purpose |
|---|---|---|
| `/` | `WelcomePage` | Landing page |
| `/hub` | `Home` | Main hub |
| `/workspaces` | `ProjectsListPage` | Project listing |
| `/workspaces/new` | `WorkspacesPage` | Create workspace |
| `/workflows` | `WorkflowsPage` | Workflow listing |
| `/workflow` | `WorkflowBuilder` | Visual DAG builder (drag-drop canvas) |
| `/chat` | `ChatPage` | General chat |
| `/chat/:agentId` | `ChatPage` | Agent-specific chat |
| `/chat/:agentId/:sessionId` | `ChatPage` | Session-specific chat |
| `/agents` | `AgentsPage` | Agent management |
| `/tools` | `ToolsPage` | Tool management |
| `/team-of-agents` | `TeamOfAgentsPage` | Multi-agent team setup |
| `/orchestrators` | `OrchestratorPage` | Orchestrator management |
| `/dashboard/:agentId/:sessionId` | `AgentDashboardPage` | Agent session dashboard |
| `/orch-dashboard/:orchestratorId/:sessionId` | `DashboardPage` | Orchestrator dashboard |

### Key Components

| Component | Purpose |
|---|---|
| `ChatArea` | SSE streaming chat UI with thinking/response/tool panels |
| `WorkflowBuilder` | Visual drag-drop DAG builder for multi-agent workflows |
| `WorkflowNode` / `NodeShape` | Workflow node rendering (agent/tool nodes with shapes) |
| `AgentConfigPanel` | Agent configuration form |
| `AgentForm` | Agent creation/editing form |
| `AgentTypeSelector` | Agent type selection (PiAgent vs MemoryAgent) |
| `Canvas` | Drag-drop canvas for workflow nodes |
| `Sidebar` | Navigation sidebar |
| `Header` | App header with agent status |
| `Terminal` | Terminal output view |
| `CodeBrowser` | File tree browser for agent workspace |
| `ContextPanel` | Project context file editor |
| `SubAgentsPanel` | Orchestrator sub-agent management |
| `SubAgentSessionView` | Sub-agent session monitoring |
| `ScrumRoomPanel` | Team collaboration view |
| `ModelSelect` | LLM model selector |
| `ToolForm` / `ToolDetailPanel` | Tool creation and detail viewing |

---

## 7. TUI — Terminal UI (Python/Textual)

| File | Purpose |
|---|---|
| `tui/app.py` | Textual App entry point (`TuiApp` class) |
| `tui/components/agent_list.py` | `AgentListScreen` — lists agents from DB, select to chat |
| `tui/components/chat.py` | `ChatScreen` — streaming chat with agent |
| `tui/components/api.py` | `APIClient` — HTTP client for backend communication |
| `tui/pyproject.toml` | Python project metadata (textual dependency) |

---

## 8. MCP Gateway — External Tool Proxy

### Components

| Component | Technology | Purpose |
|---|---|---|
| **Gateway** | FastMCP (Python) | Central MCP proxy that mounts upstream servers as prefixed sub-servers |
| **Tavily Server** | FastMCP (Python) | Tavily search API as MCP tool |
| **Nginx** | Nginx | Reverse proxy (routes `/mcp` to gateway) |

### Gateway Architecture

```
Client (PiAgent via mcp-bridge.ts)
    │  Streamable HTTP
    ▼
Nginx (port 8080) → /mcp → Gateway (port 9000)
                              │
                              ├── /tavily → Tavily MCP Server (port 8000)
                              │              └── search tool
                              └── /healthz → health check
```

### Config (`mcp/gateway/config.yaml`)

```yaml
name: mcp-gateway
upstreams:
  - name: tavily
    prefix: tavily
    url: http://tavily:8000/mcp/
```

---

## 9. Coding Orchestrator — Meta Agents

| File | Purpose |
|---|---|
| `coding_orchestrator/explorer.ts` | Explorer agent: defines `explore_repos` custom tool that fans out exploration to multiple sub-repos in parallel using stateless PiAgent sub-agents |
| `coding_orchestrator/explorer_system_prompt.md` | System prompt for the codebase explorer agent (read-only exploration protocol, output format spec) |
| `coding_orchestrator/wiki_writer.md` | System prompt for the wiki creator agent (compiles codebase → `.wiki/` Markdown tree with provenance tracking) |

---

## 10. Tests

| Test File | What It Tests |
|---|---|
| `tests/test-pi-agent.ts` | Basic PiAgent instantiation and query |
| `tests/test-pi-agent-2.ts` | Advanced PiAgent scenarios |
| `tests/test-raw-agent.ts` | Raw agent factory |
| `tests/test-orchestrator.ts` | PiOrchestrator with sub-agents |
| `tests/test-tool-execution.ts` | ToolExecutor parsing and execution |
| `tests/test-tool-execution.cjs` | CommonJS tool execution variant |
| `tests/test-custom-tools.ts` | Custom tool registration and invocation |
| `tests/test-mem0.ts` | mem0 memory add/search/delete |

---

## 11. Conventions & Patterns

### Naming
- TypeScript files: `kebab-case.ts`
- React components: `PascalCase.jsx`
- Database models: `PascalCase.js`
- Python: `snake_case.py`
- Route files: single-word lowercase

### Error Handling
- Runtime routes return `{ error: string }` with appropriate HTTP status codes (400, 404, 502).
- PiAgent tool execution returns `{ content: [{ type: 'text', text }] }` format.
- Database server returns `{ error: err.message }` with 400 for validation errors.

### Patterns
- **Event-driven architecture** — PiAgent uses a granular event system (20+ event types).
- **SSE for streaming** — Chat endpoints use Server-Sent Events.
- **Global state maps** — Runtime uses in-memory Maps for session management.
- **Tool abstraction** — Tools defined as `ToolInput` with TypeBox schemas.
- **Dependency injection** — PiAgent accepts Mem0, McpBridge, Skills as config.
- **Session deduplication** — `sessionFileMap` prevents duplicate disk sessions.

### Config
- Environment variables loaded via `dotenv` in `runtime/load-env.ts` (must load before SDK imports).
- API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` in `.env`.
- MCP endpoint: `MCP_ENDPOINT` env var (default `http://localhost:8080/mcp`).
- Database: Default MongoDB on `localhost:27017`.

---

## 12. Dependencies

### npm (top-level)
- `@mariozechner/pi-ai` — LLM model abstraction
- `@mariozechner/pi-coding-agent` — Core agent SDK (sessions, tools, streaming)
- `@modelcontextprotocol/sdk` — MCP client SDK
- `dotenv` — Environment loading
- `mem0ai` — Memory layer (OSS)
- Dev: `tsx`, `typescript`, `typebox`

### npm (runtime)
- `express`, `cors`, `typebox` — Server

### npm (database)
- `express`, `cors`, `mongoose` — Server + MongoDB ODM

### npm (frontend)
- `react`, `react-router-dom`, `reactflow` (workflow canvas), plus UI dependencies

### Python
- `textual` — TUI framework
- `fastmcp`, `starlette`, `uvicorn` — MCP gateway
- `tavily-python` — Tavily search client

### Infrastructure
- MongoDB — Agent/tool persistence
- Qdrant — Vector store for memory
- Docker — MCP gateway deployment
- Nginx — MCP reverse proxy

---

## 13. Startup Sequence

Per `otto_settings.json`, the system is started with 4 panes:

1. **MongoDB** — `mongod --dbpath ~/mongodb-data --port 27017`
2. **Database Server** — `npm start` in `database/` (port 4000)
3. **Runtime Server** — `npm start` in `runtime/` (port 5000)
4. **Frontend** — `npm start` in `frontend/react-app/` (port 3000)

Additionally, for full functionality:
- **MCP Gateway** — `docker compose up` in `mcp/` (port 8080)
- **Qdrant** — Local vector store for mem0
- **Ollama** — (optional) for local embeddings at `http://localhost:11434`

---

## 14. Key Observations for Wiki Creator

1. **This is a single monorepo**, not multiple independent repos. All components share the same `package.json`, `tsconfig.json`, and `.env`.
2. **The boundary between "library" and "application" code is porous** — `pi-agent.ts` is both a reusable class and the runtime's execution engine.
3. **The runtime imports from root-level modules** (e.g., `runtime/routes/agent.ts` imports `../../pi-agent.js`), so they are tightly coupled.
4. **The frontend is a separate npm project** with its own `node_modules`, but it calls the database and runtime via HTTP.
5. **The MCP gateway and TUI are independent processes** with their own dependency managers (Docker/poetry/pip).
6. **The coding_orchestrator is a self-contained meta-system** that uses PiAgent to orchestrate exploration/wiki-creation of other codebases.
7. **Empty directories** (`cli_tools/`, `orchestration/`, `wiki/`, `memories/`) are reserved for future use or runtime data.
8. **Generated/log data** is present in `runtime/` (jsonl files, compiled C++ binaries) — these should be excluded from wiki coverage.
9. **The `AGENTS.md` at root is empty** — it's the standard pi-coding-agent context file placeholder.

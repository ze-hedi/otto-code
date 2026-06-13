# Otto Code Runtime Server — End-to-End Architecture

## 1. Overview

The runtime server is a TypeScript/Express HTTP server (port 5000) that sits between the React frontend and the PiAgent SDK. It instantiates and manages **long-lived AI coding agent sessions**, exposes REST endpoints for chat (with SSE streaming), orchestrators, multi-agent workflows, file browsing, context editing, logs, and MCP tool discovery.

**Location:** `runtime/`  
**Entry point:** `runtime/server.ts`  
**Start command:** `tsx server.ts` (via `npm start`)

---

## 2. Entry Point: `server.ts`

```
runtime/server.ts:1-83
```

### Boot sequence
1. **`import './load-env.js'`** — Must come first. Reads `.env` from project root into `process.env` so `@mariozechner/pi-ai` can see `ANTHROPIC_API_KEY` at module-load time. (`runtime/load-env.ts:17-32`)
2. Creates an **Express app** with `cors()` and `express.json()` middleware.
3. Mounts **6 route modules** (no prefix — routes are flat at root):
   - `agentRoutes` — agent lifecycle, chat, abort, config, messages, stats, deletion
   - `orchestratorRoutes` — orchestrator lifecycle, sub-agent queries, orchestrator stats
   - `filesRoutes` — filesystem browsing within agent workspaces
   - `logsRoutes` — agent event log retrieval
   - `workflowRoutes` — workflow graph compilation, SSE events, save/load
   - `contextRoutes` — project-scoped `context/*.md` file CRUD
4. Two **inline routes** on the app itself:
   - `GET /runtime/status` — dump of active agents/sessions
   - `GET /runtime/mcp-tools` — MCP gateway tool discovery

### Key imports from global shared state

```typescript
// runtime/state.ts
activeAgents         // Map<sessionId, PiAgent>
activeOrchestrators  // Map<sessionId, PiOrchestrator>
orchestratorSubAgents// Map<sessionId, AgentData[]>
sessionAgentMap      // Map<sessionId, agentId>
sessionFileMap       // Map<sessionFile path, sessionId>
agentToSessionMap    // Map<agentId, compositeKey>
sessionHooks         // Map<sessionId, SessionHook[]>
workflowSessions     // Map<sessionId, WorkflowSessionState>
workflowHistory      // WorkflowRecord[]
workflowEvents       // EventEmitter (broadcasts SSE to all clients)
currentAgentId       // string | null
```

---

## 3. Route Structure

All routes live under `runtime/routes/`. Each module exports a default Express `Router`.

### 3.1 Agent Routes (`routes/agent.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/runtime/run` | Instantiate a new `PiAgent` from `AgentData` |
| `POST` | `/runtime/chat/:id` | Send message → SSE stream of agent response |
| `POST` | `/runtime/chat/:id/tool-approve` | Approve a pending tool call (guardrails) |
| `POST` | `/runtime/chat/:id/tool-reject` | Reject a pending tool call |
| `POST` | `/runtime/agents/:id/abort` | Abort current agent session |
| `GET` | `/runtime/agents/:id/config` | Get agent config + registered tools |
| `GET` | `/runtime/agents/:id/messages` | Get full conversation history |
| `GET` | `/runtime/agents/:id/stats` | Get context usage + session stats |
| `DELETE` | `/runtime/agents/:id` | Remove agent from memory |

### 3.2 Orchestrator Routes (`routes/orchestrator.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/runtime/orchestrator/run` | Create orchestrator + sub-agents |
| `GET` | `/runtime/orchestrator/:id/subagents` | List sub-agents |
| `GET` | `/runtime/orchestrator/:orchId/subagent/:agentId/messages` | Sub-agent conversation history |
| `GET` | `/runtime/orchestrator/:id/stats` | Aggregated orchestrator + sub-agent stats |

### 3.3 Workflow Routes (`routes/workflow.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/runtime/workflow/events` | SSE stream of workflow hook events |
| `GET` | `/runtime/workflows` | List workflow history |
| `PATCH` | `/runtime/workflows/:id/touch` | Update `lastInteractedAt` |
| `POST` | `/runtime/workflow/compile` | **Core**: compile visual graph → runtime agents |
| `POST` | `/runtime/workflow/save` | Persist workflow to disk |
| `GET` | `/runtime/workflow/load` | Load workflow from disk |

### 3.4 Files Routes (`routes/files.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/runtime/agents/:id/files/tree` | Walk agent workspace (8 levels deep) |
| `GET` | `/runtime/agents/:id/files/read?path=` | Read file content (≤1MB, path escape protected) |

### 3.5 Logs Routes (`routes/logs.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/runtime/logs/:id` | Get formatted logs for one agent |
| `GET` | `/runtime/logs` | Get logs for all agents |

### 3.6 Context Routes (`routes/context.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/runtime/context/list?root=` | List `*.md` files in `<root>/context/` |
| `GET` | `/runtime/context/read?root=&file=` | Read one context file |
| `PUT` | `/runtime/context/write?root=&file=` | Write content to a context file |

---

## 4. How Agents Are Instantiated and Managed

### 4.1 Single Agent (`POST /runtime/run`)

```
runtime/routes/agent.ts:37-161
```

1. Client sends `{ agent: AgentData, files?: AgentFile[], sessionId?, sessionFile? }`
2. **Deduplication**: if `sessionFile` is already loaded, return existing session ID
3. **Validation**: `sessionMode === 'disk'|'continue'` requires `workingDir`
4. **Config assembly**:
   - `soulFile` → `systemPromptSuffix`
   - `skillsFile` → `skills: [{ name, content }]`
   - Model: resolved via `resolveModel()` helper — bare names like `"claude-sonnet-4-6"` become `"anthropic/claude-sonnet-4-6"`; `"gpt-4"` becomes `"openai/gpt-4"` (`runtime/state.ts:100-107`)
   - Compaction settings passed through if present
5. **`new PiAgent(config)`** — the SDK wrapper class from `pi-agent.ts:232`
6. If API key is missing and model is Anthropic, returns `400 api_key_required`
7. If `sessionFile`, calls `piAgent.loadSession(sessionFile)` to restore prior session
8. Stored in global state maps: `activeAgents`, `sessionAgentMap`, `sessionFileMap`
9. Sets `global.activeAgent` and `global.activeAgentId` (backward compatibility)

### 4.2 Orchestrator (`POST /runtime/orchestrator/run`)

```
runtime/routes/orchestrator.ts:32-118
```

1. Client sends `{ orchestratorId, systemPrompt, model?, agents: AgentData[] }`
2. For each sub-agent: fetches files from DB (`GET localhost:4000/api/agents/:id/files`), builds `PiAgentConfig`, creates `PiAgent` → stored in `activeAgents` under composite key `${sessionId}::${agent._id}`
3. Creates `PiOrchestrator` (from `pi-orchestrator.ts`):
   - The orchestrator wraps a "raw agent" (no built-in bash/read/edit/write tools)
   - Its only tool is `delegate` — accepts `{agents: [{name, task}]}`, fans out work in parallel
   - Sub-agents run via `agent.chat()` (stateful) or `agent.execute()` (one-shot)
4. Stores orchestrator in `activeOrchestrators`, sub-agents metadata in `orchestratorSubAgents`, underlying PiAgent in `activeAgents` (keyed by sessionId)

### 4.3 Workflow Agents (`POST /runtime/workflow/compile`)

```
runtime/routes/workflow.ts:125-540
```

This is the most complex endpoint. It:

1. **Parses the visual graph** — nodes (`agent` | `orchestrator` | `tool` | `artefact`) + connections (execution flow and `tool-link` edges)
2. **Validates the graph** via `workflow-scheduler.ts`:
   - Kahn's algorithm → topological sort into parallel levels
   - Agents cannot directly feed into other agents — an `artefact` (interface) must sit between them
   - Interfaces must have at least one agent/orchestrator predecessor
   - Only the "Delegate" interface can feed multiple downstream actors
3. **Builds agents** for each `agent` node — same config assembly as single agent, but with an `onToolExecute` callback that routes through MCP tools, DB tools, or interface tools (briefing/plan/report/delegate)
4. **Builds orchestrators** from `orchestrator` nodes — creates sub-agent PiAgents, builds delegate tool, creates raw agent via `createRawAgent()`
5. **Resolves linked tools** — bulk-fetches DB tools from `localhost:4000/api/tools`, connects MCP bridge for MCP tools
6. **Assigns interface tools** — each agent gets `briefingTool`, `planTool`, `reportTool`, and/or `delegateTool` based on outgoing artefact connections
7. **Wires hooks** — `sessionHooks` per composite key catch all interface tool calls (`'*'`) and emit `workflowEvents` (SSE broadcast). Multi-entry interfaces accumulate submissions before emitting.
8. **Stores** composite keys in `activeAgents`, `agentToSessionMap`, `orchestratorSubAgents`
9. **Incremental recompilation** — if `existingSessionId` is provided, reuses already-compiled agents but re-wires hooks for changed graph connections

---

## 5. WebSocket / SSE Handling

The runtime uses **Server-Sent Events (SSE)**, not WebSocket.

### 5.1 Chat SSE (`POST /runtime/chat/:id`)

```
runtime/routes/agent.ts:172-215
```

- Sets headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Calls `piAgent.chat(message, callback)` where the callback:
  - `handleEvent(event)` — logs to console (`pi-agent-utils.ts:52-156`)
  - `handleEventWithClient(event, send)` — translates `AgentSessionEvent` → SSE JSON lines (`pi-agent-utils.ts:9-40`)

SSE event types sent to client:

| SSE `type` | Triggering AgentSessionEvent |
|------------|------------------------------|
| `delta` | `message_update` → `text_delta` |
| `thinking` | `message_update` → `thinking_delta` |
| `done` | `message_update` → `done` |
| `error` | `message_update` → `error` |
| `tool_start` | `tool_execution_start` |
| `tool_end` | `tool_execution_end` |
| `tool_approval_required` | Separate listener on `piAgent.onToolApprovalRequired()` |

### 5.2 Workflow Events SSE (`GET /runtime/workflow/events`)

```
runtime/routes/workflow.ts:36-53
```

- Long-lived SSE connection
- Listens on `workflowEvents` EventEmitter for `hook_fired` events
- Broadcasts to all connected clients when any workflow agent submits an interface tool
- Also emits `hook_partial` for multi-entry interface progress

---

## 6. Workflow Orchestration Logic

### 6.1 Graph Compilation Pipeline

```
POST /runtime/workflow/compile
  │
  ├─► buildExecutionQueue(nodes, connections)     // workflow-scheduler.ts
  │     ├─ Separate tool-link edges from execution edges
  │     ├─ Kahn's topological sort → levels[][]
  │     └─ Returns { levels, predecessors, successors, toolLinks }
  │
  ├─► compileGraph(result)                        // workflow-scheduler.ts
  │     ├─ Rule 1: agent ⟂ agent (need artefact between)
  │     ├─ Rule 2: artefact must have actor predecessor
  │     └─ Rule 3: only "Delegate" artefact feeds multiple actors
  │
  ├─► Build PiAgent for each agent node
  ├─► Build orchestrator (raw agent + delegate) for each orchestrator node
  ├─► Resolve linked tools (DB fetch + MCP bridge)
  ├─► Assign interface tools per outgoing artefact connections
  ├─► Wire sessionHooks → workflowEvents for SSE broadcast
  └─► Return { sessionId, activeAgent, agents[], executionQueue }
```

### 6.2 Interface Tools (Inter-Agent Communication)

Defined in `workflow_interfaces_tools.ts`:

| Tool Name | Parameter Shape | Purpose |
|-----------|----------------|---------|
| `submit_briefing` | `{title, summary, completedSteps[], currentStatus, keyFindings[], nextSteps[]}` | Structured status dump |
| `submit_plan` | `{title, objective, steps[{order, action, details, dependsOn[], successCriteria}], risks[], estimatedComplexity}` | Action plan |
| `submit_report` | `{title, originalQuery, reasoning, steps[{step, rationale, outcome}], conclusion, openQuestions[]}` | Detailed article-style report |
| `submit_delegate` | `{goal, delegations[{agentName, task, context, expectedOutput, priority, referenceSpecs?}]}` | Task delegation |

When an agent calls any of these, the hook callback fires `workflowEvents.emit('hook_fired', payload)` — the frontend listens via SSE and can decide to start the next agent in the execution queue.

### 6.3 Multi-Entry Interface Accumulation

```
runtime/routes/workflow.ts:455-515
```

When multiple agents feed into the same interface node (e.g., two agents both connect to a "Briefing" artefact), a `pendingBriefings` accumulator waits for **all** expected submissions before emitting a merged `hook_fired` event. Partial progress is broadcast as `hook_partial`.

### 6.4 Incremental Recompilation

```
runtime/routes/workflow.ts:269-280
```

If `existingSessionId` matches a `workflowSessions` entry, agents whose node IDs already appear in `compiledActors` are **reused** (not re-created). Only new agents are built. All hooks are re-wired to reflect potential graph connection changes.

---

## 7. Supporting Utilities

### 7.1 `agent-logger.ts`

```
runtime/agent-logger.ts:1-117
```

In-memory async logger. Captures `AgentLogEntry` objects (timestamp, agentId, eventType, data) per agent. Event types: `message_update`, `tool_execution_start`, `tool_execution_end`, `message_end`, `prompt_end`, `error`. Max 1000 entries per agent (FIFO trim).

### 7.2 `tool-executor.ts`

```
runtime/tool-executor.ts:1-133
```

Safe execution of user-defined JavaScript function strings (DB tools). Uses `new Function('params', functionString)` pattern. Provides:
- `executeFunction()` — parse + execute with 5s timeout via `Promise.race`
- `validateFunction()` — syntax check only
- `executeSafely()` — wraps errors into result format instead of throwing

### 7.3 `workflow-scheduler.ts`

```
runtime/workflow-scheduler.ts:1-178
```

Pure graph algorithms:
- `buildExecutionQueue()` — Kahn's topological sort, separating tool-link edges from execution edges, returning leveled parallel groups + predecessor/successor maps
- `compileGraph()` — structural validation rules (agent→agent forbidden, interface must have actors, delegate-only multi-fanout)

### 7.4 `load-env.ts`

```
runtime/load-env.ts:1-33
```

Manual `.env` parser. Iterates lines, splits on first `=`, sets `process.env[key]` if not already set. Must be imported before any SDK module.

---

## 8. External Dependencies

| Module | File | Role |
|--------|------|------|
| `PiAgent` | `pi-agent.ts` | Wraps `@mariozechner/pi-coding-agent` SDK. Manages model auth, session lifecycle, tool registry, compaction, chat/execute |
| `PiOrchestrator` | `pi-orchestrator.ts` | Delegation orchestrator. Wraps a raw agent with only a `delegate` tool. Fans out sub-agent execution in parallel |
| `createRawAgent` | `raw-agent.ts` | Factory that patches `PiAgent._createSession` to suppress built-in tools (bash/read/edit/write), skills, themes, context files |
| `workflow_interfaces_tools` | `workflow_interfaces_tools.ts` | TypeBox schema definitions for `briefingTool`, `planTool`, `reportTool`, `createDelegateTool()` |
| `mcp-bridge.ts` | `mcp-bridge.ts` | Thin wrapper around `@modelcontextprotocol/sdk` — connects to MCP gateway, discovers tools, calls them |
| `pi-agent-utils.ts` | `pi-agent-utils.ts` | `handleEvent()` (console logging) and `handleEventWithClient()` (SSE forwarding) |
| `Mem0` | `mem0.ts` | Optional memory system (not used in routes directly, passed through config) |

---

## 9. Data Flow: End-to-End Chat

```
Frontend                          Runtime Server                    PiAgent SDK
───────                          ───────────────                    ───────────
                                                                    
POST /runtime/run                parse AgentData
{ agent, files } ──────────────► build PiAgentConfig
                                 new PiAgent(config)
                                 activeAgents.set(id, agent) ──────► PiAgent constructor
                                 ◄── { success, sessionId }             AuthStorage, ModelRegistry
                                                                        createAgentSession()
                                                                        
POST /runtime/chat/:id           activeAgents.get(id)
{ message } ───────────────────► set SSE headers
                                 piAgent.chat(msg, cb) ────────────► agentSession.prompt(msg)
                                                                       │
                                 ◄── AgentSessionEvent stream ─────────┤
                                 handleEvent(event)    (console log)   │ text_delta
                                 handleEventWithClient  (SSE write)    │ thinking_delta
                                 res.write(data: {...})                │ tool_execution_start
                                 ◄── data: {type:"delta", text} ──── Frontend receives SSE
                                 ◄── data: {type:"done"}
                                 res.end()
```

---

## 10. Key Architectural Patterns

### 10.1 Composite Key Strategy

Agents belonging to orchestrators or workflows use **composite keys**: `${sessionId}::${agentId}`. This allows multiple orchestrators/workflows to each have sub-agents with the same MongoDB `_id` without collision.

- `activeAgents` keyed by composite key for sub-agents
- `activeAgents` keyed by bare sessionId for the orchestrator's own PiAgent
- `agentToSessionMap` maps agentId → composite key for reverse lookup
- `orchestratorSubAgents` maps sessionId → AgentData[] for UI

### 10.2 State Hygiene on Deletion

`DELETE /runtime/agents/:id` (`agent.ts:359-397`):
- Removes from `activeAgents`, `sessionAgentMap`, `sessionFileMap`
- If it was an orchestrator, also cleans up all sub-agent composite keys and `orchestratorSubAgents`
- Resets `currentAgentId` and globals if it was the active agent
- Calls `clearSessionHooks()` and `agentLogger.clearLogs()`

### 10.3 Error Handling Pattern

All routes use try/catch with:
- `400` for missing/invalid request body fields
- `404` for agent/orchestrator not found in runtime
- `500` for unexpected errors with `{ error: err.message }`
- `503` for "no active session" on stats/messages endpoints

### 10.4 Path Security

Files and context routes both validate that resolved paths stay within the allowed root directory using `path.resolve()` + `startsWith()` checks. Files cap at 1MB.

---

## 11. Global Side Effects & Concurrency

- `global.activeAgent` / `global.activeAgentId` — set on every agent/orchestrator run. Used by other modules for backward compatibility.
- `workflowEvents` EventEmitter — single shared emitter. No per-client tracking; every connected SSE client gets every event.
- `agentLogger` — singleton, in-memory only. Logs lost on restart.
- All state (`activeAgents`, `sessionHooks`, `workflowSessions`, etc.) is in-process memory only. **No persistence layer for runtime state.**

---

## 12. Workflow File Persistence

```
POST /runtime/workflow/save  →  fs.writeFileSync(filePath, JSON.stringify(data))
GET  /runtime/workflow/load?filePath=  →  fs.readFileSync → JSON.parse
```

Simple JSON file save/load. File path comes from the frontend. Directories are created recursively on save.

---

## 13. Suggested Entry Point for Development

**`runtime/routes/agent.ts`** — The single-agent lifecycle (`/runtime/run` and `/runtime/chat/:id`) is the simplest and most representative entry point. Understanding how a PiAgent is created from AgentData and how chat SSE streaming works will ground all other routes, since orchestrators and workflows build on the same PiAgent foundation.

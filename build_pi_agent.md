# Building a PiAgent

`PiAgent` is a class-based wrapper around the `@mariozechner/pi-coding-agent` SDK. It simplifies creating and running coding agents with custom tools, skills, sessions, event streaming, and guardrails — all with a single constructor and two main methods: `execute()` and `chat()`.

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────┐
│ PiAgent (pi-agent.ts)                       │
│                                             │
│  • Configuration, tool/skill registration   │
│  • Session lifecycle (memory/disk/continue) │
│  • Granular event dispatch                  │
│  • MCP integration, Mem0, guardrails        │
│                                             │
│  ┌─────────────────────────────────┐       │
│  │ @mariozechner/pi-coding-agent   │       │
│  │                                 │       │
│  │ createAgentSession()  ─→  AgentSession  │
│  │ DefaultResourceLoader              │       │
│  │ SessionManager                     │       │
│  │ SettingsManager                    │       │
│  │ AuthStorage / ModelRegistry        │       │
│  └─────────────────────────────────┘       │
│                                             │
│  ┌──────────┐  ┌──────────┐               │
│  │ mcp-     │  │ mem0.ts  │               │
│  │ bridge.ts│  │          │               │
│  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────┘
```

**File locations:**
- `pi-agent.ts` — main `PiAgent` class
- `pi-agent-utils.ts` — event helper functions (`handleEvent`, `handleEventWithClient`)
- `mcp-bridge.ts` — MCP client wrapper (`createMcpBridge`)
- `mem0.ts` — memory persistence wrapper (`Mem0` class)

---

## 2. Quick start — minimal example

```typescript
import { PiAgent } from "./pi-agent";

const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// One-shot execution (fresh session, no history)
await agent.execute("What is 2 + 2?", (event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
```

Reference: `quick-start.ts:1-31`, `tests/test-pi-agent.ts:1-63`

---

## 3. Configuration — `PiAgentConfig`

Complete config shape (all fields are optional except `model`):

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | `string` | **required** | `"provider/model-name"` format, e.g. `"anthropic/claude-sonnet-4-5"` |
| `name` | `string` | `"agent"` | Used for session filename (`<name>_<timestamp>.jsonl`) |
| `apiKey` | `string` | `process.env.*` | Runtime API key override |
| `systemPromptSuffix` | `string` | `""` | Appended to Pi's default system prompt |
| `thinkingLevel` | `"off" \| "low" \| "medium" \| "high" \| "xhigh"` | `"medium"` | Extended thinking control |
| `sessionMode` | `"memory" \| "disk" \| "continue"` | `"memory"` | Persistence strategy |
| `workingDir` | `string` | `process.cwd()` | Working directory for session files |
| `playground` | `string` | `process.cwd()` | Directory the agent operates in (cwd for tools) |
| `sessionDir` | `string` | _computed_ | Custom directory for session persistence |
| `skills` | `SkillInput[]` | `[]` | Skills injected into the agent session |
| `tools` | `ToolInput[]` | `[]` | Custom tools registered at construction |
| `mem0Config` | `Mem0Config` | undefined | Mem0 long-term memory config |
| `compaction` | `object` | `{ enabled: true }` | Context compaction settings |
| `toolCallGuardrails` | `boolean` | `false` | Require user approval before tool execution |
| `mcpEndpoint` | `string` | undefined | MCP gateway URL for tool discovery |
| `mcpConnectionTimeout` | `number` | `5000` | MCP connection timeout in ms |

Reference: `pi-agent.ts:155-217`

### Model format

Models must use the `"provider/model-name"` format. The constructor splits on `/` and throws if the format is invalid:

```typescript
// ✅ Valid
new PiAgent({ model: "anthropic/claude-sonnet-4-5" });
new PiAgent({ model: "openai/gpt-4o" });

// ❌ Throws: "Invalid model format. Expected 'provider/model-name'..."
new PiAgent({ model: "claude-sonnet-4-5" });
```

When using `runtime/state.ts`'s `resolveModel()`, bare names are auto-prefixed: `claude-*` → `anthropic/`, `gpt-*` → `openai/`.

Reference: `pi-agent.ts:220-226`, `runtime/state.ts:135-140`

---

## 4. Session modes

Three persistence strategies control whether conversation history survives across calls:

### `"memory"` (default)
In-memory session. History is lost when the PiAgent instance is garbage-collected.

```typescript
const agent = new PiAgent({ model: "...", sessionMode: "memory" });
await agent.chat("Hello");  // fresh session
await agent.chat("Again");  // same session, remembers "Hello"
```

### `"disk"`
Persists to `<sessionDir>/<name>_<timestamp>.jsonl`. Requires `sessionDir` or `workingDir`.

```typescript
const agent = new PiAgent({
  model: "...",
  sessionMode: "disk",
  workingDir: "/path/to/project",
  name: "my-agent",
});
// Writes to: /path/to/project/memories/my-agent_2025-06-11T12-00-00-000Z.jsonl
```

### `"continue"`
Resumes the most recent session file from the working directory.

```typescript
const agent = new PiAgent({ model: "...", sessionMode: "continue", workingDir: "/path/to/project" });
// Opens the newest .jsonl in /path/to/project/memories/
```

Reference: `pi-agent.ts:224-232, 437-470`

---

## 5. Sending prompts

Two main methods:

### `execute(query, onEvent?)` — one-shot, fresh session
Creates a **new session** each time. No history between calls. Use this for stateless agents or isolated tasks.

```typescript
await agent.execute("List .ts files", handleEvent);
await agent.execute("Count lines", handleEvent);  // fresh session — doesn't remember first query
```

### `chat(message, onEvent?)` — persistent conversation
Creates a session on first call, then **reuses** it. The agent remembers prior turns.

```typescript
await agent.chat("List .ts files", handleEvent);
await agent.chat("Now count lines in those files", handleEvent);  // remembers context
```

Both methods:
- Throw if the stream ends with an error
- Accept an optional `EventCallback` for per-call event handling
- Return `Promise<void>` — they resolve when the agent finishes (including all tool calls and retries)

Reference: `pi-agent.ts:518-584`

---

## 6. Event handling — two approaches

### Approach 1: Per-call callback (simple)

Pass a function to `execute()` or `chat()`. Works like the raw SDK subscription:

```typescript
agent.execute("Query", (event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
```

**Helper utilities** in `pi-agent-utils.ts`:
- `handleEvent(event)` — logs every event to stdout in human-readable format
- `handleEventWithClient(event, send)` — forwards `text_delta`, `thinking_delta`, `done`, `error`, `tool_start`, `tool_end` as SSE-compatible objects

---

## 7. System prompt and skills

### Custom system prompt

```typescript
const agent = new PiAgent({
  model: "...",
  systemPromptSuffix: `
You are a senior engineer reviewing PRs.
Be direct. Flag bugs as BLOCKING, style issues as NON-BLOCKING.
Output format:
## Summary
## Blocking issues
## Non-blocking suggestions
  `,
});
```

The suffix is appended to Pi's default "expert coding assistant" prompt via `DefaultResourceLoader.appendSystemPrompt`.

### Skills

Skills are Markdown files with YAML frontmatter injected as `SkillInput` objects:

```typescript
const SKILL = {
  name: "list-files",
  content: `---
description: List files in the current directory
---
When asked to list files, use the Bash tool to run \`ls -la\`.
`,
};

const agent = new PiAgent({
  model: "...",
  skills: [SKILL],
});
```

Internally, skills are:
1. Written to a temp directory (`os.tmpdir()/pi-agent-skills-*`)
2. Converted to `Skill` objects with `sourceInfo` metadata
3. Merged into the resource loader via `skillsOverride`

The temp dir is cleaned up when the process exits (handled by the OS).

Reference: `pi-agent.ts:371-404`, `tests/test-pi-agent.ts:6-16`

---

## 8. Custom tools

### Tool definition

```typescript
import { Type } from "typebox";
import type { ToolInput } from "./pi-agent";

const dbTool: ToolInput = {
  name: "search_database",           // unique tool name (LLM sees this)
  label: "Search Database",          // human-readable
  description: "Search users by name, email, or role",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
  }),
  promptSnippet: "Search user database",
  promptGuidelines: ["Always specify a query"],
  executionMode: "sequential",       // or "parallel"
  execute: async (toolCallId, params, signal) => {
    const results = await db.search(params.query);
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
      details: { count: results.length },
    };
  },
};
```

### Registration at construction

```typescript
const agent = new PiAgent({ model: "...", tools: [dbTool] });
```

### Dynamic registration

```typescript
agent.addTool({
  name: "get_weather",
  label: "Get Weather",
  description: "Get current weather for a location",
  parameters: Type.Object({
    location: Type.String(),
  }),
  execute: async (_, params) => ({
    content: [{ type: "text", text: `Weather for ${params.location}: sunny` }],
  }),
});
```

### Tool management

```typescript
agent.getRegisteredTools();  // string[] — tool names
agent.hasTool("search_database");  // boolean
agent.removeTool("search_database");  // boolean
```

**Important:** Tools registered after a session is created require a new session (`execute()` creates one; `chat()` does not until the first call).

Reference: `pi-agent.ts:461-497`, `examples/custom-tools.ts`

---

## 9. MCP integration

Connect to an MCP (Model Context Protocol) gateway to discover and register tools:

```typescript
const agent = new PiAgent({
  model: "...",
  mcpEndpoint: "http://localhost:8080/mcp",
  mcpConnectionTimeout: 5000,  // optional, default 5000ms
});

// Discover and register MCP tools (call before first execute/chat)
const mcpToolNames = await agent.connectMcp();
console.log("MCP tools:", mcpToolNames);

// Check state
agent.isMcpConnected();  // true
agent.getMcpTools();     // string[]

// Reconnect (old MCP tools replaced)
await agent.connectMcp("http://new-endpoint/mcp");

// Disconnect
await agent.disconnectMcp();
```

MCP tools appear alongside custom tools in the agent's tool registry. Tool names are prefixed and conflicts with existing tools are skipped with a warning.

Reference: `pi-agent.ts:499-535`, `mcp-bridge.ts`

---

## 10. Tool call guardrails

When enabled, the agent pauses before executing any tool and waits for explicit approval:

```typescript
const agent = new PiAgent({
  model: "...",
  toolCallGuardrails: true,  // default: false
});

// Listen for approval requests
agent.onToolApprovalRequired((toolCallId, toolName, args) => {
  console.log(`Approve tool "${toolName}"?`, args);
  // User clicks approve in UI...
});

// In response to user action:
agent.approveToolCall(toolCallId);             // proceed
agent.rejectToolCall(toolCallId, "Not safe");  // block with reason
```

The approval flow is promise-based: the `beforeToolCall` hook on the agent blocks until `approveToolCall()` or `rejectToolCall()` is called.

Reference: `pi-agent.ts:396-417, 472-488`, `runtime/routes/agent.ts:188-217`

---

## 11. Context compaction

Compaction automatically summarizes older conversation turns when the agent approaches the token limit:

```typescript
const agent = new PiAgent({
  model: "...",
  compaction: {
    enabled: true,            // default: true
    reserveTokens: 4000,      // headroom before triggering compaction
    keepRecentTokens: 8000,   // recent tokens kept unsummarized
    customInstructions: "Prioritize code changes and errors.",
  },
});
```

Compaction events fire on handlers:
- `onCompactionStart(reason)` — `"manual"`, `"threshold"`, or `"overflow"`
- `onCompactionEnd(reason, result, aborted, willRetry, errorMessage?)`

Reference: `pi-agent.ts:198-206, 420-424`

---

## 12. Long-term memory (Mem0)

Integrate semantic memory so the agent can remember conversations across sessions:

```typescript
import { Mem0 } from "./mem0";

const agent = new PiAgent({
  model: "...",
  mem0Config: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    llmModel: "claude-sonnet-4-6",
    embedProvider: "openai",          // or "ollama"
    embedModel: "text-embedding-3-small",
    embedDims: 1536,
    historyDbPath: "./data/mem0.db",
    qdrantUrl: "http://localhost:6333",
    collectionName: "agent-memories",
  },
});

// After each chat(), memories are extracted and stored automatically
// (fire-and-forget, logged on error)

// Manual memory operations:
const mem0 = agent.getMem0();
if (mem0) {
  await mem0.add([{ role: "user", content: "Important fact" }]);
  const results = await mem0.search("Important fact", { topK: 5 });
  const all = await mem0.getAll({ userId: "user-123" });
}
```

Reference: `pi-agent.ts:245-252, 569-574, 576-593`, `mem0.ts`

---

## 13. Session loading and introspection

### Load a saved session

```typescript
const agent = new PiAgent({ model: "...", sessionMode: "memory" });

// Replace current session with a .jsonl file
await agent.loadSession("/path/to/session.jsonl");
// Optionally override cwd
await agent.loadSession("/path/to/session.jsonl", "/custom/playground");
```

### Introspection

```typescript
const agent = new PiAgent({ model: "..." });

await agent.chat("Hello");

// Messages
const messages = await agent.getMessages();
const session = agent.getCurrentSession();

// Stats
agent.getContextUsage();     // token usage details
agent.getSessionStats();     // total tokens, cost, turn count

// Config
agent.getConfig();           // { model, hasApiKey, systemPromptSuffix, ... }
agent.isApiReady();          // true if API key available (Anthropic only; always true for others)
```

Reference: `pi-agent.ts:476-500, 595-601`

---

## 14. Runtime integration (Express/SSE)

The `runtime/` directory shows a production pattern for serving PiAgent over HTTP:

```
POST /runtime/run        → new PiAgent(config), returns sessionId
POST /runtime/chat/:id   → SSE stream with agent.chat(message, eventCB)
POST /runtime/chat/:id/tool-approve  → approve pending tool call
POST /runtime/chat/:id/tool-reject   → reject pending tool call
POST /runtime/agents/:id/abort       → session.abort()
GET  /runtime/agents/:id/config      → { config, tools }
GET  /runtime/agents/:id/messages    → conversation history
GET  /runtime/agents/:id/stats       → { contextUsage, sessionStats }
DELETE /runtime/agents/:id           → remove from memory
```

Key pattern: `handleEventWithClient()` converts agent events to JSON SSE messages:
```typescript
agent.chat(message, (event) => {
  handleEventWithClient(event, send);  // send = res.write(`data: ${JSON.stringify(payload)}\n\n`)
});
```

Agents are stored in `Map<string, PiAgent>` keyed by sessionId (`runtime/state.ts:13`).

Reference: `runtime/server.ts`, `runtime/routes/agent.ts`, `runtime/state.ts`, `pi-agent-utils.ts:8-38`

---

## 15. Error handling patterns

```typescript
try {
  await agent.execute("Query", handleEvent);
} catch (err) {
  // Stream errors (API failures, rate limits) are thrown
  // Tool execution errors are captured in onToolEnd(..., isError=true)
  console.error(err.message);
}
```

The built-in tool `execute` wrapper catches errors and returns them as `{ isError: true }` rather than throwing, so the LLM can respond to tool failures. Stream-level errors (e.g., API quota exceeded) are thrown from `execute()`/`chat()`.

Reference: `pi-agent.ts:287-305`

---

## 16. Conventions to follow

| Convention | Example |
|---|---|
| Model format: `"provider/model-name"` | `"anthropic/claude-sonnet-4-5"` |
| TypeBox for tool parameter schemas | `Type.Object({ query: Type.String() })` |
| Tool results: `{ content: any[], details?: any }` | `{ content: [{ type: "text", text: "..." }], details: { count: N } }` |
| Tool errors: return `{ isError: true }`, don't throw | `pi-agent.ts:300-304` |
| Event callbacks: optional chaining (`?.`) | `h.onTextDelta?.(delta, idx, msg)` |
| Skills: `{ name: string, content: string }` with YAML frontmatter | `tests/test-pi-agent.ts:6-16` |
| Sessions: `chat()` for persistent, `execute()` for one-shot | `pi-agent.ts:518-584` |

---

## 17. Dependencies

| Package | Role |
|---|---|
| `@mariozechner/pi-coding-agent` | Core SDK (`createAgentSession`, `SessionManager`, `AuthStorage`, etc.) |
| `@mariozechner/pi-ai` | Model definitions (`getModel`, `Model`, providers) |
| `typebox` | Runtime type system for tool parameter schemas |
| `@modelcontextprotocol/sdk` | MCP client (Streamable HTTP transport) |
| `mem0ai/oss` | Long-term memory (LLM extraction + vector search) |
| `express`, `cors` | Runtime server (in `runtime/` only) |

---

## 18. Testing

Test files in `tests/`:

| File | What it covers |
|---|---|
| `test-pi-agent.ts` | Basic execute, skills, system prompt |
| `test-pi-agent-2.ts` | Handlers, PR review, conversation, compaction, session modes |
| `test-custom-tools.ts` | Tool registration, dynamic add/remove, execution |
| `test-tool-execution.ts` | Tool execution lifecycle |

Run with:
```bash
npx tsx tests/test-pi-agent.ts basic
npx tsx tests/test-pi-agent-2.ts pr
```

---

## 19. Suggested entry point

**Start at `pi-agent.ts:218-260` (the constructor)** — it initializes every subsystem (auth, model, resource loader, Mem0, tool registration) and is the best single place to understand how all pieces connect.

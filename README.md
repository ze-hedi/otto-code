# Otto Code

> **v0 — API is not stable yet.** This project is in early development. Class
> shapes, config fields, event names, and module layout WILL change without
> notice. Pin to an exact commit if you depend on it, and expect breakage on
> upgrades.

A TypeScript wrapper around the [Pi coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
SDK. Otto Code provides class-based agents (`PiAgent`), a parallel
orchestrator (`PiOrchestrator`), a raw/no-tools agent factory
(`createRawAgent`), and an Express runtime server that exposes agents to a
React frontend over SSE.

---

## Status

| Surface                 | Stability                                  |
| ----------------------- | ------------------------------------------ |
| `PiAgent` constructor   | v0 — fields will be renamed/removed        |
| `PiAgentEventHandlers`  | v0 — event names and signatures may change |
| `PiOrchestrator`        | v0 — experimental, behavior may shift      |
| Runtime REST API        | v0 — endpoints and payloads will change    |
| Built-in tool semantics | inherited from Pi SDK, follow upstream     |

No semver guarantees yet. There is no `1.0.0` release.

---

## Install

```bash
npm install
npx pi /login   # store an Anthropic API key in Pi's auth storage
```

Or pass the key at runtime:

```ts
const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

A `.env.example` is included. Copy it to `.env` and fill in
`ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`).

---

## Quick start

```ts
import { PiAgent } from "./pi-agent";

const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  thinkingLevel: "medium",
  sessionMode: "memory",
});

await agent.execute("List all TypeScript files in this directory", (event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "tool_execution_start") {
    console.error(`\n[${event.toolName}]`);
  }
});
```

See `quick-start.ts` for a working PR-review example.

---

## Core API (subject to change)

### `PiAgent`

- `new PiAgent(config: PiAgentConfig)` — construct.
- `execute(prompt, onEvent?)` — run a one-shot prompt and await completion.
- `chat(message, onEvent?)` — run on a persistent session (preserves history).
- `query(prompt, onEvent?)` — start a run and return the `AgentSession` without
  awaiting `agent_end`.
- `addTool / removeTool / hasTool / getRegisteredTools` — manage custom tools
  at runtime.
- `getCurrentSession()` — currently active `AgentSession` (or `null`).

### `PiAgentConfig` (selected fields)

| Field                | Type                                              | Notes                                                |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `model`              | `"provider/model-name"`                           | Required.                                            |
| `systemPromptSuffix` | `string`                                          | Appended to Pi's default system prompt.              |
| `thinkingLevel`      | `"off" \| "low" \| "medium" \| "high" \| "xhigh"` | Defaults to `"medium"`.                              |
| `apiKey`             | `string`                                          | Overrides Pi's stored auth at runtime.               |
| `sessionMode`        | `"memory" \| "disk" \| "continue"`                | Persistence behavior.                                |
| `workingDir`         | `string`                                          | Where disk sessions are stored.                      |
| `playground`         | `string`                                          | Agent's CWD for `bash` / file tools.                 |
| `skills`             | `SkillInput[]`                                    | Inject markdown skills into the session.             |
| `handlers`           | `PiAgentEventHandlers`                            | Structured per-event callbacks; see `pi-agent.ts`.   |
| `tools`              | `ToolInput[]`                                     | Custom tools (TypeBox schemas).                      |
| `onToolExecute`      | `(id, name, params, signal) => Promise<...>`      | Handler for custom tool calls.                       |

### Built-in tools

`bash`, `read`, `write`, `edit` — provided by the Pi SDK. Strip them with
`createRawAgent({ ... })` from `raw-agent.ts` if you only want custom tools
(or none at all).

### `PiOrchestrator`

Lightweight router that registers named sub-agents and exposes a single
`delegate` tool to a top-level agent. Sub-agents run in parallel via
`Promise.all`. See `pi-orchestrator.ts`.

### Events

`PiAgentEventHandlers` exposes granular callbacks: `onAgentStart` /
`onAgentEnd`, `onTurnStart` / `onTurnEnd`, message and thinking deltas, tool
lifecycle (`onToolStart` / `onToolUpdate` / `onToolEnd`), session
compaction, retries, and a catch-all `onEvent`. The full list lives in
`pi-agent.ts`.

---

## Runtime server

`runtime/server.ts` is an Express server that wraps `PiAgent` instances for
the React frontend in `frontend/react-app/`. It exposes:

- `POST /runtime/run` — instantiate an agent.
- `POST /runtime/chat/:id` — send a message, response streams over SSE.
- `GET  /runtime/status` — list active agents.
- `GET  /runtime/logs[/:id]` — retrieve captured event logs.
- `DELETE /runtime/agents/:id` — drop an agent from memory.

Start it:

```bash
cd runtime
npm install
npm start    # defaults to PORT=5000
```

CORS is wide open and there's no auth — local/trusted networks only.
Full details and request/response shapes are in `runtime/runtime_details.md`
(also expect changes).

---

## Repository layout

```
.
├── pi-agent.ts            # PiAgent class + event handler interfaces
├── pi-orchestrator.ts     # PiOrchestrator (parallel sub-agent delegation)
├── raw-agent.ts           # createRawAgent factory (no built-in tools)
├── pi-agent-utils.ts      # shared helpers (event printing, etc.)
├── mem0.ts                # mem0ai integration (experimental)
├── quick-start.ts         # minimal PR-review example
├── examples/              # custom-tools.ts and more
├── tests/                 # ad-hoc tsx test scripts
├── runtime/               # Express server bridging PiAgent <-> frontend
├── frontend/              # React app + workflow UI
├── database/              # MongoDB models + seed scripts
└── otto_settings.json     # local config
```

---

## Examples

```bash
npm run example:basic
npm run example:pr
npm run example:conversation
npm run example:logging
npm run example:nonblocking
```

Each script reads the same `examples.ts` entry and selects a scenario. If
the Anthropic API quota is exhausted, the agent will return a 400 — see
`result.txt` for a mock of what successful runs look like.

---

## Type checking and tests

```bash
npm run build       # tsc --noEmit
npm run typecheck   # same
npm test            # tsx test-simple.ts
```

A local-only GitHub Actions workflow lives at `.github/workflows/` and is
intended to run via [`act`](https://github.com/nektos/act), not on GitHub's
runners — it would otherwise consume your API quota.

---

## License

MIT.

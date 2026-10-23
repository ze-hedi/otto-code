---
title: PiAgent
sources:
  - agents/pi-agent.ts
---

# PiAgent

## Purpose

`PiAgent` is the core wrapper around the Pi coding agent SDK (`@mariozechner/pi-coding-agent`). It turns a declarative `PiAgentConfig` into a runnable agent: it resolves the model, manages sessions (including multiple parallel sessions), registers tools and MCP servers, enforces tool-approval guardrails, and exposes `chat()` / `execute()` for running the agent.

## How it works

1. The constructor splits the `model` string on `/` into provider and model name, validates both, and resolves the model via `getModel`. It sets up `AuthStorage` and `ModelRegistry`, and applies defaults (thinking level `medium`, built-in tools `read/bash/edit/write`, MCP timeout 5000 ms).
2. Tools from config, workflow interfaces, and connected MCP servers are converted to `ToolDefinition`s and stored in `toolDefinitions`.
3. The first `chat()` / `execute()` call creates a session through `_createSessionWith`, which builds a `DefaultResourceLoader` scoped to `playground`, filters parent `AGENTS.md` files, and injects the system prompt, suffix, and skills.
4. `chat()` reuses the active session (continuous conversation); `execute()` always creates a fresh session. Both subscribe to the session to catch stream errors and forward events to an optional callback.

## Key code

- `agents/pi-agent.ts`
  - `PiAgent` — the wrapper class; constructor and public API.
  - `_createToolDefinition` / `_createMcpToolDefinition` / `_parseMcpDescription` — convert `ToolInput`s and MCP tools into SDK tool definitions. `_parseMcpDescription` reads an optional `---pi-agent---` block (`snippet` + `guidelines`) embedded in an MCP tool description.
  - `_createSessionWith` — builds the resource loader and settings, then calls the SDK's `createAgentSession`.
  - `connectMcp` / `connectAllMcp` / `disconnectMcp` / `_disconnectServer` — MCP lifecycle and tool registration.
  - `chat` / `execute` / `abort` / `getMessages` — running the agent.
  - `getSession` / `createNewSession` / `loadSession` / `listSessions` — multi-session management.
  - `registerTool` / `unregisterTool` / `createSubAgentTool` — runtime tool management.
  - `onToolApprovalRequired` / `approveToolCall` / `rejectToolCall` — the tool-approval guardrail API.

## Data & config

- Sessions are persisted as JSONL files under `<playground>/.otto-sessions/`. With `workflowId` set, they go to `.otto-sessions/workflow-<workflowId>/`, and with `workflowSessionId` also set, one level deeper.
- Reads proxy settings through `EnvHttpProxyAgent` (the `HTTP_PROXY` / `HTTPS_PROXY` / `no_proxy` environment variables).
- The API key comes from config or the provider's auth storage; otherwise no key is set.
- See [Config & types](config-and-types.md) for the full `PiAgentConfig` surface.

## Gotchas

- MCP tools are registered on the agent, but existing sessions do not pick them up — a new session is required after connecting.
- Key-less calls (`chat(message)`, `getSession()`) resolve to the session under `"main"`. Other sessions must be addressed by key and created with `createNewSession` first.
- Tool-approval guardrails are agent-level, not session-level: the code warns against running guarded sessions concurrently.
- The `_createPersistentSubAgentTool` method here duplicates the one in [sub-agent-pattern](sub-agents.md) and [raw-pi-agent](raw-pi-agent.md).

## Related

- [Config & types](config-and-types.md) — the `PiAgentConfig` and `ToolInput` shapes used here.
- [RawPiAgent](raw-pi-agent.md) — the subclass that overrides system-prompt behaviour.
- [MCP bridge](mcp-bridge.md) — the client used by `connectMcp`.
- [Event handling](event-handling.md) — how `AgentSessionEvent`s are rendered.

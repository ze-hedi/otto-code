---
title: MCP bridge
sources:
  - agents/mcp-bridge.ts
---

# MCP bridge

## Purpose

`mcp-bridge.ts` is a thin wrapper around the Model Context Protocol SDK client. It connects to an MCP gateway over Streamable HTTP, lists the available tools, and exposes a simple `callTool` interface. It is the lowest level of MCP access in the codebase.

## How it works

1. `createMcpBridge(endpoint, timeoutMs)` creates a `StreamableHTTPClientTransport` from the endpoint URL and a `Client` named `pi-agent`.
2. It connects with an abort timeout (default 5000 ms), then calls `client.listTools()`.
3. It normalizes each tool into an `McpToolEntry` (`name`, `description`, `inputSchema`) and returns a `McpBridge` with `tools`, `callTool(name, args)`, and `close()`.

## Key code

- `agents/mcp-bridge.ts`
  - `createMcpBridge` — the factory that connects and lists tools.
  - `McpBridge` — the returned handle (`tools`, `callTool`, `close`).
  - `McpToolEntry` — a normalized tool description.

## Data & config

- `endpoint` — the MCP gateway URL (e.g. `http://localhost:3100`).
- `timeoutMs` — connection timeout, default 5000 ms.

## Gotchas

- This wrapper does not register tools with any agent; that is the job of `PiAgent.connectMcp`, which uses this module.
- `callTool` casts the MCP result content to `any[]`; no result validation happens here.

## Related

- [PiAgent](pi-agent.md) — registers MCP tools into agent sessions.
- [Swarm](swarm.md) — uses an MCP bridge for its task manager.

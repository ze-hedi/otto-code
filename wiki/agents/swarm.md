---
title: Swarm
sources:
  - agents/swarm.ts
---

# Swarm

## Purpose

`Swarm` is a high-level orchestration pattern: a coordinator agent clarifies the user's request, synthesizes a goal, runs a team `Meeting` with specialist agents, and then plans concrete tasks into an MCP-backed task manager. It ties together the coordinator, specialists, meeting, and MCP bridge.

## How it works

1. **Phase 0 — setup.** `run` connects to the MCP task manager at `http://localhost:3100` and creates a project.
2. **Phase 1 — clarification + synthesis.** The coordinator registers `clarification_tool` (asks the user questions via stdin) and `synthesize_goal` (captures the goal paragraph), then chats with the user input.
3. **Phase 2 — meeting.** A `Meeting` is run with the coordinator plus all specialists, using the synthesized goal. The transcript is captured.
4. **Phase 3 — task planning.** The coordinator gets a fresh session, registers the MCP task tools (`add_task`, `get_tasks`, `update_task`, `get_project`), and is prompted to iteratively break the goal into tasks across three rounds.
5. Cleanup unregisters the phase-1/phase-3 tools and closes the MCP bridge.

## Key code

- `agents/swarm.ts`
  - `Swarm` — the orchestrator class and its `run` method.
  - `_buildCoordinatorPrompt` — lists specialists and describes the two-phase coordinator job.
  - `_buildCoordinatorTools` — project-level task tools for the coordinator.
  - `_buildAgentTools` — per-specialist task tools (`get_my_tasks`, `update_my_task`, `add_subtask`).
  - `ask` — stdin prompt helper for clarifications.

## Data & config

- MCP endpoint is hardcoded to `http://localhost:3100`.
- The coordinator defaults to model `deepseek/deepseek-v4-pro` with no built-in tools and `sessionMode: "memory"`; a custom `coordinatorConfig` can override this.
- Session keys are random UUIDs (`swarm-…`, `tasks-…`).

## Gotchas

- The task-manager MCP endpoint is hardcoded and not configurable.
- `createProject` parses the first content item as JSON; if the MCP returns a non-JSON string this throws.
- The MCP tools inject `project_id` (and, for specialist tools, `responsible_agent`) automatically before delegating to the bridge.
- `clarification_tool` and `synthesize_goal` are unregistered after phase 1, so they are not available during the meeting or task planning.

## Related

- [Meeting](meeting.md) — used in phase 2.
- [MCP bridge](mcp-bridge.md) — used to reach the task manager.
- [RawPiAgent](raw-pi-agent.md) — the coordinator and specialists are `RawPiAgent`s.
- [Config & types](config-and-types.md) — `RawPiAgentConfig` and `ToolInput`.

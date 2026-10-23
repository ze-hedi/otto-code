---
title: Workflow
sources:
  - agents/workflow.ts
  - agents/workflow-interface.ts
  - agents/workflow-types.ts
---

# Workflow

## Purpose

The workflow engine orchestrates multiple agents as a directed acyclic graph (DAG). Agent nodes do the work; "interface" nodes sit between agents and define how one agent's output is handed to the next — delegate (one→many), forward (one→one), accumulate (many→one), or route (one→many but pick one). A topological sort decides the execution order.

## How it works

1. A `Workflow` is constructed from a `workflowRecord` with `components` (nodes) and `connections` (edges), plus an `AgentsStorage` of agent configs and an `InterfaceStorage` of interfaces.
2. `buildExecutionQueue` runs Kahn's algorithm: it computes in-degrees, groups nodes into levels, and throws on a cycle. It keeps only agent nodes in the runnable levels, then calls `buildWorfklowAgents`.
3. `buildWorfklowAgents` instantiates one `RawPiAgent` per agent node. For each successor interface it appends the interface's input prompt suffix, and for each predecessor interface it appends the output prompt suffix. It also wraps the interface tool's `execute` so that calling it records the agent's output on the interface via `addResult`. If `guardrailsOnInterfaces` is set, interface tools become approval-guarded.
4. `run(lvl_1_inputs)` feeds one input per first-level agent, then for each later level runs agents in parallel (`Promise.all`), pulling the predecessor interface's recorded results and formatting them as `[agentId]: response`.

## Key code

- `agents/workflow-types.ts`
  - `AgentsStorage` / `InterfaceStorage` — lookup maps for agent configs and interfaces.
  - `NodeType` (`agent` | `interface`), `WorkflowNode`, `WorkflowEdge`, `WorkflowComponent`, `WorkflowConnection`, `WorkflowSchema`.
  - `ExecutionQueueResult` — the runnable `levels` plus `predecessors` / `successors`.
- `agents/workflow-interface.ts`
  - `AgentInterface` — base class holding prompt suffixes, the successor tool, input/output name pairs, and the accumulated `predResults`.
  - `DelegationInterface` — one→many; the agent delegates to a chosen subset of downstream agents (`tasks[]` schema).
  - `ForwardInterface` — one→one; forwards a single `result` to the next agent.
  - `AccumulateInterface` — many→one; aggregates several agents' results (`results[]` schema).
  - `RouteInterface` — one→many but activates exactly one downstream agent (`route` + `result` schema).
- `agents/workflow.ts`
  - `Workflow` — parses the graph and coordinates execution.
  - `buildExecutionQueue` — Kahn's algorithm + agent-level filtering.
  - `buildWorfklowAgents` — instantiates agents and wires interfaces.
  - `run` — executes the graph level by level.
  - `compileGraph` — a separate validation method (see Gotchas).

## Data & config

- Input is a `workflowRecord` whose `components` are `{ id, type, x, y }` and `connections` are `{ from, fromSide, to, toSide }` (a React Flow-style schema).
- `workflowId` / `workflowSessionId` (passed to `buildExecutionQueue` / `buildWorfklowAgents`) control where agent session files are written under `.otto-sessions/`.
- Agent configs come from `AgentsStorage`; interface objects come from `InterfaceStorage`.

## Gotchas

- The `compileGraph()` method appears to have inverted logic: it throws "invalid workflow" when an agent's successor **is** an interface (the opposite of what the message suggests). It is also not called automatically — `buildExecutionQueue` does not invoke it.
- The method name `buildWorfklowAgents` contains a typo ("worfklow").
- Interfaces record results by wrapping the interface tool's `execute`; if the agent never calls the interface tool, the downstream agent is skipped ("no results on predecessor interface").
- Level-1 agent count must exactly match the number of `lvl_1_inputs`, or `run` throws.

## Related

- [RawPiAgent](raw-pi-agent.md) — the agent type each node instantiates.
- [Config & types](config-and-types.md) — `RawPiAgentConfig` and `interfaceTools`.
- [PiAgent](pi-agent.md) — provides the tool guardrails used by `guardrailsOnInterfaces`.

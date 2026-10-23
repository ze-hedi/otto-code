# Design — impact study, decisions, risks

base_commit: b5deab45812c1c01392113655d1af2153dbc17e4

## 1. Current state

14 files sit directly under `agents/`. This document records (a) the target
grouping, (b) the internal import graph, (c) the external blast radius, and
(d) the design decisions and risks. It is the "impact study" requested for this
feature.

## 2. Target structure

| Subfolder       | Files (moved from `agents/`) |
|-----------------|------------------------------|
| `core/`         | pi-agent.ts, raw-pi-agent.ts, pi-agent-configs.ts, pi-agent-types.ts, pi-agent-utils.ts, sub-agent-pattern.ts |
| `workflow/`     | workflow.ts, workflow-interface.ts, workflow-types.ts |
| `orchestration/`| meeting.ts, swarm.ts |
| `integrations/` | mcp-bridge.ts, jev-agent.ts, jev-agent-configs.ts |

## 3. Internal import graph (why the children are split this way)

Source file → local modules it imports (`.js` extension omitted here):

| Source | Imports (local) |
|--------|-----------------|
| jev-agent-configs.ts | — |
| jev-agent.ts | jev-agent-configs |
| mcp-bridge.ts | — |
| meeting.ts | pi-agent-types, raw-pi-agent |
| pi-agent-configs.ts | pi-agent-types, workflow-interface |
| pi-agent.ts | mcp-bridge (static + dynamic), pi-agent-configs, pi-agent-types, sub-agent-pattern, workflow-interface |
| pi-agent-types.ts | — |
| pi-agent-utils.ts | — |
| raw-pi-agent.ts | pi-agent, pi-agent-configs, pi-agent-types, sub-agent-pattern |
| sub-agent-pattern.ts | pi-agent, pi-agent-types, pi-agent-utils, raw-pi-agent |
| swarm.ts | mcp-bridge, meeting, pi-agent-configs, pi-agent-types, raw-pi-agent |
| workflow-interface.ts | pi-agent-types |
| workflow.ts | raw-pi-agent, pi-agent-configs, pi-agent-types, pi-agent-utils, workflow-interface, workflow-types |
| workflow-types.ts | pi-agent-configs, workflow-interface |

**Key finding — `core` and `workflow` are mutually dependent:**
- `core → workflow`: `pi-agent.ts` imports `AgentInterface` from `workflow-interface` (value import, line 32); `pi-agent-configs.ts` imports `AgentInterface` from `workflow-interface` (type import, line 1).
- `workflow → core`: `workflow.ts` imports `raw-pi-agent`/`pi-agent-configs`/`pi-agent-types`/`pi-agent-utils`; `workflow-interface.ts` imports `pi-agent-types`; `workflow-types.ts` imports `pi-agent-configs` and `workflow-interface`.

Because of this cycle, `core` and `workflow` are moved **together** (child `001.2`).
`integrations` is standalone (no internal deps) → moved first (`001.1`).
`orchestration` depends on `core` and `integrations` → moved last (`001.3`).

Also note the pre-existing runtime cycle `pi-agent → sub-agent-pattern → raw-pi-agent → pi-agent` (preserved, not fixed).

## 4. External impact (blast radius)

Every non-`agents/` file that imports the moved files. These must be re-pointed.

### web_app/backend (5 files)
| File | Imports from `agents/` |
|------|------------------------|
| src/routes/agents.ts | pi-agent-utils (`handleEventWithClient`) |
| src/routes/workflows.ts | workflow-types (`AgentsStorage`, `InterfaceStorage`, `WorkflowSchema`), workflow (`Workflow`), pi-agent-utils (`handleEventWithClient`) |
| src/services/agent-manager.ts | raw-pi-agent (`RawPiAgent`), pi-agent-configs (`RawPiAgentConfig`, `ToolInput`) |
| src/services/workflow-manager.ts | workflow-types (`AgentsStorage`, `InterfaceStorage`, `NodeType`, `WorkflowSchema`), pi-agent-configs (`RawPiAgentConfig`), pi-agent-types (`ToolInput`), workflow-interface (`AgentInterface`, `ParamDescriptions`, `DelegationInterface`, `ForwardInterface`, `AccumulateInterface`, `RouteInterface`), workflow (`Workflow`) |

### memory (1 file)
| File | Imports |
|------|---------|
| memory/extractor_agent.ts | raw-pi-agent (`RawPiAgent`), pi-agent-types (`ToolInput`) |

### tests (8 files)
test-pi-agent.ts, test-pi-agent-2.ts, test-pi-agent-mcp.ts, test-tool-execution.ts,
test-task-manager-mcp.ts, test-mem0-worker.ts, test-custom-tools.ts,
test-tools-and-builtins.ts — import `PiAgent` (pi-agent), `RawPiAgent` (raw-pi-agent),
`RawPiAgentConfig` (pi-agent-configs), `handleEvent` (pi-agent-utils), `ToolInput`.

### examples (~19 files)
- Top-level: arxiv_mcp_server_test.ts, swarm-test.ts, explorer.ts, dashboard-planner.ts, planner.ts, raw-agent-with-volatile-subagents.ts, orchestrator.ts, web-researcher.ts, cv-analyser.ts, persistant-sub-agent.ts, pi_agent_with_terminate_tool.ts, workflow-test.ts, workflow-interface-test.ts, coding-team.ts, custom-tools.ts, worker.ts, meeting-test.ts.
- `examples/coding_team/OttoCode_V1.ts` uses `../../agents/...`; `scrum-tool.ts` has only a commented-out import.

They import from `pi-agent`, `raw-pi-agent`, `pi-agent-configs`, `pi-agent-types`,
`pi-agent-utils`, `sub-agent-pattern`, `workflow`, `workflow-types`,
`workflow-interface`, `meeting`, `swarm`.

### quick-start.ts (1 file)
`import { PiAgent } from "./agents/pi-agent";`

### Config
- `web_app/backend/tsconfig.json` defines a dead `@agents/*` alias (removed per R5) and `include: ["src/**/*.ts", "../../agents/**/*.ts"]`. The `**` already matches subfolders, so `include` stays as-is.

### Not affected (verified)
- No Python imports, no dynamic `import()`/`require()`/file-glob loading outside `agents/`.
- `web_app/frontend/**` and `tui/**` references to `/agents/...` are REST URLs, not file imports.
- `jev-agent` / `jev-agent-configs` have **no importers anywhere** (only `jev-agent → jev-agent-configs`); moving them is low-impact but they are kept.

## 5. Design decisions

- D1: Four subfolders as in §2 (user-approved).
- D2: Direct relative imports, no barrel `index.ts`, drop the dead `@agents/*` alias (user-approved).
- D3: Pure mechanical move — preserve pre-existing type errors and broken re-exports; fix those separately (user-approved).
- D4: Migration order = integrations → (core + workflow) → orchestration, dictated by the import graph in §3.

## 6. Risks

- `core ↔ workflow` cycle (see §3) forces those two groups into one child (`001.2`).
- Pre-existing type errors mean the pass bar is "no NEW errors + zero module-resolution errors", **not** "typecheck passes".
- Double-churn: files that move later have their imports re-pointed in an earlier child, then again when they move (e.g. `swarm.ts → mcp-bridge` is updated in `001.1` and again in `001.3`). Intermediate states must remain module-resolvable after each child.
- Broken re-exports (`pi-agent-configs` does not re-export `ToolInput`/`SubAgentToolConfig`/`PersistantSubAgentToolConfig`, but several files import them from it) are pre-existing and preserved.
- Import-extension inconsistency (`.js` vs none) — do not normalize during this move.

## 7. Baseline (pre-existing tsc errors — must not change)

- Root `npx tsc --noEmit`: **17** errors → TS2322 ×8, TS2564 ×6, TS7006 ×1, TS2353 ×1, TS2345 ×1.
- Backend `cd web_app/backend && npx tsc --noEmit`: **25** errors → TS2322 ×11, TS2564 ×7, TS7006 ×3, TS2353 ×3, TS2459 ×1.
- Zero "Cannot find module" / "is not a module" errors in both.

Because error messages include file paths (which change after a move), verify by
**error-code multiset + total count + absence of module errors**, not by literal
line equality. Reproduce the baseline with:

```
npx tsc --noEmit 2>&1 | grep -oE 'error TS[0-9]+' | sort | uniq -c
cd web_app/backend && npx tsc --noEmit 2>&1 | grep -oE 'error TS[0-9]+' | sort | uniq -c
```

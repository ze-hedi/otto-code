---
id: "001"
kind: parent
status: draft
version: 1
depends_on: []
children: ["001.1", "001.2", "001.3"]
priority: P2
base_commit: b5deab45812c1c01392113655d1af2153dbc17e4
---

# Goal

Reorganize the 14 top-level files under `agents/` into semantically meaningful
subfolders, and document the impact of that move on the rest of the codebase.
This is a pure refactor: files move and import paths are updated, but no logic
changes, no exported-symbol changes, and no new behavior is added.

# Requirements

- R1: WHEN the reorganization is complete THE SYSTEM SHALL have the 14 `agents/` files organized into four subfolders (`core/`, `workflow/`, `orchestration/`, `integrations/`), with no `.ts` files remaining directly under `agents/`.
- R2: WHEN the reorganization is complete THE SYSTEM SHALL resolve every import statement that points at a moved file to its new location, so that no module-resolution ("Cannot find module") error is introduced anywhere.
- R3: WHEN the reorganization is complete THE SYSTEM SHALL preserve each module's runtime behavior: the set of exported symbols in every file is unchanged, and the only source edits are import-path updates plus file moves.
- R4: WHEN the reorganization is complete THE SYSTEM SHALL keep the set of pre-existing TypeScript errors unchanged in kind and count (17 at repo root, 25 in `web_app/backend`), introducing no new errors and fixing none.
- R5: WHEN the reorganization is complete THE SYSTEM SHALL have the unused `@agents/*` path alias removed from `web_app/backend/tsconfig.json`.

# Acceptance criteria

- A1 (R1): Given the reorg is done, When I list `agents/`, Then it contains exactly `core/`, `workflow/`, `orchestration/`, `integrations/` and no `.ts` files, with files distributed 6 / 3 / 2 / 3 as defined in `design.md` §2.
- A2 (R2): Given the reorg is done, When I run the root and backend typechecks, Then neither output contains "Cannot find module" or "is not a module".
- A3 (R3): Given the reorg is done, When I run `git diff --find-renames HEAD`, Then the diff shows only file renames and import-path line changes, and no `export` statement is added, removed, or renamed.
- A4 (R4): Given the reorg is done, When I count the typecheck errors by code, Then the multiset of error codes and totals match the baseline in `design.md` §7 (root 17, backend 25), and there are zero module-resolution errors.
- A5 (R5): Given the reorg is done, When I read `web_app/backend/tsconfig.json`, Then it contains no `paths` / `@agents/*` entry.

# Out of scope

- Fixing the pre-existing TypeScript errors (17 root / 25 backend).
- Fixing the broken re-exports: several files import `ToolInput`, `SubAgentToolConfig`, `PersistantSubAgentToolConfig` from `pi-agent-configs`, which does not re-export them.
- Deleting the apparently-unused `jev-agent` / `jev-agent-configs` files (they are only moved, not removed).
- Updating documentation (`docs/`, `wiki/`) that references `agents/` paths.
- Editing `.claude/worktrees/env_2/` (a duplicate git worktree copy).
- Normalizing import extensions (`.js` vs none) or the pre-existing `pi-agent → sub-agent-pattern → raw-pi-agent → pi-agent` runtime cycle.

# Constraints

- Pure mechanical move: no behavior, export, or logic changes.
- No new dependencies.
- Keep each file's existing import-extension convention (some imports use `.js`, some don't).

# Children

- `001.1` — move `integrations/` (mcp-bridge, jev-agent, jev-agent-configs). No dependencies.
- `001.2` — move `core/` + `workflow/` (9 files) together, because they are mutually dependent. Depends on `001.1`.
- `001.3` — move `orchestration/` (meeting, swarm). Depends on `001.1` and `001.2`.

Full target structure, impact study, design decisions and risks are in `design.md`.
Feature-level checks are in `verify.md`.

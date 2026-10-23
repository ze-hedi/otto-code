# Verify — feature-level checks (run after all children are done)

No new tests (pure refactor). Run these commands; each must pass.

1. Structure — no `.ts` directly under `agents/`, four subfolders present:
   ```
   find agents -maxdepth 1 -type f          # → empty
   ls -d agents/core agents/workflow agents/orchestration agents/integrations   # → all four exist
   ```

2. No stale import paths:
   ```
   grep -rnE "agents/(pi-agent|raw-pi-agent|pi-agent-configs|pi-agent-types|pi-agent-utils|sub-agent-pattern|workflow|workflow-interface|workflow-types|meeting|swarm|mcp-bridge|jev-agent|jev-agent-configs)(\.js|\.ts)?" --include="*.ts" . | grep -v node_modules | grep -v '/.claude/'
   ```
   → empty.

3. Typecheck error set unchanged (R2, R4):
   ```
   npx tsc --noEmit 2>&1 | grep -oE 'error TS[0-9]+' | sort | uniq -c
   # → TS2322 ×8, TS2564 ×6, TS7006 ×1, TS2353 ×1, TS2345 ×1  (17 total)
   cd web_app/backend && npx tsc --noEmit 2>&1 | grep -oE 'error TS[0-9]+' | sort | uniq -c
   # → TS2322 ×11, TS2564 ×7, TS7006 ×3, TS2353 ×3, TS2459 ×1  (25 total)
   ```
   Both must contain zero "Cannot find module" / "is not a module" lines.

4. No behavior change (R3):
   ```
   git diff --find-renames HEAD --stat
   ```
   → only renames + import-line edits; `git diff --find-renames HEAD` shows no
   added/removed `export` statements and no non-import content changes.

5. Dead alias removed (R5):
   ```
   grep -n "@agents" web_app/backend/tsconfig.json   # → no match
   ```

---
title: Dashboards & sleeping
sources:
  - web_app/frontend/src/pages/DashboardsPage.tsx
  - web_app/frontend/src/pages/DashboardDetailPage.tsx
  - web_app/frontend/src/pages/SleepingModePage.tsx
---

# Dashboards & sleeping

## Purpose

These pages expose two read-oriented features. The dashboard pages show plans and tasks that agents have produced (via the project-dashboard MCP tool). The sleeping-mode page distills finished session histories into long-term memories stored in Qdrant.

## How it works

1. `DashboardsPage` fetches `/dashboards` and shows one card per dashboard, summarizing task counts by state and the active plan.
2. `DashboardDetailPage` fetches `/dashboards/:id` and lays tasks out in columns (in work, opened, blocked, closed), with plans sorted active → draft → archived.
3. `SleepingModePage` fetches `/sleeping/:projectId/sessions` to list agent and workflow sessions. Each has "Show" (fetch `/sleeping/:projectId/memories`) and "Distill" (POST `/sleeping/:projectId/distill`) actions.

## Key code

- `web_app/frontend/src/pages/DashboardsPage.tsx` — dashboard list. `taskCounts` computes counts per task state; the card shows the active plan (or the last plan) badge.
- `web_app/frontend/src/pages/DashboardDetailPage.tsx` — a single dashboard. Groups tasks by `STATE_ORDER` and sorts plans by status.
- `web_app/frontend/src/pages/SleepingModePage.tsx` — the distillation UI.
  - `fetchMemories` — loads memories for an agent/session pair from `/sleeping/:projectId/memories`.
  - `distillAgent` / `distillWorkflowAgent` — POST a `type` of `agent` or `workflow-agent` to `/sleeping/:projectId/distill`, and show the resulting `memoriesExtracted` / `batchesProcessed`.
  - `parseFilename` — splits a session filename into agent id + session id (mirrors the backend logic, but simpler).

## Data & config

- Backend endpoints: `/dashboards`, `/dashboards/:id`, `/sleeping/:projectId/sessions`, `/sleeping/:projectId/memories`, `/sleeping/:projectId/distill`.
- Dashboard tasks have states `opened` / `in_work` / `blocked` / `closed` and priorities `low` / `medium` / `high`; plans have statuses `draft` / `active` / `archived`.

## Gotchas

- Dashboards are read-only in the UI — they are created and mutated by agents through the MCP tool, not by these pages.
- The frontend `parseFilename` is a simplified copy of the backend's `parseFilename`; the two can disagree for unusual filenames (the frontend just splits on the first dash).
- Distillation is synchronous from the UI's perspective (a single POST that blocks until done), so large sessions take a long time with no progress updates.

## Related

- [Frontend](frontend.md)
- [Backend routes](backend-routes.md)

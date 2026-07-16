// runtime/default-agents.ts
// Previously registered explorer/planner at startup.
// Default agents are now loaded on-demand (e.g. via the orchestrator's delegate tool).

export async function registerDefaultAgents(): Promise<void> {
  // no-op — agents are no longer auto-registered at server startup
}

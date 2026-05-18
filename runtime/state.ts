// runtime/state.ts
// Global runtime state shared across all route modules.

import { PiAgent } from '../pi-agent.js';
import { PiOrchestrator } from '../pi-orchestrator.js';
import type { AgentData } from './types.js';

// ─── Global state ─────────────────────────────────────────────────────────────

// Map of sessionId → PiAgent instance
export const activeAgents = new Map<string, PiAgent>();

// Map of orchestratorId → PiOrchestrator instance
export const activeOrchestrators = new Map<string, PiOrchestrator>();

// Map of orchestratorId → sub-agent metadata (for the UI)
export const orchestratorSubAgents = new Map<string, AgentData[]>();

// Map of sessionId → agentId (so we can look up which agent a session belongs to)
export const sessionAgentMap = new Map<string, string>();

// Map of sessionFile path → sessionId (deduplication of disk sessions)
export const sessionFileMap = new Map<string, string>();

// Reverse lookup: agentId (MongoDB _id) → composite key in activeAgents
export const agentToSessionMap = new Map<string, string>();

// Convenience pointer to the last agent that was run
export let currentAgentId: string | null = null;

export function setCurrentAgentId(id: string | null) {
  currentAgentId = id;
}

// Also exposed on global so other modules/scripts can access it directly
declare global {
  var activeAgent: PiAgent | null;
  var activeAgentId: string | null;
}
global.activeAgent = null;
global.activeAgentId = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a bare model name (e.g. "claude-sonnet-4-6") to the
 * "provider/model-name" format that PiAgent expects.
 * If the model already contains "/" it is returned as-is.
 */
export function resolveModel(model: string): string {
  if (model.includes('/')) return model;
  if (model.startsWith('claude-')) return `anthropic/${model}`;
  if (model.startsWith('gpt-'))    return `openai/${model}`;
  // fallback
  return `anthropic/${model}`;
}

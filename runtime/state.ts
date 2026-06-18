// runtime/state.ts
// Global runtime state shared across all route modules.

import { PiAgent } from '../pi-agent.js';
import type { AgentData } from './types.js';

// ─── Global state ─────────────────────────────────────────────────────────────

// Map of sessionId → PiAgent instance
export const activeAgents = new Map<string, PiAgent>();

// Map of sessionId → agentId (so we can look up which agent a session belongs to)
export const sessionAgentMap = new Map<string, string>();

// Map of sessionFile path → sessionId (deduplication of disk sessions)
export const sessionFileMap = new Map<string, string>();

// Reverse lookup: agentId (MongoDB _id) → composite key in activeAgents
export const agentToSessionMap = new Map<string, string>();

// ─── Workflow session hooks ───────────────────────────────────────────────────

export interface SessionHookContext {
  sessionId: string;
  agentName: string;
  toolName: string;
  args: any;
  result: any;
}

export interface SessionHook {
  /** Tool name to match, or '*' to match all interface tools. */
  toolName: string;
  callback: (ctx: SessionHookContext) => void | Promise<void>;
}

/** Map of session key → registered hooks (same keys as activeAgents). */
export const sessionHooks = new Map<string, SessionHook[]>();

/** Remove all hooks for a session (handles both bare and composite keys). */
export function clearSessionHooks(sessionId: string): void {
  sessionHooks.delete(sessionId);
  for (const key of sessionHooks.keys()) {
    if (key.startsWith(sessionId + '::')) {
      sessionHooks.delete(key);
    }
  }
}

// ─── Workflow session state (tracks compiled actors per session for incremental recompilation) ─

export interface WorkflowSessionState {
  sessionId: string;
  /** Map of node.id → compositeKey for already-compiled actors */
  compiledActors: Map<string, string>;
  /** The successors map from the last compilation (used for hook wiring) */
  successors: Map<string, any[]>;
  /** The predecessors map from the last compilation */
  predecessors: Map<string, any[]>;
}

/** sessionId → WorkflowSessionState */
export const workflowSessions = new Map<string, WorkflowSessionState>();

// ─── Workflow history (in-memory) ────────────────────────────────────────────

export interface WorkflowRecord {
  id: string;             // sessionId
  agents: string[];       // agent/orchestrator names
  createdAt: string;      // ISO timestamp
  lastInteractedAt: string;
}

export const workflowHistory: WorkflowRecord[] = [];

// ─── Workflow event bus (SSE broadcast) ──────────────────────────────────────

import { EventEmitter } from 'events';
export const workflowEvents = new EventEmitter();

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

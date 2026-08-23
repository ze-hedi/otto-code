import type { TSchema } from "typebox";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

// ── Public API types ───────────────────────────────────────────────────────────

export interface SkillInput {
  /** Skill name (used as the file stem and skill identifier) */
  name: string;
  /** Raw markdown content of the skill file */
  content: string;
}

/** Simplified tool input for users of PiAgent wrapper */
export interface ToolInput {
  /** Tool name for LLM calls (e.g., "search_database") */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Description for the LLM to understand when to use this tool */
  description: string;
  /** TypeBox schema for tool parameters */
  parameters?: TSchema;
  /** Optional: One-line snippet for "Available tools" section in system prompt */
  promptSnippet?: string;
  /** Optional: Guidelines appended to system prompt */
  promptGuidelines?: string[];
  /** Optional: Execution mode override */
  executionMode?: "sequential" | "parallel";
  /**equal to true if we want the agent loop to finis */
  terminate ?: boolean ; 
  /** Execute handler for this tool */
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal
  ) => Promise<{ content: any[]; details?: any }>;
}

export interface PersistantSubAgentToolConfig {
  name: string;
  description: string;
  parameters?: TSchema;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface SubAgentToolConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  builtInTools?: string[];
  playground?: string;
  parameters?: TSchema;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

/** Raw event callback — receives the full AgentSessionEvent union. */
export type EventCallback = (event: AgentSessionEvent) => void;

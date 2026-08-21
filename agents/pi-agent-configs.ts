import type { TSchema } from "typebox";
import type {AgentSessionEvent} from "@mariozechner/pi-coding-agent"

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

export interface PiAgentConfig {
  /** Agent name (used for session file naming) */
  name?: string;
  /** Model provider and name, e.g., "anthropic/claude-sonnet-4-5" */
  model: string;
  /** Additional system prompt appended to Pi's default */
  systemPromptSuffix?: string;
  /** Thinking level: "off" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  /** Optional: override API key at runtime */
  apiKey?: string;
  /** Session persistence: "memory" | "disk" | "continue" */
  sessionMode?: "memory" | "disk" | "continue";
  /** Working directory for disk-based sessions */
  workingDir?: string;
  /** Repository/directory the agent will operate in (cwd for file and shell tools) */
  playground?: string;
  /** Skills to inject into the agent session */
  skills?: SkillInput[];
  /** Custom tools to register at construction time */
  tools?: ToolInput[];
  /** Override directory for session persistence (used by SessionManager.create). */
  sessionDir?: string;
  /** Tool names that require user approval before executing (default: [] = no guardrails) */
  toolCallGuardrails?: string[];
  /**
   * MCP server endpoints. Map of server_name → endpoint URL.
   * Call connectMcp(serverName) or connectAllMcp() to discover and register tools.
   * @example { filesystem: "http://localhost:3001/mcp", database: "http://localhost:3002/mcp" }
   */
  mcpServers?: Record<string, string>;
  /** MCP connection timeout in ms (default: 5000). */
  mcpConnectionTimeout?: number;
  /**
   * Which built-in tools the agent is allowed to use.
   * Defaults to ["read", "bash", "edit", "write"] (the SDK default).
   * Pass a subset to restrict (e.g. ["read", "bash", "grep", "ls"] for read-only agents).
   * Pass [] to disable all built-in tools.
   */
  builtInTools?: string[];
  /** Sub-agents exposed as tools. Key is used for lookup, value defines the agent config. */
  subAgents?: Record<string, SubAgentToolConfig>;

  persistantSubAgents ?: Record<string,[RawPiAgentConfig,PersistantSubAgentToolConfig]>
  /** Compaction (context compression) settings */
  compaction?: {
    /** Enable/disable auto-compaction (default: true) */
    enabled?: boolean;
    /** Tokens to reserve as headroom before triggering compaction */
    reserveTokens?: number;
    /** How many recent tokens to keep after compaction (not summarized) */
    keepRecentTokens?: number;
    /** Custom instructions appended to the summarization prompt */
    customInstructions?: string;
  };
}

/** Raw event callback — receives the full AgentSessionEvent union. */
export type EventCallback = (event: AgentSessionEvent) => void;


export type RawPiAgentConfig = Omit<PiAgentConfig, "systemPromptSuffix"> & {
  /** Fully replace Pi's default system prompt. The SDK still appends project
   *  context, skills, date, and cwd after it. */
  systemPrompt?: string;
}& {};
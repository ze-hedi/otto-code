export interface SerializableSubAgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  builtInTools?: string[];
  playground?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface SerializableAgentConfig {
  name?: string;
  description?: string;
  model: string;
  systemPrompt?: string;
  playground?: string;
  workingDir?: string;
  builtInTools?: string[];
  mcpServers?: Record<string, string>;
  mcpConnectionTimeout?: number;
  toolCallGuardrails?: string[];
  clarificationTool?: boolean;
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  subAgents?: Record<string, SerializableSubAgentConfig>;
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
    customInstructions?: string;
  };
}

export interface AgentDocument {
  agent_id: string;
  config: SerializableAgentConfig;
  status: "active" | "stopped";
  created_at: Date;
  updated_at: Date;
}

export interface ProjectDocument {
  project_id: string;
  name: string;
  path: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

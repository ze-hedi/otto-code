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

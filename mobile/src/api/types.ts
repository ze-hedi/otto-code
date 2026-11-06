export interface Project {
  project_id: string;
  name: string;
  path: string;
  description?: string;
}

export interface AgentConfig {
  name?: string;
  description?: string;
  model: string;
  playground?: string;
  thinkingLevel?: string;
}

export interface AgentDoc {
  agent_id: string;
  config: AgentConfig;
  status: "active" | "stopped";
}

export interface AgentBusyState {
  busy: boolean;
  sessionKey: string | null;
}

export interface SessionInfo {
  filename: string;
  sessionKey: string;
  sessionId: string | null;
  createdAt: string | null;
  sizeBytes: number;
}

export function agentLabel(doc: Pick<AgentDoc, "agent_id" | "config">): string {
  return doc.config.name ?? doc.config.description ?? doc.agent_id.slice(0, 8);
}

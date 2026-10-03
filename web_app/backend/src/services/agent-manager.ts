import { v4 as uuidv4 } from "uuid";
import { Collection } from "mongodb";
import { RawPiAgent } from "../../../../agents/raw-pi-agent.js";
import type { RawPiAgentConfig } from "../../../../agents/pi-agent-configs.js";
import { getDb } from "../db/mongo.js";
import type { AgentDocument, SerializableAgentConfig } from "../types.js";

const activeAgents = new Map<string, RawPiAgent>();

const API_KEY_ENV: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

function resolveApiKey(model: string): string | undefined {
  const provider = model.split("/")[0];
  const envVar = API_KEY_ENV[provider];
  return envVar ? process.env[envVar] : undefined;
}

function getCollection(): Collection<AgentDocument> {
  return getDb().collection<AgentDocument>("agents");
}

export async function createAgent(config: SerializableAgentConfig): Promise<AgentDocument> {
  const agentId = uuidv4();
  const now = new Date();

  const rawConfig: RawPiAgentConfig = {
    name: config.name,
    model: config.model,
    apiKey: resolveApiKey(config.model),
    systemPrompt: config.systemPrompt,
    playground: config.playground,
    workingDir: config.workingDir,
    builtInTools: config.builtInTools,
    mcpServers: config.mcpServers,
    mcpConnectionTimeout: config.mcpConnectionTimeout,
    toolCallGuardrails: config.toolCallGuardrails,
    thinkingLevel: config.thinkingLevel,
    compaction: config.compaction,
  };

  const agent = new RawPiAgent(rawConfig);
  activeAgents.set(agentId, agent);

  const doc: AgentDocument = {
    agent_id: agentId,
    config,
    status: "active",
    created_at: now,
    updated_at: now,
  };

  await getCollection().insertOne(doc);
  return doc;
}

export function getActiveAgent(agentId: string): RawPiAgent | undefined {
  return activeAgents.get(agentId);
}

export async function getAgentDoc(agentId: string): Promise<AgentDocument | null> {
  return getCollection().findOne({ agent_id: agentId });
}

export async function getAllAgentDocs(): Promise<AgentDocument[]> {
  return getCollection().find().toArray();
}

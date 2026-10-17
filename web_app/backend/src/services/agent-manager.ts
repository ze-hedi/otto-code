import { v4 as uuidv4 } from "uuid";
import { Collection } from "mongodb";
import { RawPiAgent } from "../../../../agents/raw-pi-agent.js";
import { getDb } from "../db/mongo.js";
import type { AgentDocument, SerializableAgentConfig } from "../types.js";
import { toRawAgentConfig } from "./agent-config.js";
import { isKubernetesMode } from "../runtime/config.js";
import { markIdle } from "./agent-state.js";

// Session keys, busy state and clarification plumbing live in their own modules so the
// container runner can share them without pulling in MongoDB.
export {
  getSessionKey, setSessionKey, markBusy, markIdle, getAgentBusyState, getAgentEmitter,
} from "./agent-state.js";
export { setClarificationCallback, resolveClarification } from "./clarification.js";

const activeAgents = new Map<string, RawPiAgent>();

function getCollection(): Collection<AgentDocument> {
  return getDb().collection<AgentDocument>("agents");
}

export async function createAgent(config: SerializableAgentConfig): Promise<AgentDocument> {
  const agentId = uuidv4();
  const now = new Date();

  // In kubernetes mode the agent only comes to life inside its own container,
  // so the backend process stores the config and nothing else.
  if (!isKubernetesMode()) {
    activeAgents.set(agentId, new RawPiAgent(toRawAgentConfig(agentId, config)));
  }

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

/** Get or re-hydrate an agent: if not in memory, recreate from DB doc. */
export async function getOrActivateAgent(agentId: string): Promise<RawPiAgent | null> {
  const existing = activeAgents.get(agentId);
  if (existing) return existing;

  const doc = await getCollection().findOne({ agent_id: agentId });
  if (!doc) return null;

  const agent = new RawPiAgent(toRawAgentConfig(agentId, doc.config));
  activeAgents.set(agentId, agent);
  return agent;
}

export async function getAgentDoc(agentId: string): Promise<AgentDocument | null> {
  return getCollection().findOne({ agent_id: agentId });
}

export async function getAllAgentDocs(playground?: string): Promise<AgentDocument[]> {
  const filter = playground ? { "config.playground": playground } : {};
  return getCollection().find(filter).toArray();
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  const agent = activeAgents.get(agentId);
  if (agent) {
    await agent.disconnectMcp().catch(() => {});
    activeAgents.delete(agentId);
  }
  markIdle(agentId);
  const result = await getCollection().deleteOne({ agent_id: agentId });
  return result.deletedCount > 0;
}

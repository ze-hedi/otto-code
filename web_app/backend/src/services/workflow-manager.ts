import type { AgentsStorage } from "../../../../agents/workflow-types.js";
import { agentsStorageFromConfigs } from "./workflow-core.js";
import { getAllAgentDocs } from "./agent-manager.js";

// Interface tools, validation, interface storage and the level-by-level runner are pure
// (no MongoDB) so the container runner can use them too.
export * from "./workflow-core.js";

// ── Build AgentsStorage from all agents in DB ────────────────────────────────

export async function buildAgentsStorage(playground?: string): Promise<AgentsStorage> {
  const agentDocs = await getAllAgentDocs(playground);
  return agentsStorageFromConfigs(agentDocs.map((doc) => [doc.agent_id, doc.config]));
}

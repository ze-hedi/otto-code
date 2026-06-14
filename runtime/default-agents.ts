// runtime/default-agents.ts
// Registers built-in agents (like the explorer) on server startup.

import { PiAgent } from '../pi-agent.js';
import {
  exploreReposTool,
  orchestratorPrompt,
  PLAYGROUND,
  EXPLORER_MODEL,
  EXPLORER_THINKING,
} from '../coding_orchestrator/explorer.js';
import {
  plannerPrompt,
  PLANNER_MODEL,
  PLANNER_THINKING,
} from '../coding_orchestrator/planner.js';
import { activeAgents, sessionAgentMap, setCurrentAgentId } from './state.js';

export const EXPLORER_SESSION_ID = 'explorer';
export const PLANNER_SESSION_ID = 'planner';

export async function registerDefaultAgents(): Promise<void> {
  // ── Explorer agent ──────────────────────────────────────────────────────────
  const explorer = new PiAgent({
    name: 'explorer',
    model: EXPLORER_MODEL,
    systemPromptSuffix: orchestratorPrompt,
    builtInTools: ['read', 'bash'],
    playground: PLAYGROUND,
    sessionMode: 'memory',
    thinkingLevel: EXPLORER_THINKING,
    tools: [exploreReposTool],
  });

  activeAgents.set(EXPLORER_SESSION_ID, explorer);
  sessionAgentMap.set(EXPLORER_SESSION_ID, EXPLORER_SESSION_ID);
  setCurrentAgentId(EXPLORER_SESSION_ID);

  console.log(`[runtime] Default agent "explorer" registered (session: ${EXPLORER_SESSION_ID})`);

  // ── Planner agent ──────────────────────────────────────────────────────────
  const planner = new PiAgent({
    name: 'planner',
    model: PLANNER_MODEL,
    systemPromptSuffix: plannerPrompt,
    builtInTools: ['read', 'bash'],
    playground: PLAYGROUND,
    sessionMode: 'memory',
    thinkingLevel: PLANNER_THINKING,
  });

  activeAgents.set(PLANNER_SESSION_ID, planner);
  sessionAgentMap.set(PLANNER_SESSION_ID, PLANNER_SESSION_ID);

  console.log(`[runtime] Default agent "planner" registered (session: ${PLANNER_SESSION_ID})`);
}

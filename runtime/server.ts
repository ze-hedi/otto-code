// runtime/server.ts
// Instantiates PiAgent sessions from agent data sent by the React frontend.

// IMPORTANT: load-env must be first so API keys are in process.env before the
// SDK modules initialize (pi-ai reads env vars at module-load time).
import './load-env.js';

// Patch Node.js fetch to route through http_proxy / https_proxy.
// undici's ProxyAgent hooks into the global fetch dispatcher, unlike global-agent
// which only patches http/https modules (not fetch).
import { ProxyAgent, setGlobalDispatcher } from 'undici';
const proxyUrl = process.env.https_proxy || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[runtime] Proxy enabled: ${proxyUrl.replace(/\/\/.*@/, '//***@')}`);
}

import express from 'express';
import cors from 'cors';
import { activeAgents, sessionAgentMap, currentAgentId } from './state.js';
import { registerDefaultAgents } from './default-agents.js';
import agentRoutes from './routes/agent.js';
import filesRoutes from './routes/files.js';
import logsRoutes from './routes/logs.js';
import workflowRoutes from './routes/workflow.js';
import contextRoutes from './routes/context.js';

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ─── Route modules ───────────────────────────────────────────────────────────

app.use(agentRoutes);
app.use(filesRoutes);
app.use(logsRoutes);
app.use(workflowRoutes);
app.use(contextRoutes);

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * GET /runtime/status
 *
 * Returns the list of active agent IDs and the current (last-run) agent ID.
 */
app.get('/runtime/status', (_req, res) => {
  const sessions: Record<string, string> = {};
  for (const [sid, agentId] of sessionAgentMap) {
    if (activeAgents.has(sid)) sessions[sid] = agentId;
  }
  res.json({
    activeAgents: Array.from(activeAgents.keys()),
    sessionAgentMap: sessions,
    currentAgentId,
  });
});

// ─── MCP Tools discovery ────────────────────────────────────────────────────

const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://localhost:8080/mcp';

app.get('/runtime/mcp-tools', async (_req, res) => {
  try {
    const { createMcpBridge } = await import('../mcp-bridge.js');
    const bridge = await createMcpBridge(MCP_ENDPOINT, 5000);
    const tools = bridge.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    await bridge.close();
    res.json(tools);
  } catch (err: any) {
    res.status(502).json({ error: `MCP gateway unavailable: ${err.message}` });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`Runtime server running on http://localhost:${PORT}`);
  await registerDefaultAgents();
});

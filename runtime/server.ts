// runtime/server.ts
// Instantiates PiAgent sessions from agent data sent by the React frontend.

// IMPORTANT: load-env must be first so API keys are in process.env before the
// SDK modules initialize (pi-ai reads env vars at module-load time).
import './load-env.js';

import express from 'express';
import cors from 'cors';
import { PiAgent, PiAgentConfig } from '../pi-agent.js';
import { agentLogger } from './agent-logger.js';

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentData {
  _id: string;
  name: string;
  model: string;
  description: string;
  type?: string;
  status?: string;
  // New fields from database schema
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh';
  sessionMode?: 'memory' | 'disk' | 'continue';
  workingDir?: string;
  apiKey?: string;
}

interface AgentFile {
  type: 'soul' | 'skills';
  content: string;
}

interface RunRequest {
  agent: AgentData;
  files?: AgentFile[];
}

// ─── Global state ─────────────────────────────────────────────────────────────

// Map of agentId → PiAgent instance (all active agents)
const activeAgents = new Map<string, PiAgent>();

// Convenience pointer to the last agent that was run
let currentAgentId: string | null = null;

// Also exposed on global so other modules/scripts can access it directly
declare global {
  var activeAgent: PiAgent | null;
  var activeAgentId: string | null;
}
global.activeAgent = null;
global.activeAgentId = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a bare model name (e.g. "claude-sonnet-4-6") to the
 * "provider/model-name" format that PiAgent expects.
 * If the model already contains "/" it is returned as-is.
 */
function resolveModel(model: string): string {
  if (model.includes('/')) return model;
  if (model.startsWith('claude-')) return `anthropic/${model}`;
  if (model.startsWith('gpt-'))    return `openai/${model}`;
  // fallback
  return `anthropic/${model}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /runtime/run
 *
 * Body: { agent: AgentData, files?: AgentFile[] }
 *
 * Instantiates a new PiAgent for the given agent, registers it in
 * `activeAgents`, and sets it as the global `activeAgent`.
 */
app.post('/runtime/run', (req, res) => {
  const { agent, files = [] }: RunRequest = req.body;

  if (!agent?._id || !agent?.model) {
    res.status(400).json({ error: 'Request body must include agent._id and agent.model' });
    return;
  }

  // Validate session mode requirements
  if (agent.sessionMode === 'disk' || agent.sessionMode === 'continue') {
    if (!agent.workingDir || agent.workingDir.trim() === '') {
      res.status(400).json({ 
        error: `workingDir is required when sessionMode is "${agent.sessionMode}"` 
      });
      return;
    }
  }

  // Build config from DB files
  const soulFile   = files.find((f) => f.type === 'soul');
  const skillsFile = files.find((f) => f.type === 'skills');

  // Skills are passed as individual SkillInput objects so PiAgent can register
  // them properly via the resource loader (not just appended to the system prompt)
  const skills = skillsFile
    ? [{ name: 'agent-skills', content: skillsFile.content }]
    : [];

  const config: PiAgentConfig = {
    model: resolveModel(agent.model),
    systemPromptSuffix: soulFile?.content?.trim() || undefined,
    skills,
    // Use agent's configured values with database defaults as fallback
    sessionMode: agent.sessionMode || 'memory',
    thinkingLevel: agent.thinkingLevel || 'medium',
    workingDir: agent.workingDir?.trim() || undefined,
    apiKey: agent.apiKey || undefined,
  };

  try {
    const piAgent = new PiAgent(config);

    // Store in map and as globals
    activeAgents.set(agent._id, piAgent);
    currentAgentId        = agent._id;
    global.activeAgent    = piAgent;
    global.activeAgentId  = agent._id;

    console.log(`[runtime] Agent "${agent.name}" (${agent._id}) started`);
    console.log(`[runtime]   model          : ${config.model}`);
    console.log(`[runtime]   description    : ${agent.description}`);
    console.log(`[runtime]   sessionMode    : ${config.sessionMode}`);
    console.log(`[runtime]   thinkingLevel  : ${config.thinkingLevel}`);
    
    if (config.workingDir) {
      console.log(`[runtime]   workingDir     : ${config.workingDir}`);
    }
    
    if (config.apiKey) {
      const masked = config.apiKey.length > 12 
        ? config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4)
        : '***';
      console.log(`[runtime]   apiKey         : ${masked}`);
    }
    
    if (soulFile) {
      console.log(`[runtime]   system prompt  :`);
      console.log(`[runtime]   ──────────────────────────────────`);
      console.log(soulFile.content.trim().split('\n').map(l => `[runtime]   ${l}`).join('\n'));
      console.log(`[runtime]   ──────────────────────────────────`);
    } else {
      console.log(`[runtime]   system prompt  : (none)`);
    }

    res.json({ 
      success: true, 
      agentId: agent._id,
      name: agent.name,
      model: config.model,
      sessionMode: config.sessionMode,
      thinkingLevel: config.thinkingLevel,
      workingDir: config.workingDir || null,
      hasCustomApiKey: !!config.apiKey,
    });
  } catch (err: any) {
    console.error(`[runtime] Failed to instantiate agent: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /runtime/chat/:id
 *
 * Body: { message: string }
 *
 * Sends a message to an already-initialized PiAgent session and streams the
 * response back as Server-Sent Events (SSE).
 *
 * SSE event shapes:
 *   data: {"type":"delta","text":"..."}        — streamed text chunk
 *   data: {"type":"tool_start","name":"..."}   — tool execution began
 *   data: {"type":"tool_end","name":"...","result":"...","isError":false}
 *   data: {"type":"done"}                      — assistant turn finished
 *   data: {"type":"error","message":"..."}     — something went wrong
 */
app.post('/runtime/chat/:id', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body as { message?: string };

  const piAgent = activeAgents.get(id);
  if (!piAgent) {
    res.status(404).json({ error: 'Agent not found in runtime. Call /runtime/run first.' });
    return;
  }
  if (!message?.trim()) {
    res.status(400).json({ error: 'Request body must include a non-empty message' });
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  const send = (payload: object) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  console.log(`[runtime] chat → agent ${id}: "${message.trim().slice(0, 80)}"`);

  try {
    await piAgent.chat(message.trim(), (event: any) => {
      if (event.type === 'message_update') {
        const sub = event.assistantMessageEvent;
        if (sub?.type === 'text_delta') {
          send({ type: 'delta', text: sub.delta });
          // Log text deltas
          agentLogger.log(id, 'message_update', {
            textDelta: sub.delta,
            timestamp: new Date().toISOString()
          });
        }
      } else if (event.type === 'tool_execution_start') {
        send({ type: 'tool_start', name: event.toolName, args: event.args });
        // Log tool execution start
        agentLogger.log(id, 'tool_execution_start', {
          toolName: event.toolName,
          args: event.args,
          timestamp: new Date().toISOString()
        });
      } else if (event.type === 'tool_execution_end') {
        send({
          type: 'tool_end',
          name: event.toolName,
          result: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
          isError: event.isError,
        });
        // Log tool execution end
        agentLogger.log(id, 'tool_execution_end', {
          toolName: event.toolName,
          result: typeof event.result === 'string' ? event.result : event.result,
          isError: event.isError,
          timestamp: new Date().toISOString()
        });
      } else if (event.type === 'message_end') {
        // Log message end
        agentLogger.log(id, 'message_end', {
          timestamp: new Date().toISOString()
        });
      } else if (event.type === 'prompt_end') {
        // Log prompt end
        agentLogger.log(id, 'prompt_end', {
          timestamp: new Date().toISOString()
        });
      }
    });
    console.log(`[runtime] chat ✓ agent ${id} turn complete`);
    send({ type: 'done' });
  } catch (err: any) {
    console.error(`[runtime] chat ✗ agent ${id}: ${err.message}`);
    // Log error
    agentLogger.log(id, 'error', {
      message: err.message ?? String(err),
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    send({ type: 'error', message: err.message ?? String(err) });
  } finally {
    res.end();
  }
});

/**
 * GET /runtime/status
 *
 * Returns the list of active agent IDs and the current (last-run) agent ID.
 */
app.get('/runtime/status', (_req, res) => {
  res.json({
    activeAgents: Array.from(activeAgents.keys()),
    currentAgentId,
  });
});

/**
 * DELETE /runtime/agents/:id
 *
 * Removes an agent instance from memory.
 */
app.delete('/runtime/agents/:id', (req, res) => {
  const { id } = req.params;
  if (!activeAgents.has(id)) {
    res.status(404).json({ error: 'Agent not found in runtime' });
    return;
  }
  activeAgents.delete(id);
  if (currentAgentId === id) {
    currentAgentId       = null;
    global.activeAgent   = null;
    global.activeAgentId = null;
  }
  // Clear logs for removed agent
  agentLogger.clearLogs(id);
  console.log(`[runtime] Agent ${id} removed from runtime`);
  res.json({ success: true });
});

/**
 * GET /runtime/logs/:id
 *
 * Retrieves and prints the logs for a specific agent.
 * Returns formatted logs as JSON and prints them to console.
 */
app.get('/runtime/logs/:id', (req, res) => {
  const { id } = req.params;
  const logs = agentLogger.getLogs(id);
  
  if (logs.length === 0) {
    res.json({ 
      success: true, 
      agentId: id, 
      message: 'No logs found',
      logs: [] 
    });
    return;
  }

  // Print logs to console
  console.log(agentLogger.formatLogs(id));

  // Return logs as JSON
  res.json({
    success: true,
    agentId: id,
    count: logs.length,
    logs: logs
  });
});

/**
 * GET /runtime/logs
 *
 * Retrieves and prints logs for all agents.
 * Returns formatted logs as JSON and prints them to console.
 */
app.get('/runtime/logs', (_req, res) => {
  const allLogs = agentLogger.getAllLogs();
  
  if (allLogs.size === 0) {
    res.json({ 
      success: true, 
      message: 'No logs found',
      agents: {} 
    });
    return;
  }

  // Print all logs to console
  console.log(agentLogger.formatAllLogs());

  // Convert Map to object for JSON response
  const logsObject: Record<string, any[]> = {};
  allLogs.forEach((logs, agentId) => {
    logsObject[agentId] = logs;
  });

  res.json({
    success: true,
    count: allLogs.size,
    agents: logsObject
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Runtime server running on http://localhost:${PORT}`);
});

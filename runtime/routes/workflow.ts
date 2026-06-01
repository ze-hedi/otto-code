// runtime/routes/workflow.ts
// Workflow execution — translates the visual graph into runtime agents/orchestrators.

import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { PiAgent, PiAgentConfig } from '../../pi-agent.js';
import { createRawAgent } from '../../raw-agent.js';
import {
  activeAgents,
  activeOrchestrators,
  orchestratorSubAgents,
  sessionAgentMap,
  agentToSessionMap,
  sessionHooks,
  setCurrentAgentId,
  resolveModel,
  workflowEvents,
  workflowHistory,
  workflowSessions,
} from '../state.js';
import type { SessionHook } from '../state.js';
import type { AgentData, AgentFile } from '../types.js';
import { buildExecutionQueue, compileGraph } from '../workflow-scheduler.js';
import { briefingTool, planTool, reportTool, createDelegateTool, INTERFACE_TOOL_NAMES } from '../../workflow_interfaces_tools.js';
import { ToolExecutor } from '../tool-executor.js';
import { Type } from 'typebox';

const router = Router();

/**
 * GET /runtime/workflow/events
 *
 * SSE stream for workflow hook events (broadcast to all connected clients).
 */
router.get('/runtime/workflow/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onHook = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  workflowEvents.on('hook_fired', onHook);

  req.on('close', () => {
    workflowEvents.off('hook_fired', onHook);
  });
});

/**
 * GET /runtime/workflows
 *
 * Returns the list of workflow records, sorted by lastInteractedAt descending.
 */
router.get('/runtime/workflows', (_req, res) => {
  const sorted = [...workflowHistory].sort(
    (a, b) => new Date(b.lastInteractedAt).getTime() - new Date(a.lastInteractedAt).getTime()
  );
  res.json(sorted);
});

/**
 * PATCH /runtime/workflows/:id/touch
 *
 * Updates lastInteractedAt for a workflow record.
 */
router.patch('/runtime/workflows/:id/touch', (req, res) => {
  const record = workflowHistory.find((w) => w.id === req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  record.lastInteractedAt = new Date().toISOString();
  res.json(record);
});

interface WorkflowNode {
  id: string;
  type: 'agent' | 'tool' | 'artefact' | 'orchestrator';
  name: string;
  icon?: string;
  agentId?: string;
  toolId?: string;
  isMcp?: boolean;
  artefactType?: string;
  orchestratorId?: string;
  subAgents?: (AgentData & { files?: AgentFile[]; stateful?: boolean })[];
}

interface WorkflowConnection {
  from: string;
  fromSide: string;
  to: string;
  toSide: string;
  linkType?: string;
}

interface WorkflowRunRequest {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  existingSessionId?: string; // If provided, incremental compile: reuse session, skip already-compiled agents
}

/**
 * POST /runtime/workflow/compile
 *
 * Receives the workflow graph (nodes + connections) and spins up
 * the corresponding agents/orchestrator in the runtime.
 */
router.post('/runtime/workflow/compile', async (req, res) => {
  const { nodes, connections, existingSessionId }: WorkflowRunRequest = req.body;

  if (!nodes?.length) {
    res.status(400).json({ error: 'Workflow must contain at least one node' });
    return;
  }

  const agentNodes = nodes.filter((n) => n.type === 'agent');
  const orchestratorNodes = nodes.filter((n) => n.type === 'orchestrator');
  if (agentNodes.length === 0 && orchestratorNodes.length === 0) {
    res.status(400).json({ error: 'Workflow must contain at least one agent or orchestrator' });
    return;
  }

  // Determine if this is an incremental compile
  const isIncremental = !!existingSessionId && workflowSessions.has(existingSessionId);
  const existingState = isIncremental ? workflowSessions.get(existingSessionId)! : null;

  try {
    // Pre-declare tool resolution state (populated later, referenced by onToolExecute closures)
    const dbToolMap = new Map<string, any>();
    let mcpBridge: Awaited<ReturnType<typeof import('../../mcp-bridge.js').createMcpBridge>> | null = null;
    const mcpToolMap = new Map<string, { name: string; description: string; inputSchema: Record<string, unknown> }>();

    // Build execution queue (Kahn's topological sort) and validate full graph
    const queueResult = buildExecutionQueue(nodes, connections);
    const { levels: executionQueue, predecessors, successors, toolLinks } = compileGraph(queueResult);
    console.log(`[runtime] Workflow execution queue (${executionQueue.length} levels):`);
    executionQueue.forEach((level, i) => {
      console.log(`[runtime]   Level ${i}: ${level.map((n) => `${n.name || n.id} (${n.type})`).join(', ')}`);
    });

    // Agent data is now sent directly from the frontend — no DB fetch needed
    const buildAgent = (node: any, keyRef: { current: string }): { agent: AgentData; piAgent: PiAgent } => {
      const files: AgentFile[] = node.files || [];
      const soulFile = files.find((f) => f.type === 'soul');
      const skillsFile = files.find((f) => f.type === 'skills');
      const skills = skillsFile ? [{ name: 'agent-skills', content: skillsFile.content }] : [];

      const config: PiAgentConfig = {
        name: node.name,
        model: resolveModel(node.model),
        systemPromptSuffix: soulFile?.content?.trim() || undefined,
        skills,
        sessionMode: node.sessionMode || 'memory',
        thinkingLevel: node.thinkingLevel || 'medium',
        workingDir: node.workingDir?.trim() || undefined,
        playground: node.playground?.trim() || undefined,
        apiKey: node.apiKey || process.env.ANTHROPIC_API_KEY || undefined,
        ...(node.compaction ? { compaction: node.compaction } : {}),
        onToolExecute: async (_toolCallId, toolName, params, _signal) => {
          console.log(`[runtime] Agent "${node.name}" called tool "${toolName}"`, JSON.stringify(params, null, 2));

          // ── MCP tool execution ─────────────────────────────────────────
          if (mcpBridge && mcpToolMap.has(toolName)) {
            try {
              const mcpResult = await mcpBridge.callTool(toolName, params);
              return { content: mcpResult.content };
            } catch (err: any) {
              return { content: [{ type: 'text', text: `MCP tool error: ${err.message}` }] };
            }
          }

          // ── DB tool execution ──────────────────────────────────────────
          const dbToolEntry = Array.from(dbToolMap.values()).find((t) => t.name === toolName);
          if (dbToolEntry?.executionFunction) {
            return ToolExecutor.executeSafely(dbToolEntry.executionFunction, params);
          }

          // ── Interface tool fallback ────────────────────────────────────
          const result = {
            content: [{ type: 'text', text: `${toolName} submitted successfully.` }],
          };

          if ((INTERFACE_TOOL_NAMES as readonly string[]).includes(toolName) && keyRef.current) {
            const hooks = sessionHooks.get(keyRef.current) || [];
            for (const hook of hooks) {
              if (hook.toolName === '*' || hook.toolName === toolName) {
               try {
                  await hook.callback({
                    sessionId: keyRef.current,
                    agentName: node.name,
                    toolName,
                    args: params,
                    result,
                  });
                } catch (err: any) {
                  console.error(`[workflow-hook] Error firing hook for "${toolName}": ${err.message}`);
                }
              }
            }
          }

          return result;
        },
      };

      return { agent: node as AgentData, piAgent: new PiAgent(config) };
    };

    const sessionId = isIncremental ? existingSessionId! : `workflow-${Date.now()}`;
    console.log(`[runtime] ${isIncremental ? 'Incremental' : 'Full'} compile, sessionId: ${sessionId}`);

    // Build all agents first
    // actorMap unifies agents and orchestrators for interface tool assignment and hook wiring
    const actorMap = new Map<string, { agent: AgentData; piAgent: PiAgent; keyRef: { current: string } }>();
    // Track which node IDs are newly built (vs reused from previous compile)
    const newlyBuiltNodeIds = new Set<string>();

    for (const node of agentNodes) {
      // If incremental and this node was already compiled, reuse the existing PiAgent
      if (isIncremental && existingState!.compiledActors.has(node.id)) {
        const compositeKey = existingState!.compiledActors.get(node.id)!;
        const existingPiAgent = activeAgents.get(compositeKey);
        if (existingPiAgent) {
          const keyRef = { current: compositeKey };
          actorMap.set(node.id, { agent: node as AgentData, piAgent: existingPiAgent, keyRef });
          console.log(`[runtime] Reusing existing agent "${node.name}" (${compositeKey})`);
          continue;
        }
      }
      const keyRef = { current: '' };
      actorMap.set(node.id, { ...buildAgent(node, keyRef), keyRef });
      newlyBuiltNodeIds.add(node.id);
    }

    // Build orchestrator nodes — each becomes a raw agent with a delegate tool + sub-agents
    for (const node of orchestratorNodes) {
      // If incremental and this orchestrator was already compiled, reuse it
      if (isIncremental && existingState!.compiledActors.has(node.id)) {
        const compositeKey = existingState!.compiledActors.get(node.id)!;
        const existingPiAgent = activeAgents.get(compositeKey);
        if (existingPiAgent) {
          const keyRef = { current: compositeKey };
          actorMap.set(node.id, { agent: node as AgentData, piAgent: existingPiAgent, keyRef });
          console.log(`[runtime] Reusing existing orchestrator "${node.name}" (${compositeKey})`);
          continue;
        }
      }
      newlyBuiltNodeIds.add(node.id);
      const keyRef = { current: '' };
      const files: AgentFile[] = node.files || [];
      const soulFile = files.find((f) => f.type === 'soul');

      // Create PiAgent for each sub-agent
      const subAgentPiAgents = new Map<string, { def: AgentData; piAgent: PiAgent }>();
      for (const sub of (node.subAgents || [])) {
        const subFiles: AgentFile[] = sub.files || [];
        const subSoul = subFiles.find((f) => f.type === 'soul');
        const subSkills = subFiles.find((f) => f.type === 'skills');
        const skills = subSkills ? [{ name: 'agent-skills', content: subSkills.content }] : [];

        const subConfig: PiAgentConfig = {
          name: sub.name,
          model: resolveModel(sub.model),
          systemPromptSuffix: subSoul?.content?.trim() || undefined,
          skills,
          sessionMode: sub.sessionMode || 'memory',
          thinkingLevel: sub.thinkingLevel || 'medium',
          workingDir: sub.workingDir?.trim() || undefined,
          playground: sub.playground?.trim() || undefined,
          apiKey: sub.apiKey || process.env.ANTHROPIC_API_KEY || undefined,
          ...(sub.compaction ? { compaction: sub.compaction } : {}),
        };

        const subPiAgent = new PiAgent(subConfig);
        subAgentPiAgents.set(sub.name, { def: sub, piAgent: subPiAgent });
      }

      // Build the delegate tool from sub-agents
      const agentList = Array.from(subAgentPiAgents.entries())
        .map(([name, { def }]) => `[${name}] ${def.description}`)
        .join('\n');

      // Create the orchestrator as a raw agent with delegate tool + workflow hooks
      const orchestratorPiAgent = createRawAgent({
        model: resolveModel(node.model || 'claude-sonnet-4-6'),
        systemPromptSuffix: soulFile?.content?.trim() || undefined,
        sessionMode: node.sessionMode || 'memory',
        thinkingLevel: node.thinkingLevel || 'medium',
        playground: node.playground?.trim() || undefined,
        apiKey: node.apiKey || process.env.ANTHROPIC_API_KEY || undefined,
        tools: [
          {
            name: 'delegate',
            label: 'Delegate',
            description:
              `Delegate tasks to one or more sub-agents. They run in parallel.\n\n` +
              `AVAILABLE AGENTS:\n${agentList}\n\n` +
              `Pass multiple agents to fan out work concurrently. Pass one for a focused task.\n` +
              `IMPORTANT: Call this tool ONCE with all agents needed. Do NOT call it again with the same agents. After receiving results, synthesize and respond.`,
            parameters: Type.Object({
              agents: Type.Array(
                Type.Object({
                  name: Type.String({ description: 'Agent ID to call' }),
                  task: Type.String({ description: 'Plain-English instruction for the agent' }),
                })
              ),
            }),
          },
        ],
        onToolExecute: async (_toolCallId, toolName, params: any, _signal) => {
          console.log(`[runtime] Orchestrator "${node.name}" called tool "${toolName}"`, JSON.stringify(params, null, 2));

          if (toolName === 'delegate') {
            // Validate all agent names
            for (const entry of params.agents) {
              if (!subAgentPiAgents.has(entry.name)) {
                throw new Error(
                  `Unknown agent "${entry.name}". Available: ${Array.from(subAgentPiAgents.keys()).join(', ')}`
                );
              }
            }

            // Spawn all sub-agents in parallel
            const results = await Promise.all(
              params.agents.map(async ({ name, task }: { name: string; task: string }) => {
                const { def, piAgent: subAgent } = subAgentPiAgents.get(name)!;
                try {
                  let finalText = '';
                  const run = def.stateful
                    ? subAgent.chat.bind(subAgent)
                    : subAgent.execute.bind(subAgent);
                  await run(task, (event: any) => {
                    if (event.type === 'agent_end') {
                      const messages = event.messages || [];
                      for (let i = messages.length - 1; i >= 0; i--) {
                        const msg = messages[i];
                        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                          const textBlocks = msg.content.filter((b: any) => b.type === 'text');
                          if (textBlocks.length > 0) {
                            finalText = textBlocks.map((b: any) => b.text).join('\n');
                            break;
                          }
                        }
                      }
                    }
                  });
                  return { agent: name, status: 'ok' as const, result: finalText || '(no output)' };
                } catch (err) {
                  return { agent: name, status: 'error' as const, result: err instanceof Error ? err.message : String(err) };
                }
              })
            );

            return {
              content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
            };
          }

          // ── MCP tool execution ─────────────────────────────────────────
          if (mcpBridge && mcpToolMap.has(toolName)) {
            try {
              const mcpResult = await mcpBridge.callTool(toolName, params);
              return { content: mcpResult.content };
            } catch (err: any) {
              return { content: [{ type: 'text', text: `MCP tool error: ${err.message}` }] };
            }
          }

          // ── DB tool execution ──────────────────────────────────────────
          const dbToolEntry = Array.from(dbToolMap.values()).find((t: any) => t.name === toolName);
          if (dbToolEntry?.executionFunction) {
            return ToolExecutor.executeSafely(dbToolEntry.executionFunction, params);
          }

          // Interface tools (briefing, plan, report, etc.)
          const result = {
            content: [{ type: 'text', text: `${toolName} submitted successfully.` }],
          };

          if ((INTERFACE_TOOL_NAMES as readonly string[]).includes(toolName) && keyRef.current) {
            const hooks = sessionHooks.get(keyRef.current) || [];
            for (const hook of hooks) {
              if (hook.toolName === '*' || hook.toolName === toolName) {
                try {
                  await hook.callback({
                    sessionId: keyRef.current,
                    agentName: node.name,
                    toolName,
                    args: params,
                    result,
                  });
                } catch (err: any) {
                  console.error(`[workflow-hook] Error firing hook for "${toolName}": ${err.message}`);
                }
              }
            }
          }

          return result;
        },
      });

      // Store sub-agent PiAgents for later registration
      (orchestratorPiAgent as any)._workflowSubAgents = subAgentPiAgents;

      actorMap.set(node.id, {
        agent: node as AgentData,
        piAgent: orchestratorPiAgent,
        keyRef,
      });

      console.log(`[runtime] Orchestrator "${node.name}" built with ${subAgentPiAgents.size} sub-agent(s): ${Array.from(subAgentPiAgents.keys()).join(', ')}`);
    }

    // ── Resolve linked tools (DB + MCP) upfront ─────────────────────────────
    // Collect all tool nodes from toolLinks
    const allLinkedToolNodes = Array.from(toolLinks.values()).flat();
    const dbToolIds = allLinkedToolNodes.filter((t) => !t.isMcp && t.toolId).map((t) => t.toolId!);
    const mcpToolNodes = allLinkedToolNodes.filter((t) => t.isMcp);

    // Bulk-fetch DB tools (populates pre-declared dbToolMap)
    if (dbToolIds.length > 0) {
      try {
        const uniqueIds = [...new Set(dbToolIds)];
        const res = await fetch(`http://localhost:4000/api/tools`);
        if (res.ok) {
          const allDbTools: any[] = await res.json();
          for (const t of allDbTools) {
            if (uniqueIds.includes(t._id)) dbToolMap.set(t._id, t);
          }
        }
      } catch (err: any) {
        console.warn(`[workflow] Failed to fetch DB tools: ${err.message}`);
      }
    }

    // Connect MCP bridge if any MCP tools are linked (populates pre-declared mcpBridge/mcpToolMap)
    if (mcpToolNodes.length > 0) {
      try {
        const { createMcpBridge } = await import('../../mcp-bridge.js');
        const endpoint = process.env.MCP_ENDPOINT || 'http://localhost:8080/mcp';
        mcpBridge = await createMcpBridge(endpoint, 5000);
        for (const t of mcpBridge.tools) mcpToolMap.set(t.name, t);
      } catch (err: any) {
        console.warn(`[workflow] MCP bridge unavailable: ${err.message}`);
      }
    }

    // Assign interface tools to each agent/orchestrator based on outgoing interfaces
    const allActorNodes = [...agentNodes, ...orchestratorNodes];
    const agentDetails: { name: string; model: string; sessionMode: string; thinkingLevel: string; tools: string[] }[] = [];

    for (const node of allActorNodes) {
      console.log("actor node : ", node.name)
      const { agent: agentData, piAgent } = actorMap.get(node.id)!;
      const nodeSuccessors = successors.get(node.id) || [];
      const assignedTools: string[] = [];

      // Skip tool assignment for reused actors (they already have their tools)
      if (isIncremental && !newlyBuiltNodeIds.has(node.id)) {
        agentDetails.push({
          name: agentData.name,
          model: agentData.model,
          sessionMode: agentData.sessionMode || 'memory',
          thinkingLevel: agentData.thinkingLevel || 'medium',
          tools: ['(reused)'],
        });
        continue;
      }

      // Orchestrators already have delegate built-in, note it in assignedTools
      if (node.type === 'orchestrator') {
        assignedTools.push('delegate (built-in)');
      }

      for (const succ of nodeSuccessors) {
        if (succ.type !== 'artefact') continue;
        const interfaceName = (succ.name || '').toLowerCase();
        if (interfaceName === 'briefing') {
          piAgent.addTool(briefingTool);
          assignedTools.push('briefing');
          console.log(`[runtime]   Assigned briefingTool to "${node.name}"`);
        } else if (interfaceName === 'plan') {
          piAgent.addTool(planTool);
          assignedTools.push('plan');
          console.log(`[runtime]   Assigned planTool to "${node.name}"`);
        } else if (interfaceName === 'report') {
          piAgent.addTool(reportTool);
          assignedTools.push('report');
          console.log(`[runtime]   Assigned reportTool to "${node.name}"`);
        } else if (interfaceName === 'delegate' && node.type !== 'orchestrator') {
          // Only add delegate tool for regular agents (orchestrators already have it)
          const delegateSuccessors = successors.get(succ.id) || [];
          const delegateTargets: Record<string, string> = {};
          for (const delegatedNode of delegateSuccessors) {
            if (delegatedNode.type === 'agent' || delegatedNode.type === 'orchestrator') {
              const delegatedActor = actorMap.get(delegatedNode.id);
              if (delegatedActor) {
                delegateTargets[delegatedActor.agent.name] = delegatedActor.agent.description;
              }
            }
          }

          piAgent.addTool(createDelegateTool(delegateTargets));
          assignedTools.push(`delegate → [${Object.keys(delegateTargets).join(', ')}]`);
          console.log(`[runtime]   Assigned delegateTool to "${node.name}" (delegates to: ${Object.keys(delegateTargets).join(', ')})`);
        }
        console.log(`[runtime] "${node.name}" added tool: ${interfaceName}`);
      }

      // ── Register linked tools (DB + MCP) via tool-link connections ──────
      const linkedTools = toolLinks.get(node.id) || [];
      for (const toolNode of linkedTools) {
        if (toolNode.isMcp) {
          // MCP tool — self-executing via bridge
          const mcpName = (toolNode.toolId || '').replace(/^mcp_/, '');
          const mcpDef = mcpToolMap.get(mcpName);
          if (mcpDef && mcpBridge) {
            const bridge = mcpBridge; // capture for closure
            piAgent.addTool({
              name: mcpDef.name,
              label: mcpDef.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              description: mcpDef.description,
              parameters: Type.Unsafe(mcpDef.inputSchema),
              promptSnippet: `${mcpDef.name}: ${mcpDef.description}`,
            });
            assignedTools.push(`${mcpDef.name} (mcp)`);
            console.log(`[runtime]   Assigned MCP tool "${mcpDef.name}" to "${node.name}"`);
          } else {
            console.warn(`[runtime]   MCP tool "${mcpName}" not found or bridge unavailable`);
          }
        } else {
          // DB tool — self-executing via ToolExecutor
          const dbTool = dbToolMap.get(toolNode.toolId!);
          if (dbTool) {
            piAgent.addTool({
              name: dbTool.name,
              label: dbTool.name,
              description: dbTool.description,
              parameters: Type.Unsafe(dbTool.schema || { type: 'object' }),
              promptSnippet: `${dbTool.name}: ${dbTool.description}`,
            });
            assignedTools.push(`${dbTool.name} (db)`);
            console.log(`[runtime]   Assigned DB tool "${dbTool.name}" to "${node.name}"`);
          } else {
            console.warn(`[runtime]   DB tool "${toolNode.toolId}" not found`);
          }
        }
      }

      agentDetails.push({
        name: agentData.name,
        model: agentData.model,
        sessionMode: agentData.sessionMode || 'memory',
        thinkingLevel: agentData.thinkingLevel || 'medium',
        tools: assignedTools,
      });
    }

    // Dump registered tools for each actor
    for (const [nodeId, { agent, piAgent }] of actorMap) {
      console.log(`[DEBUG] "${agent.name}" registered tools:`, piAgent.getRegisteredTools());
    }

    // Build pending-briefings accumulator for multi-entry interfaces
    // Key: interfaceNodeId, Value: { expected count, received entries, toolName, nextAgents }
    const pendingBriefings = new Map<string, {
      expected: number;
      received: { agentName: string; toolName: string; args: any }[];
      nextAgentInfos: { name: string; compositeKey: string }[];
    }>();

    // Pre-scan: find interface nodes fed by multiple agents
    for (const level of executionQueue) {
      for (const node of level) {
        if (node.type !== 'artefact') continue;
        const nodePredecessors = (predecessors.get(node.id) || []).filter(
          (n) => n.type === 'agent' || n.type === 'orchestrator'
        );
        if (nodePredecessors.length > 1) {
          // Resolve next agents after this interface
          const nextActors = (successors.get(node.id) || []).filter(
            (n) => n.type === 'agent' || n.type === 'orchestrator'
          );
          const nextAgentInfos = nextActors.map((a) => {
            const entry = actorMap.get(a.id);
            if (!entry) return { name: a.name || a.id, compositeKey: '' };
            return { name: a.name || a.id, compositeKey: `${sessionId}::${resolveActorId(a, entry.agent)}` };
          });
          pendingBriefings.set(node.id, {
            expected: nodePredecessors.length,
            received: [],
            nextAgentInfos,
          });
          console.log(`[workflow] Multi-entry interface "${node.name}" expects ${nodePredecessors.length} submissions`);
        }
      }
    }

    // Helper: resolve the runtime ID for an actor node (orchestrators use orchestratorId)
    const resolveActorId = (node: WorkflowNode, agent: AgentData) =>
      node.type === 'orchestrator' ? (node.orchestratorId || (node as any)._id || agent._id) : agent._id;

    // Register all actors under composite key + reverse map + hooks
    for (const node of allActorNodes) {
      const { agent, piAgent, keyRef } = actorMap.get(node.id)!;
      const actorId = resolveActorId(node, agent);
      const compositeKey = `${sessionId}::${actorId}`;
      const isReused = isIncremental && !newlyBuiltNodeIds.has(node.id);

      // Only register new actors in activeAgents / sub-agents (reused are already there)
      if (!isReused) {
        activeAgents.set(compositeKey, piAgent);
        agentToSessionMap.set(actorId, compositeKey);

        // For orchestrators, also register sub-agents and metadata
        if (node.type === 'orchestrator') {
          const subAgentPiAgents: Map<string, { def: AgentData; piAgent: PiAgent }> = (piAgent as any)._workflowSubAgents;
          if (subAgentPiAgents) {
            const subAgentDataList: AgentData[] = [];
            for (const [name, { def, piAgent: subPi }] of subAgentPiAgents) {
              const subCompositeKey = `${sessionId}::${def._id}`;
              activeAgents.set(subCompositeKey, subPi);
              agentToSessionMap.set(def._id, subCompositeKey);
              subAgentDataList.push(def);
              console.log(`[runtime]   Sub-agent "${name}" (${subCompositeKey}) registered`);
            }
            orchestratorSubAgents.set(compositeKey, subAgentDataList);
          }
        }
      }

      // Always (re-)wire hooks — graph connections may have changed on incremental compile
      keyRef.current = compositeKey;
      sessionHooks.set(compositeKey, [{
        toolName: '*',
        callback: async ({ agentName, toolName, args }) => {
          console.log(`[workflow-hook] "${agentName}" submitted "${toolName}"`);

          // Find the interface node matching the tool that was called
          const actorSuccessors = successors.get(node.id) || [];
          const interfaceNode = actorSuccessors.find(
            (n) => n.type === 'artefact' && toolName === `submit_${(n.name || '').toLowerCase()}`
          );

          if (!interfaceNode) {
            // No matching interface — emit immediately as single-entry
            const hookPayload = {
              type: 'hook_fired' as const,
              agentName,
              toolName,
              args,
              nextAgents: [] as { name: string; compositeKey: string }[],
            };
            console.log(`[workflow-hook] Emitting hook_fired (no interface):`, JSON.stringify(hookPayload, null, 2));
            workflowEvents.emit('hook_fired', hookPayload);
            return;
          }

          // Check if this is a multi-entry interface
          const pending = pendingBriefings.get(interfaceNode.id);

          if (pending) {
            // Multi-entry: accumulate and wait for all predecessors
            pending.received.push({ agentName, toolName, args });
            console.log(`[workflow-hook] Multi-entry "${interfaceNode.name}": ${pending.received.length}/${pending.expected} received`);

            // Emit partial progress event
            workflowEvents.emit('hook_fired', {
              type: 'hook_partial',
              interfaceName: interfaceNode.name || interfaceNode.id,
              received: pending.received.length,
              expected: pending.expected,
              latestAgent: agentName,
            });

            if (pending.received.length < pending.expected) return;

            // All entries received — emit merged hook_fired
            const hookPayload = {
              type: 'hook_fired' as const,
              toolName,
              entries: pending.received.map((e) => ({
                agentName: e.agentName,
                args: e.args,
              })),
              nextAgents: pending.nextAgentInfos,
            };
            console.log(`[workflow-hook] Emitting merged hook_fired for "${interfaceNode.name}":`, JSON.stringify(hookPayload, null, 2));
            workflowEvents.emit('hook_fired', hookPayload);

            // Reset for potential re-use
            pending.received = [];
          } else {
            // Single-entry: emit immediately (existing behavior)
            const nextActors = (successors.get(interfaceNode.id) || []).filter(
              (n) => n.type === 'agent' || n.type === 'orchestrator'
            );
            const nextAgentInfos = nextActors.map((a) => {
              const entry = actorMap.get(a.id);
              if (!entry) return { name: a.name || a.id, compositeKey: '' };
              return { name: a.name || a.id, compositeKey: `${sessionId}::${resolveActorId(a, entry.agent)}` };
            });
            console.log(
              `[workflow-hook] Next actors after "${toolName}": [${nextAgentInfos.map((a) => a.name).join(', ')}]`
            );

            const hookPayload = {
              type: 'hook_fired' as const,
              agentName,
              toolName,
              args,
              nextAgents: nextAgentInfos,
            };
            console.log(`[workflow-hook] Emitting hook_fired:`, JSON.stringify(hookPayload, null, 2));
            workflowEvents.emit('hook_fired', hookPayload);
          }
        },
      }]);

      console.log(`[runtime] Workflow "${agent.name}" → id: ${actorId} | key: ${compositeKey} | tools: [${piAgent.getRegisteredTools().join(', ')}]${isReused ? ' (reused)' : ''}`);
    }

    // First agent/orchestrator in execution queue is the default chat target
    const firstActorNode = executionQueue.flat().find((n) => n.type === 'agent' || n.type === 'orchestrator')!;
    const { agent: firstAgent } = actorMap.get(firstActorNode.id)!;
    const firstActorId = resolveActorId(firstActorNode, firstAgent);

    console.log(`[runtime] Workflow compiled with ${agentNodes.length} agent(s) + ${orchestratorNodes.length} orchestrator(s), first: "${firstAgent.name}" [${isIncremental ? 'incremental' : 'full'}, ${newlyBuiltNodeIds.size} new]`);

    // Update workflow session state for future incremental compiles
    const sessionState = workflowSessions.get(sessionId) || {
      sessionId,
      compiledActors: new Map<string, string>(),
      successors: new Map(),
      predecessors: new Map(),
    };
    // Register all actors (including reused) in the session state
    for (const node of allActorNodes) {
      const { agent } = actorMap.get(node.id)!;
      sessionState.compiledActors.set(node.id, `${sessionId}::${resolveActorId(node, agent)}`);
    }
    sessionState.successors = successors;
    sessionState.predecessors = predecessors;
    workflowSessions.set(sessionId, sessionState);

    // Save workflow record for history (only on first compile)
    if (!isIncremental) {
      const now = new Date().toISOString();
      workflowHistory.push({
        id: sessionId,
        agents: Array.from(actorMap.values()).map(({ agent }) => agent.name),
        createdAt: now,
        lastInteractedAt: now,
      });
    } else {
      // Update history entry with new agent list
      const record = workflowHistory.find((w) => w.id === sessionId);
      if (record) {
        record.agents = Array.from(actorMap.values()).map(({ agent }) => agent.name);
        record.lastInteractedAt = new Date().toISOString();
      }
    }

    // Build agent info list with correct IDs for both agents and orchestrators
    const buildAgentInfo = (nodeId: string) => {
      const node = allActorNodes.find((n) => n.id === nodeId)!;
      const { agent } = actorMap.get(nodeId)!;
      return { name: agent.name, id: resolveActorId(node, agent) };
    };

    const allAgentInfos = Array.from(actorMap.keys()).map(buildAgentInfo);
    const newAgents = Array.from(actorMap.keys())
      .filter((nodeId) => newlyBuiltNodeIds.has(nodeId))
      .map(buildAgentInfo);

    res.json({
      success: true,
      compilationSuccess: true,
      mode: 'multi-agent',
      sessionId,
      incremental: isIncremental,
      activeAgent: { name: firstAgent.name, id: firstActorId },
      agents: allAgentInfos,
      newAgents,
      agentDetails,
      executionQueue: executionQueue.map((level) => level.map((n) => ({ id: n.id, type: n.type, name: n.name }))),
    });
  } catch (err: any) {
    console.error(`[runtime] Workflow run failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Workflow file persistence ──────────────────────────────────────────────────

router.post('/runtime/workflow/save', (req, res) => {
  try {
    const { filePath, data } = req.body;
    if (!filePath || !data) {
      res.status(400).json({ error: 'filePath and data are required' });
      return;
    }
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[runtime] Workflow saved to ${filePath}`);
    res.json({ success: true, filePath });
  } catch (err: any) {
    console.error(`[runtime] Workflow save failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.get('/runtime/workflow/load', (req, res) => {
  try {
    const filePath = req.query.filePath as string;
    if (!filePath) {
      res.status(400).json({ error: 'filePath query parameter is required' });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Workflow file not found' });
      return;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    res.json(data);
  } catch (err: any) {
    console.error(`[runtime] Workflow load failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;

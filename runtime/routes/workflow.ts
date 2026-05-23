// runtime/routes/workflow.ts
// Workflow execution — translates the visual graph into runtime agents/orchestrators.

import { Router } from 'express';
import { PiAgent, PiAgentConfig } from '../../pi-agent.js';
import {
  activeAgents,
  sessionAgentMap,
  agentToSessionMap,
  sessionHooks,
  setCurrentAgentId,
  resolveModel,
  workflowEvents,
} from '../state.js';
import type { SessionHook } from '../state.js';
import type { AgentData, AgentFile } from '../types.js';
import { buildExecutionQueue, compileGraph } from '../workflow-scheduler.js';
import { briefingTool, planTool, reportTool, createDelegateTool, INTERFACE_TOOL_NAMES } from '../../workflow_interfaces_tools.js';

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

interface WorkflowNode {
  id: string;
  type: 'agent' | 'tool' | 'artefact';
  name: string;
  icon?: string;
  agentId?: string;
  toolId?: string;
  artefactType?: string;
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
}

/**
 * POST /runtime/workflow/compile
 *
 * Receives the workflow graph (nodes + connections) and spins up
 * the corresponding agents/orchestrator in the runtime.
 */
router.post('/runtime/workflow/compile', async (req, res) => {
  const { nodes, connections }: WorkflowRunRequest = req.body;

  if (!nodes?.length) {
    res.status(400).json({ error: 'Workflow must contain at least one node' });
    return;
  }

  const agentNodes = nodes.filter((n) => n.type === 'agent');
  if (agentNodes.length === 0) {
    res.status(400).json({ error: 'Workflow must contain at least one agent' });
    return;
  }

  try {
    // Build execution queue (Kahn's topological sort) and validate
    const queueResult = buildExecutionQueue(nodes, connections);
    const { levels: executionQueue, predecessors, successors } = compileGraph(queueResult);
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

          const result = {
            content: [{ type: 'text', text: `${toolName} submitted successfully.` }],
          };

          // Fire session hooks for interface tools
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

    const sessionId = `workflow-${Date.now()}`;
    console.log(":::::: agent build correctly ") ;

    // Build all agents first
    const agentMap = new Map<string, { agent: AgentData; piAgent: PiAgent; keyRef: { current: string } }>();
    for (const node of agentNodes) {
      const keyRef = { current: '' };
      agentMap.set(node.id, { ...buildAgent(node, keyRef), keyRef });
    }

    // Assign interface tools to each agent based on outgoing interfaces
    const agentDetails: { name: string; model: string; sessionMode: string; thinkingLevel: string; tools: string[] }[] = [];

    for (const node of agentNodes) {
      console.log("agent node : ", node.name)
      const { agent: agentData, piAgent } = agentMap.get(node.id)!;
      const nodeSuccessors = successors.get(node.id) || [];
      const assignedTools: string[] = [];

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
        } else if (interfaceName === 'delegate') {
          const delegateSuccessors = successors.get(succ.id) || [];
          const subAgents: Record<string, string> = {};
          for (const delegatedNode of delegateSuccessors) {
            if (delegatedNode.type === 'agent') {
              const delegatedAgent = agentMap.get(delegatedNode.id);
              if (delegatedAgent) {
                subAgents[delegatedAgent.agent.name] = delegatedAgent.agent.description;
              }
            }
          }

          piAgent.addTool(createDelegateTool(subAgents));
          assignedTools.push(`delegate → [${Object.keys(subAgents).join(', ')}]`);
          console.log(`[runtime]   Assigned delegateTool to "${node.name}" (delegates to: ${Object.keys(subAgents).join(', ')})`);
        }
        console.log("11111 agent :",node.name," added tool :" , interfaceName) ; 
      }


      agentDetails.push({
        name: agentData.name,
        model: agentData.model,
        sessionMode: agentData.sessionMode || 'memory',
        thinkingLevel: agentData.thinkingLevel || 'medium',
        tools: assignedTools,
      });
    }

    // Dump registered tools for each agent
    for (const [nodeId, { agent, piAgent }] of agentMap) {
      console.log(`[DEBUG] Agent "${agent.name}" registered tools:`, piAgent.getRegisteredTools());
    }


    // Multiple agents — register each under composite key + reverse map
    for (const node of agentNodes) {
      const { agent, piAgent, keyRef } = agentMap.get(node.id)!;
      const compositeKey = `${sessionId}::${agent._id}`;
      activeAgents.set(compositeKey, piAgent);
      agentToSessionMap.set(agent._id, compositeKey);

      // Wire up hooks
      keyRef.current = compositeKey;
      sessionHooks.set(compositeKey, [{
        toolName: '*',
        callback: async ({ agentName, toolName, args }) => {
          console.log(`[workflow-hook] Agent "${agentName}" submitted "${toolName}"`);

          // Find the interface node matching the tool that was called
          const agentSuccessors = successors.get(node.id) || [];
          const interfaceNode = agentSuccessors.find(
            (n) => n.type === 'artefact' && toolName === `submit_${(n.name || '').toLowerCase()}`
          );

          let nextAgentInfos: { name: string; compositeKey: string }[] = [];
          if (interfaceNode) {
            const nextAgents = (successors.get(interfaceNode.id) || []).filter(
              (n) => n.type === 'agent'
            );
            nextAgentInfos = nextAgents.map((a) => {
              const entry = agentMap.get(a.id);
              const key = entry ? `${sessionId}::${entry.agent._id}` : '';
              return { name: a.name || a.id, compositeKey: key };
            });
            console.log(
              `[workflow-hook] Next agents after "${toolName}": [${nextAgentInfos.map((a) => a.name).join(', ')}]`
            );
          }

          // Broadcast to frontend via SSE
          const hookPayload = {
            type: 'hook_fired',
            agentName,
            toolName,
            args,
            nextAgents: nextAgentInfos,
          };
          console.log(`[workflow-hook] Emitting hook_fired:`, JSON.stringify(hookPayload, null, 2));
          workflowEvents.emit('hook_fired', hookPayload);
        },
      }]);

      console.log(`[runtime] Workflow agent "${agent.name}" → id: ${agent._id} | key: ${compositeKey} | tools: [${piAgent.getRegisteredTools().join(', ')}]`);
    }

    // First agent in execution queue is the default chat target
    const firstAgentNode = executionQueue.flat().find((n) => n.type === 'agent')!;
    const { agent: firstAgent } = agentMap.get(firstAgentNode.id)!;

    console.log(`[runtime] Workflow compiled with ${agentNodes.length} agents, first: "${firstAgent.name}"`);

    res.json({
      success: true,
      compilationSuccess: true,
      mode: 'multi-agent',
      sessionId,
      activeAgent: { name: firstAgent.name, id: firstAgent._id },
      agents: Array.from(agentMap.values()).map(({ agent }) => ({ name: agent.name, id: agent._id })),
      agentDetails,
      executionQueue: executionQueue.map((level) => level.map((n) => ({ id: n.id, type: n.type, name: n.name }))),
    });
  } catch (err: any) {
    console.error(`[runtime] Workflow run failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;

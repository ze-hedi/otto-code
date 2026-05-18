// runtime/routes/workflow.ts
// Workflow execution — translates the visual graph into runtime agents/orchestrators.

import { Router } from 'express';
import { PiAgent, PiAgentConfig } from '../../pi-agent.js';
import {
  activeAgents,
  sessionAgentMap,
  agentToSessionMap,
  setCurrentAgentId,
  resolveModel,
} from '../state.js';
import type { AgentData, AgentFile } from '../types.js';
import { buildExecutionQueue, compileGraph } from '../workflow-scheduler.js';
import { briefingTool, planTool, reportTool, createDelegateTool } from '../../workflow_interfaces_tools.js';

const router = Router();

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
    const buildAgent = (node: any): { agent: AgentData; piAgent: PiAgent } => {
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
          return {
            content: [{ type: 'text', text: `${toolName} submitted successfully.` }],
          };
        },
      };

      return { agent: node as AgentData, piAgent: new PiAgent(config) };
    };

    const sessionId = `workflow-${Date.now()}`;
    console.log(":::::: agent build correctly ") ;

    // Build all agents first
    const agentMap = new Map<string, { agent: AgentData; piAgent: PiAgent }>();
    for (const node of agentNodes) {
      agentMap.set(node.id, buildAgent(node));
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

    // Single agent — run directly
    if (agentNodes.length === 1) {
      const node = agentNodes[0];
      const { agent, piAgent } = agentMap.get(node.id)!;

      activeAgents.set(sessionId, piAgent);
      sessionAgentMap.set(sessionId, agent._id);
      setCurrentAgentId(sessionId);
      global.activeAgent = piAgent;
      global.activeAgentId = sessionId;

      console.log(`[runtime] Workflow single-agent session ${sessionId} started: "${agent.name}"`);

      res.json({
        success: true,
        compilationSuccess: true,
        mode: 'single-agent',
        sessionId,
        agent: agent.name,
        agentDetails,
        executionQueue: executionQueue.map((level) => level.map((n) => ({ id: n.id, type: n.type, name: n.name }))),
      });
      return;
    }

    // Multiple agents — register each under composite key + reverse map
    for (const node of agentNodes) {
      const { agent, piAgent } = agentMap.get(node.id)!;
      const compositeKey = `${sessionId}::${agent._id}`;
      activeAgents.set(compositeKey, piAgent);
      agentToSessionMap.set(agent._id, compositeKey);
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

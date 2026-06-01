// runtime/workflow-scheduler.ts
// Kahn's algorithm — builds a leveled execution queue from the workflow DAG.

interface WorkflowNode {
  id: string;
  type: string;
  name?: string;
  [key: string]: any;
}

interface WorkflowConnection {
  from: string;
  to: string;
  linkType?: string;
  [key: string]: any;
}

export interface ExecutionQueueResult {
  levels: WorkflowNode[][];
  predecessors: Map<string, WorkflowNode[]>;
  successors: Map<string, WorkflowNode[]>;
  /** Map of agentNodeId → tool nodes linked via tool-link connections. */
  toolLinks: Map<string, WorkflowNode[]>;
}

/**
 * Builds a parallel execution queue using topological sort (Kahn's algorithm).
 * Each level contains nodes that can run in parallel (same depth, independent).
 * tool-link connections are excluded — they represent bindings, not execution flow.
 *
 * Returns:
 * - levels: ordered array of parallel groups
 * - predecessors: Map<nodeId, nodes[]> — who feeds into each node
 * - successors: Map<nodeId, nodes[]> — who each node feeds into
 *
 * Throws if a cycle is detected.
 */
export function buildExecutionQueue(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[]
): ExecutionQueueResult {
  // Index all nodes by ID (including tools, for tool-link resolution)
  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) nodeMap.set(node.id, node);

  // Build tool-link map: agentNodeId → toolNode[]
  const toolLinkEdges = connections.filter((c) => c.linkType === 'tool-link');
  const toolLinks = new Map<string, WorkflowNode[]>();
  for (const edge of toolLinkEdges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;
    const agentId = fromNode.type === 'tool' ? edge.to : edge.from;
    const toolId = fromNode.type === 'tool' ? edge.from : edge.to;
    const toolNode = nodeMap.get(toolId);
    if (!toolNode || toolNode.type !== 'tool') continue;
    if (!toolLinks.has(agentId)) toolLinks.set(agentId, []);
    toolLinks.get(agentId)!.push(toolNode);
  }

  // Exclude tool nodes from execution graph
  const execNodes = nodes.filter((n) => n.type !== 'tool');

  // Only consider execution-flow edges (exclude tool-links)
  const execEdges = connections.filter((c) => c.linkType !== 'tool-link');

  // Build in-degree map, adjacency list, and predecessor/successor maps
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const predecessors = new Map<string, WorkflowNode[]>();
  const successors = new Map<string, WorkflowNode[]>();

  for (const node of execNodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    predecessors.set(node.id, []);
    successors.set(node.id, []);
  }

  for (const edge of execEdges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, inDegree.get(edge.to)! + 1);

    // Store references (not copies)
    successors.get(edge.from)!.push(nodeMap.get(edge.to)!);
    predecessors.get(edge.to)!.push(nodeMap.get(edge.from)!);
  }

  // Kahn's with level grouping
  const levels: WorkflowNode[][] = [];
  let currentLevel = execNodes.filter((n) => inDegree.get(n.id) === 0);

  let visited = 0;

  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    visited += currentLevel.length;

    const nextLevel: WorkflowNode[] = [];

    for (const node of currentLevel) {
      for (const neighborId of adjacency.get(node.id)!) {
        const newDegree = inDegree.get(neighborId)! - 1;
        inDegree.set(neighborId, newDegree);
        if (newDegree === 0) {
          const neighborNode = nodeMap.get(neighborId);
          if (neighborNode) nextLevel.push(neighborNode);
        }
      }
    }

    currentLevel = nextLevel;
  }

  if (visited < execNodes.length) {
    throw new Error('Cycle detected in workflow graph — cannot determine execution order');
  }

  return { levels, predecessors, successors, toolLinks };
}

/**
 * Validates the execution graph structure.
 * Rule: an agent cannot directly feed into another agent — an interface
 * must sit between them.
 *
 * Throws if the rule is violated. Returns the result unchanged if valid.
 */
export function compileGraph(result: ExecutionQueueResult): ExecutionQueueResult {
  const { levels, successors, predecessors } = result;

  for (const level of levels) {
    for (const node of level) {

      // Rule 1: agent/orchestrator cannot directly feed into another agent/orchestrator
      if (node.type === 'agent' || node.type === 'orchestrator') {
        const nodeSuccessors = successors.get(node.id) || [];
        for (const succ of nodeSuccessors) {
          if (succ.type === 'agent' || succ.type === 'orchestrator') {
            throw new Error(
              `Invalid workflow: "${node.name || node.id}" cannot directly feed into "${succ.name || succ.id}" — an interface must sit between them`
            );
          }
        }
      }

      // Rule 2: every interface must be fed by at least one agent or orchestrator
      if (node.type === 'artefact') {
        const nodePredecessors = predecessors.get(node.id) || [];
        const actorPredecessors = nodePredecessors.filter((n) => n.type === 'agent' || n.type === 'orchestrator');
        if (actorPredecessors.length === 0) {
          throw new Error(
            `Invalid workflow: interface "${node.name || node.id}" must be fed by at least one agent or orchestrator`
          );
        }
      }

      // Rule 3: only "Delegate" interface can feed multiple agents/orchestrators; others feed 0 or 1
      if (node.type === 'artefact') {
        const nodeSuccessors = successors.get(node.id) || [];
        const actorSuccessors = nodeSuccessors.filter((n) => n.type === 'agent' || n.type === 'orchestrator');
        const isDelegate = (node.name || '').toLowerCase() === 'delegate';
        if (!isDelegate && actorSuccessors.length > 1) {
          throw new Error(
            `Invalid workflow: interface "${node.name || node.id}" can only feed 0 or 1 agent/orchestrator, but feeds ${actorSuccessors.length} — only "Delegate" can feed multiple`
          );
        }
      }

    }
  }

  return result;
}

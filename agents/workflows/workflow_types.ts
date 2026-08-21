export enum NodeType { agent, node }

export interface WorkflowNode {
  id: string;
  type: NodeType;
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export interface WorkflowComponent {
  id: string;
  type: string;
  x: number;
  y: number;
}

export interface WorkflowConnection {
  from: string;
  fromSide: string;
  to: string;
  toSide: string;
}

export interface WorkflowSchema {
  components: WorkflowComponent[];
  connections: WorkflowConnection[];
}


export interface ExecutionQueueResult {
  levels: WorkflowNode[][];               // levels that will actually RUN (agent nodes only)
  predecessors: Map<string, WorkflowNode[]>;
  successors: Map<string, WorkflowNode[]>;
}

export class Workflow {
    private ExecutionQueue_ : ExecutionQueueResult ; 
    private components_ :  WorkflowNode[] ; 
    private connections_ : WorkflowEdge[] ; 


    constructor(workflowRecord : Record<string, any> ) 
    {
        const components = workflowRecord["components"] as WorkflowComponent[];
        const connections = workflowRecord["connections"] as WorkflowConnection[];

        this.components_ = components.map((c) => ({
            id: c.id,
            type: c.type === "agent" ? NodeType.agent : NodeType.node,
        }));
        this.connections_ = connections.map((c) => ({ from: c.from, to: c.to }));
    } ; 

    public get executionQueue(): ExecutionQueueResult { return this.ExecutionQueue_ ; }



    public buildExecutionQueue(
        nodes: WorkflowNode[] = this.components_,
        connections: WorkflowEdge[] = this.connections_,
    ) {
        // Index nodes by id
        const nodeMap = new Map<string, WorkflowNode>();
        for (const node of nodes) nodeMap.set(node.id, node);

        // Skip edges that reference missing nodes
        const validEdges = connections.filter(
            (e) => nodeMap.has(e.from) && nodeMap.has(e.to),
        );

        // Build in-degree, adjacency, predecessor/successor maps over ALL nodes
        const inDegree = new Map<string, number>();
        const adjacency = new Map<string, string[]>();
        const predecessors = new Map<string, WorkflowNode[]>();
        const successors = new Map<string, WorkflowNode[]>();

        for (const node of nodes) {
            inDegree.set(node.id, 0);
            adjacency.set(node.id, []);
            predecessors.set(node.id, []);
            successors.set(node.id, []);
        }

        for (const edge of validEdges) {
            adjacency.get(edge.from)!.push(edge.to);
            inDegree.set(edge.to, inDegree.get(edge.to)! + 1);

            successors.get(edge.from)!.push(nodeMap.get(edge.to)!);
            predecessors.get(edge.to)!.push(nodeMap.get(edge.from)!);
        }

        // Kahn's algorithm with level grouping (nodes with in-degree 0 start)
        const levels: WorkflowNode[][] = [];
        let currentLevel = nodes.filter((n) => inDegree.get(n.id) === 0);
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
                    const neighbor = nodeMap.get(neighborId);
                if (neighbor) nextLevel.push(neighbor);}}}
            currentLevel = nextLevel;
        }

        if (visited < nodes.length) {
            throw new Error('Cycle detected in workflow graph — cannot determine execution order');
        }

        const runLevels = levels
            .map((level) => level.filter((n) => n.type === NodeType.agent))
            .filter((level) => level.length > 0);

        this.ExecutionQueue_ = { levels: runLevels, predecessors, successors };
         
        }

        compileGraph() : void 
        {
            const {levels, successors, predecessors} = this.ExecutionQueue_ ; 

            for (const level of levels) {
                for (const node of level) {
                    
                    if (node.type === NodeType.agent) {
                        const nodeSuccessors = successors.get(node.id) || [] ; 
                        for (const succ of  nodeSuccessors) {
                            if (succ.type === NodeType.node) 
                                throw new Error(
                            `invalid workflow : ${node.id} need an interface to ${succ.id} `)  ;                   
                        } 
                    }
                }
            }
        }
} ;




import { ToolInput } from "./pi-agent-configs"
import { Type } from "@sinclair/typebox"


class AgentInterface {
    protected name_ : string ; 
    constructor(name:string) {this.name_ = name } ; 
} ; 



export class DelegationInterface extends AgentInterface{
    private toolForSuccessors_ : ToolInput ;
    private subAgentsInputsNames_ : [string,string][] ;
    private subAgentsOutputNames_ : [string,string][] ; 



    constructor(toolForSuccessors: ToolInput, subAgentsInputsNames : [string,string][],subAgentsOutputNames : [string,string][] ){
        super("delegation_interface") ; 
        this.toolForSuccessors_ = toolForSuccessors ;  
        this.subAgentsInputsNames_ = subAgentsInputsNames ; 
        this.subAgentsOutputNames_ = subAgentsOutputNames ; 

        
        this.toolForSuccessors_.parameters = Type.Object({
                                tasks: Type.Array(Type.Object({
                                task: Type.String({ description: "a clear description of a task to be run. Be specific about expected inputs, outputs, files to create/modify, and acceptance criteria. For explorer tasks, specify the question to answer and the subfolder to explore. For verifier tasks, list every file the preceding workers touched so tests can be written for all of them." }),
                                agent: Type.Union(this.subAgentsOutputNames_.map(a => Type.Literal(a[0], { description: a[1] })), { description: "which agent to assign this task to. Use 'explorer' to survey the codebase first, then 'worker' for implementation, and 'verifier' after every implementation batch." }),
                            }))
                        })
    } ; 
}



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


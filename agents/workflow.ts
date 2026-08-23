import { RawPiAgent } from "./raw-pi-agent";
import { RawPiAgentConfig } from "./pi-agent-configs";
import { ToolInput } from "./pi-agent-types";
import { handleEvent } from "./pi-agent-utils";
import {
    AgentsStorage,
    InterfaceStorage,
    NodeType,
    WorkflowNode,
    WorkflowEdge,
    WorkflowComponent,
    WorkflowConnection,
    ExecutionQueueResult,
} from "./workflow-types";

export class Workflow {
    private ExecutionQueue_ : ExecutionQueueResult ; 
    private components_ :  WorkflowNode[] ; 
    private connections_ : WorkflowEdge[] ; 
    private agents_ : Map<string,RawPiAgent> ; 
    private agentsStorage_ : AgentsStorage ;
    private interfaceStorage_ : InterfaceStorage ;  


    constructor(workflowRecord : Record<string, any>, agentsStorage : AgentsStorage, 
        interfaceStorage : InterfaceStorage
     ) 
    {
        const components = workflowRecord["components"] as WorkflowComponent[];
        const connections = workflowRecord["connections"] as WorkflowConnection[];

        this.agents_ = new Map<string, RawPiAgent>() ; 
        this.agentsStorage_ = agentsStorage ; 
        this.interfaceStorage_ = interfaceStorage ; 
        console.log(`interface storage state : ${this.interfaceStorage_}`) ; 
        

        this.components_ = components.map((c) => ({
            id: c.id,
            type: c.type === "agent" ? NodeType.agent : NodeType.interface,
        }));
        this.connections_ = connections.map((c) => ({ from: c.from, to: c.to }));
    } ; 

    public get executionQueue(): ExecutionQueueResult { return this.ExecutionQueue_ ; }

    //this ethod will allow building the underlying agent objects 
    public buildWorfklowAgents(): void 
    {
        for (const node of this.components_) {
            if (node.type === NodeType.agent) {
                console.log(`agent to build : ${node.id}`)
                let lTools2Inject : ToolInput[] = []; 
                let successors = this.ExecutionQueue_.successors.get(node.id) ; 
                let agentConfig = this.agentsStorage_?.getAgentByID(node.id) ; 
                if (successors) 
                    for (const succ of successors) {
                        if (succ.type === NodeType.interface) {
                            let link = this.interfaceStorage_?.getInterfaceByID(succ.id) ; 
                            let tool2Inject = link?.getTool() ; 
                            let promptsuffix_ = link?.getPromptSuffix() ; 
                            if (promptsuffix_) 
                               agentConfig.systemPrompt += "\n" + promptsuffix_ ;      
                            
                            console.log(`tool name : ${tool2Inject?.name}`) ; 
                            lTools2Inject?.push(tool2Inject) ;
                        }
                    }
                    if (agentConfig) {
                        agentConfig.tools = lTools2Inject ;
                        const agent = new RawPiAgent(agentConfig) ; 
                        console.log(`built ${node.id} agent successfuly !! `) ; 
                        this.agents_.set(node.id,agent) ; 
                    }
            }
        }
    }

    //This method will be called to build the execution queue based on the Kahn Algorithm
    public buildExecutionQueue(
        nodes: WorkflowNode[] = this.components_,
        connections: WorkflowEdge[] = this.connections_,
    ) {
        const nodeMap = new Map<string, WorkflowNode>();
        for (const node of nodes){            
            nodeMap.set(node.id, node);

        }

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

        for (const level of runLevels) {
            console.log("new level") ; 
            for (const node of level) {
                const nodeSuccessors = successors.get(node.id) || [] ; 
                console.log(`agent ${node.id}`)
                for (const succ of nodeSuccessors) {
                    if (succ?.type === NodeType.interface) 
                    {
                        console.log(`we need to add this tool ${succ.id}`)
                    }
                }
                
            }

        }
            console.log("~~~~~~~~~~~~ started bbuilding the underlying agent ")  ; 
            this.buildWorfklowAgents() ; 
         
        }
        
        //Once we've built the queue we check that the DAG respect all the rules
        compileGraph() : void 
        {
            const {levels, successors, predecessors} = this.ExecutionQueue_ ; 

            for (const level of levels) {
                for (const node of level) {
                    
                    if (node.type === NodeType.agent) {
                        const nodeSuccessors = successors.get(node.id) || [] ; 
                        for (const succ of  nodeSuccessors) {
                            if (succ.type === NodeType.interface) 
                                throw new Error(
                            `invalid workflow : ${node.id} need an interface to ${succ.id} `)  ;                   
                        } 
                    }
                }
            }
        }

        public getAvailableAgents() : RawPiAgent[] {
            return [...this.agents_.values()]; 
        }

        //Once we made sure that the graph is good we start running it. 
        //It should works as follow : 
        //We start by giving user inputs for the agent of the first level 
        async run(lvl_1_inputs:string[]) : Promise<void> 
        {
            const firstLevel = this.ExecutionQueue_.levels[0] ;
            if (lvl_1_inputs.length !== firstLevel.length)
                throw new Error("input strings should be equal to the number of first level agents") ;
            
            for (let i = 0; i < lvl_1_inputs.length; ++i) {
                const agent = this.agents_.get(firstLevel[i].id) ;
                if (!agent) throw new Error(`no agent built for ${firstLevel[i].id}`) ;
                await agent.chat(lvl_1_inputs[i], handleEvent) ;
            }
        }



} ;

import { RawPiAgentConfig } from "./pi-agent-configs";
import { AgentInterface } from "./workflow-interface";



//class to store available agents
//we store agent with their config and the agent object so we can instiate as much copies 
export class AgentsStorage {
    private availableAgents_ : Map<string, RawPiAgentConfig> ; 

    constructor(availableAgents ?: Map<string,RawPiAgentConfig>) {
        this.availableAgents_ = availableAgents ; 
    }
    

    public getAgentByID(id: string) : RawPiAgentConfig {
        return this.availableAgents_.get(id) ; 
    }
}



export class InterfaceStorage {
    private availablesInterfaces_ : Map<string,AgentInterface> ;

    constructor(availablesInterfaces : Map<string,AgentInterface>) {
        this.availablesInterfaces_ = availablesInterfaces ; 
    }

    public getInterfaceByID(id:string) : AgentInterface {
        return this.availablesInterfaces_.get(id) ;   
    }
}



export enum NodeType { agent, interface }

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




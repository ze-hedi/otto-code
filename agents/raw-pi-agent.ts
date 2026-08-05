// raw-pi-agent.ts
// Subclass of PiAgent that takes full control of the system prompt,
// injecting built-in tool definitions (description, parameters, guidelines)
// so the caller can craft the prompt with full awareness of available tools.

import {
  SessionManager,
  AgentSession,
  type ToolDefinition,
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
} from "@mariozechner/pi-coding-agent";
import {ToolInput, type RawPiAgentConfig } from "./pi-agent-configs.js";
import {PiAgent} from "./pi-agent"
import { createSubAgentTool } from "./sub-agent-pattern.js";


const builtInToolFactories: Record<string, (cwd: string) => ToolDefinition> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
};

export class RawPiAgent extends PiAgent {
  private _baseSystemPrompt: string | undefined;
  private _subAgentToolNames: Set<string> = new Set();
  protected _persistentSubAgents: Map<string,PiAgent> = new Map(); 
  protected _persistentSubAgentsTool: Map<string,ToolInput> = new Map() ; 
  

  constructor(config: RawPiAgentConfig) {
    const { systemPrompt, ...baseConfig } = config;
    super(baseConfig);


    if (config.persistantSubAgents) {
      for (const [key, subAgentPair] of Object.entries(config.persistantSubAgents)) {
        let subAgent = new RawPiAgent(subAgentPair[0]) ; 
        this._persistentSubAgents.set(key,subAgent) ; 
        let tool_input : ToolInput = this._createPersistentSubAgentTool(subAgentPair[1],subAgent ) ; 
        this._persistentSubAgentsTool.set(key,tool_input) ; 
      }
    }

    this._baseSystemPrompt = systemPrompt;
    this._noContextFiles = true;
  }

  private async _buildToolsSection(): Promise<string> {
    const lines = ["# Available Tools", ""];

    // Built-in tools
    const cwd = this.config.playground;
    const builtInDefs = this._builtInTools
      .map((name) => builtInToolFactories[name]?.(cwd))
      .filter((d): d is ToolDefinition => d !== undefined);

    for (const def of builtInDefs) {
      lines.push(`## ${def.name}`);
      lines.push(def.description);
      if (def.promptGuidelines?.length) {
        lines.push("Guidelines:");
        for (const g of def.promptGuidelines) {
          lines.push(`- ${g}`);
        }
      }
      lines.push("");
    }

    // Custom tools (registered via config.tools)
    const builtInNames = new Set(this._builtInTools);
    for (const [name, def] of this.toolDefinitions) {
      if (builtInNames.has(name)) continue; // already rendered above
      if (this._subAgentToolNames.has(name)) continue; // rendered in own section
      lines.push(name);
      lines.push(def.description);
      if (def.promptSnippet) {
        lines.push(def.promptSnippet);
      }
      if (def.promptGuidelines?.length) {
        lines.push("Guidelines:");
        for (const g of def.promptGuidelines) {
          lines.push(`- ${g}`);
        }
      }
      lines.push("");
    }

    // MCP tools — connect to all configured servers and inject their tools
    const mcpResults = await this.connectAllMcp();
    for (const [serverName, toolNames] of mcpResults) {
      for (const toolName of toolNames) {
        const def = this.toolDefinitions.get(toolName);
        if (def) {
          lines.push(`## ${def.name}`);
          lines.push(def.description);
          lines.push("");
        }
      }
    }

    // Volatile sub-agents — create tools, register for execution, render in own section
    if (this._subAgents.size > 0) {
      lines.push("# Available Volatile Subagents", "");
      lines.push("These are spawned subagents as a tool that don't keep context. You call them once, they do their job and their disappear")
      for (const [key, config] of this._subAgents) {
        const toolInput = createSubAgentTool(config);
        const toolDef = this._createToolDefinition(toolInput);
        this.toolDefinitions.set(toolInput.name, toolDef);
        this._subAgentToolNames.add(toolInput.name);

        lines.push(`## ${toolInput.name}`);
        lines.push(toolInput.description);
        if (toolInput.promptSnippet) {
          lines.push(toolInput.promptSnippet);
        }
        if (toolInput.promptGuidelines?.length) {
          lines.push("Guidelines:");
          for (const g of toolInput.promptGuidelines) {
            lines.push(`- ${g}`);
          }
        }
        lines.push("");
      }
    }

    if (this._persistentSubAgents.size>0) {

      lines.push("# Available persistant Subagents","" ) ; 
      lines.push("These are subAgent with persistent memory : They keep context between different calls") ; 
      for (const [key,toolInput] of this._persistentSubAgentsTool) {
        const toolDef = this._createToolDefinition(toolInput) ;
        this.toolDefinitions.set(toolInput.name,toolDef) ;
        this._subAgentToolNames.add(toolInput.name); 

        lines.push(`## ${toolInput.name}`);
        lines.push(toolInput.description);
        if (toolInput.promptSnippet) {
          lines.push(toolInput.promptSnippet);
        }
        if (toolInput.promptGuidelines?.length) {
          lines.push("Guidelines:");
          for (const g of toolInput.promptGuidelines) {
            lines.push(`- ${g}`);
          }
        }
        lines.push("");

      }

    }

    return lines.join("\n");
  }

  protected override async _createSessionWith(
    sessionManager: SessionManager,
  ): Promise<AgentSession> {
    if (this._baseSystemPrompt !== undefined) {
      this._systemPrompt = this._baseSystemPrompt + "\n\n" + await this._buildToolsSection();
    }

    const session = await super._createSessionWith(sessionManager);

    // Strip the date/cwd lines that buildSystemPrompt() always appends
    // session.agent.state.systemPrompt = session.agent.state.systemPrompt
    //   .replace(/\nCurrent working directory: .+/, "");

    return session;
  }
}

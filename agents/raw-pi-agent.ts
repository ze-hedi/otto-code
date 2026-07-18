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
import { PiAgent, type PiAgentConfig } from "./pi-agent.js";

export type RawPiAgentConfig = Omit<PiAgentConfig, "systemPromptSuffix"> & {
  /** Fully replace Pi's default system prompt. The SDK still appends project
   *  context, skills, date, and cwd after it. */
  systemPrompt?: string;
};

const builtInToolFactories: Record<string, (cwd: string) => ToolDefinition> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
};

export class RawPiAgent extends PiAgent {
  private _baseSystemPrompt: string | undefined;

  constructor(config: RawPiAgentConfig) {
    const { systemPrompt, ...baseConfig } = config;
    super(baseConfig);
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

    // Custom tools (registered via config.tools, e.g. sub-agent tools)
    const builtInNames = new Set(this._builtInTools);
    for (const [name, def] of this.toolDefinitions) {
      if (builtInNames.has(name)) continue; // already rendered above
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
    session.agent.state.systemPrompt = session.agent.state.systemPrompt
      .replace(/\nCurrent working directory: .+/, "");

    return session;
  }
}

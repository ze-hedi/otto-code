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
import { PiAgent } from "./pi-agent.js";

const builtInToolFactories: Record<string, (cwd: string) => ToolDefinition> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
};

export class RawPiAgent extends PiAgent {
  protected override async _createSessionWith(
    sessionManager: SessionManager,
  ): Promise<AgentSession> {
    if (this._systemPrompt !== undefined) {
      const cwd = this.config.playground;
      const toolDefs = this._builtInTools
        .map((name) => builtInToolFactories[name]?.(cwd))
        .filter((d): d is ToolDefinition => d !== undefined);

      console.log("built-in tool definitions:");
      for (const def of toolDefs) {
        console.log(`\n=== ${def.name} ===`);
        console.log(`description: ${def.description}`);
        console.log(`promptSnippet: ${def.promptSnippet}`);
        console.log(`promptGuidelines: ${JSON.stringify(def.promptGuidelines)}`);
        console.log(`parameters: ${JSON.stringify(def.parameters, null, 2)}`);
      }
    }

    return super._createSessionWith(sessionManager);
  }
}

import { Type, TSchema } from "typebox";
import { PiAgent, ToolInput } from "./pi-agent.js";

export interface SubAgentToolConfig {
  agent: PiAgent;
  name: string;
  description: string;
  parameters?: TSchema;
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export function createSubAgentTool(config: SubAgentToolConfig): ToolInput {
  const parameters = config.parameters ?? Type.Object({
    task: Type.String({ description: "The task and all context the sub-agent needs" }),
  });

  return {
    name: config.name,
    label: config.name.replace(/_/g, " "),
    description: config.description,
    parameters,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    execute: async (_toolCallId, params) => {
      const task = (params as { task: string }).task;

      try {
        await config.agent.execute(task);

        const messages = await config.agent.getMessages();
        const last = messages.filter((m) => m.role === "assistant").at(-1);

        let output = "";
        if (last) {
          if (typeof last.content === "string") {
            output = last.content;
          } else if (Array.isArray(last.content)) {
            output = last.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n");
          }
        }

        return { content: [{ type: "text", text: output || "(no output)" }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
      }
    },
  };
}

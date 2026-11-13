import { Type } from "typebox";
import { PiAgent } from "./pi-agent.js";
import { ToolInput, SubAgentToolConfig , PersistantSubAgentToolConfig} from "./pi-agent-types.js";
import { RawPiAgent } from "./raw-pi-agent.js";
import type { TSchema } from "typebox";
import {handleEvent} from "./pi-agent-utils"; 

export type { SubAgentToolConfig };



export function createPersistentSubAgentTool(config: PersistantSubAgentToolConfig, agent: PiAgent): ToolInput {
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
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const entries = Object.entries(params as Record<string, unknown>);
      const task = entries.map(([k, v]) => {
        const val = Array.isArray(v) ? v.join(", ") : String(v);
        return `${k}: ${val}`;
      }).join("\n\n");

      try {
        await agent.chat(task);

        const messages = await agent.getMessages();
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

// Creates a tool that spins up a fresh RawPiAgent per call — stateless, no memory between invocations.
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
    executionMode: "parallel",
    execute: async (toolCallId, params, _signal, onUpdate) => {
      let task: string;
      let tools = config.tools;
      try {
        if (config.prepare) {
          const prepared = config.prepare(params);
          task = prepared.task;
          tools = [...(config.tools ?? []), ...(prepared.tools ?? [])];
        } else {
          task = Object.entries(params as Record<string, unknown>).map(([k, v]) => {
            const val = Array.isArray(v) ? v.join(", ") : String(v);
            return `${k}: ${val}`;
          }).join("\n\n");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: invalid sub-agent input: ${msg}` }], isError: true };
      }

      const agent = new RawPiAgent({
        name: config.name,
        // one session file per call: a shared file would leak history between calls and collide in parallel
        agentId: `${config.name}-${toolCallId}`,
        model: config.model,
        systemPrompt: config.systemPrompt,
        builtInTools: config.builtInTools,
        playground: config.playground,
        skills: config.skills,
        mcpServers: config.mcpServers,
        tools,
      });

      try {
        await agent.execute(task, undefined, onUpdate ? (event) => {
          onUpdate({
            content: [{ type: "text", text: "" }],
            details: { subagentEvent: true, event },
          });
        } : undefined);

        const messages = await agent.getMessages();
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
        return { content: [{ type: "text", text: `Error: subagent didn't get launched ${msg}` }], isError: true };
      } finally {
        await agent.disconnectMcp().catch(() => {});
      }
    },
  };
}

import type { RawPiAgentConfig } from "../../../../agents/pi-agent-configs.js";
import type { SerializableAgentConfig } from "../types.js";
import { makeClarificationTool } from "./clarification.js";

const API_KEY_ENV: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

export function resolveApiKey(model: string): string | undefined {
  const provider = model.split("/")[0];
  const envVar = API_KEY_ENV[provider];
  return envVar ? process.env[envVar] : undefined;
}

/** Maps a stored agent config to the config RawPiAgent consumes. */
export function toRawAgentConfig(agentId: string, config: SerializableAgentConfig): RawPiAgentConfig {
  const rawConfig: RawPiAgentConfig = {
    name: config.name,
    model: config.model,
    apiKey: resolveApiKey(config.model),
    systemPrompt: config.systemPrompt,
    playground: config.playground,
    workingDir: config.workingDir,
    builtInTools: config.builtInTools,
    mcpServers: config.mcpServers,
    mcpConnectionTimeout: config.mcpConnectionTimeout,
    toolCallGuardrails: config.toolCallGuardrails,
    thinkingLevel: config.thinkingLevel,
    compaction: config.compaction,
    ...(config.subAgents && { subAgents: config.subAgents }),
  };

  if (config.clarificationTool) {
    rawConfig.tools = [...(rawConfig.tools ?? []), makeClarificationTool(agentId)];
  }

  return rawConfig;
}

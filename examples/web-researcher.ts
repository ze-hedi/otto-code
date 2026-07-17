import "dotenv/config";
import { RawPiAgent, RawPiAgentConfig } from "../agents/raw-pi-agent";

const config: RawPiAgentConfig = {
  model: "deepseek/deepseek-v4-pro",
  sessionMode: "memory",
  systemPrompt: "You are a helpful assistant.",
  builtInTools: ["read", "edit", "write"],
  mcpServers:{tavily_mcp:"http://0.0.0.0:8000/mcp"},
};

const agent = new RawPiAgent(config);


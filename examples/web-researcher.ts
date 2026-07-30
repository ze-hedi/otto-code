
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { RawPiAgent, RawPiAgentConfig } from "../agents/raw-pi-agent";
import { handleEvent } from "../agents/pi-agent-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(resolve(__dirname, "web-research-sys-prompt.md"), "utf-8");

const config: RawPiAgentConfig = {
  model: "deepseek/deepseek-v4-pro",
  sessionMode: "memory",
  systemPrompt,
  builtInTools: ["read", "edit", "write"],
  mcpServers:{tavily_mcp:"http://0.0.0.0:8000/mcp"},
};

const agent = new RawPiAgent(config);

const system_prompt = await agent.getSystemPrompt() ; 
console.log("### system prompt ###")  ; 
console.log(system_prompt) ; 

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));

while (true) {
  const input = await ask("\nYou: ");
  if (!input || input.toLowerCase() === "exit") break;
  await agent.chat(input, handleEvent);
}

rl.close();
process.exit(0);

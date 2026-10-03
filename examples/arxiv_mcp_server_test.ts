import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { RawPiAgent } from "../agents/raw-pi-agent";
import { RawPiAgentConfig } from "../agents/pi-agent-configs";
import { handleEvent } from "../agents/pi-agent-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const systemPrompt = `You are a literature reviewer specializing in transformer architectures.

Your job is to find, read, and synthesize academic papers on a given topic.
When asked about a research area, you should:
1. Search for relevant papers on arxiv
2. Read their abstracts and key details
3. Produce a structured literature review summarizing the main contributions, evolution of ideas, and open questions

Be thorough but concise. Cite paper titles and arxiv IDs. Organize findings chronologically or thematically as appropriate.`;

const config: RawPiAgentConfig = {
  model: "deepseek/deepseek-v4-pro",
  apiKey: process.env.DEEPSEEK_API_KEY,
  sessionMode: "memory",
  systemPrompt,
  builtInTools: [],
  mcpServers: { arxiv: "http://127.0.0.1:8000/mcp" },
};

const agent = new RawPiAgent(config);

const fullSystemPrompt = await agent.getSystemPrompt();
console.log("### Full System Prompt ###");
console.log(fullSystemPrompt);
console.log("### End System Prompt ###\n");

console.log("Starting research on RoPE (Rotary Position Embedding) in transformers...\n");

await agent.chat(
  "Do a literature review on RoPE (Rotary Position Embedding) in transformers. Find key papers, summarize the main ideas, how RoPE evolved, its variants, and open research questions.",
  handleEvent,
);

const stats = agent.getSessionStats();
console.log("\n### Session Stats ###");
console.log(JSON.stringify(stats, null, 2));

process.exit(0);

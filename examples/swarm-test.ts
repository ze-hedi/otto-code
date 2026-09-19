import { RawPiAgent } from "../agents/raw-pi-agent";
import { Swarm } from "../agents/swarm";
import { handleEvent } from "../agents/pi-agent-utils";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const MODEL = "deepseek/deepseek-v4-pro";

const backend = new RawPiAgent({
  name: "backend",
  model: MODEL,
  systemPrompt: "You are a backend engineer. You focus on APIs, databases, and server architecture. Keep your responses short (2-3 sentences max).",
  builtInTools: [],
  sessionMode: "memory",
});

const frontend = new RawPiAgent({
  name: "frontend",
  model: MODEL,
  systemPrompt: "You are a frontend engineer. You focus on UI, UX, and client-side performance. Keep your responses short (2-3 sentences max).",
  builtInTools: [],
  sessionMode: "memory",
});

const devops = new RawPiAgent({
  name: "devops",
  model: MODEL,
  systemPrompt: "You are a DevOps engineer. You focus on deployment, CI/CD, and infrastructure. Keep your responses short (2-3 sentences max).",
  builtInTools: [],
  sessionMode: "memory",
});

async function main() {
  const swarm = new Swarm([
    { agent: backend, name: "Backend Engineer", description: "Backend specialist focused on APIs and databases" },
    { agent: frontend, name: "Frontend Engineer", description: "Frontend specialist focused on UI and UX" },
    { agent: devops, name: "DevOps Engineer", description: "DevOps specialist focused on deployment and infrastructure" },
  ]);

  await swarm.run("I want to build a real-time chat application", 20, handleEvent);
}

main().catch(console.error);

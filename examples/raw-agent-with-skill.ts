import { RawPiAgent } from "../agents/raw-pi-agent.ts";
import { handleEvent } from "../agents/pi-agent-utils";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const systemPrompt: string = `You are Otto, a concise coding assistant. Use the skills available to you when a task matches their description.`;

const agent = new RawPiAgent({
    name: "otto skill agent",
    model: "deepseek/deepseek-v4-pro",
    systemPrompt: systemPrompt,
    builtInTools: ["read", "bash"],
    playground: resolve(__dirname, ".."),
    sessionMode: "memory",
    // a skill folder (contains SKILL.md) or a parent folder of several skill folders
    skills: [resolve(__dirname, "skills/repo-summary")],
});

console.log(await agent.getSystemPrompt());

await agent.execute("Give me an overview of the examples/ folder.", undefined, handleEvent);

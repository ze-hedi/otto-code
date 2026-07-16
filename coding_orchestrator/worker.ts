import "dotenv/config";
import path from "path";
import { PiAgent } from "../pi-agent.js";

export const PLAYGROUND = path.join(process.env.HOME!, "code/antares-xpansion");
export const WORKER_MODEL = "deepseek/deepseek-v4-pro";
export const WORKER_THINKING: "high" = "high";

// ── Worker agent ───────────────────────────────────────────────────────────────

export const worker = new PiAgent({
  name: "worker",
  model: WORKER_MODEL,
  systemPromptSuffix: "",
  builtInTools: ["read", "bash", "edit", "write"],
  playground: PLAYGROUND,
  sessionMode: "memory",
  thinkingLevel: WORKER_THINKING,
  handlers: {
    onTextDelta: (delta) => process.stdout.write(delta),
    onToolStart: (id, name, args) =>
      console.log(`\n[tool:start] id=${id} name=${name}`, JSON.stringify(args, null, 2)),
  },
});

// CLI entry point — only runs when this file is executed directly
const isDirectRun = process.argv[1]?.includes("worker");
if (isDirectRun) {
  const readline = await import("readline");

  console.log("system prompt:");
  const session = await worker.getSession();
  console.log(session.systemPrompt);

  while (true) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) => {
      rl.question("enter query ", resolve);
    });

    if (answer === "exit") {
      rl.close();
      break;
    }

    await worker.chat(answer);
  }
}

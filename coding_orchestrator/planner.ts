import "dotenv/config";
import fs from "fs";
import path from "path";
import { PiAgent } from "../pi-agent.js";

export const plannerPrompt = fs.readFileSync(
  path.join(import.meta.dirname, "planner.md"),
  "utf-8"
);

export const PLAYGROUND = path.join(process.env.HOME!, "code/otto_code");
export const PLANNER_MODEL = "deepseek/deepseek-v4-pro";
export const PLANNER_THINKING: "high" = "high";

// ── Planner agent ──────────────────────────────────────────────────────────────

export const planner = new PiAgent({
  name: "planner",
  model: PLANNER_MODEL,
  systemPromptSuffix: plannerPrompt,
  builtInTools: ["read", "bash"],
  playground: PLAYGROUND,
  sessionMode: "memory",
  thinkingLevel: PLANNER_THINKING,
  handlers: {
    onTextDelta: (delta) => process.stdout.write(delta),
    onToolStart: (id, name, args) =>
      console.log(`\n[tool:start] id=${id} name=${name}`, JSON.stringify(args, null, 2)),
  },
});

// CLI entry point — only runs when this file is executed directly
const isDirectRun = process.argv[1]?.includes("planner");
if (isDirectRun) {
  const readline = await import("readline");

  console.log("system prompt ");
  const session = await planner.getSession();
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

    await planner.chat(answer);
  }
}

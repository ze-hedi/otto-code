import { RawPiAgent } from "../agents/raw-pi-agent";
import { Meeting } from "../agents/meeting";
import { handleEvent } from "../agents/pi-agent-utils";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const MODEL = "deepseek/deepseek-v4-pro";

const ceo = new RawPiAgent({
  name: "ceo",
  model: MODEL,
  systemPrompt: "You are a startup CEO. You are pragmatic and care about shipping fast. Keep your responses short (2-3 sentences max).",
  builtInTools: [],
  sessionMode: "memory",
});

const cto = new RawPiAgent({
  name: "cto",
  model: MODEL,
  systemPrompt: "You are a CTO. You care about technical quality and scalability. Keep your responses short (2-3 sentences max).",
  builtInTools: [],
  sessionMode: "memory",
});

const designer = new RawPiAgent({
  name: "designer",
  model: MODEL,
  systemPrompt: "You are a product designer. You care about user experience and simplicity. Keep your responses short (2-3 sentences max).",
  builtInTools: [],
  sessionMode: "memory",
});

async function main() {
  // Check sessions before meeting
  console.log("=== Before meeting ===");
  console.log("CEO sessions:", ceo.listSessions());
  console.log("CTO sessions:", cto.listSessions());
  console.log("Designer sessions:", designer.listSessions());

  const meeting = new Meeting(
    [
      { agent: ceo, name: "CEO", description: "Startup CEO focused on shipping fast" },
      { agent: cto, name: "CTO", description: "CTO focused on technical quality" },
      { agent: designer, name: "Designer", description: "Product designer focused on UX" },
    ],
    "Decide whether to build the MVP with a no-code tool or custom code.",
  );

  const transcript = await meeting.run(20, handleEvent);

  // Check sessions after meeting — each agent should have a "meeting" session
  console.log("\n=== After meeting ===");
  console.log("CEO sessions:", ceo.listSessions());
  console.log("CTO sessions:", cto.listSessions());
  console.log("Designer sessions:", designer.listSessions());

  console.log("\n=== Transcript ===");
  for (const turn of transcript.turns) {
    console.log(`\n[Round ${turn.round}] ${turn.agentName}:`);
    console.log(turn.message);
  }

  console.log("\n=== Result ===");
  console.log(`Rounds: ${transcript.rounds}`);
  console.log(`Consensus: ${transcript.reachedConsensus}`);
}

main().catch(console.error);

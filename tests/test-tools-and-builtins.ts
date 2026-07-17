// tests/test-tools-and-builtins.ts
// Live test: build an agent with custom tools, drop the built-in `read` tool,
// then ask the agent to report which tools it has access to.
//
// Run with:  tsx tests/test-tools-and-builtins.ts
// Requires ANTHROPIC_API_KEY in the environment (.env is loaded via dotenv).

import "dotenv/config";
import { PiAgent, type ToolInput } from "../agents/pi-agent";
import { handleEvent } from "../agents/pi-agent-utils";
import { Type } from "typebox";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pull plain text out of a message's content (string or array of blocks). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

// ── Custom tools ─────────────────────────────────────────────────────────────

const searchDatabaseTool: ToolInput = {
  name: "search_database",
  label: "Search Database",
  description: "Search the user database by name, email, or role.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query (matches name, email, or role)" }),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
  }),
  // One-liner so the tool shows up in the "Available tools" section of the prompt.
  promptSnippet: "search_database: search the user database by name, email, or role",
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Searched database for "${params.query}" (stub).` }],
      details: { query: params.query },
    };
  },
};

const getWeatherTool: ToolInput = {
  name: "get_weather",
  label: "Get Weather",
  description: "Get the current weather for a city.",
  parameters: Type.Object({
    location: Type.String({ description: "City name, e.g. 'Tunis'" }),
  }),
  promptSnippet: "get_weather: get current weather for a city",
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Weather in ${params.location}: sunny, 28°C (stub).` }],
      details: { location: params.location },
    };
  },
};

// ── Test ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Test: custom tools + built-in tool removal ===\n");

  const agent = new PiAgent({
    name: "tools-test-agent",
    model: "anthropic/claude-sonnet-4-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    thinkingLevel: "low",
    sessionMode: "memory",

    // Register one custom tool at construction time...
    tools: [searchDatabaseTool],

    // Drop the built-in `read` tool. Default is ["read", "bash", "edit", "write"];
    // by omitting "read" the agent can no longer read files.
    builtInTools: ["bash", "edit", "write"],
  });

  // ...and add a second custom tool dynamically before the first session exists.
  agent.addTool(getWeatherTool);

  // Sanity checks on the wrapper's own bookkeeping (no API call needed).
  console.log("Built-in tools enabled:", ["bash", "edit", "write"]);
  console.log("Registered custom tools:", agent.getRegisteredTools());
  console.log("Has 'search_database':", agent.hasTool("search_database"));
  console.log("Has 'get_weather':", agent.hasTool("get_weather"));
  console.log("Has 'read' (custom):", agent.hasTool("read"), "(read is a built-in, so false here)\n");

  if (!agent.isApiReady()) {
    console.error(
      "\n⚠️  No ANTHROPIC_API_KEY set — skipping the live 'what tools do you have' query.\n" +
      "    Set ANTHROPIC_API_KEY (or add it to .env) to run the full test."
    );
    return;
  }

  console.log("=== Asking the agent what tools it has ===\n");

  await agent.execute(
    "Without calling any tools, list every tool you currently have access to. " +
    "Explicitly state whether you have a file `read` tool. " +
    "Then confirm you can see the custom tools `search_database` and `get_weather`.",
    handleEvent
  );

  // Pull the agent's final answer back out of the session and print it on its own.
  const messages = await agent.getMessages();
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const finalResponse = extractText(lastAssistant?.content);

  console.log("\n\n=== Final agent response ===\n");
  console.log(finalResponse || "(no text response captured)");

  console.log("\n\n✅ Done — verify above that the agent lists bash/edit/write + the two");
  console.log("   custom tools, and reports that it has NO `read` tool.\n");
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

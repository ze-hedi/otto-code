#!/usr/bin/env tsx
// test-simple.ts - Simple test to debug Pi SDK

import "dotenv/config";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

async function test() {
  console.log("Starting test...");

  try {
    // Set up auth
    const authStorage = AuthStorage.create();
    
    // Set API key from environment if available
    if (process.env.ANTHROPIC_API_KEY) {
      authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
      console.log("Anthropic API key loaded from .env");
    }
    
    const modelRegistry = ModelRegistry.create(authStorage);

    console.log("Auth storage created");

    // Get model
    const model = getModel("anthropic", "claude-sonnet-4-5");
    if (!model) {
      throw new Error("Model not found");
    }
    console.log("Model found:", model.id);

    // Create session
    console.log("Creating session...");
    const { session } = await createAgentSession({
      model,
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      thinkingLevel: "medium",
    });

    console.log("Session created, subscribing to events...");

    // Subscribe to all events
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }

      if (event.type === "tool_call_start") {
        console.log(`\n⚙️ [${event.toolName}]`);
      }
    });

    console.log("Sending prompt...\n");
    await session.prompt("List all .ts files in the current directory");
    
    console.log("\n\n--- Harness Response ---");
    const assistantResponse = session.getLastAssistantText();
    console.log(assistantResponse);
    
    console.log("\n--- All Messages ---");
    console.log(JSON.stringify(session.state.messages, null, 2));
    
    console.log("\n✅ Done!");
  } catch (error) {
    console.error("ERROR:", error);
    process.exit(1);
  }
}

test().catch((error) => {
  console.error("ERROR:", error);
  process.exit(1);
});

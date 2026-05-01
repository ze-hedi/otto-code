// runtime/pi-agent-utils.ts
// Shared utilities for handling PiAgent events.

import { AgentEvent } from './pi-agent';

/**
 * Logs every AgentEvent to stdout in a human-readable format.
 * Suitable for use as the event handler passed to agent.execute() / agent.chat().
 */
export function handleEvent(event: AgentEvent) {
  switch (event.type) {
    case "agent_start":
      console.log("--- agent start ---");
      break;

    case "agent_end":
      console.log("--- agent end ---");
      break;

    case "turn_start":
      console.log("\n--- turn start ---");
      break;

    case "turn_end":
      console.log("\n--- turn end ---");
      break;

    case "message_start":
      console.log("\n--- message start ---");
      break;

    case "message_end":
      console.log("\n--- message end ---");
      break;

    case "message_update":
      switch (event.assistantMessageEvent.type) {
        case "thinking_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "thinking_end":
          console.log("\n--- end of thinking ---\n");
          break;
        case "text_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "toolcall_end":
          console.log(`\n🔧 [tool call] ${event.assistantMessageEvent.toolCall.name} ${JSON.stringify(event.assistantMessageEvent.toolCall.arguments)}`);
          break;
        case "text_end":
          console.log(`\n--- text block end ---`);
          break;
        case "done":
          console.log(`\n--- stream done (${event.assistantMessageEvent.reason}) ---`);
          break;
        case "error":
          console.log(`\n--- stream error (${event.assistantMessageEvent.reason}) ---`);
          break;
      }
      break;

    case "tool_execution_start":
      console.log(`\n⚙️  [${event.toolName}] ${JSON.stringify(event.args)}`);
      
      // Log file path for write/edit operations
      if (event.toolName === 'write' || event.toolName === 'edit') {
        const filePath = (event.args as any)?.filePath;
        if (filePath) {
          console.log(`📝 File operation: ${event.toolName} → ${filePath}`);
        }
      }
      break;

    case "tool_execution_update":
      process.stdout.write(String(event.partialResult));
      break;

    case "tool_execution_end": {
      const result = String(event.result);
      if (event.isError) {
        console.log(`\n❌ [${event.toolName}] error: ${result}`);
      } else {
        console.log(`\n✅ [${event.toolName}]:\n${result}`);
      }
      break;
    }

    case "queue_update":
      console.log(`\n--- queue update (steering: ${event.steering.length}, followUp: ${event.followUp.length}) ---`);
      break;

    case "compaction_start":
      console.log(`\n--- compaction start (${event.reason}) ---`);
      break;

    case "compaction_end":
      console.log(`\n--- compaction end (${event.reason}, aborted: ${event.aborted}) ---`);
      break;

    case "session_info_changed":
      console.log(`\n--- session name: ${event.name} ---`);
      break;

    case "auto_retry_start":
      console.log(`\n--- retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms: ${event.errorMessage} ---`);
      break;

    case "auto_retry_end":
      console.log(`\n--- retry end (success: ${event.success}, attempt: ${event.attempt}${event.finalError ? `, error: ${event.finalError}` : ""}) ---`);
      break;
  }
}

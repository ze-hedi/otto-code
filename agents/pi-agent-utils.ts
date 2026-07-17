// runtime/pi-agent-utils.ts
// Shared utilities for handling PiAgent events.

import { AgentEvent } from './pi-agent';

/**
 * Forwards relevant AgentEvents to a frontend client over SSE.
 * Pass the request-scoped `send` function from the chat route.
 */
export function handleEventWithClient(event: AgentEvent, send: (payload: object) => void) {
  console.log("printing full event ") 
  console.log(event)
  switch (event.type) {
    case "message_update":
      switch (event.assistantMessageEvent.type) {
        case "text_delta":
          send({ type: 'delta', text: event.assistantMessageEvent.delta });
          break;
        case "thinking_delta":
          send({ type: 'thinking', text: event.assistantMessageEvent.delta });
          break;
        case "done":
          send({ type: 'done' });
          break;
        case "error":
          send({ type: 'error', message: event.assistantMessageEvent.reason });
          break;
      }
      break;

    case "tool_execution_start":
      send({ type: 'tool_start', name: event.toolName, args: event.args });
      break;

    case "tool_execution_end":
      send({ type: 'tool_end', name: event.toolName, result: event.result, isError: event.isError });
      break;
  }
}

/**
 * Logs every AgentEvent to stdout in a human-readable format.
 * Suitable for use as the event handler passed to agent.execute() / agent.chat().
 */
export function handleEvent(event: AgentEvent) {
  console.log("printing the whole event ") ; 
  // console.log(event) ; 
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
      if (event.toolResults.length > 0) {
        console.log(`tool results:\n${JSON.stringify(event.toolResults, null, 2)}`);
      }
      break;

    case "message_start":
      console.log(`\n--- message start (role: ${event.message.role}) ---`);
      
      break;

    case "message_end":
      console.log(`\n--- message end (role: ${event.message.role}) ---`);
      break;

    case "message_update":
      switch (event.assistantMessageEvent.type) {
        case "thinking_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "thinking_end":
          console.log(`\n--- end of thinking ---\n${event.assistantMessageEvent.content}\n`);
          break;
        case "text_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "text_end":
          console.log(`\n--- text block end ---`);
          break;
        case "toolcall_end":
          console.log(`\n🔧 [tool call]\n${JSON.stringify(event.assistantMessageEvent.toolCall, null, 2)}`);
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
      console.log(`\n⚙️  [${event.toolName}]\n${JSON.stringify(event.args, null, 2)}`);
      break;

    case "tool_execution_update": {
      const partial = event.partialResult as any;
      const text = typeof partial === "string"
        ? partial
        : partial?.content?.[0]?.text ?? null;
      if (text) process.stdout.write(text);
      break;
    }

    case "tool_execution_end": {
      const result = typeof event.result === "string"
        ? event.result
        : JSON.stringify(event.result, null, 2);
      if (event.isError) {
        console.log(`\n❌ [${event.toolName}] error:\n${result}`);
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

// runtime/pi-agent-utils.ts
// Shared utilities for handling PiAgent events.

import type { AgentSessionEvent as AgentEvent } from '@mariozechner/pi-coding-agent';

/**
 * Forwards relevant AgentEvents to a frontend client over SSE.
 * Pass the request-scoped `send` function from the chat route.
 */
export function handleEventWithClient(event: AgentEvent, send: (payload: object) => void) {
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

// ANSI escape codes
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const MAX_RESULT_LENGTH = 500;

function extractResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as any;
    if (Array.isArray(r.content)) {
      const text = r.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      if (text) return text;
    }
    if (Array.isArray(r)) {
      const text = r
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      if (text) return text;
    }
  }
  return JSON.stringify(result, null, 2);
}

let _inThinking = false;

export function handleEvent(event: AgentEvent) {
  // Catch errors on any event type — some events (e.g. message_end) carry
  // errorMessage without a dedicated "error" event type.
  const msg = (event as any).message ?? event;
  if (msg.errorMessage) {
    console.log(`\n${RED}[error on ${event.type}]${RESET} ${msg.errorMessage}`);
  }

  switch (event.type) {
    case "agent_start":
      console.log(`${DIM}[agent start]${RESET}`);
      break;

    case "agent_end":
      console.log(`\n${DIM}[agent end]${RESET}`);
      break;

    case "message_update":
      switch (event.assistantMessageEvent.type) {
        case "thinking_delta":
          if (!_inThinking) {
            _inThinking = true;
            console.log(`\n${DIM}[thinking]${RESET}`);
          }
          process.stdout.write(`${DIM}${event.assistantMessageEvent.delta}${RESET}`);
          break;
        case "thinking_end":
          _inThinking = false;
          process.stdout.write(`\n${RESET}`);
          break;
        case "text_delta":
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        case "text_end":
          process.stdout.write("\n");
          break;
        case "toolcall_end": {
          const tc = event.assistantMessageEvent.toolCall;
          console.log(`\n${CYAN}[tool] ${tc.name}${RESET}`);
          console.log(`${CYAN}input:${RESET} ${JSON.stringify(tc.arguments, null, 2)}`);
          break;
        }
        case "done":
          console.log(`\n${DIM}[done: ${event.assistantMessageEvent.reason}]${RESET}`);
          break;
        case "error": {
          const errMsg = (event.assistantMessageEvent.error as any)?.errorMessage;
          console.log(`\n${RED}[stream error: ${event.assistantMessageEvent.reason}]${RESET}`);
          if (errMsg) console.log(`${RED}${errMsg}${RESET}`);
          break;
        }
      }
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
      const text = extractResultText(event.result);
      if (event.isError) {
        console.log(`${RED}[${event.toolName} error]${RESET}\n${text}`);
      } else {
        const display = text.length > MAX_RESULT_LENGTH
          ? text.slice(0, MAX_RESULT_LENGTH) + `\n${DIM}... (truncated)${RESET}`
          : text;
        console.log(`${CYAN}[${event.toolName} result]${RESET}\n${display}`);
      }
      break;
    }

    case "auto_retry_start":
      console.log(`\n${RED}[retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms]${RESET} ${event.errorMessage}`);
      break;

    case "auto_retry_end":
      if (event.success) {
        console.log(`${DIM}[retry succeeded on attempt ${event.attempt}]${RESET}`);
      } else {
        console.log(`${RED}[retry failed on attempt ${event.attempt}]${RESET}${event.finalError ? ` ${event.finalError}` : ""}`);
      }
      break;

    case "compaction_end":
      if (event.errorMessage) {
        console.log(`${RED}[compaction error: ${event.errorMessage}]${RESET}`);
      }
      break;
  }
}

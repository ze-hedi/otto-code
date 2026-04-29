# Otto Reviewer

Class-based wrapper for the Pi coding agent TypeScript SDK. Configure once, query multiple times, subscribe to streaming events.

## Architecture

```
PiAgent (pi-agent.ts)
  ├─ Constructor: Configure model, system prompt, thinking level, session mode
  ├─ query(): Execute prompt, returns session for streaming
  └─ execute(): Execute prompt and wait for completion

AgentEvent subscription (from @mariozechner/pi-coding-agent)
  ├─ message_update → text_delta (stream LLM tokens)
  ├─ tool_call_start → agent invokes bash/read/write/edit
  ├─ tool_call_end → tool result returned
  ├─ message_end → LLM turn complete
  └─ prompt_end → entire query complete
```

## Setup

```bash
npm install
npx pi /login  # Authenticate with Anthropic API key
```

Or set API key at runtime:

```typescript
const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

### Troubleshooting

**API Quota Exceeded Error:**

If you get an error like:
```
400 {"type":"error","error":{"type":"invalid_request_error","message":"Third-party apps now draw from your extra usage..."}}
```

Solutions:
1. Add API quota at [claude.ai/settings/usage](https://claude.ai/settings/usage)
2. Or use a different API key: 
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   npx pi /login
   ```
3. Or provide the key programmatically:
   ```typescript
   const agent = new PiAgent({
     model: "anthropic/claude-sonnet-4-5",
     apiKey: process.env.ANTHROPIC_API_KEY,
   });
   ```

## Quick Start

### Basic Usage

```typescript
import { PiAgent } from "./pi-agent";

const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  thinkingLevel: "medium",
  sessionMode: "memory",
});

await agent.execute("List all TypeScript files in this directory", (event) => {
  // Stream text tokens to stdout
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }

  // Log tool calls
  if (event.type === "tool_call_start") {
    console.log(`\n⚙️ [${event.toolName}]`);
  }
});
```

### PR Reviewer

```typescript
const prReviewer = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  systemPromptSuffix: `
You are a senior engineer doing PR reviews.
- Be direct and opinionated
- Flag bugs as BLOCKING
- Flag style issues as NON-BLOCKING
- Always suggest concrete fixes

Output format:
## Summary
## Blocking issues
## Non-blocking suggestions
  `,
});

await prReviewer.execute(
  "Run git diff --staged and review all changes",
  streamToStdout
);
```

### Multiple Queries (Conversation)

```typescript
const agent = new PiAgent({
  model: "anthropic/claude-sonnet-4-5",
  sessionMode: "disk", // Persist session to disk
});

// First query
await agent.execute("Analyze the codebase structure", streamToStdout);

// Second query (agent remembers context from first query)
await agent.execute("Now explain the main class in each file", streamToStdout);
```

## Configuration Options

```typescript
interface PiAgentConfig {
  /** Model in "provider/model-name" format */
  model: string;

  /** Additional system prompt appended to Pi's default */
  systemPromptSuffix?: string;

  /** Thinking level: "off" | "low" | "medium" | "high" | "xhigh" */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";

  /** Override API key at runtime */
  apiKey?: string;

  /** Session persistence mode */
  sessionMode?: "memory" | "disk" | "continue";

  /** Working directory for disk-based sessions */
  workingDir?: string;
}
```

## Event Types

Subscribe to these events in your callback:

| Event Type         | Description                                | Key Fields                      |
| ------------------ | ------------------------------------------ | ------------------------------- |
| `message_update`   | LLM streaming text tokens                  | `assistantMessageEvent.delta`   |
| `tool_call_start`  | Agent starts calling a tool                | `toolName`, `input`             |
| `tool_call_end`    | Tool execution finished                    | `toolName`, `output`            |
| `message_end`      | One LLM turn complete                      | —                               |
| `prompt_end`       | Entire query complete                      | —                               |
| `compaction`       | Context window compacted (near token limit)| —                               |

## Examples

Run the included examples:

```bash
npm run example:basic          # Basic query with streaming
npm run example:pr             # PR reviewer with custom system prompt
npm run example:conversation   # Multiple queries, same session
npm run example:logging        # Log all event types
npm run example:nonblocking    # Start query without awaiting
```

## Built-in Tools

The agent has four built-in tools (no MCP server needed):

| Tool  | Description                               | Example Prompt                              |
| ----- | ----------------------------------------- | ------------------------------------------- |
| bash  | Execute shell commands                    | "Run git diff HEAD~1"                       |
| read  | Read file contents                        | "Read src/main.ts and explain it"           |
| write | Write new files                           | "Create a test file for src/utils.ts"       |
| edit  | Edit existing files (find/replace)        | "Fix the bug in line 42 of src/parser.ts"   |

## Use Cases

### Code Review

```typescript
await agent.execute(`
  Run git diff main...HEAD and review:
  1. Are there any bugs or regressions?
  2. Is the code well-structured?
  3. Are there missing tests?
`);
```

### Changelog Generation

```typescript
await agent.execute(`
  Run git log --oneline -20, group commits into features/fixes/chores,
  and write a CHANGELOG.md entry.
`);
```

### Refactoring

```typescript
await agent.execute(`
  Read all files in src/, find all occurrences of function getCwd(),
  and rename it to getCurrentWorkingDirectory() everywhere.
`);
```

### Test Generation

```typescript
await agent.execute(`
  Read src/parser.ts and generate comprehensive unit tests
  in tests/parser.test.ts using Jest.
`);
```

## Session Modes

| Mode       | Description                              | Use Case                              |
| ---------- | ---------------------------------------- | ------------------------------------- |
| `memory`   | In-memory only, no disk writes           | Quick one-off queries                 |
| `disk`     | Save session to `.jsonl` file            | Resume later, inspect history         |
| `continue` | Resume most recent disk session          | Multi-query conversations             |

## API Reference

### `PiAgent`

#### Constructor

```typescript
constructor(config: PiAgentConfig)
```

#### `query(prompt: string, onEvent?: EventCallback): Promise<AgentSession>`

Execute a prompt and return the session immediately (non-blocking). Subscribe to events via `onEvent` or by calling `session.subscribe()` later.

#### `execute(prompt: string, onEvent?: EventCallback): Promise<void>`

Execute a prompt and wait for `prompt_end` event before resolving.

#### `getCurrentSession(): AgentSession | null`

Get the currently active session (if any).

## License

MIT

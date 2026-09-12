# pi-ai Tool Loop Reference

How to use `@mariozechner/pi-ai` as a standalone LLM calling layer — no AgentSession, no coding-agent, just direct LLM calls with a manual tool loop.

---

## Package split

| Package | What it does |
|---|---|
| `@mariozechner/pi-ai` | Raw LLM calls — models, streaming, tool definitions |
| `@mariozechner/pi-coding-agent` | Full agent session on top (bash tools, session persistence, loop) |

You can use `pi-ai` alone and manage the loop yourself.

---

## Minimal LLM call (no tools)

```typescript
import { getModel, complete } from '@mariozechner/pi-ai';

const model = getModel('anthropic', 'claude-opus-4-5');

const response = await complete(model, {
  systemPrompt: 'You are helpful.',
  messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }]
});

console.log(response.content[0].text);
console.log(response.usage);      // token counts
console.log(response.stopReason); // "stop" | "length" | "toolUse" | "error" | "aborted"
```

### Streaming variant

```typescript
import { stream } from '@mariozechner/pi-ai';

const events = stream(model, { messages: [...] });

for await (const event of events) {
  if (event.type === 'text_delta') process.stdout.write(event.delta);
  if (event.type === 'done')       console.log('\n', event.message);
  if (event.type === 'error')      console.error(event.error);
}
```

---

## Stop conditions

```typescript
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

| Value | Meaning | Loop action |
|---|---|---|
| `"stop"` | Model finished naturally | End loop |
| `"toolUse"` | Model wants to call tools | Execute tools, push results, loop |
| `"length"` | Hit `maxTokens` | End loop |
| `"error"` | Provider/safety error | End loop |
| `"aborted"` | `AbortSignal` triggered | End loop |

Only `"toolUse"` requires you to continue the loop.

---

## Tool definition

```typescript
import { Type } from '@mariozechner/pi-ai'; // re-exports TypeBox

const tools = [
  {
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    parameters: Type.Object({
      city: Type.String({ description: 'City name' })
    })
  },
  {
    name: 'finish',
    description: 'Call this with your final answer when you are done.',
    parameters: Type.Object({
      answer: Type.String()
    })
  }
];
```

---

## AssistantMessage shape (when stopReason === "toolUse")

```typescript
interface ToolCall {
  type: "toolCall";
  id: string;                      // Unique ID — required for matching results
  name: string;                    // Tool name
  arguments: Record<string, any>;  // Parsed arguments object
}

// response.content is an array that may mix text and tool calls:
// [
//   { type: "text",    text: "Let me check the weather..." },
//   { type: "toolCall", id: "call_1", name: "get_weather", arguments: { city: "Paris" } },
//   { type: "toolCall", id: "call_2", name: "get_weather", arguments: { city: "London" } }
// ]
```

---

## ToolResultMessage shape

After executing a tool, push a result back into the messages array.

```typescript
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;                         // Must match ToolCall.id exactly
  toolName: string;                           // Should match ToolCall.name
  content: (TextContent | ImageContent)[];    // At least one item required
  isError: boolean;                           // true if the tool failed
  timestamp: number;                          // Date.now()
}

// Text result
{
  role: 'toolResult',
  toolCallId: call.id,
  toolName: call.name,
  content: [{ type: 'text', text: 'Paris: 18°C, sunny' }],
  isError: false,
  timestamp: Date.now()
}

// Error result (model will see it and can recover)
{
  role: 'toolResult',
  toolCallId: call.id,
  toolName: call.name,
  content: [{ type: 'text', text: 'Connection timed out' }],
  isError: true,
  timestamp: Date.now()
}

// Image result
{
  role: 'toolResult',
  toolCallId: call.id,
  toolName: call.name,
  content: [
    { type: 'text',  text: 'Chart generated' },
    { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' }
  ],
  isError: false,
  timestamp: Date.now()
}
```

---

## Full tool loop

```typescript
import { getModel, complete } from '@mariozechner/pi-ai';
import { Type } from '@mariozechner/pi-ai';

const model = getModel('anthropic', 'claude-opus-4-5');

const context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [
    { role: 'user', content: 'What is the weather in Paris and London?', timestamp: Date.now() }
  ],
  tools
};

while (true) {
  const response = await complete(model, context);
  context.messages.push(response); // always append the assistant message first

  if (response.stopReason !== 'toolUse') break;

  const toolCalls = response.content.filter(b => b.type === 'toolCall');
  let shouldStop = false;

  for (const call of toolCalls) {
    // Termination tool — break before executing
    if (call.name === 'finish') {
      console.log('Final answer:', call.arguments.answer);
      shouldStop = true;
      break;
    }

    // Execute the tool
    let text: string;
    let isError = false;
    try {
      text = await executeTool(call.name, call.arguments);
    } catch (err) {
      text = (err as Error).message;
      isError = true;
    }

    context.messages.push({
      role: 'toolResult',
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: 'text', text }],
      isError,
      timestamp: Date.now()
    });
  }

  if (shouldStop) break;
}
```

---

## Message array across iterations

```
Initial:      [User]
→ complete()
After round 1: [User, Assistant(toolCall×2)]        stopReason: "toolUse"
→ push results
After results: [User, Assistant(toolCall×2), ToolResult1, ToolResult2]
→ complete()
After round 2: [User, Assistant(toolCall×2), ToolResult1, ToolResult2, Assistant(text)]  stopReason: "stop"
→ loop ends
```

**Rules:**
- Always push the `AssistantMessage` before pushing `ToolResultMessage`s.
- Push **all** tool results for a round before calling `complete()` again.
- The order of `ToolResultMessage`s should match the order of tool calls in the content array.

---

## Multi-tool calls (parallel)

The model can request multiple tools in a single response. Handle them all before looping:

```typescript
// response.content = [
//   { type: "toolCall", id: "c1", name: "get_weather", arguments: { city: "Paris" } },
//   { type: "toolCall", id: "c2", name: "get_weather", arguments: { city: "London" } }
// ]

context.messages.push(response);

// Can run in parallel
const results = await Promise.all(
  toolCalls.map(call => executeTool(call.name, call.arguments))
);

for (let i = 0; i < toolCalls.length; i++) {
  context.messages.push({
    role: 'toolResult',
    toolCallId: toolCalls[i].id,
    toolName: toolCalls[i].name,
    content: [{ type: 'text', text: results[i] }],
    isError: false,
    timestamp: Date.now()
  });
}
```

---

## Termination tool patterns

There is no built-in terminal tool in pi-ai. Two approaches:

### Option A — dedicated `finish` tool (structured final output)

Define a tool the model must call when it has its answer:

```typescript
{
  name: 'finish',
  description: 'Call this with your final structured answer when you are done. Do not call any other tools after this.',
  parameters: Type.Object({
    answer: Type.String(),
    confidence: Type.Number({ minimum: 0, maximum: 1 })
  })
}
```

Detect it in the loop:
```typescript
if (call.name === 'finish') {
  result = call.arguments; // structured output
  break;
}
```

Use when you want a **guaranteed structured output** at the end of the loop.

### Option B — let the model stop naturally

No finish tool — the loop exits when `stopReason !== "toolUse"`. The model's last text response is the answer:

```typescript
while (true) {
  const response = await complete(model, context);
  context.messages.push(response);
  if (response.stopReason !== 'toolUse') {
    const answer = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    break;
  }
  // ... handle tools
}
```

Use when you just want **free-form text** as the final answer.

---

## Argument validation

Validate tool arguments against the TypeBox schema before executing:

```typescript
import { validateToolCall } from '@mariozechner/pi-ai';

try {
  const validArgs = validateToolCall(tools, call); // throws if invalid
  const result = await executeTool(call.name, validArgs);
} catch (err) {
  context.messages.push({
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: `Invalid arguments: ${err.message}` }],
    isError: true,
    timestamp: Date.now()
  });
}
```

---

## Streaming with tool calls

```typescript
const events = stream(model, context);

let response;
for await (const event of events) {
  switch (event.type) {
    case 'text_delta':
      process.stdout.write(event.delta);
      break;
    case 'toolcall_start':
      console.log(`\nCalling tool: ${event.partial.content.at(-1)?.name}`);
      break;
    case 'toolcall_end':
      console.log('Args:', event.toolCall.arguments);
      break;
    case 'done':
      response = event.message;
      break;
    case 'error':
      console.error('Error:', event.error);
      break;
  }
}

// Then handle response.stopReason and tool calls as normal
```

### Streaming event types

```typescript
type AssistantMessageEvent =
  | { type: "start";          partial: AssistantMessage }
  | { type: "text_start";     contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta";     contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end";       contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end";   contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done";  reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "error" | "aborted";           error: AssistantMessage }
```

---

## Context is fully serializable

```typescript
// Save
const saved = JSON.stringify(context);
fs.writeFileSync('session.json', saved);

// Restore and continue
const context = JSON.parse(fs.readFileSync('session.json', 'utf8'));
const response = await complete(model, context);
```

---

## Abort a request

```typescript
const controller = new AbortController();

setTimeout(() => controller.abort(), 5000); // cancel after 5s

const response = await complete(model, context, { signal: controller.signal });
// response.stopReason === "aborted" if cancelled
```

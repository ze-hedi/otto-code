# The pi-agent-core Agent Loop -- A Complete Dissection

> Deep dive into Mario Zechner's `@mariozechner/pi-agent-core` agent loop:
> how it handles LLM calls, tool execution, streaming, message queuing,
> and context management.

---

## Architecture Overview

`pi-agent-core` is a two-layer system:

1. **Low-level loop functions** (`agent-loop.js`) -- stateless, pure orchestration logic
2. **High-level `Agent` class** (`agent.js`) -- stateful wrapper with message queuing, event subscriptions, and lifecycle management

The fundamental design principle: **AgentMessage[] is the internal currency; conversion to LLM-compatible Message[] happens only at the call boundary.** This separation lets the system carry custom message types (UI-only, steering, tool results with metadata) without polluting the LLM context.

---

## 1. Entry Points -- Three Ways In

### `agentLoop()` -- Start a fresh prompt

```js
export function agentLoop(prompts, context, config, signal, streamFn) {
    const stream = createAgentStream();
    void runAgentLoop(prompts, context, config, async (event) => {
        stream.push(event);
    }, signal, streamFn).then((messages) => {
        stream.end(messages);
    });
    return stream;
}
```

Returns an `EventStream<AgentEvent, AgentMessage[]>` **immediately** -- the loop runs asynchronously. The stream is an async iterable that consumers can `for await` over. The `createAgentStream` uses `EventStream` from `pi-ai`, ending when it sees an `agent_end` event and resolving its final value from `event.messages`.

### `agentLoopContinue()` -- Resume from existing context

Used for retries after tool execution or compaction. Validates that the last message is NOT an assistant message (LLM providers reject assistant->assistant sequences), then runs the same loop without adding new prompts.

### `runAgentLoop()` -- Direct async variant

Same as `agentLoop()` but returns `Promise<AgentMessage[]>` instead of a stream. This is what the `Agent` class uses internally -- it passes its own `processEvents` method as the `emit` callback.

---

## 2. The Core Loop -- Two Nested Whiles

This is the heart of the system (`agent-loop.js:77-137`):

```js
async function runLoop(currentContext, newMessages, config, signal, emit, streamFn) {
    let firstTurn = true;
    let pendingMessages = (await config.getSteeringMessages?.()) || [];

    // OUTER LOOP: follow-up messages
    while (true) {
        let hasMoreToolCalls = true;

        // INNER LOOP: tool calls + steering messages
        while (hasMoreToolCalls || pendingMessages.length > 0) {
            // 1. Emit turn_start (skip on first turn -- already emitted)
            // 2. Inject pending steering messages into context
            // 3. Stream assistant response from LLM
            // 4. Check for error/abort -> exit immediately
            // 5. Extract tool calls, execute them, collect results
            // 6. Emit turn_end
            // 7. Poll for new steering messages
        }

        // Agent would stop. Check for follow-up messages.
        const followUpMessages = (await config.getFollowUpMessages?.()) || [];
        if (followUpMessages.length > 0) {
            pendingMessages = followUpMessages;
            continue;  // re-enter outer loop
        }
        break;  // done
    }
    await emit({ type: "agent_end", messages: newMessages });
}
```

### Why two loops?

The **inner loop** handles the standard agent cycle: call LLM -> execute tools -> repeat. It exits when there are no more tool calls AND no steering messages.

The **outer loop** exists for a specific scenario: after the agent would naturally stop (no tool calls), external code might queue a follow-up message (e.g., "now summarize what you did"). `getFollowUpMessages()` is polled, and if messages exist, they become the next `pendingMessages` and the inner loop restarts.

### The `hasMoreToolCalls` flag

This starts as `true` on each outer loop iteration -- even before the first LLM call. This guarantees at least one LLM call per outer loop cycle. After tool execution, it's set to `!executedToolBatch.terminate`:

```js
hasMoreToolCalls = !executedToolBatch.terminate;
```

If the LLM produces no tool calls at all, `hasMoreToolCalls` is set to `false` (line 113), and the inner loop exits (unless steering messages arrived).

### Steering vs. Follow-up Messages

Both are user-injected messages, but with different timing:

- **Steering messages** (`getSteeringMessages`): polled at the START of the loop and AFTER each tool batch. Injected before the next LLM call. Use case: user types something while the agent is running.
- **Follow-up messages** (`getFollowUpMessages`): polled only when the agent would stop. Use case: programmatic "one more thing" after the agent finishes.

The `Agent` class implements both via `PendingMessageQueue` with two drain modes:
- `"all"`: drain all queued messages at once
- `"one-at-a-time"`: drain one per poll

---

## 3. The LLM Call -- `streamAssistantResponse()`

Located at `agent-loop.js:142-219`. This is the **only place** where AgentMessage[] crosses the LLM boundary.

### Step 1: Context transformation

```js
let messages = context.messages;
if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
}
```

Optional hook that operates on `AgentMessage[]`. This is where compaction/context pruning happens -- the pi-coding-agent session layer uses this to trim old messages when approaching the context window limit. The hook must not throw.

### Step 2: Format conversion

```js
const llmMessages = await config.convertToLlm(messages);
```

Converts `AgentMessage[]` to `Message[]` (LLM-compatible format). The default implementation simply filters to `user`, `assistant`, and `toolResult` roles:

```js
function defaultConvertToLlm(messages) {
    return messages.filter((message) =>
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "toolResult"
    );
}
```

Custom messages, UI-only messages, and internal metadata are stripped here.

### Step 3: Build LLM context and stream

```js
const llmContext = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
};

const streamFunction = streamFn || streamSimple;
const resolvedApiKey = (config.getApiKey
    ? await config.getApiKey(config.model.provider)
    : undefined) || config.apiKey;

const response = await streamFunction(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
});
```

`streamSimple` from `pi-ai` is the default stream function. It's provider-agnostic -- handles Anthropic, OpenAI, Google, etc. The `getApiKey` callback supports short-lived tokens (e.g., GitHub Copilot OAuth tokens that expire).

### Step 4: Process streaming events

The response is an async iterable of `AssistantMessageEvent`. The processing uses an **in-place partial message** pattern:

```js
let partialMessage = null;
let addedPartial = false;

for await (const event of response) {
    switch (event.type) {
        case "start":
            // First chunk: create partial message, push to context
            partialMessage = event.partial;
            context.messages.push(partialMessage);
            addedPartial = true;
            await emit({ type: "message_start", message: { ...partialMessage } });
            break;

        case "text_delta":
        case "thinking_delta":
        case "toolcall_delta":
        // ... and their _start/_end variants
            // Update partial in-place in context
            partialMessage = event.partial;
            context.messages[context.messages.length - 1] = partialMessage;
            await emit({
                type: "message_update",
                assistantMessageEvent: event,
                message: { ...partialMessage },
            });
            break;

        case "done":
        case "error":
            // Get final assembled message
            const finalMessage = await response.result();
            // Reconcile: replace partial or push if no partial existed
            if (addedPartial) {
                context.messages[context.messages.length - 1] = finalMessage;
            } else {
                context.messages.push(finalMessage);
            }
            await emit({ type: "message_end", message: finalMessage });
            return finalMessage;
    }
}
```

Key design decisions:

1. **Partial messages live in context.messages** -- they're replaced in-place as deltas arrive. This means the context always reflects the latest state.
2. **Every event snapshot is spread** (`{ ...partialMessage }`) before emission -- prevents downstream code from seeing future mutations.
3. **Non-streaming fallback**: if the iterator completes without a `done`/`error` event, `response.result()` is called directly (lines 210-219).

---

## 4. Tool Call Detection and Routing

After `streamAssistantResponse()` returns the final message, tool detection is a content block filter:

```js
const toolCalls = message.content.filter((c) => c.type === "toolCall");
```

The LLM response message contains fully-formed `toolCall` content blocks (name, id, arguments). No streaming detection needed -- by the time we're here, the full message is assembled.

### Execution mode selection

```js
async function executeToolCalls(currentContext, assistantMessage, config, signal, emit) {
    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
    const hasSequentialToolCall = toolCalls.some((tc) =>
        currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential"
    );
    if (config.toolExecution === "sequential" || hasSequentialToolCall) {
        return executeToolCallsSequential(...);
    }
    return executeToolCallsParallel(...);
}
```

Two modes:
- **Parallel** (default): all tools in a batch run concurrently via `Promise.all`
- **Sequential**: tools run one at a time

The mode is forced to sequential if **any** tool in the batch has `executionMode: "sequential"` on its definition, OR if the global `config.toolExecution` is `"sequential"`.

---

## 5. Tool Execution Pipeline -- Three Phases

Every tool call goes through a prepare -> execute -> finalize pipeline.

### Phase 1: Prepare (`prepareToolCall`)

```js
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal) {
    // 1. Find tool by name
    const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
    if (!tool) {
        return {
            kind: "immediate",
            result: createErrorToolResult(`Tool ${toolCall.name} not found`),
            isError: true,
        };
    }

    // 2. Prepare arguments (optional tool-specific shim)
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);

    // 3. Validate against schema
    const validatedArgs = validateToolArguments(tool, preparedToolCall);

    // 4. beforeToolCall hook -- can BLOCK execution
    if (config.beforeToolCall) {
        const beforeResult = await config.beforeToolCall({
            assistantMessage, toolCall, args: validatedArgs, context: currentContext,
        }, signal);
        if (beforeResult?.block) {
            return {
                kind: "immediate",
                result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
                isError: true,
            };
        }
    }

    return { kind: "prepared", toolCall, tool, args: validatedArgs };
}
```

Returns one of two kinds:
- `"immediate"` -- error/blocked, no execution needed. A tool result message is created directly.
- `"prepared"` -- validated, hooks passed, ready to execute.

The `beforeToolCall` hook is where tool call guardrails plug in. When guardrails are configured, a `beforeToolCall` is installed that returns `{ block: true, reason: "..." }` if the user rejects the call.

### Phase 2: Execute (`executePreparedToolCall`)

```js
async function executePreparedToolCall(prepared, signal, emit) {
    const updateEvents = [];
    try {
        const result = await prepared.tool.execute(
            prepared.toolCall.id,      // unique ID
            prepared.args,              // validated params
            signal,                     // AbortSignal
            (partialResult) => {        // streaming update callback
                updateEvents.push(Promise.resolve(emit({
                    type: "tool_execution_update",
                    toolCallId: prepared.toolCall.id,
                    toolName: prepared.toolCall.name,
                    args: prepared.toolCall.arguments,
                    partialResult,
                })));
            }
        );
        await Promise.all(updateEvents);
        return { result, isError: false };
    } catch (error) {
        await Promise.all(updateEvents);
        return { result: createErrorToolResult(error.message), isError: true };
    }
}
```

The tool's `execute` function receives four arguments:
1. `toolCallId` -- for correlating updates
2. `params` -- validated arguments
3. `signal` -- for cancellation
4. `onUpdate` -- callback the tool can call N times with partial results

Each `onUpdate` call emits a `tool_execution_update` event. Update promises are collected and awaited after execution (even on error), ensuring all events flush before returning.

### Phase 3: Finalize (`finalizeExecutedToolCall`)

```js
async function finalizeExecutedToolCall(
    currentContext, assistantMessage, prepared, executed, config, signal
) {
    let result = executed.result;
    let isError = executed.isError;

    if (config.afterToolCall) {
        const afterResult = await config.afterToolCall({
            assistantMessage, toolCall: prepared.toolCall, args: prepared.args,
            result, isError, context: currentContext,
        }, signal);

        if (afterResult) {
            result = {
                content: afterResult.content ?? result.content,
                details: afterResult.details ?? result.details,
                terminate: afterResult.terminate ?? result.terminate,
            };
            isError = afterResult.isError ?? isError;
        }
    }

    return { toolCall: prepared.toolCall, result, isError };
}
```

The `afterToolCall` hook can **override any field** of the result -- content, details, error status, or the terminate flag. This is a field-by-field merge (not deep merge). The pi-coding-agent session layer uses this to let extensions modify tool outputs.

---

## 6. Sequential vs. Parallel Tool Execution -- The Difference

### Sequential

```
for each toolCall:
    emit tool_execution_start
    prepare -> execute -> finalize
    emit tool_execution_end
    emit tool result message (message_start + message_end)
```

Simple loop. Each tool runs to completion before the next starts. Tool results are emitted immediately after each tool finishes.

### Parallel

```
Phase 1 (sequential): for each toolCall:
    emit tool_execution_start
    prepare
    if immediate (error/blocked) -> finalize, emit tool_execution_end, store result
    else -> store async function that will execute + finalize + emit

Phase 2 (parallel):
    Promise.all(all stored async functions)
    -> tool_execution_end events fire in completion order (non-deterministic)

Phase 3 (sequential, source order):
    for each finalized result (in original tool call order):
        emit tool result message (message_start + message_end)
```

The critical insight: **preparation is always sequential** (validation and `beforeToolCall` happen one at a time), but **execution runs concurrently**. After all tools complete, **result messages are emitted in source order** -- this ensures deterministic message ordering for the LLM's next turn.

---

## 7. Termination -- The `terminate` Flag

```js
function shouldTerminateToolBatch(finalizedCalls) {
    return finalizedCalls.length > 0 &&
           finalizedCalls.every((finalized) => finalized.result.terminate === true);
}
```

A tool can set `terminate: true` on its result to signal "I'm done, stop the loop." But this only takes effect if **every tool in the batch** says terminate. One non-terminating tool keeps the loop alive.

When the batch terminates, `hasMoreToolCalls` is set to `false`, and the inner loop exits (unless steering messages are pending).

The complete set of stop conditions:

1. **LLM error/abort**: `stopReason === "error"` or `"aborted"` -> exit immediately, emit `agent_end`
2. **No tool calls**: LLM responds with text only -> `hasMoreToolCalls = false`
3. **All tools terminate**: every tool in batch sets `terminate: true`
4. **No follow-up messages**: outer loop checks `getFollowUpMessages()`, gets empty -> break

---

## 8. The `Agent` Class -- Stateful Wrapper

The `Agent` class (`agent.js`) wraps the stateless loop functions.

### State management

```js
class Agent {
    _state;           // MutableAgentState
    listeners;        // Set<(event, signal) => Promise<void>>
    steeringQueue;    // PendingMessageQueue
    followUpQueue;    // PendingMessageQueue
    activeRun;        // { promise, resolve, abortController } | undefined
    // ... hooks: beforeToolCall, afterToolCall, convertToLlm, transformContext
}
```

`MutableAgentState` uses property getters/setters that **copy arrays on assignment**:

```js
set tools(nextTools) { tools = nextTools.slice(); }
set messages(nextMessages) { messages = nextMessages.slice(); }
```

This prevents external code from accidentally mutating the agent's internal state.

### `prompt()` -- The main entry point

```js
async prompt(input, images) {
    if (this.activeRun) {
        throw new Error(
            "Agent is already processing a prompt. "
            + "Use steer() or followUp() to queue messages, or wait for completion."
        );
    }
    const messages = this.normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
}
```

Only one run can be active. If you need to inject messages while the agent is running, use `steer()` or `followUp()`.

### `runWithLifecycle()` -- Run management

```js
async runWithLifecycle(executor) {
    const abortController = new AbortController();
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    this.activeRun = { promise, resolve: resolvePromise, abortController };
    this._state.isStreaming = true;

    try {
        await executor(abortController.signal);
    } catch (error) {
        await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
        this.finishRun();  // clears isStreaming, pendingToolCalls, resolves promise
    }
}
```

On failure, a synthetic assistant message with `stopReason: "error"` is pushed to state, so the conversation always ends cleanly.

### Event processing

```js
async processEvents(event) {
    // Update internal state based on event type
    switch (event.type) {
        case "message_start":
            this._state.streamingMessage = event.message;
            break;
        case "message_end":
            this._state.streamingMessage = undefined;
            this._state.messages.push(event.message);
            break;
        case "tool_execution_start":
            this._state.pendingToolCalls.add(event.toolCallId);
            break;
        case "tool_execution_end":
            this._state.pendingToolCalls.delete(event.toolCallId);
            break;
        // ...
    }

    // Then notify all subscribers IN ORDER, awaiting each
    for (const listener of this.listeners) {
        await listener(event, signal);
    }
}
```

Listeners are awaited sequentially and included in the run's settlement. The run isn't considered "idle" until all `agent_end` listeners finish.

### Message queuing bridge

The `Agent` wires its queues to the loop config:

```js
createLoopConfig() {
    return {
        // ... model, hooks, etc.
        getSteeringMessages: async () => this.steeringQueue.drain(),
        getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
}
```

The `PendingMessageQueue` drains by mode -- `"all"` returns everything, `"one-at-a-time"` returns just the first item. This controls how many injected messages the loop sees per poll.

---

## 9. Complete Event Sequence

A full run with one tool call produces this event sequence:

```
agent_start
  turn_start
    message_start  (user prompt)
    message_end    (user prompt)
    message_start  (assistant -- first streaming chunk)
    message_update x N  (text deltas, thinking deltas, tool call deltas)
    message_end    (assistant -- final assembled message)
    tool_execution_start
    tool_execution_update x N  (optional streaming from tool)
    tool_execution_end
    message_start  (tool result)
    message_end    (tool result)
  turn_end  (with assistant message + tool results)
  turn_start
    message_start  (assistant -- processes tool result)
    message_update x N
    message_end    (assistant -- final answer, no tool calls)
  turn_end  (with assistant message, empty tool results)
agent_end  (with all newMessages)
```

---

## 10. The pi-coding-agent Session Layer

The `AgentSession` class in `pi-coding-agent` adds several capabilities on top of the core loop.

### Tool registration pipeline

Tools go through a multi-stage pipeline:

1. **ToolDefinition** -- has metadata: `promptSnippet`, `promptGuidelines`, `renderer`, `executionMode`
2. **RegisteredTool** -- pairs definition with `sourceInfo` (built-in, SDK, extension)
3. **Wrapped AgentTool** -- `wrapToolDefinition()` injects extension context factory
4. **agent.state.tools** -- live tools the agent can call

```js
export function wrapToolDefinition(definition, ctxFactory) {
    return {
        ...definition,
        execute: (toolCallId, params, signal, onUpdate) =>
            definition.execute(
                toolCallId, params, signal, onUpdate,
                ctxFactory?.()  // Inject extension context on every call
            ),
    };
}
```

### Context compression (compaction)

After each `agent_end`, the session checks two conditions:

1. **Overflow recovery**: LLM returned a context overflow error -> remove the error message, compact, and auto-retry via `agent.continue()`
2. **Threshold compaction**: context tokens exceed a configurable percentage of the model's context window -> auto-compact

Compaction produces a summary message that replaces older conversation turns, keeping the context within bounds while preserving essential information.

Extensions can intercept compaction via `session_before_compact` event and provide custom compaction logic or cancel it entirely.

### Agent-level tool hooks

The session installs `beforeToolCall` and `afterToolCall` on the agent that route to the extension system:

```js
this.agent.beforeToolCall = async ({ toolCall, args }) => {
    const runner = this._extensionRunner;
    return await runner.emitToolCall({
        type: "tool_call",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        input: args,
    });
};

this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
    const hookResult = await runner.emitToolResult({
        type: "tool_result",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        input: args,
        content: result.content,
        details: result.details,
        isError,
    });
    return hookResult;  // Can override content, details, isError
};
```

### Session-specific events

The session layer adds events beyond what the core loop emits:

- `queue_update` -- when steering/follow-up queues change
- `compaction_start` / `compaction_end` -- context compression lifecycle
- `auto_retry_start` / `auto_retry_end` -- automatic retry on transient errors
- `session_info_changed` -- session name updates

### System prompt building

The session dynamically builds the system prompt from:

- Base system prompt (SDK default or custom)
- Tool snippets (`promptSnippet` from each active tool)
- Tool guidelines (`promptGuidelines` from each active tool)
- Loaded skills, context files (AGENTS.md, CLAUDE.md)
- Extension modifications via `before_agent_start` event

---

## 11. Key Design Takeaways

1. **Separation of message formats**: `AgentMessage[]` internally, `Message[]` only at the LLM boundary. This is the architectural decision that enables custom message types, tool metadata, and UI-specific content without LLM pollution.

2. **Callback-based emission**: The loop uses an `emit()` callback rather than returning events. This decouples the loop from the consumption pattern -- the `Agent` class processes events synchronously and updates state, while `agentLoop()` pushes to a stream.

3. **Two-phase tool execution in parallel mode**: Prepare sequentially (validation + hooks), execute concurrently, emit results in source order. This balances safety (sequential validation) with performance (parallel execution) and determinism (ordered results).

4. **The terminate flag is a unanimous vote**: ALL tools in a batch must agree to stop. This prevents premature termination when one tool finishes early but others haven't contributed their results yet.

5. **Immutable state via copy-on-assign**: Arrays are `.slice()`'d on set, preventing external mutation. But objects within those arrays are shared references -- the system relies on convention, not deep cloning.

6. **Run exclusivity**: Only one `prompt()` or `continue()` can run at a time. Mid-run injection uses `steer()` and `followUp()` queues, not concurrent `prompt()` calls. This eliminates race conditions in state management.

7. **Dynamic extension context**: Tool wrappers create a factory function `() => runner.createContext()` invoked fresh on each execution. Extensions can be reloaded mid-session without reinstalling hooks.

8. **Event queue ordering**: The session's `_agentEventQueue` is a promise chain that ensures events are processed sequentially, critical for proper ordering of steering messages and queue updates.

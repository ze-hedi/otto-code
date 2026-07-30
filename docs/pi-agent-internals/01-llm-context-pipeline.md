# LLM Context Pipeline

How the SDK transforms the internal message array into the exact payload sent to the Anthropic API.

## The Full Chain

```
AgentSession.prompt(text)
  │
  ├─ builds user message, runs extension before_agent_start hook
  ├─ sets system prompt on agent.state.systemPrompt
  │
  └─ agent.prompt(messages)
       └─ runAgentLoop(prompts, contextSnapshot, loopConfig)
            └─ runLoop(context)
                 │
                 │  [inject steering/follow-up messages into context.messages]
                 │
                 └─ streamAssistantResponse(context, config)
                      │
                      ├─ 1. transformContext(context.messages)
                      │     AgentMessage[] → AgentMessage[]
                      │     Extension hook (emitContext). Can modify/filter messages.
                      │
                      ├─ 2. convertToLlm(transformedMessages)
                      │     AgentMessage[] → Message[]
                      │     Converts SDK-specific roles to standard LLM roles.
                      │     (see "convertToLlm Details" below)
                      │
                      ├─ 3. llmContext = { systemPrompt, messages, tools }
                      │
                      └─ 4. streamFn(model, llmContext, options)
                           │
                           └─ anthropic provider
                                │
                                ├─ transformMessages(messages)
                                │    - drops errored/aborted assistant messages
                                │    - handles thinking blocks (redacted, cross-model)
                                │    - inserts synthetic empty tool_results for orphaned tool_use
                                │    - normalizes tool call IDs for cross-provider compat
                                │
                                ├─ convertMessages(messages) → Anthropic API format
                                │    - user → { role: "user", content: [...] }
                                │    - assistant → { role: "assistant", content: [...] }
                                │    - toolResult → { type: "tool_result", tool_use_id, content, is_error }
                                │    - consecutive toolResults merged into one user message
                                │    - cache_control added to last user message
                                │
                                ├─ buildParams() — assembles final params
                                │    - system prompt (with OAuth prefix if applicable)
                                │    - tools with cache_control on last tool
                                │    - thinking config (budget tokens, thinking level)
                                │    - max_tokens, model, metadata
                                │
                                ├─ onPayload(params)  ← last interception point
                                │
                                └─ client.messages.create(params)
```

## convertToLlm Details

This function (in `pi-coding-agent/dist/core/messages.js`) transforms SDK-specific message roles into standard LLM roles:

| SDK role | Becomes | Notes |
|----------|---------|-------|
| `user` | `user` | pass-through |
| `assistant` | `assistant` | pass-through |
| `toolResult` | `toolResult` | pass-through (later converted to `tool_result` content block) |
| `bashExecution` | `user` | formatted as command + output text. Dropped if `excludeFromContext: true` |
| `compactionSummary` | `user` | wrapped in `<summary>` tags, includes token count |
| `branchSummary` | `user` | wrapped in `<summary>` tags |
| `custom` | `user` | content passed through |
| anything else | **dropped** | filtered out |

An additional wrapper (`convertToLlmWithBlockImages` in `sdk.js`) optionally replaces all `image` content blocks with placeholder text when image reading is disabled.

## What the LLM sees from a tool result

When a tool's `execute()` returns:

```ts
{
  content: [{ type: "text", text: "file contents here" }],  // ← LLM sees this
  details: { lineCount: 42 },                                // ← LLM does NOT see this
  terminate: true,                                            // ← controls loop, not sent to LLM
  isError: false,                                             // ← LLM sees this (as is_error)
}
```

The `details` field is stored in the message and session file but is stripped during `convertMessages()`. Only `content` and `isError` reach the API.

## Interception Points

Four ways to inspect or modify the context before it hits the API, from earliest to latest:

### 1. `transformContext` (AgentMessage[] → AgentMessage[])
Wired to extensions via `emitContext()`. Operates on the raw SDK messages before any conversion.

### 2. `convertToLlm` (AgentMessage[] → Message[])
Replaceable via the Agent constructor options. Controls how SDK roles map to LLM roles.

### 3. `onPayload` (final Anthropic API params)
**Most useful for debugging.** Receives the exact `params` object passed to `client.messages.create()` — includes `messages`, `system`, `tools`, `thinking`, `max_tokens`, everything. Wired to extensions via `emitBeforeProviderRequest()`. Can modify and return new params.

### 4. `onResponse` (post-call)
Fires after the API responds. Gets `{ status, headers }`. Read-only for the request, but useful for logging.

## System Prompt Construction

The system prompt goes through several stages:

1. **Built** by `buildSystemPrompt()` — combines cwd, skills, context files (AGENTS.md/CLAUDE.md), custom prompt, tool snippets, prompt guidelines
2. **Stored** on `agent.state.systemPrompt`
3. **Rebuilt** when active tools change (`setActiveToolsByName()`)
4. **Overridable** per-turn by the `before_agent_start` extension hook
5. **Injected** into API params by `buildParams()` as a `system` array with `cache_control` markers

For OAuth tokens, an additional mandatory prefix block (`"You are Claude Code..."`) is prepended to the system prompt.

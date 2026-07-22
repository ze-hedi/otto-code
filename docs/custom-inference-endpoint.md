# Using a Custom Inference Engine with PiAgent

This guide explains how to connect your own local LLM inference engine to PiAgent (built on Mario Zechner's `@mariozechner/pi-coding-agent` SDK). By the end, your locally-served model will power the full agent loop — tool calling, multi-turn reasoning, and all.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture: How the Agent Loop Works](#architecture-how-the-agent-loop-works)
3. [Choosing a Wire Protocol](#choosing-a-wire-protocol)
4. [Implementing the OpenAI Chat Completions Protocol](#implementing-the-openai-chat-completions-protocol)
   - [Endpoint](#endpoint)
   - [Request Body](#request-body)
   - [Messages Format](#messages-format)
   - [Tools Format](#tools-format)
   - [Streaming Response (SSE)](#streaming-response-sse)
   - [Finish Reasons](#finish-reasons)
   - [Usage Reporting](#usage-reporting)
5. [Registering Your Engine in Pi](#registering-your-engine-in-pi)
   - [models.json Configuration](#modelsjson-configuration)
   - [Compatibility Flags](#compatibility-flags)
   - [Per-Model Overrides](#per-model-overrides)
6. [Using It from PiAgent (TypeScript)](#using-it-from-piagent-typescript)
7. [Minimal Reference Server (Python)](#minimal-reference-server-python)
8. [Testing Your Implementation](#testing-your-implementation)
9. [Advanced: Alternative Protocols](#advanced-alternative-protocols)
   - [Anthropic Messages Protocol](#anthropic-messages-protocol)
   - [Mistral Conversations Protocol](#mistral-conversations-protocol)
10. [Troubleshooting](#troubleshooting)

---

## Overview

PiAgent is **stateless on the LLM side**. Every request carries the full conversation history. Your inference engine receives the entire context, generates a streamed response, and the agent loop handles the rest (tool execution, re-prompting, etc.).

Your engine must implement **one HTTP endpoint** that speaks one of the supported wire protocols. The simplest and most widely adopted is the **OpenAI Chat Completions** format.

---

## Architecture: How the Agent Loop Works

```
User prompt
    |
    v
+---------------------------+
| PiAgent (TypeScript)      |
|                           |
|  1. Build messages array  |
|     (system + history +   |
|      user message)        |
|                           |
|  2. POST to your server   |  --->  POST /v1/chat/completions
|     with full context     |        { model, messages, tools, stream: true }
|                           |
|  3. Parse SSE stream      |  <---  data: {"choices":[{"delta":{"content":"..."}}]}
|                           |        data: {"choices":[{"delta":{"tool_calls":[...]}}]}
|                           |        data: [DONE]
|  4. If tool_calls:        |
|     - Execute tools       |
|     - Append results      |
|     - GOTO step 1         |
|                           |
|  5. If no tool_calls:     |
|     - Return response     |
+---------------------------+
```

Key points:
- The LLM server has **no memory** — every request contains the full conversation.
- The agent loop continues until the model returns a response with no tool calls.
- Context grows with each turn. When it approaches `contextWindow`, Pi triggers **compaction** (summarizing old messages to free space).

---

## Choosing a Wire Protocol

Pi supports 10 wire protocols. Your engine must speak exactly one of them:

| `api` value | Based on | Best for |
|---|---|---|
| `openai-completions` | OpenAI Chat Completions API | **Recommended.** Any custom engine, Ollama, vLLM, SGLang, llama.cpp, LM Studio, TGI |
| `anthropic-messages` | Anthropic Messages API | Engines that natively speak Anthropic format |
| `mistral-conversations` | Mistral Chat API | Mistral-compatible servers |
| `openai-responses` | OpenAI Responses API | OpenAI Responses-specific features |
| `google-generative-ai` | Google Generative AI | Google AI Studio / Gemma |
| `google-vertex` | Google Vertex AI | Vertex AI deployments |
| `google-gemini-cli` | Gemini CLI | Gemini CLI-based setups |
| `azure-openai-responses` | Azure OpenAI | Azure deployments |
| `openai-codex-responses` | OpenAI Codex | Codex-specific features |
| `bedrock-converse-stream` | AWS Bedrock | AWS Bedrock deployments |

**Use `openai-completions`** unless you have a specific reason not to. It's the de facto standard that nearly every inference engine implements.

---

## Implementing the OpenAI Chat Completions Protocol

### Endpoint

```
POST /v1/chat/completions
Content-Type: application/json
Accept: text/event-stream
```

Your server must listen on a base URL (e.g., `http://localhost:8000`) and handle requests to `/v1/chat/completions`. The Pi SDK uses the OpenAI client library, which appends `/chat/completions` to whatever `baseUrl` you configure (which should end with `/v1`).

### Request Body

Your server will receive JSON bodies with this structure:

```json
{
  "model": "your-model-id",
  "stream": true,
  "messages": [ ... ],
  "tools": [ ... ],
  "max_tokens": 16384,
  "temperature": 0.7
}
```

#### Required fields to handle

| Field | Type | Description |
|---|---|---|
| `model` | `string` | The model ID you registered. Use it to route to the right model if you serve multiple. |
| `stream` | `boolean` | Always `true` from Pi. Your server must return SSE. |
| `messages` | `array` | The full conversation history (see [Messages Format](#messages-format)). |
| `max_tokens` | `number` | Maximum tokens to generate. Respect this limit. |

#### Optional fields Pi may send

| Field | Type | Description |
|---|---|---|
| `tools` | `array` | Available tools the model can call (see [Tools Format](#tools-format)). |
| `tool_choice` | `string \| object` | Tool selection strategy (`"auto"`, `"none"`, or specific tool). |
| `temperature` | `number` | Sampling temperature. |
| `max_completion_tokens` | `number` | Alternative to `max_tokens` (configurable via compat flag). |
| `reasoning_effort` | `string` | Extended thinking level — ignore if unsupported. |
| `stream_options` | `object` | `{ "include_usage": true }` — request usage stats in stream. |

### Messages Format

The `messages` array contains the full conversation. Each message has a `role` and `content`:

#### System message

```json
{
  "role": "system",
  "content": "You are a coding assistant. You have access to tools..."
}
```

If `compat.supportsDeveloperRole` is `true`, Pi sends `"role": "developer"` instead. Set the flag to `false` to always receive `"system"`.

#### User message (text only)

```json
{
  "role": "user",
  "content": "Fix the bug in main.py"
}
```

#### User message (with images)

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What's in this screenshot?" },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,iVBORw0KGgo..."
      }
    }
  ]
}
```

#### Assistant message (text response)

```json
{
  "role": "assistant",
  "content": "I'll fix that bug now."
}
```

#### Assistant message (tool call)

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\": \"/src/main.py\"}"
      }
    }
  ]
}
```

- `content` is `null` when the model uses tools.
- `arguments` is a **JSON string**, not an object.
- Multiple tool calls can appear in a single message.

#### Tool result message

```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "def main():\n    print('hello')\n"
}
```

- `tool_call_id` matches the `id` from the assistant's `tool_calls`.
- `content` is always a string.

### Tools Format

When tools are available, Pi sends them in the request body:

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read the contents of a file",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "Absolute path to the file"
            }
          },
          "required": ["path"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Execute a bash command",
        "parameters": {
          "type": "object",
          "properties": {
            "command": { "type": "string" }
          },
          "required": ["command"]
        }
      }
    }
  ]
}
```

Your model needs to understand this schema and generate valid `tool_calls` in its response when it wants to use a tool.

### Streaming Response (SSE)

Your server must respond with `Content-Type: text/event-stream` and send Server-Sent Events. Each event is a line starting with `data: ` followed by JSON, terminated by `\n\n`.

#### Text content chunks

Stream the model's text output token by token (or in small batches):

```
data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"I'll"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" fix"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" that."},"finish_reason":null}]}
```

#### Tool call chunks

Tool calls are streamed incrementally. First the tool name, then the arguments in pieces:

```
data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_xyz789","type":"function","function":{"name":"read_file","arguments":""}}]},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"pa"}}]},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\":"}}]},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" \"/src/main.py\"}"}}]},"finish_reason":null}]}
```

Key rules for tool call streaming:
- The first chunk must include `id`, `type`, and `function.name`.
- Subsequent chunks only need `index` and `function.arguments` (partial JSON string).
- Pi accumulates the argument fragments and parses them incrementally.
- Multiple tool calls use different `index` values (0, 1, 2...).

#### Finish chunk

Always send a final chunk with `finish_reason`:

```
data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

The stream **must** end with `data: [DONE]\n\n`.

### Finish Reasons

Pi maps these finish reasons to internal states:

| Your server returns | Pi interprets as | Meaning |
|---|---|---|
| `"stop"` | End of response | Model finished naturally |
| `"length"` | Max tokens hit | Response was truncated |
| `"tool_calls"` | Tool use requested | Model wants to call tools (Pi will execute them and re-prompt) |
| `"content_filter"` | Error | Content was filtered |

If your model is calling tools, return `"tool_calls"` (or `"stop"` — Pi also checks for tool call presence in the delta).

### Usage Reporting

Optional but useful for tracking costs and context size. Send a chunk with usage data:

```
data: {"id":"cmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":1500,"completion_tokens":89}}
```

Pi requests this by sending `"stream_options": {"include_usage": true}`. If you don't support it, set `compat.supportsUsageInStreaming` to `false`.

---

## Registering Your Engine in Pi

### models.json Configuration

Create or edit `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "my-engine": {
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "models": [
        {
          "id": "my-model-70b",
          "contextWindow": 32768,
          "maxTokens": 8192,
          "reasoning": false,
          "input": ["text"]
        }
      ]
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `baseUrl` | Yes | Your server's base URL. Must end with `/v1` for OpenAI-compatible servers. |
| `api` | Yes | Wire protocol: `"openai-completions"` for custom engines. |
| `apiKey` | Yes | Required by schema. Use any placeholder if your server doesn't check auth. Can also be an env var name (e.g., `"MY_API_KEY"` reads `$MY_API_KEY`), or a shell command (e.g., `"!cat /path/to/key"`). |
| `models` | Yes | Array of model definitions your server can handle. |
| `headers` | No | Custom HTTP headers sent with every request (e.g., `{"x-custom": "value"}`). |

### Compatibility Flags

The `compat` object tells Pi what features your engine supports. Set unsupported features to `false` to avoid errors:

```json
{
  "providers": {
    "my-engine": {
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsUsageInStreaming": false,
        "supportsStore": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        { "id": "my-model-70b" }
      ]
    }
  }
}
```

Full list of `openai-completions` compat flags:

| Flag | Type | Default | Description |
|---|---|---|---|
| `supportsDeveloperRole` | `boolean` | `true` | Send `"developer"` role instead of `"system"`. Set `false` for most local models. |
| `supportsReasoningEffort` | `boolean` | `true` | Send `reasoning_effort` parameter. Set `false` unless your model supports it. |
| `supportsUsageInStreaming` | `boolean` | `true` | Send `stream_options.include_usage`. Set `false` if not supported. |
| `supportsStore` | `boolean` | `true` | Send `store` parameter. Set `false` for local models. |
| `maxTokensField` | `string` | `"max_completion_tokens"` | Which field name to use: `"max_tokens"` or `"max_completion_tokens"`. Most local engines use `"max_tokens"`. |
| `requiresToolResultName` | `boolean` | `false` | Include `name` field in tool result messages. |
| `requiresAssistantAfterToolResult` | `boolean` | `false` | Insert an assistant message after tool results. |
| `thinkingFormat` | `string` | - | How reasoning tokens are formatted: `"openai"`, `"deepseek"`, `"qwen"`, etc. |
| `cacheControlFormat` | `string` | - | Set to `"anthropic"` to add Anthropic-style cache control markers. |

### Per-Model Overrides

Each model entry can override provider-level settings:

```json
{
  "models": [
    {
      "id": "my-model-70b",
      "name": "My Custom 70B",
      "contextWindow": 32768,
      "maxTokens": 8192,
      "reasoning": false,
      "input": ["text"],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "baseUrl": "http://different-server:8001/v1",
      "api": "openai-completions",
      "compat": {
        "supportsDeveloperRole": false
      }
    }
  ]
}
```

---

## Using It from PiAgent (TypeScript)

Once registered in `models.json`, use it in your code:

```typescript
import { PiAgent } from "./agents/pi-agent";

const agent = new PiAgent({
  model: "my-engine/my-model-70b",
  apiKey: "not-needed",
  sessionMode: "memory",
  thinkingLevel: "off",
  builtInTools: ["read", "bash", "edit", "write"],
});

await agent.chat("Read main.py and explain what it does");
```

Or with the `RawPiAgent` for full prompt control:

```typescript
import { RawPiAgent } from "./agents/raw-pi-agent";

const agent = new RawPiAgent({
  model: "my-engine/my-model-70b",
  apiKey: "not-needed",
  sessionMode: "memory",
  thinkingLevel: "off",
});

await agent.chat("Your full custom prompt here...");
```

---

## Minimal Reference Server (Python)

A minimal server using FastAPI that proxies to any local model. Adapt the `generate()` function to call your actual inference engine:

```python
"""
Minimal OpenAI-compatible inference server for PiAgent.
Run: uvicorn server:app --host 0.0.0.0 --port 8000
"""

import json
import uuid
import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()

    model = body["model"]
    messages = body["messages"]
    tools = body.get("tools", [])
    max_tokens = body.get("max_tokens") or body.get("max_completion_tokens", 4096)
    temperature = body.get("temperature", 0.7)
    stream = body.get("stream", False)

    # ---------------------------------------------------------------
    # Replace this with your actual inference engine call.
    # `messages` is the full conversation in OpenAI format.
    # `tools` is the list of available tools in OpenAI format.
    #
    # Your engine must decide whether to:
    #   a) Return text content (regular response)
    #   b) Return tool_calls (request tool execution)
    #
    # For tool-calling to work, your model must understand the tool
    # schemas and generate valid JSON arguments.
    # ---------------------------------------------------------------
    async def generate():
        completion_id = f"cmpl-{uuid.uuid4().hex[:8]}"

        # Example: simple text response
        # Replace with actual model inference
        response_text = "Hello! I received your message."
        tokens = response_text.split(" ")

        # Stream role
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "choices": [{
                "index": 0,
                "delta": {"role": "assistant", "content": ""},
                "finish_reason": None,
            }],
        }
        yield f"data: {json.dumps(chunk)}\n\n"

        # Stream content tokens
        prompt_tokens = sum(len(str(m.get("content", "")).split()) for m in messages)
        completion_tokens = 0

        for i, token in enumerate(tokens):
            prefix = "" if i == 0 else " "
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "choices": [{
                    "index": 0,
                    "delta": {"content": prefix + token},
                    "finish_reason": None,
                }],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            completion_tokens += 1
            await asyncio.sleep(0.02)  # simulate generation delay

        # Finish chunk
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop",
            }],
        }
        yield f"data: {json.dumps(chunk)}\n\n"

        # Usage chunk
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "choices": [],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        }
        yield f"data: {json.dumps(chunk)}\n\n"

        yield "data: [DONE]\n\n"

    # ------- Tool call example -------
    # To return a tool call instead of text, stream chunks like:
    #
    # delta: {"tool_calls": [{"index": 0, "id": "call_123", "type": "function",
    #          "function": {"name": "read_file", "arguments": ""}}]}
    #
    # delta: {"tool_calls": [{"index": 0,
    #          "function": {"arguments": "{\"path\": \"/foo.py\"}"}}]}
    #
    # finish_reason: "tool_calls"
    # ---------------------------------

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/v1/models")
async def list_models():
    """Optional: Pi may call this to discover available models."""
    return {
        "data": [
            {"id": "my-model-70b", "object": "model", "owned_by": "local"},
        ]
    }
```

### Streaming a tool call response

Here's what the `generate()` function looks like when your model wants to call a tool:

```python
async def generate_tool_call():
    completion_id = f"cmpl-{uuid.uuid4().hex[:8]}"

    # First chunk: tool call start (name + id)
    yield f'data: {json.dumps({"id": completion_id, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant", "content": None, "tool_calls": [{"index": 0, "id": "call_" + uuid.uuid4().hex[:8], "type": "function", "function": {"name": "read_file", "arguments": ""}}]}, "finish_reason": None}]})}\n\n'

    # Subsequent chunks: stream the arguments JSON
    arg_parts = ['{"pa', 'th": ', '"/src/', 'main.py"}']
    for part in arg_parts:
        yield f'data: {json.dumps({"id": completion_id, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": part}}]}, "finish_reason": None}]})}\n\n'
        await asyncio.sleep(0.01)

    # Finish with tool_calls reason
    yield f'data: {json.dumps({"id": completion_id, "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})}\n\n'

    yield "data: [DONE]\n\n"
```

---

## Testing Your Implementation

### 1. Verify basic connectivity

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-model-70b",
    "stream": true,
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 100
  }'
```

You should see SSE events streamed back.

### 2. Test tool calling

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-model-70b",
    "stream": true,
    "messages": [{"role": "user", "content": "Read the file /tmp/test.txt"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read a file",
        "parameters": {
          "type": "object",
          "properties": {"path": {"type": "string"}},
          "required": ["path"]
        }
      }
    }],
    "max_tokens": 500
  }'
```

Your model should return `tool_calls` in the streamed deltas.

### 3. Test with Pi directly

```bash
# After configuring models.json, run Pi with your model:
pi --model my-engine/my-model-70b "Hello, what tools do you have?"
```

### 4. Common validation checks

- [ ] Response is `Content-Type: text/event-stream`
- [ ] Each event line starts with `data: `
- [ ] Each event is followed by `\n\n`
- [ ] Stream ends with `data: [DONE]\n\n`
- [ ] `delta.content` contains text fragments (not full text)
- [ ] Tool call `arguments` is a JSON **string**, not an object
- [ ] Tool call `id` is a unique string
- [ ] `finish_reason` is one of: `"stop"`, `"length"`, `"tool_calls"`

---

## Advanced: Alternative Protocols

If your engine natively speaks Anthropic or Mistral format, you can use those instead.

### Anthropic Messages Protocol

Set `"api": "anthropic-messages"` in `models.json`.

**Endpoint:** `POST /v1/messages`

**Key differences from OpenAI:**
- System prompt is a separate `system` parameter (array of content blocks), not a message.
- Tool arguments are objects (`input`), not JSON strings.
- Tool results are sent as `"role": "user"` messages with `"type": "tool_result"` content blocks.
- Streaming uses named SSE events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.
- Supports `thinking` content blocks for chain-of-thought.

**SSE event types:**
```
event: message_start
data: {"type": "message_start", "message": {"id": "msg_1", "usage": {"input_tokens": 100, "output_tokens": 0}}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 15}}

event: message_stop
data: {"type": "message_stop"}
```

### Mistral Conversations Protocol

Set `"api": "mistral-conversations"` in `models.json`.

**Endpoint:** `POST /v1/chat/completions` (same path as OpenAI)

**Key differences from OpenAI:**
- Uses `maxTokens` (camelCase) instead of `max_tokens`.
- Tool call IDs are limited to **9 alphanumeric characters**.
- Tool results use `toolCallId` (camelCase) instead of `tool_call_id`.
- Image content uses `imageUrl` (string) instead of `image_url.url` (nested object).

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `"baseUrl" is required` | Missing `baseUrl` in `models.json` | Add `"baseUrl": "http://localhost:8000/v1"` to your provider config |
| `"apiKey" is required` | Missing `apiKey` in `models.json` | Add `"apiKey": "dummy"` (any value works for local servers) |
| Model not found | Provider/model format wrong | Use `"my-engine/my-model-id"` format, matching provider name and model id exactly |
| `developer` role error | Your model doesn't support `developer` role | Set `"supportsDeveloperRole": false` in compat |
| `max_completion_tokens` error | Your model expects `max_tokens` | Set `"maxTokensField": "max_tokens"` in compat |
| `reasoning_effort` error | Your model doesn't support it | Set `"supportsReasoningEffort": false` in compat |
| Tool calls not working | Model doesn't generate proper tool call format | Ensure your model is fine-tuned for tool calling, or use a model that supports it natively (e.g., Qwen 2.5, Llama 3.1+, Mistral) |
| Stream parsing errors | Malformed SSE | Ensure each line is `data: {json}\n\n` and stream ends with `data: [DONE]\n\n` |
| Context too large | Conversation exceeds model's context window | Set accurate `contextWindow` in model config so Pi triggers compaction in time |

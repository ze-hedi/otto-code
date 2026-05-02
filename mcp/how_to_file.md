# MCP Layer — Launch & Usage Guide

## Architecture recap

```
curl / agent
    │
    ▼
nginx  :8080         (public entrypoint)
    │  /mcp   →  gateway:9000
    ▼
gateway              (FastMCP aggregator)
    ├──► tavily :8000   tools: search, extract  →  exposed as tavily_search, tavily_extract
    └──► <next> :8000   ...
```

Your agent (or curl) talks to **one** endpoint (`http://localhost:8080/mcp`). The gateway fans out tool calls to the right upstream automatically, using the `<prefix>_<tool>` naming scheme.

> **Note:** use `/mcp` without a trailing slash — FastMCP issues a 307 redirect if you include one.

---

## Prerequisites

- Docker + Docker Compose v2 (`docker compose version` — note: no hyphen)
- A Tavily API key — get one at tavily.com

---

## Step 1 — Set up env

```bash
cd mcp
cp .env.example .env
```

Edit `.env` and replace the placeholder:

```
TAVILY_API_KEY=tvly-your-real-key-here
```

---

## Step 2 — Build and start

**Production mode** (no hot reload):

```bash
docker compose up --build
```

**Dev mode** (source files mounted as volumes — edit Python, restart to reload):

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

Expected output — you should see all three services come up:

```
tavily     | INFO:     Application startup complete.
gateway    | INFO gateway registering upstream name=tavily prefix=tavily url=http://tavily:8000/mcp/
gateway    | INFO gateway starting gateway mcp-gateway on 0.0.0.0:9000
nginx      | ...start worker process...
```

nginx will only start once the gateway healthcheck passes (up to 50 s — 10 retries × 5 s).

---

## Step 3 — Verify the stack is healthy

```bash
curl -s http://localhost:8080/healthz | python3 -m json.tool
```

Expected:

```json
{
    "status": "ok",
    "upstreams": ["tavily"]
}
```

If this returns 502, the gateway didn't start — check `docker compose logs gateway`.

---

## Step 4 — List tools from a specific MCP server

MCP uses JSON-RPC 2.0 over HTTP. Every message goes to the same endpoint (`/mcp`), identified by its `method` field.

The responses come back as SSE (`text/event-stream`). Each line starts with `data: ` — pipe through `grep "^data:"` to extract the JSON.

### One-shot: initialize + list tools (copy-paste ready)

This single command handles both steps automatically — it grabs the session ID from the `initialize` response and immediately uses it for `tools/list`:

```bash
SESSION=$(curl -s -D - \
  -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-client","version":"1.0"}}}' \
  | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r') && \
curl -s \
  -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | grep "^data:" | sed 's/^data: //' | python3 -m json.tool
```

Expected output:

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
        "tools": [
            {
                "name": "tavily_search",
                "description": "Search the web with Tavily and return ranked results.",
                "inputSchema": {
                    "additionalProperties": false,
                    "properties": {
                        "query": { "type": "string" },
                        "max_results": { "default": 5, "type": "integer" },
                        "search_depth": { "default": "basic", "enum": ["basic", "advanced"], "type": "string" },
                        "include_answer": { "default": true, "type": "boolean" }
                    },
                    "required": ["query"],
                    "type": "object"
                }
            },
            {
                "name": "tavily_extract",
                "description": "Fetch and extract the main content of one or more URLs.",
                "inputSchema": {
                    "additionalProperties": false,
                    "properties": {
                        "urls": { "items": { "type": "string" }, "type": "array" }
                    },
                    "required": ["urls"],
                    "type": "object"
                }
            }
        ]
    }
}
```

To filter tools from **a specific upstream server** — all tools from a given server share the same prefix (`tavily_*`). Filter client-side:

```bash
SESSION=$(curl -s -D - \
  -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-client","version":"1.0"}}}' \
  | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r') && \
curl -s \
  -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | grep "^data:" | sed 's/^data: //' \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
tools = [t for t in data['result']['tools'] if t['name'].startswith('tavily_')]
print(json.dumps(tools, indent=2))
"
```

---

### Call a tool (bonus)

```bash
SESSION=$(curl -s -D - \
  -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl-client","version":"1.0"}}}' \
  | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r') && \
curl -s \
  -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tavily_search","arguments":{"query":"latest AI news","max_results":3,"include_answer":true}}}' \
  | grep "^data:" | sed 's/^data: //' | python3 -m json.tool
```

---

## Dev loop — hot reload

```bash
# edit gateway/src/main.py or servers/tavily/src/server.py
docker compose restart gateway     # or: restart tavily
```

The override compose file mounts `gateway/src` and `servers/tavily/src` as read-only volumes, so the container picks up changes on restart without a full rebuild.

---

## Add a new upstream server

1. Create `mcp/servers/<name>/` with a `Dockerfile`, `requirements.txt`, and `src/server.py` that ends with:
   ```python
   mcp.run(transport="http", host="0.0.0.0", port=8000)
   ```
2. Add the service to `docker-compose.yml` with an unused IP (e.g. `172.28.0.30`).
3. Append to `gateway/config.yaml`:
   ```yaml
   upstreams:
     - name: <name>
       prefix: <name>
       url: http://<name>:8000/mcp/
   ```
4. `docker compose up --build`. New tools appear immediately as `<name>_<tool>` — no agent-side change needed.

---

## Quick reference

| Command | Purpose |
|---|---|
| `docker compose up --build` | Start the full stack |
| `docker compose logs -f gateway` | Watch gateway logs |
| `docker compose restart gateway` | Reload gateway after source edit |
| `docker compose down` | Stop everything |
| `curl http://localhost:8080/healthz` | Health check |
| `POST /mcp` `method: initialize` | Start MCP session |
| `POST /mcp` `method: tools/list` | List all available tools |
| `POST /mcp` `method: tools/call` | Invoke a tool |

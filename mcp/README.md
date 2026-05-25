# MCP Gateway

A local MCP layer for the Otto agents. One nginx entrypoint fronts an
aggregating FastMCP gateway that fan-outs `tools/call` requests to
multiple FastMCP upstreams running in their own containers.

From the agent's perspective there is **one** MCP server at
`http://localhost:8080/mcp/` exposing the union of all upstream tools,
namespaced by prefix (e.g. `tavily_search`, `tavily_extract`).

## Architecture

```
agent ──► nginx (172.28.0.5:8080)
            │  /mcp/  →  gateway:9000
            ▼
          gateway (172.28.0.10)          FastMCP aggregator
            │  mounts each upstream under its prefix
            ├──► tavily   (172.28.0.20:8000)
            └──► <next>   (172.28.0.30:8000)
```

- **nginx** — public entrypoint, TLS-ready, SSE-friendly proxy
  (`proxy_buffering off`, 1h timeouts). No MCP awareness.
- **gateway** — FastMCP server on the south side, FastMCP `Client`
  on the north side. Reads `gateway/config.yaml`, calls
  `FastMCP.as_proxy(client)` per upstream, then `mount(proxy, prefix=...)`.
  Tool listing and dispatch are handled automatically by FastMCP's
  proxy + mount machinery.
- **upstreams** — independent FastMCP servers. The reference one
  (`servers/tavily`) wraps the Tavily search and extract APIs.

Static IPs are pinned on a private bridge network (`172.28.0.0/24`)
so packet captures and firewall rules stay readable. Service-DNS
(`gateway`, `tavily`) is still used inside compose.

## Layout

```
mcp/
├── docker-compose.yml           # nginx + gateway + tavily
├── docker-compose.override.yml  # dev: source volume mounts (hot reload)
├── .env.example                 # TAVILY_API_KEY
├── nginx/
│   └── nginx.conf               # :8080 → gateway:9000
├── gateway/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config.yaml              # upstream registry
│   └── src/
│       ├── main.py              # FastMCP server + /healthz
│       └── registry.py          # YAML → typed config
└── servers/
    └── tavily/
        ├── Dockerfile
        ├── requirements.txt
        └── src/server.py        # search, extract tools
```

## Run

```bash
cd mcp
cp .env.example .env
# edit .env and paste a real Tavily API key
docker compose up --build
```

Endpoints:

| URL                            | Purpose                              |
| ------------------------------ | ------------------------------------ |
| `http://localhost:8080/mcp/`   | MCP endpoint for agents (Streamable HTTP) |
| `http://localhost:8080/healthz`| Gateway health + upstream list       |

The dev override mounts `gateway/src` and `servers/tavily/src` as
read-only volumes, so editing Python source is reflected on container
restart (`docker compose restart gateway`).

## Add a new MCP server

1. Drop a new FastMCP repo under `servers/<name>/` mirroring
   `servers/tavily/`:
   - `Dockerfile`
   - `requirements.txt`
   - `src/server.py` exposing `@mcp.tool` functions and ending with
     `mcp.run(transport="http", host="0.0.0.0", port=8000)`.
2. Add a service to `docker-compose.yml` and assign an unused IP
   (e.g. `172.28.0.30`).
3. Append an entry to `gateway/config.yaml`:
   ```yaml
   upstreams:
     - name: <name>
       prefix: <name>
       url: http://<name>:8000/mcp/
   ```
4. `docker compose up --build`. The gateway re-mounts on boot;
   the new tools surface as `<name>_<tool>` with no agent-side change.

The upstream repos are designed to live in their own git repos
later — split with `git subtree split --prefix=mcp/servers/<name>`
once you want to publish images independently.

## Tool naming

FastMCP's `mount(prefix=...)` namespaces tools as `<prefix>_<tool>`
(underscore, MCP-spec safe). Pick prefixes carefully — they are part
of the public tool name your agents call.

## Configuration reference

`gateway/config.yaml`:

```yaml
name: mcp-gateway          # logical name reported to clients
upstreams:
  - name: tavily           # human label, used in logs
    prefix: tavily         # tool-name prefix
    url: http://tavily:8000/mcp/
```

Environment variables (gateway):

| Name             | Default              | Purpose                       |
| ---------------- | -------------------- | ----------------------------- |
| `GATEWAY_CONFIG` | `/app/config.yaml`   | Path to upstream registry     |
| `GATEWAY_HOST`   | `0.0.0.0`            | Bind host                     |
| `GATEWAY_PORT`   | `9000`               | Bind port                     |

Environment variables (tavily):

| Name             | Required | Purpose            |
| ---------------- | -------- | ------------------ |
| `TAVILY_API_KEY` | yes      | Tavily account key |
| `TAVILY_HOST`    | no       | Bind host          |
| `TAVILY_PORT`    | no       | Bind port          |

## Troubleshooting

- **`/healthz` returns 502** — gateway didn't come up. Check
  `docker compose logs gateway`. Most likely an upstream URL is wrong
  in `config.yaml`.
- **Agent sees no tools** — confirm the upstream is reachable from the
  gateway container: `docker compose exec gateway curl -s http://tavily:8000/mcp/`.
- **`TAVILY_API_KEY environment variable is required`** — `.env`
  not present or `env_file: .env` not picked up. The Tavily container
  refuses to start without a key.
- **SSE responses cut off** — check that nginx still has
  `proxy_buffering off` and high `proxy_read_timeout`.

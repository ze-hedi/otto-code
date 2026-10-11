# MCP Gateway — How to Run

Single Docker Compose stack that exposes **Tavily**, **Project Dashboard**, and **GitHub MCP** behind one HTTP endpoint at `http://localhost:8080/mcp/`.

## Prerequisites

- Docker + Docker Compose
- A GitHub Personal Access Token (classic, `repo` + `read:org` scopes)
- A Tavily API key

## 1. Configure secrets

```bash
cp mcp/.env.example mcp/.env
# edit mcp/.env and fill in:
#   TAVILY_API_KEY=tvly-...
#   GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
```

## 2. Build and start

```bash
cd mcp
docker compose up --build
```

First build takes ~5 min (GitHub MCP server compiles Go + Node UI).  
Subsequent starts are fast (layers cached).

The gateway is healthy when you see:
```
gateway  | INFO  starting gateway mcp-gateway on 0.0.0.0:9000
```

## 3. Verify

```bash
curl http://localhost:8080/healthz
# {"status":"ok","upstreams":["tavily","dashboard","github"]}
```

## 4. Connect from pi-agent

```typescript
const agent = new RawPiAgent({ model: "...", systemPrompt: "..." });

// Connect once — discovers all tools from all upstreams
const toolsByServer = await agent.connectGateway("http://localhost:8080/mcp/");

// toolsByServer:
//   "tavily"    → ["tavily_search", "tavily_extract"]
//   "dashboard" → ["dashboard_create_dashboard", "dashboard_get_dashboard", ...]
//   "github"    → ["github_create_issue", "github_get_file_contents", ...]

await agent.chat("Search for X and create a GitHub issue", handleEvent);
await agent.disconnectMcp();
```

## Tool name convention

The gateway prefixes every tool with its upstream name:

| Upstream | Prefix | Example tool |
|----------|--------|--------------|
| Tavily   | `tavily_` | `tavily_search` |
| Dashboard | `dashboard_` | `dashboard_create_dashboard` |
| GitHub   | `github_` | `github_create_issue` |

## Ports (internal Docker network)

| Service | IP | Port |
|---------|----|------|
| nginx (public) | 172.28.0.5 | **8080** |
| gateway | 172.28.0.10 | 9000 |
| tavily | 172.28.0.20 | 8000 |
| project-dashboard | 172.28.0.21 | 3200 |
| github-mcp | 172.28.0.30 | 8082 |

## Stop

```bash
docker compose down
```

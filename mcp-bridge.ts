// mcp-bridge.ts
// Thin MCP client wrapper for connecting to an MCP gateway over Streamable HTTP.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpBridge {
  tools: McpToolEntry[];
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: any[] }>;
  close(): Promise<void>;
}

export async function createMcpBridge(
  endpoint: string,
  timeoutMs = 5000
): Promise<McpBridge> {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  const client = new Client({ name: "pi-agent", version: "1.0.0" });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await client.connect(transport);
  } finally {
    clearTimeout(timer);
  }

  const { tools: rawTools } = await client.listTools();

  const tools: McpToolEntry[] = rawTools.map((t) => ({
    name: t.name,
    description: t.description ?? t.name,
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" },
  }));

  return {
    tools,
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args });
      return { content: result.content as any[] };
    },
    async close() {
      await client.close();
    },
  };
}

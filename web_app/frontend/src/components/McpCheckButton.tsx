import { useState } from 'react'

interface McpTool {
  name: string
  description: string
}

type CheckResult = { tools: McpTool[] } | { error: string }

/** Checks that an MCP server is reachable and shows its tools in a popup. */
export default function McpCheckButton({ name, url }: { name: string; url: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)

  const check = async () => {
    setLoading(true)
    try {
      const res = await fetch('http://localhost:4000/agents/mcp-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      setResult(await res.json())
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button type="button" className="mcp-check-btn" onClick={check} disabled={!url.trim() || loading}>
        {loading ? 'Checking…' : 'Check'}
      </button>
      {result && (
        <>
          <div className="mcp-popup-backdrop" onClick={() => setResult(null)} />
          <div className="mcp-popup">
            <div className="mcp-popup-header">
              <h3>{name || url}</h3>
              <button type="button" className="mcp-popup-close" onClick={() => setResult(null)}>&times;</button>
            </div>
            <div className="mcp-popup-body">
              {'error' in result ? (
                <p className="mcp-popup-error">Server not accessible: {result.error}</p>
              ) : (
                <>
                  <p className="mcp-popup-ok">Connected — {result.tools.length} tool(s) available</p>
                  <ul className="mcp-tool-list">
                    {result.tools.map(t => (
                      <li key={t.name}>
                        <code>{t.name}</code>
                        {t.description !== t.name && <span>{t.description}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

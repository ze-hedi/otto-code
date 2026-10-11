import { useState, useEffect } from 'react'

interface SessionStats {
  sessionId: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  cost: number
  contextUsage?: { used: number; total: number }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface SessionStatsPanelProps {
  agentId: string | null
  show: boolean
  onClose: () => void
}

export function SessionStatsPanel({ agentId, show, onClose }: SessionStatsPanelProps) {
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const fetchStats = async () => {
    if (!agentId) return
    setStatsLoading(true)
    try {
      const res = await fetch(`http://localhost:4000/agents/${agentId}/stats`)
      if (res.ok) setStats(await res.json())
      else setStats(null)
    } catch {
      setStats(null)
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    if (show && agentId) fetchStats()
  }, [show, agentId])

  return (
    <>
      {show && <div className="details-backdrop" onClick={onClose} />}
      <div className={`details-panel stats-panel ${show ? 'open' : ''}`}>
        <div className="details-panel-header">
          <h3>Session Stats</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="details-close" title="Refresh" onClick={fetchStats}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button className="details-close" onClick={onClose}>&times;</button>
          </div>
        </div>
        <div className="details-body">
          {statsLoading && <div className="stats-loading">Loading…</div>}
          {!statsLoading && !stats && <div className="stats-loading">Agent not running or no stats available.</div>}
          {!statsLoading && stats && (
            <>
              <div className="stats-section">
                <div className="stats-section-title">Tokens</div>
                <div className="stats-grid">
                  <div className="stats-cell"><span className="stats-val">{fmtNum(stats.tokens.input)}</span><span className="stats-key">input</span></div>
                  <div className="stats-cell"><span className="stats-val">{fmtNum(stats.tokens.output)}</span><span className="stats-key">output</span></div>
                  <div className="stats-cell"><span className="stats-val">{fmtNum(stats.tokens.cacheRead)}</span><span className="stats-key">cache read</span></div>
                  <div className="stats-cell"><span className="stats-val">{fmtNum(stats.tokens.cacheWrite)}</span><span className="stats-key">cache write</span></div>
                  <div className="stats-cell stats-cell-wide"><span className="stats-val stats-val-accent">{fmtNum(stats.tokens.total)}</span><span className="stats-key">total</span></div>
                </div>
              </div>
              <div className="stats-section">
                <div className="stats-section-title">Cost</div>
                <div className="stats-cost">${stats.cost.toFixed(4)}</div>
              </div>
              <div className="stats-section">
                <div className="stats-section-title">Messages</div>
                <div className="stats-grid">
                  <div className="stats-cell"><span className="stats-val">{stats.userMessages}</span><span className="stats-key">user</span></div>
                  <div className="stats-cell"><span className="stats-val">{stats.assistantMessages}</span><span className="stats-key">assistant</span></div>
                  <div className="stats-cell"><span className="stats-val">{stats.toolCalls}</span><span className="stats-key">tool calls</span></div>
                  <div className="stats-cell stats-cell-wide"><span className="stats-val stats-val-accent">{stats.totalMessages}</span><span className="stats-key">total</span></div>
                </div>
              </div>
              {stats.contextUsage && (
                <div className="stats-section">
                  <div className="stats-section-title">Context window</div>
                  <div className="stats-context-bar-wrap">
                    <div className="stats-context-bar">
                      <div
                        className="stats-context-fill"
                        style={{ width: `${Math.min(100, (stats.contextUsage.used / stats.contextUsage.total) * 100).toFixed(1)}%` }}
                      />
                    </div>
                    <span className="stats-context-label">{fmtNum(stats.contextUsage.used)} / {fmtNum(stats.contextUsage.total)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

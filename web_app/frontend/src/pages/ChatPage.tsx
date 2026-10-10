import { useState, useRef, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import Markdown from 'react-markdown'
import './ChatPage.css'

type SubAgentPart =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool'; name: string; input: string; result?: string; isError?: boolean; status: 'running' | 'done' }

type MessagePart =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool'; name: string; input: string; result?: string; isError?: boolean; status: 'running' | 'done'; toolCallId?: string }
  | { type: 'subagent'; toolCallId: string; toolName: string; status: 'running' | 'done'; parts: SubAgentPart[]; result?: string; isError?: boolean }
  | { type: 'tool_approval'; toolCallId: string; toolName: string; args: string; status: 'pending' | 'approved' | 'rejected' }
  | { type: 'clarification'; toolCallId: string; questions: string[]; answers: string[]; status: 'pending' | 'answered' }

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string       // used for user messages
  parts: MessagePart[]  // used for assistant messages
}

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

interface AgentConfig {
  name?: string
  description?: string
  model: string
  systemPrompt?: string
  builtInTools?: string[]
  mcpServers?: Record<string, string>
  thinkingLevel?: string
  playground?: string
  subAgents?: Record<string, {
    name: string
    description: string
    model: string
    systemPrompt: string
    builtInTools?: string[]
    playground?: string
  }>
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Process SSE events from a ReadableStream reader, appending to `parts` and calling `updateMessage` on each event. */
async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parts: MessagePart[],
  updateMessage: () => void,
) {
  const decoder = new TextDecoder()
  let buf = ''

  const lastPart = (type: string) =>
    parts.length > 0 && parts[parts.length - 1].type === type ? parts[parts.length - 1] : null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })

    while (buf.includes('\n')) {
      const idx = buf.indexOf('\n')
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)

      if (!line.startsWith('data: ')) continue
      let ev: any
      try { ev = JSON.parse(line.slice(6)) } catch { continue }

      if (ev.type === 'agent_idle') break

      if (ev.type === 'thinking' && ev.text) {
        const existing = lastPart('thinking') as { type: 'thinking'; content: string } | null
        if (existing) {
          existing.content += ev.text
        } else {
          parts.push({ type: 'thinking', content: ev.text })
        }
        updateMessage()
      } else if (ev.type === 'delta' && ev.text) {
        const existing = lastPart('text') as { type: 'text'; content: string } | null
        if (existing) {
          existing.content += ev.text
        } else {
          parts.push({ type: 'text', content: ev.text })
        }
        updateMessage()
      } else if (ev.type === 'tool_start') {
        parts.push({
          type: 'tool',
          name: ev.name,
          input: JSON.stringify(ev.args, null, 2),
          status: 'running',
          toolCallId: ev.toolCallId,
        })
        updateMessage()
      } else if (ev.type === 'subagent_event') {
        // Promote tool part to subagent on first subagent_event
        const toolIdx = parts.findIndex(p => p.type === 'tool' && (p as any).toolCallId === ev.toolCallId)
        if (toolIdx !== -1) {
          const old = parts[toolIdx] as any
          parts[toolIdx] = {
            type: 'subagent',
            toolCallId: ev.toolCallId,
            toolName: old.name,
            status: 'running',
            parts: [],
          }
        }
        const sa = parts.find(p => p.type === 'subagent' && (p as any).toolCallId === ev.toolCallId) as any
        if (sa) {
          const subParts: SubAgentPart[] = sa.parts
          const lastSub = (type: string) =>
            subParts.length > 0 && subParts[subParts.length - 1].type === type ? subParts[subParts.length - 1] : null

          if (ev.subType === 'thinking' && ev.text) {
            const existing = lastSub('thinking') as { type: 'thinking'; content: string } | null
            if (existing) { existing.content += ev.text }
            else { subParts.push({ type: 'thinking', content: ev.text }) }
          } else if (ev.subType === 'delta' && ev.text) {
            const existing = lastSub('text') as { type: 'text'; content: string } | null
            if (existing) { existing.content += ev.text }
            else { subParts.push({ type: 'text', content: ev.text }) }
          } else if (ev.subType === 'tool_start') {
            subParts.push({ type: 'tool', name: ev.name, input: JSON.stringify(ev.args, null, 2), status: 'running' })
          } else if (ev.subType === 'tool_end') {
            for (let i = subParts.length - 1; i >= 0; i--) {
              const p = subParts[i]
              if (p.type === 'tool' && p.name === ev.name && p.status === 'running') {
                const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
                p.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
                p.isError = ev.isError
                p.status = 'done'
                break
              }
            }
          }
          updateMessage()
        }
      } else if (ev.type === 'tool_approval_required') {
        parts.push({
          type: 'tool_approval',
          toolCallId: ev.toolCallId,
          toolName: ev.name,
          args: JSON.stringify(ev.args, null, 2),
          status: 'pending',
        })
        updateMessage()
      } else if (ev.type === 'clarification_required') {
        parts.push({
          type: 'clarification',
          toolCallId: ev.toolCallId,
          questions: ev.questions,
          answers: ev.questions.map(() => ''),
          status: 'pending',
        })
        updateMessage()
      } else if (ev.type === 'tool_end') {
        // Remove any clarification part for this tool call
        if (ev.toolCallId) {
          for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i].type === 'clarification' && (parts[i] as any).toolCallId === ev.toolCallId) {
              parts.splice(i, 1)
              break
            }
          }
        }
        // Try subagent part first (by toolCallId), then fall back to regular tool
        let matched = false
        if (ev.toolCallId) {
          const sa = parts.find(p => p.type === 'subagent' && (p as any).toolCallId === ev.toolCallId) as any
          if (sa) {
            const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
            sa.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
            sa.isError = ev.isError
            sa.status = 'done'
            matched = true
          }
        }
        if (!matched) {
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i]
            if (p.type === 'tool' && p.status === 'running' &&
                (ev.toolCallId ? (p as any).toolCallId === ev.toolCallId : p.name === ev.name)) {
              const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
              p.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
              p.isError = ev.isError
              p.status = 'done'
              break
            }
          }
        }
        updateMessage()
      } else if (ev.type === 'error') {
        parts.push({ type: 'text', content: `Error: ${ev.message}` })
        updateMessage()
      }
    }
  }
}

export function ChatPage() {
  const { agentId, projectId } = useParams<{ agentId: string; projectId: string }>()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!agentId) return
    fetch(`http://localhost:4000/agents/${agentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(doc => { if (doc?.config) setAgentConfig(doc.config) })
      .catch(() => {})
  }, [agentId])

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

  const handleOpenStats = () => {
    setShowStats(true)
    fetchStats()
  }

  // On mount: load messages, then check if agent is busy and reconnect to stream
  useEffect(() => {
    if (!agentId) return
    const controller = new AbortController()
    abortRef.current = controller

    ;(async () => {
      try {
        // Load existing messages
        const msgsRes = await fetch(`http://localhost:4000/agents/${agentId}/messages`, { signal: controller.signal })
        const msgs: ChatMessage[] = msgsRes.ok ? await msgsRes.json() : []
        if (msgs.length > 0) setMessages(msgs)

        // Check if agent is currently streaming
        const statusRes = await fetch(`http://localhost:4000/agents/${agentId}/status`, { signal: controller.signal })
        const status = await statusRes.json()

        if (status.busy) {
          setBusy(true)

          // Find or create the assistant message slot to append streaming parts to
          const lastMsg = msgs[msgs.length - 1]
          const isLastAssistant = lastMsg?.role === 'assistant'
          const parts: MessagePart[] = isLastAssistant ? [...lastMsg.parts] : []
          const assistantIdx = isLastAssistant ? msgs.length - 1 : msgs.length

          if (!isLastAssistant) {
            setMessages(prev => [...prev, { role: 'assistant', content: '', parts: [] }])
          }

          const updateMessage = () => {
            const snapshot = parts.map(p => ({ ...p }))
            setMessages(prev => {
              const next = [...prev]
              next[assistantIdx] = { role: 'assistant', content: '', parts: snapshot }
              return next
            })
          }

          // Subscribe to the event stream for remaining events
          const eventsRes = await fetch(`http://localhost:4000/agents/${agentId}/events`, { signal: controller.signal })
          if (eventsRes.ok && eventsRes.body) {
            await processSSEStream(eventsRes.body.getReader(), parts, updateMessage)
          }

          setBusy(false)
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('[chat] reconnect error:', err)
      }
    })()

    return () => { controller.abort() }
  }, [agentId])

  useEffect(() => {
    if (!showDetails || !agentId) return
    fetch(`http://localhost:4000/agents/${agentId}/system-prompt`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.systemPrompt) {
          setAgentConfig(prev => prev ? { ...prev, systemPrompt: data.systemPrompt } : prev)
        }
      })
      .catch(() => {})
  }, [showDetails, agentId])

  useEffect(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.input-bar textarea')
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 150) + 'px'
    }
  }, [input])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    const msgs: ChatMessage[] = [...messages, { role: 'user', content: text, parts: [] }]
    msgs.push({ role: 'assistant', content: '', parts: [] })
    const assistantIdx = msgs.length - 1
    setMessages([...msgs])

    const parts: MessagePart[] = []

    const updateMessage = () => {
      const snapshot = parts.map(p => ({ ...p }))
      setMessages(prev => {
        const next = [...prev]
        next[assistantIdx] = { role: 'assistant', content: '', parts: snapshot }
        return next
      })
    }

    try {
      const res = await fetch(`http://localhost:4000/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText)
      }

      await processSSEStream(res.body!.getReader(), parts, updateMessage)
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        parts.push({ type: 'text', content: `Error: ${err.message}` })
        updateMessage()
      }
    }

    setBusy(false)
  }

  async function handleToolApproval(toolCallId: string, approve: boolean, comment?: string) {
    const endpoint = approve ? 'tool-approve' : 'tool-reject'
    const body: any = { toolCallId }
    if (!approve && comment) body.comment = comment
    try {
      await fetch(`http://localhost:4000/agents/${agentId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Update the approval part status in messages
      setMessages(prev => prev.map(msg => {
        if (msg.role !== 'assistant') return msg
        const updated = msg.parts.map(p =>
          p.type === 'tool_approval' && p.toolCallId === toolCallId
            ? { ...p, status: approve ? 'approved' as const : 'rejected' as const }
            : p
        )
        return { ...msg, parts: updated }
      }))
    } catch (err) {
      console.error('[chat] tool approval error:', err)
    }
  }

  function updateClarificationAnswer(toolCallId: string, index: number, value: string) {
    setMessages(prev => prev.map(msg => {
      if (msg.role !== 'assistant') return msg
      const updated = msg.parts.map(p =>
        p.type === 'clarification' && p.toolCallId === toolCallId
          ? { ...p, answers: p.answers.map((a: string, i: number) => i === index ? value : a) }
          : p
      )
      return { ...msg, parts: updated }
    }))
  }

  async function submitClarification(toolCallId: string) {
    const part = messages.flatMap(m => m.parts).find(
      p => p.type === 'clarification' && p.toolCallId === toolCallId
    ) as Extract<MessagePart, { type: 'clarification' }> | undefined
    if (!part) return
    try {
      await fetch(`http://localhost:4000/agents/${agentId}/clarification-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId, answers: part.answers }),
      })
      setMessages(prev => prev.map(msg => {
        if (msg.role !== 'assistant') return msg
        const updated = msg.parts.map(p =>
          p.type === 'clarification' && p.toolCallId === toolCallId
            ? { ...p, status: 'answered' as const }
            : p
        )
        return { ...msg, parts: updated }
      }))
    } catch (err) {
      console.error('[chat] clarification submit error:', err)
    }
  }

  async function stop() {
    // Abort the client-side fetch
    abortRef.current?.abort()
    // Tell the backend to abort the agent
    try {
      await fetch(`http://localhost:4000/agents/${agentId}/stop`, { method: 'POST' })
    } catch {}
    setBusy(false)
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="header-inner">
          <button
            className="back-link"
            onClick={() => navigate(projectId ? `/projects/${projectId}/agents` : '/')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            ← Back
          </button>
          <div className="chat-title">
            <h2>{agentConfig?.name || 'Chat'}</h2>
            <span className="agent-id">{agentId?.slice(0, 8)}...</span>
          </div>
          <button
            className="details-btn"
            onClick={handleOpenStats}
            title="Session stats"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>
          <button
            className="details-btn"
            onClick={() => setShowDetails(!showDetails)}
            title="Agent details"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </div>
      </div>

      {showStats && <div className="details-backdrop" onClick={() => setShowStats(false)} />}
      <div className={`details-panel stats-panel ${showStats ? 'open' : ''}`}>
        <div className="details-panel-header">
          <h3>Session Stats</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="details-close" title="Refresh" onClick={fetchStats}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button className="details-close" onClick={() => setShowStats(false)}>&times;</button>
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

      {showDetails && <div className="details-backdrop" onClick={() => setShowDetails(false)} />}
      <div className={`details-panel ${showDetails ? 'open' : ''}`}>
        <div className="details-panel-header">
          <h3>Agent Details</h3>
          <button className="details-close" onClick={() => setShowDetails(false)}>&times;</button>
        </div>
        {agentConfig ? (
          <div className="details-body">
            {agentConfig.name && (
              <div className="detail-field">
                <span className="detail-label">Name</span>
                <span className="detail-value">{agentConfig.name}</span>
              </div>
            )}
            <div className="detail-field">
              <span className="detail-label">Model</span>
              <span className="detail-value mono">{agentConfig.model}</span>
            </div>
            {agentConfig.description && (
              <div className="detail-field">
                <span className="detail-label">Description</span>
                <span className="detail-value">{agentConfig.description}</span>
              </div>
            )}
            {agentConfig.thinkingLevel && agentConfig.thinkingLevel !== 'off' && (
              <div className="detail-field">
                <span className="detail-label">Thinking</span>
                <span className="detail-chip">{agentConfig.thinkingLevel}</span>
              </div>
            )}
            {agentConfig.builtInTools && agentConfig.builtInTools.length > 0 && (
              <div className="detail-field">
                <span className="detail-label">Tools</span>
                <div className="detail-chips">
                  {agentConfig.builtInTools.map(t => (
                    <span key={t} className="detail-chip">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {agentConfig.mcpServers && Object.keys(agentConfig.mcpServers).length > 0 && (
              <div className="detail-field">
                <span className="detail-label">MCP Servers</span>
                <div className="detail-chips">
                  {Object.keys(agentConfig.mcpServers).map(name => (
                    <span key={name} className="detail-chip">{name}</span>
                  ))}
                </div>
              </div>
            )}
            {agentConfig.playground && (
              <div className="detail-field">
                <span className="detail-label">Playground</span>
                <span className="detail-value mono">{agentConfig.playground}</span>
              </div>
            )}
            {agentConfig.subAgents && Object.keys(agentConfig.subAgents).length > 0 && (
              <div className="detail-field">
                <span className="detail-label">Volatile Subagents</span>
                <div className="detail-subagents">
                  {Object.entries(agentConfig.subAgents).map(([key, sa]) => (
                    <details key={key} className="detail-subagent-card">
                      <summary>
                        <span className="detail-subagent-name">{sa.name || key}</span>
                        <span className="detail-chip">{sa.model}</span>
                      </summary>
                      <div className="detail-subagent-body">
                        <div className="detail-subagent-row">
                          <span className="detail-label">Key</span>
                          <span className="detail-value mono">{key}</span>
                        </div>
                        {sa.description && (
                          <div className="detail-subagent-row">
                            <span className="detail-label">Description</span>
                            <span className="detail-value">{sa.description}</span>
                          </div>
                        )}
                        {sa.builtInTools && sa.builtInTools.length > 0 && (
                          <div className="detail-subagent-row">
                            <span className="detail-label">Tools</span>
                            <div className="detail-chips">
                              {sa.builtInTools.map(t => (
                                <span key={t} className="detail-chip">{t}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {sa.playground && (
                          <div className="detail-subagent-row">
                            <span className="detail-label">Playground</span>
                            <span className="detail-value mono">{sa.playground}</span>
                          </div>
                        )}
                        <div className="detail-subagent-row">
                          <span className="detail-label">System Prompt</span>
                          <pre className="detail-prompt">{sa.systemPrompt}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
            {agentConfig.systemPrompt && (
              <div className="detail-field">
                <span className="detail-label">System Prompt</span>
                <pre className="detail-prompt">{agentConfig.systemPrompt}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="details-body">
            <span className="detail-value">Loading...</span>
          </div>
        )}
      </div>

      <div className="messages-area">
        {messages.length === 0 && !busy && (
          <div className="empty-state">Send a message to start the conversation</div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message-row ${msg.role}`}>
            <div className="message-row-inner">
              <span className="role-label">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
              {msg.role === 'user' ? (
                <div className="user-message">
                  <p>{msg.content}</p>
                </div>
              ) : (
                <div className="assistant-parts">
                  {msg.parts.length === 0 && (
                    <div className="assistant-message"><p>...</p></div>
                  )}
                  {msg.parts.map((part, j) => {
                    if (part.type === 'thinking') {
                      return (
                        <details key={j} className="part-thinking">
                          <summary>Thinking</summary>
                          <div className="thinking-content">{part.content}</div>
                        </details>
                      )
                    }
                    if (part.type === 'text') {
                      return (
                        <div key={j} className="assistant-message">
                          <Markdown>{part.content}</Markdown>
                        </div>
                      )
                    }
                    if (part.type === 'tool') {
                      return (
                        <div key={j} className={`part-tool ${part.status}`}>
                          <div className="tool-header">
                            <span className="tool-name">{part.name}</span>
                            {part.status === 'running' && <span className="tool-spinner" />}
                            {part.status === 'done' && (
                              <span className={`tool-status ${part.isError ? 'error' : 'ok'}`}>
                                {part.isError ? 'error' : 'done'}
                              </span>
                            )}
                          </div>
                          <details className="tool-section">
                            <summary>Input</summary>
                            <pre className="tool-pre">{part.input}</pre>
                          </details>
                          {part.result !== undefined && (
                            <details className="tool-section">
                              <summary>Result</summary>
                              <pre className={`tool-pre ${part.isError ? 'tool-error' : ''}`}>{part.result}</pre>
                            </details>
                          )}
                        </div>
                      )
                    }
                    if (part.type === 'tool_approval') {
                      return (
                        <div key={j} className={`part-approval ${part.status}`}>
                          <div className="approval-header">
                            <span className="approval-icon">&#9888;</span>
                            <span className="tool-name">{part.toolName}</span>
                            {part.status === 'pending' && <span className="approval-badge pending">Awaiting approval</span>}
                            {part.status === 'approved' && <span className="approval-badge approved">Approved</span>}
                            {part.status === 'rejected' && <span className="approval-badge rejected">Rejected</span>}
                          </div>
                          <details className="tool-section" open>
                            <summary>Arguments</summary>
                            <pre className="tool-pre">{part.args}</pre>
                          </details>
                          {part.status === 'pending' && (
                            <div className="approval-actions">
                              <button
                                className="approval-btn approve"
                                onClick={() => handleToolApproval(part.toolCallId, true)}
                              >
                                Approve
                              </button>
                              <button
                                className="approval-btn reject"
                                onClick={() => {
                                  const reason = prompt('Reason for rejection (optional):')
                                  handleToolApproval(part.toolCallId, false, reason || undefined)
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    }
                    if (part.type === 'clarification') {
                      return (
                        <div key={j} className={`part-clarification ${part.status}`}>
                          <div className="clarification-header">
                            <span className="clarification-icon">?</span>
                            <span className="tool-name">Clarification needed</span>
                            {part.status === 'pending' && <span className="approval-badge pending">Awaiting answers</span>}
                            {part.status === 'answered' && <span className="approval-badge approved">Answered</span>}
                          </div>
                          <div className="clarification-questions">
                            {part.questions.map((q: string, qi: number) => (
                              <div key={qi} className="clarification-qa">
                                <label className="clarification-q">{q}</label>
                                {part.status === 'pending' ? (
                                  <textarea
                                    className="clarification-input"
                                    rows={2}
                                    value={part.answers[qi]}
                                    onChange={e => updateClarificationAnswer(part.toolCallId, qi, e.target.value)}
                                    placeholder="Your answer..."
                                  />
                                ) : (
                                  <p className="clarification-a">{part.answers[qi]}</p>
                                )}
                              </div>
                            ))}
                          </div>
                          {part.status === 'pending' && (
                            <div className="approval-actions">
                              <button
                                className="approval-btn approve"
                                onClick={() => submitClarification(part.toolCallId)}
                              >
                                Submit Answers
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    }
                    if (part.type === 'subagent') {
                      return (
                        <div key={j} className={`part-subagent ${part.status}`}>
                          <div className="subagent-header">
                            <span className="subagent-icon">⚡</span>
                            <span className="tool-name">{part.toolName}</span>
                            {part.status === 'running' && <span className="tool-spinner" />}
                            {part.status === 'done' && (
                              <span className={`tool-status ${part.isError ? 'error' : 'ok'}`}>
                                {part.isError ? 'error' : 'done'}
                              </span>
                            )}
                          </div>
                          <div className="subagent-stream" ref={el => { if (el && part.status === 'running') el.scrollTop = el.scrollHeight }}>
                            {part.parts.length === 0 && part.status === 'running' && (
                              <div className="typing-indicator">
                                <span /><span /><span />
                              </div>
                            )}
                            {part.parts.map((sp, k) => {
                              if (sp.type === 'thinking') {
                                return (
                                  <details key={k} className="part-thinking">
                                    <summary>Thinking</summary>
                                    <div className="thinking-content">{sp.content}</div>
                                  </details>
                                )
                              }
                              if (sp.type === 'text') {
                                return (
                                  <div key={k} className="assistant-message">
                                    <Markdown>{sp.content}</Markdown>
                                  </div>
                                )
                              }
                              if (sp.type === 'tool') {
                                return (
                                  <div key={k} className={`part-tool ${sp.status}`}>
                                    <div className="tool-header">
                                      <span className="tool-name">{sp.name}</span>
                                      {sp.status === 'running' && <span className="tool-spinner" />}
                                      {sp.status === 'done' && (
                                        <span className={`tool-status ${sp.isError ? 'error' : 'ok'}`}>
                                          {sp.isError ? 'error' : 'done'}
                                        </span>
                                      )}
                                    </div>
                                    {sp.result !== undefined && (
                                      <details className="tool-section">
                                        <summary>Result</summary>
                                        <pre className={`tool-pre ${sp.isError ? 'tool-error' : ''}`}>{sp.result}</pre>
                                      </details>
                                    )}
                                  </div>
                                )
                              }
                              return null
                            })}
                          </div>
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="input-wrapper">
        <div className="input-bar">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Message assistant..."
            rows={1}
            disabled={busy}
          />
          {busy ? (
            <button
              className="send-btn stop-btn"
              onClick={stop}
              title="Stop generating"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={send}
              disabled={!input.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="input-footer">Agent can make mistakes. Verify important information.</div>
      </div>
    </div>
  )
}

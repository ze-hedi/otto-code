import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import './ChatPage.css'

type MessagePart =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool'; name: string; input: string; result?: string; isError?: boolean; status: 'running' | 'done' }

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string       // used for user messages
  parts: MessagePart[]  // used for assistant messages
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
        })
        updateMessage()
      } else if (ev.type === 'tool_end') {
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]
          if (p.type === 'tool' && p.name === ev.name && p.status === 'running') {
            const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
            p.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
            p.isError = ev.isError
            p.status = 'done'
            break
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
  const { agentId } = useParams<{ agentId: string }>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [showDetails, setShowDetails] = useState(false)
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

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="header-inner">
          <Link to="/" className="back-link">← Back</Link>
          <div className="chat-title">
            <h2>{agentConfig?.name || 'Chat'}</h2>
            <span className="agent-id">{agentId?.slice(0, 8)}...</span>
          </div>
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
          <button
            className="send-btn"
            onClick={send}
            disabled={!input.trim() || busy}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
        <div className="input-footer">Agent can make mistakes. Verify important information.</div>
      </div>
    </div>
  )
}

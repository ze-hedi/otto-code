import { useState, useRef, useEffect } from 'react'
import Markdown from 'react-markdown'
import './ChatPage.css'

/* ── Types ─────────────────────────────────────────── */

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
  content: string
  parts: MessagePart[]
}

/* ── SSE stream processor ──────────────────────────── */

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
        if (existing) existing.content += ev.text
        else parts.push({ type: 'thinking', content: ev.text })
        updateMessage()
      } else if (ev.type === 'delta' && ev.text) {
        const existing = lastPart('text') as { type: 'text'; content: string } | null
        if (existing) existing.content += ev.text
        else parts.push({ type: 'text', content: ev.text })
        updateMessage()
      } else if (ev.type === 'tool_start') {
        parts.push({ type: 'tool', name: ev.name, input: JSON.stringify(ev.args, null, 2), status: 'running', toolCallId: ev.toolCallId })
        updateMessage()
      } else if (ev.type === 'subagent_event') {
        const toolIdx = parts.findIndex(p => p.type === 'tool' && (p as any).toolCallId === ev.toolCallId)
        if (toolIdx !== -1) {
          const old = parts[toolIdx] as any
          parts[toolIdx] = { type: 'subagent', toolCallId: ev.toolCallId, toolName: old.name, status: 'running', parts: [] }
        }
        const sa = parts.find(p => p.type === 'subagent' && (p as any).toolCallId === ev.toolCallId) as any
        if (sa) {
          const subParts: SubAgentPart[] = sa.parts
          const lastSub = (type: string) =>
            subParts.length > 0 && subParts[subParts.length - 1].type === type ? subParts[subParts.length - 1] : null
          if (ev.subType === 'thinking' && ev.text) {
            const existing = lastSub('thinking') as { type: 'thinking'; content: string } | null
            if (existing) existing.content += ev.text
            else subParts.push({ type: 'thinking', content: ev.text })
          } else if (ev.subType === 'delta' && ev.text) {
            const existing = lastSub('text') as { type: 'text'; content: string } | null
            if (existing) existing.content += ev.text
            else subParts.push({ type: 'text', content: ev.text })
          } else if (ev.subType === 'tool_start') {
            subParts.push({ type: 'tool', name: ev.name, input: JSON.stringify(ev.args, null, 2), status: 'running' })
          } else if (ev.subType === 'tool_end') {
            for (let i = subParts.length - 1; i >= 0; i--) {
              const p = subParts[i]
              if (p.type === 'tool' && p.name === ev.name && p.status === 'running') {
                const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
                p.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
                p.isError = ev.isError; p.status = 'done'; break
              }
            }
          }
          updateMessage()
        }
      } else if (ev.type === 'tool_approval_required') {
        parts.push({ type: 'tool_approval', toolCallId: ev.toolCallId, toolName: ev.name, args: JSON.stringify(ev.args, null, 2), status: 'pending' })
        updateMessage()
      } else if (ev.type === 'clarification_required') {
        parts.push({ type: 'clarification', toolCallId: ev.toolCallId, questions: ev.questions, answers: ev.questions.map(() => ''), status: 'pending' })
        updateMessage()
      } else if (ev.type === 'tool_end') {
        if (ev.toolCallId) {
          for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i].type === 'clarification' && (parts[i] as any).toolCallId === ev.toolCallId) { parts.splice(i, 1); break }
          }
        }
        let matched = false
        if (ev.toolCallId) {
          const sa = parts.find(p => p.type === 'subagent' && (p as any).toolCallId === ev.toolCallId) as any
          if (sa) {
            const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
            sa.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
            sa.isError = ev.isError; sa.status = 'done'; matched = true
          }
        }
        if (!matched) {
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i]
            if (p.type === 'tool' && p.status === 'running' && (ev.toolCallId ? (p as any).toolCallId === ev.toolCallId : p.name === ev.name)) {
              const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2)
              p.result = resultStr.length > 1500 ? resultStr.slice(0, 1500) + '\n... (truncated)' : resultStr
              p.isError = ev.isError; p.status = 'done'; break
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

/* ── Props ─────────────────────────────────────────── */

interface WorkflowChatPanelProps {
  agentId: string
  agentName: string
  allAgents: { id: string; name: string }[]
  onSelectAgent: (agentId: string) => void
}

/* ── Component ─────────────────────────────────────── */

export function WorkflowChatPanel({ agentId, agentName, allAgents, onSelectAgent }: WorkflowChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Reset state when agent changes
  useEffect(() => {
    setMessages([])
    setInput('')
    setBusy(false)
    abortRef.current?.abort()
  }, [agentId])

  useEffect(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.wf-chat-panel .input-bar textarea')
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
      if (!res.ok) throw new Error(await res.text())
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
      setMessages(prev => prev.map(msg => {
        if (msg.role !== 'assistant') return msg
        return { ...msg, parts: msg.parts.map(p =>
          p.type === 'tool_approval' && p.toolCallId === toolCallId
            ? { ...p, status: approve ? 'approved' as const : 'rejected' as const } : p
        )}
      }))
    } catch (err) {
      console.error('[wf-chat] tool approval error:', err)
    }
  }

  function updateClarificationAnswer(toolCallId: string, index: number, value: string) {
    setMessages(prev => prev.map(msg => {
      if (msg.role !== 'assistant') return msg
      return { ...msg, parts: msg.parts.map(p =>
        p.type === 'clarification' && p.toolCallId === toolCallId
          ? { ...p, answers: p.answers.map((a: string, i: number) => i === index ? value : a) } : p
      )}
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
        return { ...msg, parts: msg.parts.map(p =>
          p.type === 'clarification' && p.toolCallId === toolCallId
            ? { ...p, status: 'answered' as const } : p
        )}
      }))
    } catch (err) {
      console.error('[wf-chat] clarification error:', err)
    }
  }

  async function stop() {
    abortRef.current?.abort()
    try { await fetch(`http://localhost:4000/agents/${agentId}/stop`, { method: 'POST' }) } catch {}
    setBusy(false)
  }

  return (
    <div className="wf-chat-panel">
      {/* Agent selector top bar */}
      <div className="wf-chat-topbar">
        <div className="wf-chat-topbar-tabs">
          {allAgents.map(a => (
            <button
              key={a.id}
              className={`wf-chat-agent-tab ${a.id === agentId ? 'active' : ''}`}
              onClick={() => onSelectAgent(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.length === 0 && !busy && (
          <div className="empty-state">Send a message to start the conversation</div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message-row ${msg.role}`}>
            <div className="message-row-inner">
              <span className="role-label">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
              {msg.role === 'user' ? (
                <div className="user-message"><p>{msg.content}</p></div>
              ) : (
                <div className="assistant-parts">
                  {msg.parts.length === 0 && <div className="assistant-message"><p>...</p></div>}
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
                      return <div key={j} className="assistant-message"><Markdown>{part.content}</Markdown></div>
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
                          <details className="tool-section"><summary>Input</summary><pre className="tool-pre">{part.input}</pre></details>
                          {part.result !== undefined && (
                            <details className="tool-section"><summary>Result</summary><pre className={`tool-pre ${part.isError ? 'tool-error' : ''}`}>{part.result}</pre></details>
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
                          <details className="tool-section" open><summary>Arguments</summary><pre className="tool-pre">{part.args}</pre></details>
                          {part.status === 'pending' && (
                            <div className="approval-actions">
                              <button className="approval-btn approve" onClick={() => handleToolApproval(part.toolCallId, true)}>Approve</button>
                              <button className="approval-btn reject" onClick={() => {
                                const reason = prompt('Reason for rejection (optional):')
                                handleToolApproval(part.toolCallId, false, reason || undefined)
                              }}>Reject</button>
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
                                  <textarea className="clarification-input" rows={2} value={part.answers[qi]}
                                    onChange={e => updateClarificationAnswer(part.toolCallId, qi, e.target.value)} placeholder="Your answer..." />
                                ) : (
                                  <p className="clarification-a">{part.answers[qi]}</p>
                                )}
                              </div>
                            ))}
                          </div>
                          {part.status === 'pending' && (
                            <div className="approval-actions">
                              <button className="approval-btn approve" onClick={() => submitClarification(part.toolCallId)}>Submit Answers</button>
                            </div>
                          )}
                        </div>
                      )
                    }
                    if (part.type === 'subagent') {
                      return (
                        <div key={j} className={`part-subagent ${part.status}`}>
                          <div className="subagent-header">
                            <span className="subagent-icon">&#9889;</span>
                            <span className="tool-name">{part.toolName}</span>
                            {part.status === 'running' && <span className="tool-spinner" />}
                            {part.status === 'done' && (
                              <span className={`tool-status ${part.isError ? 'error' : 'ok'}`}>{part.isError ? 'error' : 'done'}</span>
                            )}
                          </div>
                          <div className="subagent-stream" ref={el => { if (el && part.status === 'running') el.scrollTop = el.scrollHeight }}>
                            {part.parts.length === 0 && part.status === 'running' && (
                              <div className="typing-indicator"><span /><span /><span /></div>
                            )}
                            {part.parts.map((sp, k) => {
                              if (sp.type === 'thinking') return <details key={k} className="part-thinking"><summary>Thinking</summary><div className="thinking-content">{sp.content}</div></details>
                              if (sp.type === 'text') return <div key={k} className="assistant-message"><Markdown>{sp.content}</Markdown></div>
                              if (sp.type === 'tool') return (
                                <div key={k} className={`part-tool ${sp.status}`}>
                                  <div className="tool-header">
                                    <span className="tool-name">{sp.name}</span>
                                    {sp.status === 'running' && <span className="tool-spinner" />}
                                    {sp.status === 'done' && <span className={`tool-status ${sp.isError ? 'error' : 'ok'}`}>{sp.isError ? 'error' : 'done'}</span>}
                                  </div>
                                  {sp.result !== undefined && <details className="tool-section"><summary>Result</summary><pre className={`tool-pre ${sp.isError ? 'tool-error' : ''}`}>{sp.result}</pre></details>}
                                </div>
                              )
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

      {/* Input */}
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
            <button className="send-btn stop-btn" onClick={stop} title="Stop generating">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
            </button>
          ) : (
            <button className="send-btn" onClick={send} disabled={!input.trim()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="input-footer">Agent can make mistakes. Verify important information.</div>
      </div>
    </div>
  )
}

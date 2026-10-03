import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import './ChatPage.css'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function ChatPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

    const msgs: ChatMessage[] = [...messages, { role: 'user', content: text }]
    msgs.push({ role: 'assistant', content: '' })
    const assistantIdx = msgs.length - 1
    setMessages([...msgs])

    let accumulated = ''

    try {
      const res = await fetch(`http://localhost:4000/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

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

          let chunk = ''
          if (ev.type === 'delta' && ev.text) chunk = ev.text
          else if (ev.type === 'thinking' && ev.text) chunk = ev.text
          else if (ev.type === 'tool_start') chunk = `\n\n**[${ev.name}]**\n`
          else if (ev.type === 'error') chunk = `\nError: ${ev.message}\n`

          if (chunk) {
            accumulated += chunk
            const content = accumulated
            setMessages(prev => {
              const next = [...prev]
              next[assistantIdx] = { role: 'assistant', content }
              return next
            })
          }
        }
      }
    } catch (err: any) {
      setMessages(prev => {
        const next = [...prev]
        next[assistantIdx] = { role: 'assistant', content: `Error: ${err.message}` }
        return next
      })
    }

    setBusy(false)
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <Link to="/" className="back-link">← Back</Link>
        <div className="chat-title">
          <h2>Chat</h2>
          <span className="agent-id">{agentId?.slice(0, 8)}...</span>
        </div>
      </div>

      <div className="messages-area">
        {messages.length === 0 && !busy && (
          <div className="empty-state">Send a message to start the conversation</div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message-row ${msg.role}`}>
            <div className={`message-bubble ${msg.role}`}>
              {msg.role === 'assistant' ? (
                <Markdown>{msg.content || '...'}</Markdown>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="input-bar">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Type a message..."
          rows={1}
          disabled={busy}
        />
        <button
          className="send-btn"
          onClick={send}
          disabled={!input.trim() || busy}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

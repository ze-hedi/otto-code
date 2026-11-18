import { useState, useEffect, useMemo, useContext, createContext } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './ObservabilityPage.css'

const API = 'http://localhost:4000'

interface SessionInfo {
  filename: string
  sessionKey: string
  sessionId: string | null
  createdAt: string | null
  sizeBytes: number
}

// Loose shapes of pi session JSONL entries — the file is the source of truth, so stay permissive.
interface Block {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  arguments?: unknown
  data?: string
  mimeType?: string
}

interface Usage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: { total?: number }
}

interface Message {
  role: string
  content?: string | Block[]
  toolCallId?: string
  toolName?: string
  isError?: boolean
  model?: string
  usage?: Usage
  stopReason?: string
  errorMessage?: string
  timestamp?: number
}

interface Entry {
  type: string
  id?: string
  timestamp?: string
  message?: Message
  [key: string]: unknown
}

type NoteKind = 'error' | 'good'

interface Note {
  id: string
  entryId: string
  kind?: NoteKind // older notes predate kinds and are treated as errors
  text: string
  createdAt: string
}

// Notes belong to the selected session; nested sub-agent timelines write into the same file.
const NotesContext = createContext<{
  notes: Note[]
  addNote: (entryId: string, kind: NoteKind, text: string) => Promise<void>
  deleteNote: (noteId: string) => Promise<void>
} | null>(null)

function NotesView({ entryId, editing, onClose }: { entryId: string; editing: NoteKind | null; onClose: () => void }) {
  const ctx = useContext(NotesContext)
  const [draft, setDraft] = useState('')
  if (!ctx) return null
  const notes = ctx.notes.filter(n => n.entryId === entryId)
  if (!editing && notes.length === 0) return null

  const save = async () => {
    if (!draft.trim() || !editing) return
    await ctx.addNote(entryId, editing, draft)
    setDraft('')
    onClose()
  }

  return (
    <div className="obs-notes">
      {notes.map(n => (
        <div key={n.id} className={`obs-note obs-note-${n.kind ?? 'error'}`}>
          <span className={`obs-tag obs-tag-${n.kind ?? 'error'}`}>{n.kind === 'good' ? 'good' : 'error'}</span>
          <span className="obs-note-text">{n.text}</span>
          <span className="obs-time">{new Date(n.createdAt).toLocaleString()}</span>
          <button className="obs-note-delete" onClick={() => ctx.deleteNote(n.id)} title="Delete note">&times;</button>
        </div>
      ))}
      {editing && (
        <div className="obs-note-editor">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
            placeholder={editing === 'good' ? 'What makes this response good?' : 'What went wrong here?'}
          />
          <div className="obs-note-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={save} disabled={!draft.trim()}>Save {editing === 'good' ? 'good example' : 'error'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MessageView({ entry, results, agentId, depth }: {
  entry: Entry
  results: Map<string, Message>
  agentId: string
  depth: number
}) {
  const [editing, setEditing] = useState<NoteKind | null>(null)
  const m = entry.message!
  const canNote = m.role === 'assistant' && !!entry.id

  return (
    <div className={`obs-msg obs-${m.role}`}>
      <div className="obs-msg-header">
        <span className="obs-role">{m.role}</span>
        {m.model && <span className="obs-model">{m.model}</span>}
        {m.stopReason && <span className="obs-tag">{m.stopReason}</span>}
        {m.usage && (
          <span className="obs-usage">
            in {m.usage.input ?? 0} · out {m.usage.output ?? 0} · cache {m.usage.cacheRead ?? 0}
            {m.usage.cost?.total ? ` · $${m.usage.cost.total.toFixed(4)}` : ''}
          </span>
        )}
        <span className="obs-time">{formatTime(entry.timestamp)}</span>
        {canNote && (
          <>
            <button className="obs-note-btn" onClick={() => setEditing('error')} title="Flag an error">+ Error</button>
            <button className="obs-note-btn" onClick={() => setEditing('good')} title="Mark as a good response">+ Good</button>
          </>
        )}
      </div>
      {m.errorMessage && <div className="obs-tool-result obs-error"><pre>{m.errorMessage}</pre></div>}
      {blocksOf(m.content).map((b, j) => {
        if (b.type === 'thinking') {
          return (
            <details key={j} className="obs-block obs-thinking">
              <summary><span className="obs-tag obs-tag-thinking">thinking</span></summary>
              <pre>{b.thinking}</pre>
            </details>
          )
        }
        if (b.type === 'toolCall') {
          return <ToolCallView key={j} block={b} result={results.get(b.id ?? '')} agentId={agentId} depth={depth} />
        }
        if (b.type === 'text') return <pre key={j} className="obs-text">{b.text}</pre>
        return <pre key={j} className="obs-text">{formatJson(b)}</pre>
      })}
      {canNote && <NotesView entryId={entry.id!} editing={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function blocksOf(content: Message['content']): Block[] {
  if (!content) return []
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

function formatTime(ts?: string): string {
  return ts ? new Date(ts).toLocaleTimeString() : ''
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  return JSON.stringify(value, null, 2)
}

function ToolResultView({ result }: { result?: Message }) {
  if (!result) return <div className="obs-pending">No result recorded (aborted or still running)</div>
  return (
    <div className={`obs-tool-result ${result.isError ? 'obs-error' : ''}`}>
      {blocksOf(result.content).map((b, i) =>
        b.type === 'image'
          ? <img key={i} src={`data:${b.mimeType};base64,${b.data}`} alt="tool output" />
          : <pre key={i}>{b.text}</pre>
      )}
    </div>
  )
}

function ToolCallView({ block, result, agentId, depth }: {
  block: Block
  result?: Message
  agentId: string
  depth: number
}) {
  const [subEntries, setSubEntries] = useState<Entry[] | null>(null)
  const [subState, setSubState] = useState<'idle' | 'loading' | 'missing'>('idle')

  const loadSubagent = async () => {
    setSubState('loading')
    const res = await fetch(`${API}/agents/${agentId}/subagent-sessions/${block.id}/entries`)
    if (res.ok) {
      setSubEntries(await res.json())
      setSubState('idle')
    } else {
      setSubState('missing')
    }
  }

  return (
    <details className={`obs-block obs-tool ${result?.isError ? 'obs-error' : ''}`}>
      <summary>
        <span className="obs-tag obs-tag-tool">tool</span>
        <span className="obs-tool-name">{block.name}</span>
        {result?.isError && <span className="obs-tag obs-tag-error">error</span>}
        {!result && <span className="obs-tag">no result</span>}
      </summary>
      <div className="obs-label">Arguments</div>
      <pre>{formatJson(block.arguments)}</pre>
      <div className="obs-label">Result</div>
      <ToolResultView result={result} />
      {subEntries === null ? (
        <button className="obs-sub-btn" onClick={loadSubagent} disabled={subState === 'loading'}>
          {subState === 'loading' ? 'Loading…' : subState === 'missing' ? 'Not a sub-agent call' : 'Load sub-agent trace'}
        </button>
      ) : (
        <div className="obs-subagent">
          <div className="obs-label">Sub-agent trace</div>
          <Timeline entries={subEntries} agentId={agentId} depth={depth + 1} />
        </div>
      )}
    </details>
  )
}

function Timeline({ entries, agentId, depth = 0 }: { entries: Entry[]; agentId: string; depth?: number }) {
  const results = useMemo(() => {
    const map = new Map<string, Message>()
    for (const e of entries) {
      if (e.type === 'message' && e.message?.role === 'toolResult' && e.message.toolCallId) {
        map.set(e.message.toolCallId, e.message)
      }
    }
    return map
  }, [entries])

  return (
    <div className="obs-timeline">
      {entries.map((e, i) => {
        if (e.type !== 'message' || !e.message) {
          if (e.type === 'session') return null
          const { type, id: _id, parentId: _p, timestamp, ...rest } = e
          return (
            <div key={i} className="obs-meta">
              <span className="obs-tag">{type}</span>
              <span className="obs-meta-body">{JSON.stringify(rest)}</span>
              <span className="obs-time">{formatTime(timestamp)}</span>
            </div>
          )
        }

        const m = e.message
        // tool results are rendered inside their tool call
        if (m.role === 'toolResult') return null

        return <MessageView key={i} entry={e} results={results} agentId={agentId} depth={depth} />
      })}
    </div>
  )
}

function SessionStats({ entries }: { entries: Entry[] }) {
  const stats = useMemo(() => {
    let input = 0, output = 0, cost = 0, toolCalls = 0, errors = 0
    for (const e of entries) {
      const m = e.message
      if (e.type !== 'message' || !m) continue
      if (m.role === 'assistant') {
        input += m.usage?.input ?? 0
        output += m.usage?.output ?? 0
        cost += m.usage?.cost?.total ?? 0
        toolCalls += blocksOf(m.content).filter(b => b.type === 'toolCall').length
      }
      if (m.role === 'toolResult' && m.isError) errors++
    }
    return { input, output, cost, toolCalls, errors }
  }, [entries])

  return (
    <div className="obs-stats">
      <div><span>{entries.length}</span>entries</div>
      <div><span>{stats.toolCalls}</span>tool calls</div>
      <div><span>{stats.errors}</span>tool errors</div>
      <div><span>{stats.input.toLocaleString()}</span>input tokens</div>
      <div><span>{stats.output.toLocaleString()}</span>output tokens</div>
      <div><span>${stats.cost.toFixed(4)}</span>cost</div>
    </div>
  )
}

function ToolStats({ entries }: { entries: Entry[] }) {
  const rows = useMemo(() => {
    const errored = new Set<string>()
    for (const e of entries) {
      const m = e.message
      if (e.type === 'message' && m?.role === 'toolResult' && m.isError && m.toolCallId) errored.add(m.toolCallId)
    }
    const byTool = new Map<string, { calls: number; errors: number }>()
    for (const e of entries) {
      const m = e.message
      if (e.type !== 'message' || m?.role !== 'assistant') continue
      for (const b of blocksOf(m.content)) {
        if (b.type !== 'toolCall') continue
        const row = byTool.get(b.name ?? '?') ?? { calls: 0, errors: 0 }
        row.calls++
        if (errored.has(b.id ?? '')) row.errors++
        byTool.set(b.name ?? '?', row)
      }
    }
    return [...byTool.entries()].sort((a, b) => b[1].calls - a[1].calls)
  }, [entries])

  if (rows.length === 0) return <div className="obs-empty">No tool calls in this session</div>
  const max = rows[0][1].calls

  return (
    <table className="obs-tool-table">
      <thead>
        <tr><th>Tool</th><th>Calls</th><th></th><th>Errors</th><th>Error rate</th></tr>
      </thead>
      <tbody>
        {rows.map(([name, r]) => (
          <tr key={name}>
            <td className="obs-tool-name">{name}</td>
            <td>{r.calls}</td>
            <td className="obs-bar-cell"><div className="obs-bar" style={{ width: `${(r.calls / max) * 100}%` }} /></td>
            <td className={r.errors ? 'obs-error-text' : ''}>{r.errors}</td>
            <td className={r.errors ? 'obs-error-text' : ''}>{((r.errors / r.calls) * 100).toFixed(0)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ObservabilityPage() {
  const { projectId, agentId } = useParams<{ projectId: string; agentId: string }>()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'trace' | 'stats'>('trace')
  const [notes, setNotes] = useState<Note[]>([])

  useEffect(() => {
    fetch(`${API}/agents/${agentId}/sessions`)
      .then(r => r.ok ? r.json() : [])
      .then((list: SessionInfo[]) => setSessions(
        list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      ))
      .catch(() => setSessions([]))
  }, [agentId])

  const selectSession = async (sessionKey: string) => {
    setSelected(sessionKey)
    setEntries(null)
    setNotes([])
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${API}/agents/${agentId}/sessions/${encodeURIComponent(sessionKey)}/entries`)
      if (res.ok) setEntries(await res.json())
      else setError((await res.json()).error ?? 'Failed to load session')
      const notesRes = await fetch(`${API}/agents/${agentId}/sessions/${encodeURIComponent(sessionKey)}/notes`)
      if (notesRes.ok) setNotes(await notesRes.json())
    } catch {
      setError('Failed to load session')
    }
    setLoading(false)
  }

  const notesBase = `${API}/agents/${agentId}/sessions/${encodeURIComponent(selected ?? '')}/notes`
  const notesCtx = {
    notes,
    addNote: async (entryId: string, kind: NoteKind, text: string) => {
      const res = await fetch(notesBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, kind, text }),
      })
      if (res.ok) {
        const note: Note = await res.json()
        setNotes(prev => [...prev, note])
      }
    },
    deleteNote: async (noteId: string) => {
      const res = await fetch(`${notesBase}/${noteId}`, { method: 'DELETE' })
      if (res.ok) setNotes(prev => prev.filter(n => n.id !== noteId))
    },
  }

  return (
    <NotesContext.Provider value={notesCtx}>
    <div className="obs-page">
      <aside className="obs-sidebar">
        <button className="obs-back" onClick={() => navigate(`/projects/${projectId}/agents`)}>&larr; Agents</button>
        <button className="obs-back" onClick={() => navigate(`/projects/${projectId}/agents/${agentId}/taxonomy`)}>Error taxonomy &rarr;</button>
        <h2>Sessions</h2>
        {sessions.length === 0 && <div className="obs-empty">No saved sessions</div>}
        {sessions.map(s => (
          <button
            key={s.filename}
            className={`obs-session ${selected === s.sessionKey ? 'active' : ''}`}
            onClick={() => selectSession(s.sessionKey)}
          >
            <span className="obs-session-key">{s.sessionKey}</span>
            <span className="obs-session-date">
              {s.createdAt ? new Date(s.createdAt).toLocaleString() : ''} · {(s.sizeBytes / 1024).toFixed(1)} KB
            </span>
          </button>
        ))}
      </aside>
      <main className="obs-main">
        {!selected && <div className="obs-empty">Select a session to inspect its trace</div>}
        {loading && <div className="obs-empty">Loading session…</div>}
        {error && <div className="obs-tool-result obs-error"><pre>{error}</pre></div>}
        {entries && agentId && (
          <>
            <div className="obs-toolbar">
              <button className={view === 'trace' ? 'active' : ''} onClick={() => setView('trace')}>Trace</button>
              <button className={view === 'stats' ? 'active' : ''} onClick={() => setView('stats')}>Stats</button>
              <button onClick={() => navigate(`/projects/${projectId}/agents/${agentId}/taxonomy`)}>Taxonomy &rarr;</button>
            </div>
            {view === 'trace' ? (
              <Timeline entries={entries} agentId={agentId} />
            ) : (
              <>
                <SessionStats entries={entries} />
                <ToolStats entries={entries} />
              </>
            )}
          </>
        )}
      </main>
    </div>
    </NotesContext.Provider>
  )
}

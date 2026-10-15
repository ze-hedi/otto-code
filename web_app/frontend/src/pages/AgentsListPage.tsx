import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './AgentsListPage.css'

interface AgentDoc {
  agent_id: string
  status: 'active' | 'stopped'
  created_at: string
  updated_at: string
  config: {
    name?: string
    description?: string
    model: string
    builtInTools?: string[]
    thinkingLevel?: string
    playground?: string
  }
}

interface ProjectDoc {
  project_id: string
  name: string
  path: string
}

interface SessionInfo {
  filename: string
  sessionKey: string
  sessionId: string | null
  createdAt: string | null
  sizeBytes: number
}

interface MemoryItem {
  id: string
  memory: string
  createdAt?: string
  score?: number
  metadata?: Record<string, any>
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function AgentsListPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [agents, setAgents] = useState<AgentDoc[]>([])
  const [project, setProject] = useState<ProjectDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [popup, setPopup] = useState<{ agentId: string; agentName: string } | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [popupBusy, setPopupBusy] = useState(false)
  const [memoriesPanel, setMemoriesPanel] = useState<{ sessionKey: string; sessionId: string | null } | null>(null)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const [distilling, setDistilling] = useState<string | null>(null) // sessionKey being distilled
  const [distillError, setDistillError] = useState<{ sessionKey: string; message: string } | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load project info to get playground path
        const projectsRes = await fetch('http://localhost:4000/projects')
        const projects: ProjectDoc[] = projectsRes.ok ? await projectsRes.json() : []
        const found = projects.find(p => p.project_id === projectId) ?? null
        setProject(found)

        // Load agents filtered by playground
        const url = found
          ? `http://localhost:4000/agents?playground=${encodeURIComponent(found.path)}`
          : `http://localhost:4000/agents`
        const agentsRes = await fetch(url)
        setAgents(agentsRes.ok ? await agentsRes.json() : [])
      } catch {}
      setLoading(false)
    }
    loadData()
  }, [projectId])

  const handleDelete = async (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation()
    const res = await fetch(`http://localhost:4000/agents/${agentId}`, { method: 'DELETE' })
    if (res.ok) {
      setAgents(prev => prev.filter(a => a.agent_id !== agentId))
    }
  }

  const openSessionsPopup = async (agent: AgentDoc) => {
    setPopup({ agentId: agent.agent_id, agentName: agent.config.name || 'Unnamed Agent' })
    setSessions([])
    setSessionsLoading(true)
    setPopupBusy(false)

    try {
      const [sessionsRes, statusRes] = await Promise.all([
        fetch(`http://localhost:4000/agents/${agent.agent_id}/sessions`),
        fetch(`http://localhost:4000/agents/${agent.agent_id}/status`),
      ])
      if (sessionsRes.ok) setSessions(await sessionsRes.json())
      if (statusRes.ok) {
        const status = await statusRes.json()
        setPopupBusy(status.busy)
      }
    } catch {}
    setSessionsLoading(false)
  }

  const loadSessionAndNavigate = async (agentId: string, filename: string) => {
    await fetch(`http://localhost:4000/agents/${agentId}/load-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    })
    navigate(`/projects/${projectId}/chat/${agentId}`)
  }

  const newChatAndNavigate = async (agentId: string) => {
    await fetch(`http://localhost:4000/agents/${agentId}/new-session`, { method: 'POST' })
    navigate(`/projects/${projectId}/chat/${agentId}`)
  }

  const deleteSession = async (e: React.MouseEvent, agentId: string, sessionKey: string) => {
    e.stopPropagation()
    const res = await fetch(`http://localhost:4000/agents/${agentId}/sessions/${sessionKey}`, { method: 'DELETE' })
    if (res.ok) {
      setSessions(prev => prev.filter(s => s.sessionKey !== sessionKey))
    }
  }

  const openMemories = async (agentId: string, sessionKey: string, sessionId: string | null) => {
    setMemoriesPanel({ sessionKey, sessionId })
    setMemories([])
    setMemoriesLoading(true)
    try {
      const url = sessionId
        ? `http://localhost:4000/memory/agents/${agentId}/memories?runId=${encodeURIComponent(sessionId)}`
        : `http://localhost:4000/memory/agents/${agentId}/memories`
      const res = await fetch(url)
      if (res.ok) setMemories(await res.json())
    } catch {}
    setMemoriesLoading(false)
  }

  const distillSession = async (agentId: string, sessionKey: string) => {
    setDistilling(sessionKey)
    setDistillError(null)
    try {
      const res = await fetch(`http://localhost:4000/memory/agents/${agentId}/sessions/${sessionKey}/distill`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDistillError({ sessionKey, message: body.error ?? `Server error ${res.status}` })
      } else {
        // success — refresh memories panel if open
        if (memoriesPanel?.sessionKey === sessionKey) {
          const s = sessions.find(s => s.sessionKey === sessionKey)
          await openMemories(agentId, sessionKey, s?.sessionId ?? null)
        }
      }
    } catch (err: any) {
      setDistillError({ sessionKey, message: err?.message ?? 'Network error — backend unreachable' })
    }
    setDistilling(null)
  }

  const closeMemoriesPanel = () => setMemoriesPanel(null)

  const closePopup = () => {
    setPopup(null)
    setMemoriesPanel(null)
  }

  return (
    <div className="agents-page">
      <div className="agents-header">
        <div className="agents-header-text">
          <button className="agents-back-link" onClick={() => navigate(`/projects/${projectId}`)}>
            &larr; {project?.name ?? 'Project'}
          </button>
          <h1>Agents</h1>
          <p>Your active and past agent sessions</p>
        </div>
        <button
          className="create-btn"
          onClick={() => navigate(`/projects/${projectId}/create`)}
        >
          + New Agent
        </button>
      </div>

      <div className="agents-grid">
        {loading && (
          <div className="agents-loading">Loading agents...</div>
        )}

        {!loading && agents.length === 0 && (
          <div className="agents-empty">
            No agents yet.{' '}
            <button
              className="link-btn"
              onClick={() => navigate(`/projects/${projectId}/create`)}
            >
              Create your first agent
            </button>{' '}
            to get started.
          </div>
        )}

        {agents.map(agent => (
          <div
            key={agent.agent_id}
            className="agent-card"
            onClick={() => openSessionsPopup(agent)}
          >
            <div className="card-header">
              <span className="card-name">
                {agent.config.name || 'Unnamed Agent'}
              </span>
              <button
                className="delete-btn"
                title="Delete agent"
                onClick={e => handleDelete(e, agent.agent_id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
              <span className={`status-dot ${agent.status}`} title={agent.status} />
            </div>

            <span className="card-model">{agent.config.model}</span>

            {agent.config.description && (
              <span className="card-description">{agent.config.description}</span>
            )}

            <div className="card-footer">
              <div className="card-tools">
                {agent.config.builtInTools?.map(t => (
                  <span key={t} className="card-tool">{t}</span>
                ))}
              </div>
              <span className="card-time">{timeAgo(agent.created_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {popup && (
        <>
          <div className="popup-backdrop" onClick={closePopup} />
          <div className="popup-modal">
            <div className="popup-header">
              <h3>{popup.agentName}</h3>
              <button className="popup-close" onClick={closePopup}>&times;</button>
            </div>
            <div className="popup-body">
              {popupBusy && (
                <div
                  className="popup-busy"
                  onClick={() => navigate(`/projects/${projectId}/chat/${popup.agentId}`)}
                >
                  <span className="busy-spinner" />
                  <span>Agent is working...</span>
                  <span className="busy-goto">Go to chat &rarr;</span>
                </div>
              )}

              <button
                className="new-chat-btn"
                onClick={() => newChatAndNavigate(popup.agentId)}
                disabled={popupBusy}
              >
                + New Chat
              </button>

              {sessionsLoading && (
                <div className="popup-loading">Loading sessions...</div>
              )}

              {!sessionsLoading && sessions.length === 0 && (
                <div className="popup-empty">No saved sessions yet</div>
              )}

              {sessions.map(s => (
                <div key={s.filename} className="session-block">
                  <div className="session-row" onClick={() => loadSessionAndNavigate(popup.agentId, s.filename)}>
                    <div className="session-row-main">
                      <span className="session-key">{s.sessionKey}</span>
                      <span className="session-size">{formatBytes(s.sizeBytes)}</span>
                    </div>
                    <div className="session-row-right">
                      {s.createdAt && <span className="session-time">{timeAgo(s.createdAt)}</span>}
                      <button
                        className="session-delete-btn"
                        onClick={(e) => deleteSession(e, popup.agentId, s.sessionKey)}
                        title="Delete session"
                      >
                        &times;
                      </button>
                    </div>
                  </div>

                  <div className="session-memory-bar">
                    <button
                      className="memory-distill-btn"
                      disabled={distilling === s.sessionKey}
                      onClick={() => distillSession(popup.agentId, s.sessionKey)}
                      title="Run sleep mode — extract memories from this session"
                    >
                      {distilling === s.sessionKey
                        ? <><span className="busy-spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Distilling…</>
                        : <>&#10024; Distill</>
                      }
                    </button>
                    {distillError?.sessionKey === s.sessionKey && (
                      <span className="distill-error" title={distillError.message}>
                        ⚠ {distillError.message}
                      </span>
                    )}
                    <button
                      className={`memory-view-btn ${memoriesPanel?.sessionKey === s.sessionKey ? 'open' : ''}`}
                      onClick={() => memoriesPanel?.sessionKey === s.sessionKey
                        ? closeMemoriesPanel()
                        : openMemories(popup.agentId, s.sessionKey, s.sessionId)
                      }
                    >
                      {memoriesPanel?.sessionKey === s.sessionKey ? 'Hide memories' : 'View memories'}
                    </button>
                  </div>

                  {memoriesPanel?.sessionKey === s.sessionKey && (
                    <div className="memories-panel">
                      {memoriesLoading && <div className="memories-empty">Loading…</div>}
                      {!memoriesLoading && memories.length === 0 && (
                        <div className="memories-empty">No memories yet — click Distill to extract.</div>
                      )}
                      {memories.map(m => (
                        <div key={m.id} className="memory-item">
                          <span className="memory-text">{m.memory}</span>
                          {m.createdAt && <span className="memory-date">{timeAgo(m.createdAt)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

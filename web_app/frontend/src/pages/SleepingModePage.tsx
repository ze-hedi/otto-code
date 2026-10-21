import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './SleepingModePage.css'

interface AgentSession {
  type: 'agent'
  filename: string
  sessionId: string | null
  createdAt: string | null
  sizeBytes: number
}

interface WorkflowSession {
  type: 'workflow'
  workflowId: string
  sessionId: string
  createdAt: string
  agentFiles: string[]
  agentCount: number
}

interface DistillResult {
  success: boolean
  batchesProcessed: number
  memoriesExtracted: number
}

interface Memory {
  id: string
  text: string
  attributed_to: string | null
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SleepingModePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [workflowSessions, setWorkflowSessions] = useState<WorkflowSession[]>([])
  const [distilling, setDistilling] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, DistillResult>>({})
  const [showMemories, setShowMemories] = useState<{ agentId: string; sessionId: string; memories: Memory[] } | null>(null)
  const [loadingMemories, setLoadingMemories] = useState(false)

  const fetchMemories = async (agentId: string, sessionId: string) => {
    setLoadingMemories(true)
    try {
      const res = await fetch(
        `http://localhost:4000/sleeping/${projectId}/memories?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`
      )
      const data = await res.json()
      setShowMemories({ agentId, sessionId, memories: data.memories ?? [] })
    } catch {
      setShowMemories({ agentId, sessionId, memories: [] })
    } finally {
      setLoadingMemories(false)
    }
  }

  const parseFilename = (filename: string): { agentId: string; sessionId: string } => {
    const base = filename.replace(/\.jsonl$/, '')
    const dashIdx = base.indexOf('-')
    if (dashIdx > 0) return { agentId: base.slice(0, dashIdx), sessionId: base.slice(dashIdx + 1) }
    return { agentId: base, sessionId: 'main' }
  }

  useEffect(() => {
    fetch(`http://localhost:4000/sleeping/${projectId}/sessions`)
      .then(r => r.ok ? r.json() : { agentSessions: [], workflowSessions: [] })
      .then(data => {
        setAgentSessions(data.agentSessions ?? [])
        setWorkflowSessions(data.workflowSessions ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const distillAgent = async (session: AgentSession) => {
    const key = session.filename
    setDistilling(prev => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`http://localhost:4000/sleeping/${projectId}/distill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent', filename: session.filename }),
      })
      const data = await res.json()
      setResults(prev => ({ ...prev, [key]: data }))
    } catch (err) {
      setResults(prev => ({ ...prev, [key]: { success: false, batchesProcessed: 0, memoriesExtracted: 0 } }))
    } finally {
      setDistilling(prev => ({ ...prev, [key]: false }))
    }
  }

  const distillWorkflowAgent = async (workflowId: string, sessionId: string, agentFile: string) => {
    const key = `${workflowId}-${sessionId}-${agentFile}`
    setDistilling(prev => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`http://localhost:4000/sleeping/${projectId}/distill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'workflow-agent', workflowId, sessionId, filename: agentFile }),
      })
      const data = await res.json()
      setResults(prev => ({ ...prev, [key]: data }))
    } catch (err) {
      setResults(prev => ({ ...prev, [key]: { success: false, batchesProcessed: 0, memoriesExtracted: 0 } }))
    } finally {
      setDistilling(prev => ({ ...prev, [key]: false }))
    }
  }

  const [expandedWorkflows, setExpandedWorkflows] = useState<Record<string, boolean>>({})

  const toggleWorkflow = (key: string) => {
    setExpandedWorkflows(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) return <div className="sleeping-loading">Loading sessions...</div>

  return (
    <div className="sleeping-page">
      <div className="sleeping-header">
        <button className="sleeping-back" onClick={() => navigate(`/projects/${projectId}`)}>
          &larr; Back to project
        </button>
        <h1>Sleeping Mode</h1>
        <p className="sleeping-subtitle">Distill session histories into long-term memory</p>
      </div>

      <section className="sleeping-section">
        <h2>Agent Sessions</h2>
        {agentSessions.length === 0 ? (
          <p className="sleeping-empty">No agent sessions found.</p>
        ) : (
          <div className="sleeping-list">
            {agentSessions.map(s => {
              const key = s.filename
              const isDistilling = distilling[key]
              const result = results[key]
              return (
                <div key={key} className="sleeping-card">
                  <div className="sleeping-card-info">
                    <span className="sleeping-card-name">{s.filename}</span>
                    <span className="sleeping-card-meta">
                      {s.createdAt ? timeAgo(s.createdAt) : 'unknown'} &middot; {formatBytes(s.sizeBytes)}
                    </span>
                  </div>
                  <div className="sleeping-card-actions">
                    {result && (
                      <span className={`sleeping-result ${result.success ? 'success' : 'error'}`}>
                        {result.success
                          ? `${result.memoriesExtracted} memories (${result.batchesProcessed} batches)`
                          : 'Failed'}
                      </span>
                    )}
                    <button
                      className="sleeping-show-btn"
                      disabled={loadingMemories}
                      onClick={() => { const p = parseFilename(s.filename); fetchMemories(p.agentId, p.sessionId) }}
                    >
                      Show
                    </button>
                    <button
                      className="sleeping-distill-btn"
                      disabled={isDistilling}
                      onClick={() => distillAgent(s)}
                    >
                      {isDistilling ? 'Distilling...' : 'Distill'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="sleeping-section">
        <h2>Workflow Sessions</h2>
        {workflowSessions.length === 0 ? (
          <p className="sleeping-empty">No workflow sessions found.</p>
        ) : (
          <div className="sleeping-list">
            {workflowSessions.map(s => {
              const groupKey = `${s.workflowId}-${s.sessionId}`
              const isExpanded = expandedWorkflows[groupKey] ?? false
              return (
                <div key={groupKey} className="sleeping-workflow-group">
                  <div className="sleeping-card sleeping-card-workflow" onClick={() => toggleWorkflow(groupKey)}>
                    <div className="sleeping-card-info">
                      <span className="sleeping-card-name">
                        {isExpanded ? '▼' : '▶'} {s.workflowId}
                      </span>
                      <span className="sleeping-card-meta">
                        session: {s.sessionId} &middot; {s.agentCount} agent{s.agentCount !== 1 ? 's' : ''} &middot; {timeAgo(s.createdAt)}
                      </span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="sleeping-workflow-agents">
                      {s.agentFiles.map(af => {
                        const afKey = `${s.workflowId}-${s.sessionId}-${af}`
                        const isDistillingAf = distilling[afKey]
                        const afResult = results[afKey]
                        return (
                          <div key={afKey} className="sleeping-card sleeping-card-nested">
                            <div className="sleeping-card-info">
                              <span className="sleeping-card-name">{af.replace('.jsonl', '')}</span>
                            </div>
                            <div className="sleeping-card-actions">
                              {afResult && (
                                <span className={`sleeping-result ${afResult.success ? 'success' : 'error'}`}>
                                  {afResult.success
                                    ? `${afResult.memoriesExtracted} memories (${afResult.batchesProcessed} batches)`
                                    : 'Failed'}
                                </span>
                              )}
                              <button
                                className="sleeping-show-btn"
                                disabled={loadingMemories}
                                onClick={(e) => { e.stopPropagation(); const p = parseFilename(af); fetchMemories(p.agentId, p.sessionId) }}
                              >
                                Show
                              </button>
                              <button
                                className="sleeping-distill-btn"
                                disabled={isDistillingAf}
                                onClick={(e) => { e.stopPropagation(); distillWorkflowAgent(s.workflowId, s.sessionId, af) }}
                              >
                                {isDistillingAf ? 'Distilling...' : 'Distill'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {showMemories && (
        <div className="sleeping-modal-overlay" onClick={() => setShowMemories(null)}>
          <div className="sleeping-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sleeping-modal-header">
              <h3>Memories: {showMemories.agentId} / {showMemories.sessionId}</h3>
              <button className="sleeping-modal-close" onClick={() => setShowMemories(null)}>&times;</button>
            </div>
            <div className="sleeping-modal-body">
              {showMemories.memories.length === 0 ? (
                <p className="sleeping-empty">No memories found for this session.</p>
              ) : (
                <div className="sleeping-memory-list">
                  {showMemories.memories.map((m) => (
                    <div key={m.id} className="sleeping-memory-item">
                      <p className="sleeping-memory-text">{m.text}</p>
                      {m.attributed_to && (
                        <span className="sleeping-memory-attr">from {m.attributed_to}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

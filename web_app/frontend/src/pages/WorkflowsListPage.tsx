import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './WorkflowsListPage.css'

interface SavedWorkflow {
  workflow_id: string
  name: string
  description?: string
  updated_at: string
  schema?: { components?: { type: string }[] }
}

interface WorkflowSession {
  sessionId: string
  createdAt: string
  agentCount: number
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function WorkflowsListPage() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()

  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([])
  const [projectPath, setProjectPath] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const [sessionTarget, setSessionTarget] = useState<SavedWorkflow | null>(null)
  const [sessions, setSessions] = useState<WorkflowSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const [popupBusy, setPopupBusy] = useState(false)

  const [toDelete, setToDelete] = useState<SavedWorkflow | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        let path: string | undefined
        if (projectId) {
          const res = await fetch('http://localhost:4000/projects')
          const projects: { project_id: string; path: string }[] = res.ok ? await res.json() : []
          path = projects.find(p => p.project_id === projectId)?.path
          setProjectPath(path)
        }
        const url = path
          ? `http://localhost:4000/workflow-store?playground=${encodeURIComponent(path)}`
          : 'http://localhost:4000/workflow-store'
        const res = await fetch(url)
        if (res.ok) setWorkflows(await res.json())
      } catch {
        setError('Failed to load workflows')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId])

  async function openSessionsPopup(wf: SavedWorkflow) {
    setSessionTarget(wf)
    setSessions([])
    setSessionsLoading(true)
    setPopupBusy(false)
    try {
      const [sessionsRes, statusRes] = await Promise.all([
        fetch(`http://localhost:4000/workflows/${wf.workflow_id}/sessions`),
        fetch('http://localhost:4000/workflows/status'),
      ])
      if (sessionsRes.ok) setSessions((await sessionsRes.json()).sessions ?? [])
      if (statusRes.ok) {
        const status = await statusRes.json()
        setPopupBusy(status.busy)
      }
    } catch {}
    setSessionsLoading(false)
  }

  function openWorkflow(wf: SavedWorkflow, session: string) {
    navigate(`/projects/${projectId}/workflows/${wf.workflow_id}?session=${encodeURIComponent(session)}`)
  }

  async function createWorkflow() {
    if (!newName.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:4000/workflow-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          playground: projectPath,
          schema: { components: [], connections: [] },
        }),
      })
      const data = await res.json()
      if (res.ok) {
        navigate(`/projects/${projectId}/workflows/${data.workflow_id}`)
      } else {
        setError(data.error ?? 'Failed to create workflow')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error')
    } finally {
      setCreating(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`http://localhost:4000/workflow-store/${toDelete.workflow_id}`, { method: 'DELETE' })
      if (res.ok) {
        const id = toDelete.workflow_id
        setWorkflows(prev => prev.filter(w => w.workflow_id !== id))
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to delete workflow')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error')
    } finally {
      setToDelete(null)
      setDeleting(false)
    }
  }

  return (
    <div className="wfl-page">
      <div className="wfl-header">
        <div className="wfl-header-text">
          <button className="wfl-back-link" onClick={() => navigate(`/projects/${projectId}`)}>
            &larr; Project
          </button>
          <h1>Workflows</h1>
          <p>Select a workflow to open it, or create a new one</p>
        </div>
        <button className="wfl-primary-btn" onClick={() => setShowCreate(true)}>+ New workflow</button>
      </div>

      {error && <div className="wfl-error">{error}</div>}

      <div className="wfl-grid">
        {loading && <div className="wfl-empty">Loading workflows...</div>}
        {!loading && workflows.length === 0 && (
          <div className="wfl-empty">No workflows yet. Create one to get started.</div>
        )}
        {workflows.map(wf => {
          const nodeCount = wf.schema?.components?.length ?? 0
          return (
            <div
              key={wf.workflow_id}
              className="wfl-card"
              onClick={() => openSessionsPopup(wf)}
            >
              <div className="wfl-card-header">
                <span className="wfl-card-name">{wf.name}</span>
                <button
                  className="wfl-delete-btn"
                  title="Delete workflow"
                  onClick={e => { e.stopPropagation(); setToDelete(wf) }}
                >
                  Delete
                </button>
              </div>
              {wf.description && <span className="wfl-card-desc">{wf.description}</span>}
              <div className="wfl-card-footer">
                <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
                <span>{timeAgo(wf.updated_at)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {showCreate && (
        <div className="wfl-overlay" onClick={() => setShowCreate(false)}>
          <div className="wfl-modal" onClick={e => e.stopPropagation()}>
            <h2>New workflow</h2>
            <label>Name *</label>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createWorkflow() }}
              placeholder="My workflow"
            />
            <label>Description</label>
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
            <div className="wfl-modal-actions">
              <button className="wfl-secondary-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="wfl-primary-btn" onClick={createWorkflow} disabled={!newName.trim() || creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionTarget && (
        <div className="wfl-overlay" onClick={() => setSessionTarget(null)}>
          <div className="wfl-modal" onClick={e => e.stopPropagation()}>
            <h2>{sessionTarget.name} — sessions</h2>
            {popupBusy && (
              <div
                className="wfl-card"
                style={{ borderLeft: '3px solid #f59e0b', cursor: 'pointer', background: 'rgba(245, 158, 11, 0.08)' }}
                onClick={() => openWorkflow(sessionTarget, 'new')}
              >
                <span className="wfl-card-name">Workflow is running...</span>
                <div className="wfl-card-footer"><span>Go to workflow &rarr;</span></div>
              </div>
            )}
            {sessionsLoading && <p>Loading sessions...</p>}
            {!sessionsLoading && sessions.length === 0 && !popupBusy && <p>No saved sessions yet</p>}
            {sessions.map(s => (
              <div
                key={s.sessionId}
                className="wfl-card"
                onClick={() => openWorkflow(sessionTarget, s.sessionId)}
              >
                <span className="wfl-card-name">{new Date(s.createdAt).toLocaleString()}</span>
                <div className="wfl-card-footer">
                  <span>{s.agentCount} agent{s.agentCount !== 1 ? 's' : ''}</span>
                  <span>{timeAgo(s.createdAt)}</span>
                </div>
              </div>
            ))}
            <div className="wfl-modal-actions">
              <button className="wfl-secondary-btn" onClick={() => setSessionTarget(null)}>Cancel</button>
              <button className="wfl-primary-btn" onClick={() => openWorkflow(sessionTarget, 'new')}>New session</button>
            </div>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="wfl-overlay" onClick={() => !deleting && setToDelete(null)}>
          <div className="wfl-modal" onClick={e => e.stopPropagation()}>
            <h2>Delete workflow</h2>
            <p>
              Delete <strong>{toDelete.name}</strong>? This removes the workflow and all agent
              sessions it created. This can't be undone.
            </p>
            <div className="wfl-modal-actions">
              <button className="wfl-secondary-btn" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</button>
              <button className="wfl-danger-btn" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

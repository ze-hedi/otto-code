import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgentFormContent } from '../components/AgentFormContent'
import './CreateAgentForm.css'

export function CreateAgentForm() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [lockedPlayground, setLockedPlayground] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!projectId) return
    fetch('http://localhost:4000/projects')
      .then(r => r.ok ? r.json() : [])
      .then((projects: { project_id: string; path: string }[]) => {
        const found = projects.find(p => p.project_id === projectId)
        if (found) setLockedPlayground(found.path)
      })
      .catch(() => {})
  }, [projectId])

  const handleSuccess = (agentId: string) => {
    if (projectId) {
      navigate(`/projects/${projectId}/chat/${agentId}`)
    }
  }

  return (
    <div className="form-container">
      <div className="form-header">
        <button
          type="button"
          className="form-back-link"
          onClick={() => navigate(projectId ? `/projects/${projectId}/agents` : '/')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          &larr; Back to Agents
        </button>
        <h1>Create Agent</h1>
        <p className="form-subtitle">Configure a new RawPiAgent instance</p>
      </div>

      <AgentFormContent
        lockedPlayground={lockedPlayground}
        onSuccess={handleSuccess}
      />
    </div>
  )
}

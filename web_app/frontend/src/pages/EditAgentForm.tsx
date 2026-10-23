import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgentFormContent } from '../components/AgentFormContent'
import type { AgentFormData } from '../components/AgentFormContent'
import './CreateAgentForm.css'

export function EditAgentForm() {
  const { projectId, agentId } = useParams<{ projectId: string; agentId: string }>()
  const navigate = useNavigate()
  const [initialData, setInitialData] = useState<AgentFormData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agentId) return
    fetch(`http://localhost:4000/agents/${agentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(doc => {
        if (doc?.config) setInitialData(doc.config)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [agentId])

  const handleSuccess = () => {
    navigate(`/projects/${projectId}/agents`)
  }

  if (loading) return <div className="form-container"><p>Loading...</p></div>
  if (!initialData) return <div className="form-container"><p>Agent not found.</p></div>

  return (
    <div className="form-container">
      <div className="form-header">
        <button
          type="button"
          className="form-back-link"
          onClick={() => navigate(`/projects/${projectId}/agents`)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          &larr; Back to Agents
        </button>
        <h1>Edit Agent</h1>
        <p className="form-subtitle">Update agent configuration</p>
      </div>

      <AgentFormContent
        initialData={initialData}
        editAgentId={agentId}
        onSuccess={handleSuccess}
        onCancel={() => navigate(`/projects/${projectId}/agents`)}
      />
    </div>
  )
}

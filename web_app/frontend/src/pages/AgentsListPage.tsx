import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  }
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

export function AgentsListPage() {
  const [agents, setAgents] = useState<AgentDoc[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('http://localhost:4000/agents')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAgents(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation()
    const res = await fetch(`http://localhost:4000/agents/${agentId}`, { method: 'DELETE' })
    if (res.ok) {
      setAgents(prev => prev.filter(a => a.agent_id !== agentId))
    }
  }

  return (
    <div className="agents-page">
      <div className="agents-header">
        <div className="agents-header-text">
          <h1>Agents</h1>
          <p>Your active and past agent sessions</p>
        </div>
        <Link to="/create" className="create-btn">
          + New Agent
        </Link>
      </div>

      <div className="agents-grid">
        {loading && (
          <div className="agents-loading">Loading agents...</div>
        )}

        {!loading && agents.length === 0 && (
          <div className="agents-empty">
            No agents yet. <Link to="/create">Create your first agent</Link> to get started.
          </div>
        )}

        {agents.map(agent => (
          <div
            key={agent.agent_id}
            className="agent-card"
            onClick={() => navigate(`/chat/${agent.agent_id}`)}
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
    </div>
  )
}

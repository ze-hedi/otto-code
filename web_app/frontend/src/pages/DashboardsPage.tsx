import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './DashboardsPage.css'

interface DashboardTask {
  id: string
  title: string
  description: string
  state: 'opened' | 'in_work' | 'blocked' | 'closed'
  assignee: string
  priority: 'low' | 'medium' | 'high'
  created_at: string
  updated_at: string
}

interface PlanEntry {
  id: string
  content: string
  status: 'draft' | 'active' | 'archived'
  created_at: string
}

interface Dashboard {
  id: string
  name: string
  description: string
  plans: PlanEntry[]
  tasks: DashboardTask[]
  created_at: string
  updated_at: string
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

function taskCounts(tasks: DashboardTask[]) {
  return {
    opened: tasks.filter(t => t.state === 'opened').length,
    in_work: tasks.filter(t => t.state === 'in_work').length,
    blocked: tasks.filter(t => t.state === 'blocked').length,
    closed: tasks.filter(t => t.state === 'closed').length,
  }
}

export function DashboardsPage() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('http://localhost:4000/dashboards')
      .then(r => r.ok ? r.json() : [])
      .then(data => setDashboards(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="dashboards-page">
      <div className="dashboards-header">
        <div className="dashboards-header-text">
          <button className="dashboards-back-link" onClick={() => navigate('/')}>
            &larr; Projects
          </button>
          <h1>Dashboards</h1>
          <p>Project plans and tasks managed by your agents</p>
        </div>
      </div>

      <div className="dashboards-grid">
        {loading && <div className="dashboards-loading">Loading dashboards...</div>}

        {!loading && dashboards.length === 0 && (
          <div className="dashboards-empty">
            No dashboards yet. Ask an agent to create one using the project-dashboard MCP tool.
          </div>
        )}

        {dashboards.map(d => {
          const counts = taskCounts(d.tasks)
          const activePlan = d.plans.find(p => p.status === 'active') ?? d.plans[d.plans.length - 1]
          return (
            <div
              key={d.id}
              className="dashboard-card"
              onClick={() => navigate(`/dashboards/${d.id}`)}
            >
              <div className="dashboard-card-header">
                <span className="dashboard-card-name">{d.name}</span>
                <span className="dashboard-card-time">{timeAgo(d.updated_at)}</span>
              </div>

              {d.description && (
                <span className="dashboard-card-description">{d.description}</span>
              )}

              <div className="dashboard-task-counts">
                {counts.opened > 0 && (
                  <span className="task-badge state-opened">{counts.opened} opened</span>
                )}
                {counts.in_work > 0 && (
                  <span className="task-badge state-in_work">{counts.in_work} in work</span>
                )}
                {counts.blocked > 0 && (
                  <span className="task-badge state-blocked">{counts.blocked} blocked</span>
                )}
                {counts.closed > 0 && (
                  <span className="task-badge state-closed">{counts.closed} closed</span>
                )}
                {d.tasks.length === 0 && (
                  <span className="task-badge state-empty">no tasks</span>
                )}
              </div>

              <div className="dashboard-card-footer">
                <span className="dashboard-meta">{d.plans.length} plan{d.plans.length !== 1 ? 's' : ''}</span>
                {activePlan && (
                  <span className={`plan-badge status-${activePlan.status}`}>{activePlan.status}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

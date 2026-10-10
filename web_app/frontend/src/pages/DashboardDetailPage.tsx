import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './DashboardDetailPage.css'

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

const STATE_ORDER: DashboardTask['state'][] = ['in_work', 'opened', 'blocked', 'closed']

export function DashboardDetailPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>()
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`http://localhost:4000/dashboards/${dashboardId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setDashboard(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dashboardId])

  if (loading) {
    return (
      <div className="detail-page">
        <div className="detail-loading">Loading dashboard...</div>
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className="detail-page">
        <button className="detail-back-link" onClick={() => navigate('/dashboards')}>&larr; Dashboards</button>
        <div className="detail-not-found">Dashboard not found.</div>
      </div>
    )
  }

  const tasksByState = STATE_ORDER.reduce((acc, state) => {
    acc[state] = dashboard.tasks.filter(t => t.state === state)
    return acc
  }, {} as Record<DashboardTask['state'], DashboardTask[]>)

  const sortedPlans = [...dashboard.plans].sort((a, b) => {
    const order = { active: 0, draft: 1, archived: 2 }
    return order[a.status] - order[b.status]
  })

  return (
    <div className="detail-page">
      <button className="detail-back-link" onClick={() => navigate('/dashboards')}>&larr; Dashboards</button>

      <div className="detail-header">
        <div>
          <h1 className="detail-title">{dashboard.name}</h1>
          {dashboard.description && (
            <p className="detail-description">{dashboard.description}</p>
          )}
        </div>
        <span className="detail-meta">Updated {timeAgo(dashboard.updated_at)}</span>
      </div>

      <div className="detail-body">
        {/* Plans section */}
        <section className="detail-section">
          <h2 className="section-title">Plans <span className="section-count">{dashboard.plans.length}</span></h2>
          {sortedPlans.length === 0 ? (
            <p className="section-empty">No plans yet.</p>
          ) : (
            <div className="plans-list">
              {sortedPlans.map(plan => (
                <div key={plan.id} className="plan-item">
                  <div className="plan-item-header">
                    <span className={`plan-badge status-${plan.status}`}>{plan.status}</span>
                    <span className="plan-time">{timeAgo(plan.created_at)}</span>
                  </div>
                  <p className="plan-content">{plan.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tasks section */}
        <section className="detail-section">
          <h2 className="section-title">Tasks <span className="section-count">{dashboard.tasks.length}</span></h2>
          {dashboard.tasks.length === 0 ? (
            <p className="section-empty">No tasks yet.</p>
          ) : (
            <div className="tasks-columns">
              {STATE_ORDER.map(state => (
                tasksByState[state].length > 0 && (
                  <div key={state} className="tasks-column">
                    <div className={`column-header state-${state}`}>
                      <span className="column-label">{state.replace('_', ' ')}</span>
                      <span className="column-count">{tasksByState[state].length}</span>
                    </div>
                    {tasksByState[state].map(task => (
                      <div key={task.id} className="task-card">
                        <div className="task-card-header">
                          <span className="task-title">{task.title}</span>
                          <span className={`priority-dot priority-${task.priority}`} title={task.priority} />
                        </div>
                        {task.description && (
                          <p className="task-description">{task.description}</p>
                        )}
                        <div className="task-card-footer">
                          {task.assignee && (
                            <span className="task-assignee">{task.assignee}</span>
                          )}
                          <span className="task-time">{timeAgo(task.updated_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

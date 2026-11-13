import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './Sidebar.css'

interface RunningAgent {
  agent_id: string
  name: string
  playground?: string
}

interface ProjectDoc {
  project_id: string
  name: string
  path: string
}

export function Sidebar() {
  const [running, setRunning] = useState<RunningAgent[]>([])
  const [projects, setProjects] = useState<ProjectDoc[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const { pathname } = useLocation()

  useEffect(() => {
    fetch('http://localhost:4000/projects')
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const load = () =>
      fetch('http://localhost:4000/agents/running')
        .then((r) => r.json())
        .then(setRunning)
        .catch(() => {})
    load()
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [])

  // Group running agents by project; agents whose playground matches no project are skipped.
  const groups = projects
    .map((project) => ({ project, agents: running.filter((a) => a.playground === project.path) }))
    .filter((g) => g.agents.length > 0)

  return (
    <aside className={`app-sidebar${collapsed ? ' collapsed' : ''}`}>
      <button
        className="app-sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Show running agents' : 'Hide running agents'}
      >
        {collapsed ? '»' : '«'}
        {collapsed && running.length > 0 && (
          <span className="app-sidebar-count">{running.length}</span>
        )}
      </button>
      {!collapsed && <div className="app-sidebar-title">Running agents</div>}
      {!collapsed && groups.length === 0 && (
        <div className="app-sidebar-empty">No agents running</div>
      )}
      {!collapsed && groups.map(({ project, agents }) => (
        <div key={project.project_id} className="app-sidebar-group">
          <div className="app-sidebar-project">{project.name}</div>
          {agents.map((a) => {
            const to = `/projects/${project.project_id}/chat/${a.agent_id}`
            return (
              <Link
                key={a.agent_id}
                to={to}
                className={`app-sidebar-item${pathname === to ? ' active' : ''}`}
              >
                <span className="app-sidebar-spinner" />
                <span className="app-sidebar-name">{a.name}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </aside>
  )
}

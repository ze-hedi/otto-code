import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './ProjectsPage.css'

interface ProjectDoc {
  project_id: string
  name: string
  path: string
  description?: string
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

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectDoc[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('http://localhost:4000/projects')
      .then(r => r.ok ? r.json() : [])
      .then(data => setProjects(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    const res = await fetch(`http://localhost:4000/projects/${projectId}`, { method: 'DELETE' })
    if (res.ok) {
      setProjects(prev => prev.filter(p => p.project_id !== projectId))
    }
  }

  return (
    <div className="projects-page">
      <div className="projects-header">
        <div className="projects-header-text">
          <h1>Otto</h1>
          <p>Select a project to get started</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button className="dashboards-link-btn" onClick={() => navigate('/dashboards')}>
            Dashboards
          </button>
          <button className="create-project-btn" onClick={() => navigate('/projects/new')}>
            + New Project
          </button>
        </div>
      </div>

      <div className="projects-grid">
        {loading && <div className="projects-loading">Loading projects...</div>}

        {!loading && projects.length === 0 && (
          <div className="projects-empty">
            No projects yet.{' '}
            <button className="link-btn" onClick={() => navigate('/projects/new')}>
              Create your first project
            </button>{' '}
            to get started.
          </div>
        )}

        {projects.map(project => (
          <div
            key={project.project_id}
            className="project-card"
            onClick={() => navigate(`/projects/${project.project_id}`)}
          >
            <div className="project-card-header">
              <div className="project-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </div>
              <span className="project-card-name">{project.name}</span>
              <button
                className="project-delete-btn"
                title="Delete project"
                onClick={e => handleDelete(e, project.project_id)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
            <span className="project-card-path">{project.path}</span>
            {project.description && (
              <span className="project-card-description">{project.description}</span>
            )}
            <span className="project-card-time">{timeAgo(project.updated_at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

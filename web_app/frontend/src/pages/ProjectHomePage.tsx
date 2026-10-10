import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './ProjectHomePage.css'

interface ProjectDoc {
  project_id: string
  name: string
  path: string
  description?: string
}

export function ProjectHomePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`http://localhost:4000/projects`)
      .then(r => r.ok ? r.json() : [])
      .then((projects: ProjectDoc[]) => {
        const found = projects.find(p => p.project_id === projectId) ?? null
        setProject(found)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <div className="project-home-loading">Loading...</div>
  if (!project) return <div className="project-home-loading">Project not found.</div>

  return (
    <div className="project-home-page">
      <div className="project-home-header">
        <button className="project-back-link" onClick={() => navigate('/')}>
          &larr; Projects
        </button>
        <div className="project-home-title">
          <h1>{project.name}</h1>
          <span className="project-home-path">{project.path}</span>
        </div>
        {project.description && (
          <p className="project-home-description">{project.description}</p>
        )}
      </div>

      <div className="project-home-cards">
        <button
          className="project-home-card"
          onClick={() => navigate(`/projects/${projectId}/agents`)}
        >
          <div className="project-home-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
            </svg>
          </div>
          <h2>Agents</h2>
          <p>Create and manage individual AI agents with custom tools and instructions.</p>
        </button>

        <button
          className="project-home-card"
          onClick={() => navigate(`/projects/${projectId}/workflow`)}
        >
          <div className="project-home-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="3" width="6" height="6" rx="1" />
              <rect x="9" y="15" width="6" height="6" rx="1" />
              <path d="M6 9v3a1 1 0 0 0 1 1h3" />
              <path d="M18 9v3a1 1 0 0 1-1 1h-3" />
            </svg>
          </div>
          <h2>Workflows</h2>
          <p>Design multi-step pipelines that chain agents together.</p>
        </button>
      </div>
    </div>
  )
}

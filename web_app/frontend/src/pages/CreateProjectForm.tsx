import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './CreateProjectForm.css'

export function CreateProjectForm() {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('http://localhost:4000/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path, ...(description && { description }) }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      navigate(`/projects/${data.project_id}`)
    } catch (err: any) {
      setError(err.message || 'Failed to create project')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="create-project-container">
      <div className="create-project-header">
        <button className="back-link" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <h1>New Project</h1>
        <p className="create-project-subtitle">A project scopes agents and workflows to a playground directory</p>
      </div>

      <form className="create-project-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="proj-name">Project Name <span className="required">*</span></label>
          <input
            id="proj-name"
            type="text"
            placeholder="e.g. My Code Assistant"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="proj-path">Playground Directory <span className="required">*</span></label>
          <input
            id="proj-path"
            type="text"
            placeholder="/path/to/your/repo"
            value={path}
            onChange={e => setPath(e.target.value)}
            className="mono"
            required
          />
          <p className="field-hint">All agents created inside this project will be scoped to this directory.</p>
        </div>

        <div className="field">
          <label htmlFor="proj-description">Description</label>
          <textarea
            id="proj-description"
            rows={3}
            placeholder="What is this project for..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        <button type="submit" className="submit-btn" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Project'}
        </button>

        {error && <div className="message error">{error}</div>}
      </form>
    </div>
  )
}

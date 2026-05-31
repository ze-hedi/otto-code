import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './ProjectsListPage.css';

function ProjectsListPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/projects')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch projects');
        return res.json();
      })
      .then(data => {
        setProjects(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleProjectClick = (project) => {
    // Build enriched project object for the workflow page
    const enrichedProject = {
      _id: project._id,
      name: project.name,
      description: project.description,
      repos: project.repos.map(repo => ({
        label: repo.label,
        path: repo.path,
        agents: repo.agents.map((agent, idx) => ({
          ...agent,
          sessionId: `${project.name}:${agent._id}:${idx}`,
          workingDir: repo.path,
        })),
      })),
    };
    navigate('/workflow', { state: { project: enrichedProject } });
  };

  const handleDelete = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this project?')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setProjects(prev => prev.filter(p => p._id !== projectId));
    } catch (err) {
      alert(`Failed to delete project: ${err.message}`);
    }
  };

  return (
    <div className="projects-container">
      <div className="projects-content">
        <div className="projects-header">
          <button className="projects-back-btn" onClick={() => navigate('/')}>
            &larr;
          </button>
          <h1>Workspaces</h1>
        </div>

        {loading && (
          <div className="projects-loading">
            <div className="spinner"></div>
            <p>Loading projects...</p>
          </div>
        )}

        {error && (
          <div className="projects-error">
            <p>Failed to load projects</p>
            <small>{error}</small>
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="projects-empty">
            <p>No projects yet</p>
            <small>Create your first project to get started</small>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="projects-grid">
            {projects.map(project => (
              <div
                key={project._id}
                className="project-card"
                onClick={() => handleProjectClick(project)}
              >
                <div className="project-card-header">
                  <div className="project-card-icon">📁</div>
                  <button
                    className="project-card-delete"
                    onClick={(e) => handleDelete(e, project._id)}
                    title="Delete project"
                  >
                    &times;
                  </button>
                </div>
                <h3>{project.name}</h3>
                <p className="project-card-desc">{project.description}</p>
                <div className="project-card-meta">
                  <span>{project.repos?.length || 0} repo{project.repos?.length !== 1 ? 's' : ''}</span>
                  <span>
                    {project.repos?.reduce((sum, r) => sum + (r.agents?.length || 0), 0)} agent{project.repos?.reduce((sum, r) => sum + (r.agents?.length || 0), 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="project-card-date">
                  {new Date(project.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          className="projects-create-btn"
          onClick={() => navigate('/workspaces/new')}
        >
          + Create New Project
        </button>
      </div>
    </div>
  );
}

export default ProjectsListPage;

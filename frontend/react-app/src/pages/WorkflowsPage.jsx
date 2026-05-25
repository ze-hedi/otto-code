import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './WorkflowsPage.css';

function WorkflowsPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:5000/runtime/workflows')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch workflows');
        return res.json();
      })
      .then((data) => {
        setWorkflows(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const formatDate = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="workflows-container">
      <div className="workflows-content">
        <button className="workflows-back" onClick={() => navigate('/')}>
          ← Home
        </button>
        <h1>Workflows</h1>

        {loading && <p className="workflows-status">Loading...</p>}
        {error && <p className="workflows-status workflows-error">Error: {error}</p>}
        {!loading && !error && workflows.length === 0 && (
          <p className="workflows-status">No workflows yet. Go create one!</p>
        )}

        <div className="workflows-list">
          {workflows.map((wf) => (
            <div key={wf.id} className="workflow-card">
              <div className="workflow-card-header">
                <span className="workflow-card-id">{wf.id}</span>
                <span className="workflow-card-time">{formatDate(wf.lastInteractedAt)}</span>
              </div>
              <div className="workflow-card-agents">
                {wf.agents.map((name, i) => (
                  <span key={i} className="workflow-agent-badge">{name}</span>
                ))}
              </div>
              <div className="workflow-card-footer">
                Created {formatDate(wf.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WorkflowsPage;

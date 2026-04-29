import React, { useEffect, useState } from 'react';
import './AgentsPage.css';

function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [model, setModel] = useState('');
  const [skills, setSkills] = useState([]);
  const [systemPrompt, setSystemPrompt] = useState(null);

  const handleSkillsLoad = (e) => {
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSkills((prev) => [
          ...prev,
          { name: file.name, content: ev.target.result },
        ]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const handleSystemPromptLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setSystemPrompt({ name: file.name, content: ev.target.result });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  useEffect(() => {
    fetch('/api/agents')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load agents');
        return res.json();
      })
      .then((data) => {
        setAgents(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="agents-container"><div className="agents-content"><p className="agents-subtitle">Loading agents...</p></div></div>;
  if (error) return <div className="agents-container"><div className="agents-content"><p className="agents-subtitle" style={{ color: '#f87171' }}>Error: {error}</p></div></div>;

  return (
    <div className="agents-container">
      <div className="agents-content">
        <div className={`agents-header-row${showForm ? ' agents-header-row--centered' : ''}`}>
          <div>
            <h1>Agents</h1>
            <p className="agents-subtitle">Manage your AI agents</p>
          </div>
          {!showForm && (
            <button className="add-agent-btn" onClick={() => setShowForm(true)}>+ Add Agent</button>
          )}
        </div>

        {showForm ? (
          <div className="create-agent-form">
            <h2 className="create-agent-title">New Agent</h2>
            <div className="form-group">
              <label className="form-label" htmlFor="agent-name">Name</label>
              <input
                id="agent-name"
                className="form-input"
                type="text"
                placeholder="Agent name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="agent-description">Description</label>
              <textarea
                id="agent-description"
                className="form-textarea"
                placeholder="Describe what this agent does..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="agent-model">Model</label>
              <select
                id="agent-model"
                className="form-input form-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="" disabled>Select a model...</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="gpt-5.1">GPT-5.1</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">System Prompt</label>
              {!systemPrompt ? (
                <label className="skills-upload-btn">
                  + Load System Prompt
                  <input
                    type="file"
                    accept=".md"
                    style={{ display: 'none' }}
                    onChange={handleSystemPromptLoad}
                  />
                </label>
              ) : (
                <div className="skills-list">
                  <div className="skill-item">
                    <div className="skill-item-header">
                      <span className="skill-icon">⌗</span>
                      <span className="skill-name">{systemPrompt.name}</span>
                      <button className="skill-remove-btn" onClick={() => setSystemPrompt(null)}>✕</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Skills</label>
              <label className="skills-upload-btn">
                + Load Skills
                <input
                  type="file"
                  accept=".md"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleSkillsLoad}
                />
              </label>
              {skills.length > 0 && (
                <div className="skills-list">
                  {skills.map((skill, i) => (
                    <div key={i} className="skill-item">
                      <div className="skill-item-header">
                        <span className="skill-icon">⌗</span>
                        <span className="skill-name">{skill.name}</span>
                        <button
                          className="skill-remove-btn"
                          onClick={() => setSkills((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-actions">
              <button className="agent-action-btn view-btn" onClick={() => { setShowForm(false); setFormName(''); setFormDescription(''); setModel(''); setSkills([]); setSystemPrompt(null); }}>
                Cancel
              </button>
              <button className="agent-action-btn edit-btn create-agent-submit-btn">
                Create Agent
              </button>
            </div>
          </div>
        ) : (
          <div className="agents-grid">
            {agents.map((agent) => (
              <div key={agent._id} className="agent-card">
                <div className="agent-header">
                  <h3 className="agent-name">{agent.name}</h3>
                  <span className={`agent-status ${agent.status.toLowerCase()}`}>
                    {agent.status}
                  </span>
                </div>
                <div className="agent-type">{agent.type}</div>
                <p className="agent-description">{agent.description}</p>
                <div className="agent-actions">
                  <button className="agent-action-btn view-btn">View</button>
                  <button className="agent-action-btn edit-btn">Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentsPage;

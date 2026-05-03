import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentCreationFlow from '../components/agents/AgentCreationFlow';
import './AgentsPage.css';
import '../components/agents/agents.css';
import '../components/AgentForm.css';

function AgentsPage() {
  const navigate = useNavigate();
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [showFlow, setShowFlow]           = useState(false);
  const [editingAgent, setEditingAgent]   = useState(null);
  const [popup, setPopup]                 = useState(null); // { message, code, agent }
  const [apiKeyInput, setApiKeyInput]     = useState('');
  const [savingKey, setSavingKey]         = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/agents').then((r) => r.json()),
      fetch('/api/claude-code-agents').then((r) => r.json()),
    ])
      .then(([piAgents, ccAgents]) => {
        setAgents([
          ...piAgents.map((a) => ({ ...a, agentType: 'pi' })),
          ...ccAgents.map((a) => ({ ...a, agentType: 'claude-code' })),
        ]);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const resetFlow = () => {
    setShowFlow(false);
    setEditingAgent(null);
  };

  const handleCreated = (agent) => {
    setAgents((prev) => [...prev, agent]);
    resetFlow();
  };

  const handleUpdated = (agent) => {
    setAgents((prev) => prev.map((a) => (a._id === agent._id ? agent : a)));
    resetFlow();
  };

  const openEdit = (agent) => {
    setEditingAgent(agent);
    setShowFlow(true);
  };

  const handleRun = async (agent) => {
    try {
      let files = [];
      if (agent.agentType === 'pi') {
        const res = await fetch(`/api/agents/${agent._id}/files`);
        files = await res.json();
      }
      const res = await fetch('http://localhost:5000/runtime/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, files }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPopup({ message: data.message || data.error || 'Runtime server error', code: data.error, agent });
        return;
      }
      navigate(`/chat/${agent._id}`, { state: { agent } });
    } catch (err) {
      setPopup({ message: `Failed to start agent: ${err.message}`, code: 'unknown', agent });
    }
  };

  const dismissPopup = () => {
    setPopup(null);
    setApiKeyInput('');
    setSavingKey(false);
  };

  const handleSaveAndRun = async () => {
    if (!apiKeyInput.trim() || !popup?.agent) return;
    setSavingKey(true);
    try {
      const res = await fetch(`/api/agents/${popup.agent._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...popup.agent, apiKey: apiKeyInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save API key');
      }
      const updatedAgent = { ...popup.agent, apiKey: apiKeyInput.trim() };
      setAgents((prev) => prev.map((a) => (a._id === updatedAgent._id ? updatedAgent : a)));
      dismissPopup();
      await handleRun(updatedAgent);
    } catch (err) {
      setPopup((prev) => ({ ...prev, message: err.message }));
      setSavingKey(false);
    }
  };

  if (loading) return (
    <div className="agents-container">
      <div className="agents-content">
        <p className="agents-subtitle">Loading agents...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="agents-container">
      <div className="agents-content">
        <p className="agents-subtitle" style={{ color: '#f87171' }}>Error: {error}</p>
      </div>
    </div>
  );

  return (
    <div className="agents-container">
      {popup && (
        <div className="agent-error-popup">
          <div className="agent-error-popup__box">
            <p className="agent-error-popup__title">Cannot start agent</p>
            <p className="agent-error-popup__message">{popup.message}</p>
            {popup.code === 'api_key_required' && (
              <>
                <input
                  className="agent-error-popup__input"
                  type="password"
                  placeholder="sk-ant-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  disabled={savingKey}
                />
                <button
                  className="agent-error-popup__save"
                  onClick={handleSaveAndRun}
                  disabled={!apiKeyInput.trim() || savingKey}
                >
                  {savingKey ? 'Saving...' : 'Save & Run'}
                </button>
              </>
            )}
            <button className="agent-error-popup__close" onClick={dismissPopup}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="agents-content">
        <div className={`agents-header-row${showFlow ? ' agents-header-row--centered' : ''}`}>
          <div>
            <h1>Agents</h1>
            <p className="agents-subtitle">Manage your AI agents</p>
          </div>
          {!showFlow && (
            <button className="add-agent-btn" onClick={() => setShowFlow(true)}>
              + Add Agent
            </button>
          )}
        </div>

        {showFlow ? (
          <AgentCreationFlow
            editingAgent={editingAgent}
            onCreated={handleCreated}
            onUpdated={handleUpdated}
            onCancel={resetFlow}
          />
        ) : (
          <div className="agents-grid">
            {agents.map((agent) => (
              <div key={agent._id} className="agent-card">
                <div className="agent-header">
                  <h3 className="agent-name">{agent.icon} {agent.name}</h3>
                  <span className={`agent-status ${agent.status?.toLowerCase()}`}>
                    {agent.status}
                  </span>
                </div>
                <div className={`agent-type-label ${agent.agentType}`}>
                  {agent.agentType === 'claude-code' ? '🖥️ Claude Code' : '🤖 Pi Agent'}
                </div>
                <p className="agent-description">{agent.description}</p>
                <div className="agent-actions">
                  <button className="agent-action-btn view-btn" onClick={() => handleRun(agent)}>
                    Run
                  </button>
                  <button className="agent-action-btn edit-btn" onClick={() => openEdit(agent)}>
                    Edit
                  </button>
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

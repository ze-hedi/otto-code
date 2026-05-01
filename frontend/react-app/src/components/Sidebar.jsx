import React from 'react';

const ARTEFACTS = [
  { type: 'if',   label: 'If',   icon: '◇' },
  { type: 'plan', label: 'Plan', icon: '☰' },
];

const Sidebar = ({ agents, loadingAgents, agentsError, onDragStart }) => {
  const handleAgentDragStart = (e, agent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'agent',
      agentId: agent._id,
      agentName: agent.name,
    }));
    onDragStart(agent);
  };

  const handleArtefactDragStart = (e, artefact) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'artefact',
      artefactType: artefact.type,
      label: artefact.label,
    }));
    onDragStart(artefact);
  };

  return (
    <aside className="wf-sidebar">
      <div className="wf-sidebar-header">
        Agents
        {!loadingAgents && !agentsError && (
          <span className="agent-count">{agents.length}</span>
        )}
      </div>
      <div className="wf-palette">
        {loadingAgents && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading agents...</p>
          </div>
        )}

        {agentsError && (
          <div className="error-state">
            <p>Failed to load agents</p>
            <small>{agentsError}</small>
          </div>
        )}

        {!loadingAgents && !agentsError && agents.length === 0 && (
          <div className="empty-state">
            <p>No agents available</p>
            <a href="/agents">Create an agent</a>
          </div>
        )}

        {!loadingAgents && !agentsError && agents.length > 0 && (
          <div className="wf-category">
            {agents.map(agent => (
              <div
                key={agent._id}
                className="wf-component"
                draggable="true"
                onDragStart={(e) => handleAgentDragStart(e, agent)}
              >
                <div className="wf-component-icon">🤖</div>
                <span>{agent.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="wf-sidebar-header wf-sidebar-header--artefacts">
          Artefacts
        </div>
        <div className="wf-category">
          {ARTEFACTS.map(artefact => (
            <div
              key={artefact.type}
              className="wf-component wf-component--artefact"
              draggable="true"
              onDragStart={(e) => handleArtefactDragStart(e, artefact)}
            >
              <div className="wf-component-icon wf-component-icon--artefact">
                {artefact.icon}
              </div>
              <span>{artefact.label}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;

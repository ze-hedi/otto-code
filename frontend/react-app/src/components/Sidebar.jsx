import React from 'react';

const Sidebar = ({ agents, loadingAgents, agentsError, onDragStart }) => {
  const handleDragStart = (e, agent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      agentId: agent._id,
      agentName: agent.name
    }));
    onDragStart(agent);
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
                onDragStart={(e) => handleDragStart(e, agent)}
              >
                <div className="wf-component-icon">🤖</div>
                <span>{agent.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;

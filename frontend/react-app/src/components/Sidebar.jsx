import React from 'react';

const Sidebar = ({
  agents, loadingAgents, agentsError,
  orchestrators, loadingOrchestrators, orchestratorsError,
  tools, loadingTools, toolsError,
  interfaces, loadingInterfaces, interfacesError,
  placedAgentIds = [],
  placedOrchestratorIds = [],
  onDragStart, onAgentClick,
  onBuildPiAgent,
  collapsed, onToggleCollapse,
}) => {
  const handleAgentDragStart = (e, agent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'agent',
      agentId: agent._id,
      agentName: agent.name,
      agentIcon: agent.icon || '🤖',
    }));
    onDragStart(agent);
  };

  const handleToolDragStart = (e, tool) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'tool',
      toolId: tool._id,
      toolName: tool.name,
      toolIcon: tool.icon || '🔧',
    }));
    onDragStart(tool);
  };

  const handleOrchestratorDragStart = (e, orchestrator) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'orchestrator',
      orchestratorId: orchestrator._id,
      orchestratorName: orchestrator.name,
      orchestratorIcon: orchestrator.icon || '🧠',
    }));
    onDragStart(orchestrator);
  };

  const handleArtefactDragStart = (e, artefact) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'artefact',
      artefactType: artefact._id,
      artefactIcon: artefact.icon,
      label: artefact.name,
    }));
    onDragStart(artefact);
  };

  return (
    <aside className={`wf-sidebar${collapsed ? ' wf-sidebar--collapsed' : ''}`}>
      <button className="wf-sidebar-toggle" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? '»' : '«'}
      </button>
      {!collapsed && (
      <>
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
            {agents.map(agent => {
              const isPlaced = placedAgentIds.includes(agent._id);
              return (
                <div
                  key={agent._id}
                  className={`wf-component${isPlaced ? ' wf-component--disabled' : ''}`}
                  draggable={!isPlaced}
                  onDragStart={(e) => !isPlaced && handleAgentDragStart(e, agent)}
                  onClick={() => !isPlaced && onAgentClick?.(agent._id)}
                >
                  <div className="wf-component-icon">{agent.icon || '🤖'}</div>
                  <span>{agent.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {!loadingAgents && !agentsError && (
          <button className="wf-build-agent-btn" onClick={onBuildPiAgent}>
            + Build an Agent
          </button>
        )}

        {/* ── Orchestrators ──────────────────────────────────── */}
        <div className="wf-sidebar-header wf-sidebar-header--orchestrators">
          Orchestrators
          {!loadingOrchestrators && !orchestratorsError && (
            <span className="agent-count">{orchestrators.length}</span>
          )}
        </div>

        {loadingOrchestrators && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading orchestrators...</p>
          </div>
        )}

        {orchestratorsError && (
          <div className="error-state">
            <p>Failed to load orchestrators</p>
            <small>{orchestratorsError}</small>
          </div>
        )}

        {!loadingOrchestrators && !orchestratorsError && orchestrators.length === 0 && (
          <div className="empty-state">
            <p>No orchestrators available</p>
            <a href="/team-of-agents">Create an orchestrator</a>
          </div>
        )}

        {!loadingOrchestrators && !orchestratorsError && orchestrators.length > 0 && (
          <div className="wf-category">
            {orchestrators.map(orch => {
              const isPlaced = placedOrchestratorIds.includes(orch._id);
              return (
                <div
                  key={orch._id}
                  className={`wf-component wf-component--orchestrator${isPlaced ? ' wf-component--disabled' : ''}`}
                  draggable={!isPlaced}
                  onDragStart={(e) => !isPlaced && handleOrchestratorDragStart(e, orch)}
                >
                  <div className="wf-component-icon">{orch.icon || '🧠'}</div>
                  <span>{orch.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Tools ─────────────────────────────────────────── */}
        <div className="wf-sidebar-header wf-sidebar-header--tools">
          Tools
          {!loadingTools && !toolsError && (
            <span className="tool-count">{tools.length}</span>
          )}
        </div>

        {loadingTools && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading tools...</p>
          </div>
        )}

        {toolsError && (
          <div className="error-state">
            <p>Failed to load tools</p>
            <small>{toolsError}</small>
          </div>
        )}

        {!loadingTools && !toolsError && tools.length === 0 && (
          <div className="empty-state">
            <p>No tools available</p>
            <a href="/tools">Create a tool</a>
          </div>
        )}

        {!loadingTools && !toolsError && tools.length > 0 && (
          <div className="wf-category">
            {tools.map(tool => (
              <div
                key={tool._id}
                className="wf-component wf-component--tool"
                draggable="true"
                onDragStart={(e) => handleToolDragStart(e, tool)}
              >
                <div className="wf-component-icon wf-component-icon--tool">
                  {tool.icon || '🔧'}
                </div>
                <span>{tool.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="wf-sidebar-header wf-sidebar-header--artefacts">
          Interfaces
          {!loadingInterfaces && !interfacesError && (
            <span className="tool-count">{interfaces.length}</span>
          )}
        </div>

        {loadingInterfaces && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading interfaces...</p>
          </div>
        )}

        {interfacesError && (
          <div className="error-state">
            <p>Failed to load interfaces</p>
            <small>{interfacesError}</small>
          </div>
        )}

        {!loadingInterfaces && !interfacesError && interfaces.length === 0 && (
          <div className="empty-state">
            <p>No interfaces available</p>
          </div>
        )}

        {!loadingInterfaces && !interfacesError && interfaces.length > 0 && (
          <div className="wf-category">
            {interfaces.map(artefact => (
              <div
                key={artefact._id}
                className="wf-component wf-component--artefact"
                draggable="true"
                onDragStart={(e) => handleArtefactDragStart(e, artefact)}
              >
                <div className="wf-component-icon wf-component-icon--artefact">
                  {artefact.icon}
                </div>
                <span>{artefact.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </aside>
  );
};

export default Sidebar;

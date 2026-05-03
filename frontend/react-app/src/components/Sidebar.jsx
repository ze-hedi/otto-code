import React from 'react';

const Sidebar = ({
  agents, loadingAgents, agentsError,
  claudeCodeAgents, loadingCCAgents, ccAgentsError,
  tools, loadingTools, toolsError,
  interfaces, loadingInterfaces, interfacesError,
  onDragStart, onAgentClick, onCCAgentClick,
  onBuildPiAgent, onBuildCCAgent,
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

  const handleCCAgentDragStart = (e, agent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      nodeType: 'claude-code-agent',
      agentId: agent._id,
      agentName: agent.name,
      agentIcon: agent.icon || '🖥️',
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
                onClick={() => onAgentClick?.(agent._id)}
              >
                <div className="wf-component-icon">{agent.icon || '🤖'}</div>
                <span>{agent.name}</span>
              </div>
            ))}
          </div>
        )}

        {!loadingAgents && !agentsError && (
          <button className="wf-build-agent-btn" onClick={onBuildPiAgent}>
            + Build an Agent
          </button>
        )}

        {/* ── Claude Code Agents ───────────────────────────── */}
        <div className="wf-sidebar-header wf-sidebar-header--cc-agents">
          Claude Code
          {!loadingCCAgents && !ccAgentsError && (
            <span className="cc-agent-count">{claudeCodeAgents.length}</span>
          )}
        </div>

        {loadingCCAgents && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        )}

        {ccAgentsError && (
          <div className="error-state">
            <p>Failed to load agents</p>
            <small>{ccAgentsError}</small>
          </div>
        )}

        {!loadingCCAgents && !ccAgentsError && claudeCodeAgents.length === 0 && (
          <div className="empty-state">
            <p>No Claude Code agents</p>
            <a href="/agents">Create one</a>
          </div>
        )}

        {!loadingCCAgents && !ccAgentsError && claudeCodeAgents.length > 0 && (
          <div className="wf-category">
            {claudeCodeAgents.map(agent => (
              <div
                key={agent._id}
                className="wf-component wf-component--cc-agent"
                draggable="true"
                onDragStart={(e) => handleCCAgentDragStart(e, agent)}
                onClick={() => onCCAgentClick?.(agent._id)}
              >
                <div className="wf-component-icon wf-component-icon--cc-agent">
                  {agent.icon || '🖥️'}
                </div>
                <span>{agent.name}</span>
              </div>
            ))}
          </div>
        )}

        {!loadingCCAgents && !ccAgentsError && (
          <button className="wf-build-agent-btn wf-build-agent-btn--cc" onClick={onBuildCCAgent}>
            + Build an Agent
          </button>
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
    </aside>
  );
};

export default Sidebar;

import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import AgentDetailPanel from './components/AgentDetailPanel';
import ClaudeCodeDetailPanel from './components/ClaudeCodeDetailPanel';
import PiAgentFormContainer from './components/agents/PiAgentFormContainer';
import ClaudeCodeAgentForm from './components/agents/ClaudeCodeAgentForm';
import { generateNodeId, NODE_DEFAULT_SIDES } from './utils';
import './WorkflowBuilder.css';

const WorkflowBuilder = () => {
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionMode, setConnectionMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [history, setHistory] = useState([]);
  const [deleteConnBtnPos, setDeleteConnBtnPos] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState(null);
  const [tools, setTools] = useState([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState(null);
  const [claudeCodeAgents, setClaudeCodeAgents] = useState([]);
  const [loadingCCAgents, setLoadingCCAgents] = useState(true);
  const [ccAgentsError, setCCAgentsError] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [selectedCCAgentId, setSelectedCCAgentId] = useState(null);
  const [creatingPiAgent, setCreatingPiAgent] = useState(false);
  const [creatingCCAgent, setCreatingCCAgent] = useState(false);
  const draggedType = useRef(null);
  const snapshotRef = useRef({ nodes, connections });
  const agentsRef   = useRef(agents);

  useEffect(() => {
    snapshotRef.current = { nodes, connections };
  }, [nodes, connections]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const saveSnapshot = useCallback(() => {
    setHistory(prev => [...prev, { nodes: snapshotRef.current.nodes, connections: snapshotRef.current.connections }]);
  }, []);

  // Fetch agents from database on mount
  useEffect(() => {
    setLoadingAgents(true);
    fetch('http://localhost:4000/api/agents')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch agents');
        return res.json();
      })
      .then(data => {
        setAgents(data);
        setLoadingAgents(false);
      })
      .catch(err => {
        console.error('Error fetching agents:', err);
        setAgentsError(err.message);
        setLoadingAgents(false);
      });
  }, []);

  // Fetch tools from database on mount
  useEffect(() => {
    setLoadingTools(true);
    fetch('http://localhost:4000/api/tools')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch tools');
        return res.json();
      })
      .then(data => {
        setTools(data);
        setLoadingTools(false);
      })
      .catch(err => {
        console.error('Error fetching tools:', err);
        setToolsError(err.message);
        setLoadingTools(false);
      });
  }, []);

  // Fetch Claude Code agents on mount
  useEffect(() => {
    setLoadingCCAgents(true);
    fetch('http://localhost:4000/api/claude-code-agents')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch Claude Code agents');
        return res.json();
      })
      .then(data => {
        setClaudeCodeAgents(data);
        setLoadingCCAgents(false);
      })
      .catch(err => {
        setCCAgentsError(err.message);
        setLoadingCCAgents(false);
      });
  }, []);

  // Close detail panels on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeAllPanels();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sync updated agent back to sidebar list and canvas nodes
  const handleAgentUpdated = useCallback((updatedAgent) => {
    setAgents((prev) => prev.map((a) => (a._id === updatedAgent._id ? updatedAgent : a)));
    setNodes((prev) =>
      prev.map((n) =>
        n.agentId === updatedAgent._id
          ? { ...n, agentName: updatedAgent.name, agentIcon: updatedAgent.icon || '🤖' }
          : n
      )
    );
  }, []);

  // Sync updated Claude Code agent back to sidebar list and canvas nodes
  const handleCCAgentUpdated = useCallback((updatedAgent) => {
    setClaudeCodeAgents((prev) => prev.map((a) => (a._id === updatedAgent._id ? updatedAgent : a)));
    setNodes((prev) =>
      prev.map((n) =>
        n.agentId === updatedAgent._id && n.agentType === 'claude-code'
          ? { ...n, agentName: updatedAgent.name, agentIcon: updatedAgent.icon || '🖥️' }
          : n
      )
    );
  }, []);

  // Close all right-side panels
  const closeAllPanels = useCallback(() => {
    setSelectedAgentId(null);
    setSelectedCCAgentId(null);
    setCreatingPiAgent(false);
    setCreatingCCAgent(false);
  }, []);

  // Open empty PI agent creation form in the right panel
  const handleBuildPiAgent = useCallback(() => {
    closeAllPanels();
    setCreatingPiAgent(true);
  }, [closeAllPanels]);

  // Open empty Claude Code agent creation form in the right panel
  const handleBuildCCAgent = useCallback(() => {
    closeAllPanels();
    setCreatingCCAgent(true);
  }, [closeAllPanels]);

  // Handle newly created PI agent — append to sidebar list and close panel
  const handlePiAgentCreated = useCallback((newAgent) => {
    setAgents((prev) => [...prev, newAgent]);
    setCreatingPiAgent(false);
  }, []);

  // Handle newly created Claude Code agent — append to sidebar list and close panel
  const handleCCAgentCreated = useCallback((newAgent) => {
    setClaudeCodeAgents((prev) => [...prev, newAgent]);
    setCreatingCCAgent(false);
  }, []);

  // Persist a tool-link add/remove to the agent's DB record
  const syncToolLink = useCallback((agentNode, toolNode, action) => {
    const agent = agentsRef.current.find((a) => a._id === agentNode.agentId);
    if (!agent || !toolNode.toolId) return;

    const currentTools = (agent.tools || []).map((t) => (typeof t === 'object' ? t._id : t));
    const newTools =
      action === 'add'
        ? [...new Set([...currentTools, toolNode.toolId])]
        : currentTools.filter((id) => id !== toolNode.toolId);

    fetch(`http://localhost:4000/api/agents/${agent._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...agent, tools: newTools }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((updated) => {
        setAgents((prev) => prev.map((a) => (a._id === updated._id ? updated : a)));
      })
      .catch(() => console.error(`Failed to ${action} tool link in DB`));
  }, []);

  // Sidebar drag start
  const handleSidebarDragStart = useCallback((agent) => {
    draggedType.current = agent;
  }, []);

  // Canvas drop - create new node
  const handleDrop = useCallback((data, x, y) => {
    let newNode;

    if (data.nodeType === 'artefact') {
      newNode = {
        id: generateNodeId(),
        type: 'artefact',
        artefactType: data.artefactType,
        label: data.label,
        x: x - 55,
        y: y - 40,
      };
    } else if (data.nodeType === 'tool') {
      newNode = {
        id: generateNodeId(),
        type: 'tool',
        toolId: data.toolId,
        toolName: data.toolName,
        toolIcon: data.toolIcon,
        x: x - 55,
        y: y - 40,
      };
    } else if (data.nodeType === 'claude-code-agent') {
      if (!data.agentId || !data.agentName) {
        draggedType.current = null;
        return;
      }
      newNode = {
        id: generateNodeId(),
        type: 'agent',
        agentType: 'claude-code',
        agentId: data.agentId,
        agentName: data.agentName,
        agentIcon: data.agentIcon || '🖥️',
        x: x - 90,
        y: y - 34,
      };
    } else {
      if (!data.agentId || !data.agentName) {
        draggedType.current = null;
        return;
      }
      newNode = {
        id: generateNodeId(),
        type: 'agent',
        agentId: data.agentId,
        agentName: data.agentName,
        agentIcon: data.agentIcon || '🤖',
        x: x - 55,
        y: y - 40,
      };
    }

    saveSnapshot();
    setNodes((prev) => [...prev, newNode]);
    draggedType.current = null;
  }, [saveSnapshot]);

  // Node drag move
  const handleNodeDragMove = useCallback((nodeId, newLeft, newTop) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, x: Math.max(0, newLeft), y: Math.max(0, newTop) }
          : node
      )
    );
  }, []);

  // Save snapshot before node drag starts (called on first mouse move)
  const handleNodeDragStart = useCallback(() => {
    saveSnapshot();
  }, [saveSnapshot]);

  // Delete node
  const handleDeleteNode = useCallback((nodeId) => {
    saveSnapshot();
    // Sync any tool-links being implicitly removed before wiping them
    const { nodes: currentNodes, connections: currentConns } = snapshotRef.current;
    currentConns.forEach((conn) => {
      if ((conn.from === nodeId || conn.to === nodeId) && conn.linkType === 'tool-link') {
        const fromNode = currentNodes.find((n) => n.id === conn.from);
        const toNode   = currentNodes.find((n) => n.id === conn.to);
        if (fromNode && toNode) {
          const agentNode = fromNode.type === 'agent' ? fromNode : toNode;
          const toolNode  = fromNode.type === 'tool'  ? fromNode : toNode;
          syncToolLink(agentNode, toolNode, 'remove');
        }
      }
    });
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.from !== nodeId && c.to !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [saveSnapshot, selectedNodeId, syncToolLink]);

  // Node click — connection mode: wire nodes; normal mode: open detail panel
  const handleNodeClick = useCallback((nodeId) => {
    if (!connectionMode) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.type === 'agent') {
        closeAllPanels();
        if (node.agentType === 'claude-code') {
          setSelectedCCAgentId(node.agentId);
        } else {
          setSelectedAgentId(node.agentId);
        }
      }
      return;
    }

    if (selectedNodeId && selectedNodeId !== nodeId) {
      const fromNode = nodes.find(n => n.id === selectedNodeId);
      const toNode   = nodes.find(n => n.id === nodeId);
      const fromSide = (NODE_DEFAULT_SIDES[fromNode?.type] ?? NODE_DEFAULT_SIDES.agent).from;
      const toSide   = (NODE_DEFAULT_SIDES[toNode?.type]   ?? NODE_DEFAULT_SIDES.agent).to;

      // Tool-link only applies to Pi agents ↔ tools (not Claude Code agents)
      const isToolLink =
        (fromNode?.type === 'agent' && fromNode?.agentType !== 'claude-code' && toNode?.type === 'tool') ||
        (fromNode?.type === 'tool'  && toNode?.type === 'agent' && toNode?.agentType !== 'claude-code');

      const newConn = {
        from: selectedNodeId,
        fromSide,
        to: nodeId,
        toSide,
        ...(isToolLink ? { linkType: 'tool-link' } : {}),
      };

      const exists = connections.some(
        (c) =>
          c.from === newConn.from &&
          c.fromSide === newConn.fromSide &&
          c.to === newConn.to &&
          c.toSide === newConn.toSide
      );

      if (!exists) {
        saveSnapshot();
        setConnections((prev) => [...prev, newConn]);
        if (isToolLink) {
          const agentNode = fromNode?.type === 'agent' ? fromNode : toNode;
          const toolNode  = fromNode?.type === 'tool'  ? fromNode : toNode;
          syncToolLink(agentNode, toolNode, 'add');
        }
      }

      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(nodeId);
    }
  }, [connectionMode, selectedNodeId, connections, nodes, saveSnapshot, syncToolLink]);

  // Handle drag start (for connections via handles)
  const handleHandleDragStart = useCallback((fromNodeId, fromSide, toNodeId, toSide, linkType) => {
    const newConn = {
      from: fromNodeId,
      fromSide,
      to: toNodeId,
      toSide,
      ...(linkType ? { linkType } : {}),
    };

    // Check if connection already exists
    const exists = connections.some(
      (c) =>
        c.from === newConn.from &&
        c.fromSide === newConn.fromSide &&
        c.to === newConn.to &&
        c.toSide === newConn.toSide &&
        (c.linkType ?? undefined) === (newConn.linkType ?? undefined)
    );

    if (!exists) {
      saveSnapshot();
      setConnections((prev) => [...prev, newConn]);
      if (linkType === 'tool-link') {
        const fromNode = snapshotRef.current.nodes.find((n) => n.id === fromNodeId);
        const toNode   = snapshotRef.current.nodes.find((n) => n.id === toNodeId);
        if (fromNode && toNode) {
          const agentNode = fromNode.type === 'agent' ? fromNode : toNode;
          const toolNode  = fromNode.type === 'tool'  ? fromNode : toNode;
          if (agentNode.agentType !== 'claude-code') {
            syncToolLink(agentNode, toolNode, 'add');
          }
        }
      }
    }
  }, [connections, saveSnapshot, syncToolLink]);

  // Connection click
  const handleConnectionClick = useCallback((conn, midpoint) => {
    setSelectedConnection(conn);
    setDeleteConnBtnPos(midpoint);
  }, []);

  // Delete connection
  const handleDeleteConnection = useCallback((conn) => {
    saveSnapshot();
    setConnections((prev) =>
      prev.filter(
        (c) =>
          !(
            c.from === conn.from &&
            c.fromSide === conn.fromSide &&
            c.to === conn.to &&
            c.toSide === conn.toSide
          )
      )
    );
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);

    if (conn.linkType === 'tool-link') {
      const fromNode = snapshotRef.current.nodes.find((n) => n.id === conn.from);
      const toNode   = snapshotRef.current.nodes.find((n) => n.id === conn.to);
      if (fromNode && toNode) {
        const agentNode = fromNode.type === 'agent' ? fromNode : toNode;
        const toolNode  = fromNode.type === 'tool'  ? fromNode : toNode;
        syncToolLink(agentNode, toolNode, 'remove');
      }
    }
  }, [saveSnapshot, syncToolLink]);

  // Canvas click (clear selection)
  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
  }, []);

  // Toggle connection mode
  const handleToggleConnectionMode = useCallback(() => {
    setConnectionMode((prev) => !prev);
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const snapshot = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setNodes(snapshot.nodes);
    setConnections(snapshot.connections);
  }, [history]);

  // Export schema (disabled - functionality removed)
  const handleExport = useCallback(() => {
    // Export functionality disabled
    console.log('Export functionality is currently disabled');
  }, []);

  // Import schema (disabled - functionality removed)
  const handleImport = useCallback(() => {
    // Import functionality disabled
    console.log('Import functionality is currently disabled');
  }, []);

  // Clear canvas
  const handleClear = useCallback(() => {
    saveSnapshot();
    setNodes([]);
    setConnections([]);
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
  }, [saveSnapshot]);

  return (
    <div className="wf-shell">
      <Header
        connectionMode={connectionMode}
        canUndo={history.length > 0}
        onToggleConnectionMode={handleToggleConnectionMode}
        onUndo={handleUndo}
        onExport={handleExport}
        onImport={handleImport}
        onClear={handleClear}
      />
      <div className="wf-body">
        <Sidebar
          agents={agents}
          loadingAgents={loadingAgents}
          agentsError={agentsError}
          claudeCodeAgents={claudeCodeAgents}
          loadingCCAgents={loadingCCAgents}
          ccAgentsError={ccAgentsError}
          tools={tools}
          loadingTools={loadingTools}
          toolsError={toolsError}
          onDragStart={handleSidebarDragStart}
          onAgentClick={(agentId) => { closeAllPanels(); setSelectedAgentId(agentId); }}
          onCCAgentClick={(agentId) => { closeAllPanels(); setSelectedCCAgentId(agentId); }}
          onBuildPiAgent={handleBuildPiAgent}
          onBuildCCAgent={handleBuildCCAgent}
        />
        <Canvas
          nodes={nodes}
          connections={connections}
          connectionMode={connectionMode}
          selectedNodeId={selectedNodeId}
          onDrop={handleDrop}
          onDeleteNode={handleDeleteNode}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragMove={handleNodeDragMove}
          onHandleDragStart={handleHandleDragStart}
          onNodeClick={handleNodeClick}
          onConnectionClick={handleConnectionClick}
          onDeleteConnection={handleDeleteConnection}
          onCanvasClick={handleCanvasClick}
        />
        {selectedAgentId && (
          <AgentDetailPanel
            agent={agents.find((a) => a._id === selectedAgentId)}
            availableTools={tools}
            onClose={() => setSelectedAgentId(null)}
            onAgentUpdated={handleAgentUpdated}
          />
        )}
        {selectedCCAgentId && (
          <ClaudeCodeDetailPanel
            agent={claudeCodeAgents.find((a) => a._id === selectedCCAgentId)}
            onClose={() => setSelectedCCAgentId(null)}
            onAgentUpdated={handleCCAgentUpdated}
          />
        )}
        {creatingPiAgent && (
          <div className="wf-detail-panel">
            <div className="wf-detail-panel-header">
              <span className="wf-detail-panel-title">Build a Pi Agent</span>
              <button className="wf-detail-panel-close" onClick={() => setCreatingPiAgent(false)}>×</button>
            </div>
            <div className="wf-detail-panel-body">
              <PiAgentFormContainer
                onCreated={handlePiAgentCreated}
                onUpdated={() => {}}
                onCancel={() => setCreatingPiAgent(false)}
              />
            </div>
          </div>
        )}
        {creatingCCAgent && (
          <div className="wf-detail-panel">
            <div className="wf-detail-panel-header">
              <span className="wf-detail-panel-title">Build a Claude Code Agent</span>
              <button className="wf-detail-panel-close" onClick={() => setCreatingCCAgent(false)}>×</button>
            </div>
            <div className="wf-detail-panel-body">
              <ClaudeCodeAgentForm
                onCreated={handleCCAgentCreated}
                onUpdated={() => {}}
                onCancel={() => setCreatingCCAgent(false)}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* Delete connection button */}
      {selectedConnection && deleteConnBtnPos && (
        <button
          className="wf-delete-conn"
          style={{
            left: `${deleteConnBtnPos.x - 11}px`,
            top: `${deleteConnBtnPos.y - 11}px`,
          }}
          onClick={() => handleDeleteConnection(selectedConnection)}
        >
          ×
        </button>
      )}
    </div>
  );
};

export default WorkflowBuilder;

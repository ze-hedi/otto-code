import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import AgentDetailPanel from './components/AgentDetailPanel';
import PiAgentFormContainer from './components/agents/PiAgentFormContainer';
import Terminal from './components/Terminal';
import { createSession, sendMessage } from './AgentChatContext';
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
  const [interfaces, setInterfaces] = useState([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(true);
  const [interfacesError, setInterfacesError] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [creatingPiAgent, setCreatingPiAgent] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [activeSessionAgent, setActiveSessionAgent] = useState(null);
  const [workflowSessionId, setWorkflowSessionId] = useState(null);
  const [hookPopup, setHookPopup] = useState(null);
  const [chatTabs, setChatTabs] = useState([]);
  const [activeChatTab, setActiveChatTab] = useState(null);
  const draggedType = useRef(null);
  const snapshotRef = useRef({ nodes, connections });
  const agentsRef   = useRef(agents);

  useEffect(() => {
    snapshotRef.current = { nodes, connections };
  }, [nodes, connections]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  // Subscribe to workflow hook events via SSE
  useEffect(() => {
    if (!workflowSessionId) return;
    const es = new EventSource('http://localhost:5000/runtime/workflow/events');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'hook_fired') {
          setHookPopup(data);
        }
      } catch {}
    };
    return () => es.close();
  }, [workflowSessionId]);

  const handleAcceptHook = () => {
    console.log('[workflow] handleAcceptHook fired, hookPopup:', JSON.stringify(hookPopup));
    if (!hookPopup || !hookPopup.nextAgents?.length) {
      console.log('[workflow] No nextAgents found, closing popup');
      setHookPopup(null);
      return;
    }
    const next = hookPopup.nextAgents[0]; // single next agent for now
    const { name, compositeKey } = next;
    console.log('[workflow] Accept hook → next agent:', name, 'key:', compositeKey);

    // Register session in chat store
    createSession(name, compositeKey, name);

    // Add a new chat tab and switch to it
    setChatTabs((prev) => {
      if (prev.some((t) => t.sessionId === compositeKey)) return prev;
      return [...prev, { agentName: name, sessionId: compositeKey }];
    });
    setActiveChatTab(compositeKey);
    setActiveSessionAgent(name);
    setWorkflowSessionId(compositeKey);

    // Build a context message and send it to the next agent
    const argsText = Object.entries(hookPopup.args || {})
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');
    const contextMessage = `[Delegation from agent "${hookPopup.agentName}" via "${hookPopup.toolName}"]\n\n${argsText}`;

    sendMessage(compositeKey, contextMessage);

    setHookPopup(null);
  };

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

  // Fetch interfaces from database on mount
  useEffect(() => {
    setLoadingInterfaces(true);
    fetch('http://localhost:4000/api/interfaces')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch interfaces');
        return res.json();
      })
      .then(data => {
        setInterfaces(data);
        setLoadingInterfaces(false);
      })
      .catch(err => {
        setInterfacesError(err.message);
        setLoadingInterfaces(false);
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

  // Close all right-side panels
  const closeAllPanels = useCallback(() => {
    setSelectedAgentId(null);
    setCreatingPiAgent(false);
  }, []);

  // Open empty PI agent creation form in the right panel
  const handleBuildPiAgent = useCallback(() => {
    closeAllPanels();
    setCreatingPiAgent(true);
  }, [closeAllPanels]);

  // Handle newly created PI agent — append to sidebar list and close panel
  const handlePiAgentCreated = useCallback((newAgent) => {
    setAgents((prev) => [...prev, newAgent]);
    setCreatingPiAgent(false);
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
        icon: data.artefactIcon,
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
        setSelectedAgentId(node.agentId);
      }
      return;
    }

    if (selectedNodeId && selectedNodeId !== nodeId) {
      const fromNode = nodes.find(n => n.id === selectedNodeId);
      const toNode   = nodes.find(n => n.id === nodeId);
      const fromSide = (NODE_DEFAULT_SIDES[fromNode?.type] ?? NODE_DEFAULT_SIDES.agent).from;
      const toSide   = (NODE_DEFAULT_SIDES[toNode?.type]   ?? NODE_DEFAULT_SIDES.agent).to;

      const isToolLink =
        (fromNode?.type === 'agent' && toNode?.type === 'tool') ||
        (fromNode?.type === 'tool'  && toNode?.type === 'agent');

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
          syncToolLink(agentNode, toolNode, 'add');
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
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  const handleExport = useCallback(() => {
    setShowExportConfirm(true);
  }, []);

  const confirmExport = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      nodes: nodes.map((n) => {
        const base = { id: n.id, type: n.type, x: n.x, y: n.y };
        if (n.type === 'agent') return { ...base, name: n.agentName, icon: n.agentIcon, agentId: n.agentId };
        if (n.type === 'tool') return { ...base, name: n.toolName, icon: n.toolIcon, toolId: n.toolId };
        if (n.type === 'artefact') return { ...base, name: n.label, icon: n.icon, artefactType: n.artefactType };
        return base;
      }),
      connections: connections.map((c) => ({
        from: c.from,
        fromSide: c.fromSide,
        to: c.to,
        toSide: c.toSide,
        ...(c.linkType ? { linkType: c.linkType } : {}),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportConfirm(false);
  }, [nodes, connections]);

  const handleImport = useCallback((data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.connections)) {
      alert('Invalid workflow file: missing nodes or connections.');
      return;
    }
    saveSnapshot();
    const importedNodes = data.nodes.map((n) => {
      const base = { id: n.id, type: n.type, x: n.x, y: n.y };
      if (n.type === 'agent') return { ...base, agentId: n.agentId, agentName: n.name, agentIcon: n.icon || '🤖' };
      if (n.type === 'tool') return { ...base, toolId: n.toolId, toolName: n.name, toolIcon: n.icon || '🔧' };
      if (n.type === 'artefact') return { ...base, artefactType: n.artefactType, label: n.name, icon: n.icon };
      return base;
    });
    setNodes(importedNodes);
    setConnections(data.connections);
  }, [saveSnapshot]);

  // Clear canvas
  const addLog = useCallback((type, message) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalLogs((prev) => [...prev, { timestamp, type, message }]);
  }, []);

  const handleRun = useCallback(async () => {
    const agentNodes = nodes.filter((n) => n.type === 'agent');
    if (agentNodes.length === 0) {
      setTerminalOpen(true);
      addLog('error', 'Add at least one agent to the workflow before running.');
      return;
    }
    setTerminalOpen(true);
    addLog('info', 'Running workflow...');

    // Build nodes with full agent data for the runtime
    const builtNodes = await Promise.all(nodes.map(async (n) => {
      const base = { id: n.id, type: n.type };
      if (n.type === 'agent') {
        const agentData = agents.find((a) => a._id === n.agentId);
        // Fetch agent files (soul prompt, skills)
        let files = [];
        try {
          const filesRes = await fetch(`http://localhost:4000/api/agents/${n.agentId}/files`);
          if (filesRes.ok) files = await filesRes.json();
        } catch {}
        return { ...base, ...agentData, files };
      }
      if (n.type === 'tool') return { ...base, name: n.toolName, icon: n.toolIcon, toolId: n.toolId };
      if (n.type === 'artefact') return { ...base, name: n.label, icon: n.icon, artefactType: n.artefactType };
      return base;
    }));

    const payload = {
      nodes: builtNodes,
      connections: connections.map((c) => ({
        from: c.from,
        fromSide: c.fromSide,
        to: c.to,
        toSide: c.toSide,
        ...(c.linkType ? { linkType: c.linkType } : {}),
      })),
    };
    try {
      const res = await fetch('http://localhost:5000/runtime/workflow/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      if (data.compilationSuccess) {
        addLog('info', 'Compilation succeeded');
        // Set the first agent from execution queue as active chat target
        let agentName = null;
        if (data.executionQueue?.length > 0) {
          const firstAgent = data.executionQueue[0].find((n) => n.type === 'agent');
          if (firstAgent) agentName = firstAgent.name;
        }
        setActiveSessionAgent(agentName);
        // For multi-agent workflows, use the composite key so the runtime
        // can look up the correct agent in its activeAgents map.
        const chatSessionId = data.mode === 'multi-agent' && data.activeAgent?.id
          ? `${data.sessionId}::${data.activeAgent.id}`
          : data.sessionId;
        setWorkflowSessionId(chatSessionId);
        // Register session in the shared chat store and create first chat tab
        createSession(agentName, chatSessionId, agentName);
        setChatTabs([{ agentName, sessionId: chatSessionId }]);
        setActiveChatTab(chatSessionId);
      }
      addLog('info', `Workflow started (${data.mode})`);
      addLog('info', `Session: ${data.sessionId}`);
      if (data.agentDetails) {
        addLog('info', '── Agents ──────────────────────────');
        data.agentDetails.forEach((a) => {
          addLog('info', `  ${a.name} | model: ${a.model} | mode: ${a.sessionMode} | thinking: ${a.thinkingLevel}`);
          if (a.tools.length > 0) {
            addLog('info', `    interfaces: ${a.tools.join(', ')}`);
          }
        });
      }
      if (data.executionQueue) {
        addLog('info', '── Execution Queue ─────────────────');
        data.executionQueue.forEach((level, i) => {
          const names = level.map((n) => `${n.name} (${n.type})`).join(', ');
          addLog('info', `  Level ${i}: ${names}`);
        });
      }
    } catch (err) {
      addLog('error', `Failed: ${err.message}`);
    }
  }, [nodes, connections, agents, addLog]);

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
        onRun={handleRun}
        onClear={handleClear}
      />
      <div className="wf-body">
        <Sidebar
          agents={agents}
          loadingAgents={loadingAgents}
          agentsError={agentsError}
          tools={tools}
          loadingTools={loadingTools}
          toolsError={toolsError}
          interfaces={interfaces}
          loadingInterfaces={loadingInterfaces}
          interfacesError={interfacesError}
          onDragStart={handleSidebarDragStart}
          onAgentClick={(agentId) => { closeAllPanels(); setSelectedAgentId(agentId); }}
          placedAgentIds={nodes.filter((n) => n.type === 'agent').map((n) => n.agentId)}
          onBuildPiAgent={handleBuildPiAgent}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
        <div className={`wf-canvas-area${terminalOpen ? ' wf-canvas-area--split' : ''}`}>
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
          {terminalOpen && (
            <Terminal
              logs={terminalLogs}
              onClose={() => setTerminalOpen(false)}
              chatTabs={chatTabs}
              activeChatTab={activeChatTab}
              onSwitchChatTab={(sid) => setActiveChatTab(sid)}
            />
          )}
        </div>
        {selectedAgentId && (
          <AgentDetailPanel
            agent={agents.find((a) => a._id === selectedAgentId)}
            availableTools={tools}
            onClose={() => setSelectedAgentId(null)}
            onAgentUpdated={handleAgentUpdated}
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

      {showExportConfirm && (
        <div className="wf-modal-overlay">
          <div className="wf-modal">
            <p className="wf-modal-text">Are you sure you want to export this workflow?</p>
            <div className="wf-modal-actions">
              <button className="btn btn--secondary" onClick={() => setShowExportConfirm(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={confirmExport}>Yes, export</button>
            </div>
          </div>
        </div>
      )}

      {hookPopup && (
        <div className="wf-modal-overlay" onClick={() => setHookPopup(null)}>
          <div className="wf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, textAlign: 'left' }}>
            <div className="wf-modal-text">
              <strong>{hookPopup.agentName}</strong> called <strong>{hookPopup.toolName}</strong>
              {hookPopup.nextAgents?.length > 0 && (
                <span> → {hookPopup.nextAgents.map((a) => a.name).join(', ')}</span>
              )}
            </div>
            <div style={{
              background: '#1e1e2e',
              borderRadius: '6px',
              overflow: 'auto',
              maxHeight: '400px',
              margin: '12px 0',
              padding: '4px 0',
            }}>
              {Object.entries(hookPopup.args || {}).map(([key, value]) => (
                <div key={key} style={{
                  display: 'flex',
                  padding: '8px 12px',
                  borderBottom: '1px solid #2a3350',
                }}>
                  <span style={{ color: '#7c8cf8', fontWeight: 600, minWidth: 120, flexShrink: 0, fontSize: '13px' }}>
                    {key}
                  </span>
                  <span style={{ color: '#cdd6f4', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {Array.isArray(value) ? (
                      <ul style={{ margin: 0, paddingLeft: '18px', listStyle: 'disc' }}>
                        {value.map((item, i) => (
                          <li key={i} style={{ marginBottom: '4px' }}>
                            {typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}
                          </li>
                        ))}
                      </ul>
                    ) : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                  </span>
                </div>
              ))}
            </div>
            <div className="wf-modal-actions">
              <button className="btn btn--secondary" onClick={() => setHookPopup(null)}>Close</button>
              <button className="btn btn--primary" onClick={handleAcceptHook}>Accept</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowBuilder;

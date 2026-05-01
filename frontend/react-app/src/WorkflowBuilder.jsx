import React, { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import { generateNodeId } from './utils';
import './WorkflowBuilder.css';

const WorkflowBuilder = () => {
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionMode, setConnectionMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [deleteConnBtnPos, setDeleteConnBtnPos] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState(null);
  const draggedType = useRef(null);

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

  // Sidebar drag start
  const handleSidebarDragStart = useCallback((agent) => {
    draggedType.current = agent;
  }, []);

  // Canvas drop - create new node
  const handleDrop = useCallback((agentId, agentName, x, y) => {
    if (!agentId || !agentName) {
      draggedType.current = null;
      return;
    }

    const newNode = {
      id: generateNodeId(),
      agentId,
      agentName,
      x: x - 55, // Center the node on drop position
      y: y - 40,
    };

    setNodes((prev) => [...prev, newNode]);
    setUndoStack((prev) => [...prev, { action: 'add-node', nodeId: newNode.id }]);
    draggedType.current = null;
  }, []);

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

  // Delete node
  const handleDeleteNode = useCallback((nodeId) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.from !== nodeId && c.to !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  // Node click (for connection mode)
  const handleNodeClick = useCallback((nodeId) => {
    if (!connectionMode) return;

    if (selectedNodeId && selectedNodeId !== nodeId) {
      // Create connection
      const newConn = {
        from: selectedNodeId,
        fromSide: 'right',
        to: nodeId,
        toSide: 'left',
      };

      // Check if connection already exists
      const exists = connections.some(
        (c) =>
          c.from === newConn.from &&
          c.fromSide === newConn.fromSide &&
          c.to === newConn.to &&
          c.toSide === newConn.toSide
      );

      if (!exists) {
        setConnections((prev) => [...prev, newConn]);
        setUndoStack((prev) => [...prev, { action: 'add-connection', ...newConn }]);
      }

      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(nodeId);
    }
  }, [connectionMode, selectedNodeId, connections]);

  // Handle drag start (for connections via handles)
  const handleHandleDragStart = useCallback((fromNodeId, fromSide, toNodeId, toSide) => {
    const newConn = {
      from: fromNodeId,
      fromSide,
      to: toNodeId,
      toSide,
    };

    // Check if connection already exists
    const exists = connections.some(
      (c) =>
        c.from === newConn.from &&
        c.fromSide === newConn.fromSide &&
        c.to === newConn.to &&
        c.toSide === newConn.toSide
    );

    if (!exists) {
      setConnections((prev) => [...prev, newConn]);
      setUndoStack((prev) => [...prev, { action: 'add-connection', ...newConn }]);
    }
  }, [connections]);

  // Connection click
  const handleConnectionClick = useCallback((conn, midpoint) => {
    setSelectedConnection(conn);
    setDeleteConnBtnPos(midpoint);
  }, []);

  // Delete connection
  const handleDeleteConnection = useCallback((conn) => {
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
  }, []);

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
    if (undoStack.length === 0) return;

    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));

    if (lastAction.action === 'add-node') {
      handleDeleteNode(lastAction.nodeId);
    } else if (lastAction.action === 'add-connection') {
      handleDeleteConnection({
        from: lastAction.from,
        fromSide: lastAction.fromSide,
        to: lastAction.to,
        toSide: lastAction.toSide,
      });
    }
  }, [undoStack, handleDeleteNode, handleDeleteConnection]);

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
    setNodes([]);
    setConnections([]);
    setUndoStack([]);
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
  }, []);

  return (
    <div className="wf-shell">
      <Header
        connectionMode={connectionMode}
        canUndo={undoStack.length > 0}
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
          onDragStart={handleSidebarDragStart} 
        />
        <Canvas
          nodes={nodes}
          connections={connections}
          connectionMode={connectionMode}
          selectedNodeId={selectedNodeId}
          onDrop={handleDrop}
          onDeleteNode={handleDeleteNode}
          onNodeDragMove={handleNodeDragMove}
          onHandleDragStart={handleHandleDragStart}
          onNodeClick={handleNodeClick}
          onConnectionClick={handleConnectionClick}
          onDeleteConnection={handleDeleteConnection}
          onCanvasClick={handleCanvasClick}
        />
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

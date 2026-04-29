import React, { useState, useCallback, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import { VALID_TYPES, NODE_META } from './constants';
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
  const draggedType = useRef(null);

  // Sidebar drag start
  const handleSidebarDragStart = useCallback((type) => {
    draggedType.current = type;
  }, []);

  // Canvas drop - create new node
  const handleDrop = useCallback((type, x, y) => {
    if (!VALID_TYPES.includes(type)) {
      draggedType.current = null;
      return;
    }

    const newNode = {
      id: generateNodeId(),
      type,
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

  // Export schema
  const handleExport = useCallback(() => {
    const schema = {
      components: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
      })),
      connections: connections.map((c) => ({
        from: c.from,
        fromSide: c.fromSide,
        to: c.to,
        toSide: c.toSide,
      })),
    };

    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'workflow-schema.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [nodes, connections]);

  // Import schema
  const handleImport = useCallback((schema) => {
    // Validation
    if (
      typeof schema !== 'object' ||
      schema === null ||
      !Array.isArray(schema.components) ||
      !Array.isArray(schema.connections)
    ) {
      alert('Invalid workflow file: must contain "components" and "connections" arrays.');
      return;
    }

    const SIDES = ['left', 'right'];

    // Validate components
    for (const comp of schema.components) {
      if (
        typeof comp.id !== 'string' ||
        typeof comp.type !== 'string' ||
        typeof comp.x !== 'number' ||
        typeof comp.y !== 'number'
      ) {
        alert(
          'Invalid workflow file: each component must have string "id", string "type", number "x", and number "y".'
        );
        return;
      }
      if (!VALID_TYPES.includes(comp.type)) {
        alert(`Invalid workflow file: unknown component type "${comp.type}".`);
        return;
      }
    }

    // Validate connections
    const compIds = new Set(schema.components.map((c) => c.id));
    for (const conn of schema.connections) {
      if (
        typeof conn.from !== 'string' ||
        typeof conn.fromSide !== 'string' ||
        typeof conn.to !== 'string' ||
        typeof conn.toSide !== 'string'
      ) {
        alert(
          'Invalid workflow file: each connection must have string "from", "fromSide", "to", and "toSide".'
        );
        return;
      }
      if (!SIDES.includes(conn.fromSide) || !SIDES.includes(conn.toSide)) {
        alert('Invalid workflow file: connection sides must be "left" or "right".');
        return;
      }
      if (!compIds.has(conn.from) || !compIds.has(conn.to)) {
        alert('Invalid workflow file: connection references an unknown component id.');
        return;
      }
    }

    // Clear and load
    setNodes(schema.components);
    setConnections(schema.connections);
    setUndoStack([]);
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
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
        <Sidebar onDragStart={handleSidebarDragStart} />
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

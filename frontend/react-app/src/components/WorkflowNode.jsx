import React, { useRef, useCallback } from 'react';

const WorkflowNode = ({
  node,
  isSelected,
  connectionMode,
  onDelete,
  onDragMove,
  onHandleDragStart,
  onNodeClick
}) => {
  const nodeRef = useRef(null);
  const dragState = useRef({ isDragging: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 });

  const handleMouseDown = useCallback((e) => {
    // Ignore if clicking delete button or handle
    if (e.target.classList.contains('wf-node-delete') ||
        e.target.classList.contains('wf-handle')) {
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    const state = dragState.current;
    state.isDragging = true;
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.initLeft = nodeRef.current.offsetLeft;
    state.initTop = nodeRef.current.offsetTop;

    if (connectionMode && onNodeClick) {
      onNodeClick(node.id);
    }

    const handleMouseMove = (ev) => {
      if (!state.isDragging) return;
      
      const deltaX = ev.clientX - state.startX;
      const deltaY = ev.clientY - state.startY;
      const newLeft = state.initLeft + deltaX;
      const newTop = state.initTop + deltaY;

      onDragMove(node.id, newLeft, newTop);
    };

    const handleMouseUp = () => {
      state.isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [node.id, connectionMode, onNodeClick, onDragMove]);

  const handleHandleMouseDown = useCallback((e, side) => {
    e.stopPropagation();
    e.preventDefault();
    onHandleDragStart(node.id, side);
  }, [node.id, onHandleDragStart]);

  const isArtefact = node.type === 'artefact';
  const nodeIcon = isArtefact
    ? (node.artefactType === 'if' ? '◇' : '☰')
    : '🤖';
  const nodeLabel = isArtefact ? node.label : node.agentName;

  return (
    <div
      ref={nodeRef}
      className={`wf-node ${isArtefact ? `wf-node--artefact wf-node--${node.artefactType}` : ''} ${isSelected ? 'selected' : ''}`}
      style={{ left: `${node.x}px`, top: `${node.y}px` }}
      data-id={node.id}
      data-agent-id={node.agentId}
      onMouseDown={handleMouseDown}
    >
      <button
        className="wf-node-delete"
        title="Remove"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(node.id);
        }}
      >
        ×
      </button>
      <div className={`wf-node-icon ${isArtefact ? 'wf-node-icon--artefact' : ''}`}>
        {nodeIcon}
      </div>
      <div className="wf-node-label">{nodeLabel}</div>
      <div
        className="wf-handle left"
        data-side="left"
        onMouseDown={(e) => handleHandleMouseDown(e, 'left')}
      />
      <div
        className="wf-handle right"
        data-side="right"
        onMouseDown={(e) => handleHandleMouseDown(e, 'right')}
      />
    </div>
  );
};

export default WorkflowNode;

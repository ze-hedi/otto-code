import React, { useRef, useCallback } from 'react';
import NodeShape from './workflow/NodeShape';

const WorkflowNode = ({
  node,
  isSelected,
  connectionMode,
  onDelete,
  onDragStart,
  onDragMove,
  onHandleDragStart,
  onNodeClick,
  getScale
}) => {
  const nodeRef  = useRef(null);
  const dragState = useRef({ isDragging: false, startX: 0, startY: 0, initLeft: 0, initTop: 0, snapshotSaved: false });

  const handleMouseDown = useCallback((e) => {
    if (e.target.classList.contains('wf-node-delete') ||
        e.target.classList.contains('wf-handle')) {
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    const state = dragState.current;
    state.isDragging    = true;
    state.snapshotSaved = false;
    state.startX        = e.clientX;
    state.startY        = e.clientY;
    state.initLeft      = nodeRef.current.offsetLeft;
    state.initTop       = nodeRef.current.offsetTop;

    if (connectionMode && onNodeClick) {
      onNodeClick(node.id);
    }

    const handleMouseMove = (ev) => {
      if (!state.isDragging) return;
      if (!state.snapshotSaved) {
        state.snapshotSaved = true;
        onDragStart?.(node.id);
      }
      const scale = getScale?.() ?? 1;
      onDragMove(
        node.id,
        state.initLeft + (ev.clientX - state.startX) / scale,
        state.initTop  + (ev.clientY - state.startY) / scale
      );
    };

    const handleMouseUp = () => {
      state.isDragging = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup',   handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup',   handleMouseUp);
  }, [node.id, connectionMode, onNodeClick, onDragStart, onDragMove, getScale]);

  const handleHandleMouseDown = useCallback((e, side) => {
    e.stopPropagation();
    e.preventDefault();
    onHandleDragStart(node.id, side);
  }, [node.id, onHandleDragStart]);

  return (
    <div
      ref={nodeRef}
      className={`wf-node wf-node--${node.type} ${isSelected ? 'selected' : ''}`}
      style={{ left: `${node.x}px`, top: `${node.y}px` }}
      data-id={node.id}
      data-agent-id={node.agentId}
      onMouseDown={handleMouseDown}
    >
      <NodeShape
        node={node}
        onDelete={onDelete}
        onHandleMouseDown={handleHandleMouseDown}
      />
    </div>
  );
};

export default WorkflowNode;

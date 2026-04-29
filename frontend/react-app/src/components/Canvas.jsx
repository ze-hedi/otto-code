import React, { useRef, useEffect, useState, useCallback } from 'react';
import WorkflowNode from './WorkflowNode';
import { ensureSVGDefs, getHandlePos, bezierPath, pathMidpoint } from '../utils';

const Canvas = ({
  nodes,
  connections,
  connectionMode,
  selectedNodeId,
  onDrop,
  onDeleteNode,
  onNodeDragMove,
  onHandleDragStart,
  onNodeClick,
  onConnectionClick,
  onDeleteConnection,
  onCanvasClick,
  onUpdateConnections
}) => {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [linkingState, setLinkingState] = useState(null);
  const [deleteConnBtn, setDeleteConnBtn] = useState(null);

  // Initialize SVG defs on mount
  useEffect(() => {
    if (svgRef.current) {
      ensureSVGDefs(svgRef.current);
    }
  }, []);

  // Handle drop zone events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDropInternal = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const type = e.dataTransfer.getData('text/plain');
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    onDrop(type, x, y);
  };

  // Handle canvas background click
  const handleCanvasClick = (e) => {
    if (e.target === canvasRef.current ||
        e.target.classList.contains('wf-grid') ||
        e.target.classList.contains('wf-drop-zone')) {
      onCanvasClick();
    }
  };

  // Handle linking
  const handleHandleDragStartInternal = useCallback((nodeId, side) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setLinkingState({ fromNodeId: nodeId, fromSide: side });

    const handleMouseMove = (ev) => {
      if (svgRef.current && canvasRef.current) {
        const nodeEl = canvasRef.current.querySelector(`[data-id="${nodeId}"]`);
        if (!nodeEl) return;

        const canvasRect = canvasRef.current.getBoundingClientRect();
        const { x: fx, y: fy } = getHandlePos(nodeEl, side, canvasRect);
        const tx = ev.clientX - canvasRect.left;
        const ty = ev.clientY - canvasRect.top;

        // Draw temp line
        let tempLine = svgRef.current.querySelector('.wf-arrow-temp');
        if (!tempLine) {
          tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          tempLine.setAttribute('class', 'wf-arrow wf-arrow-temp');
          tempLine.setAttribute('pointer-events', 'none');
          tempLine.setAttribute('stroke-dasharray', '5,4');
          svgRef.current.appendChild(tempLine);
        }
        tempLine.setAttribute('d', bezierPath(fx, fy, tx, ty, side, 'left'));
      }
    };

    const handleMouseUp = (ev) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // Remove temp line
      const tempLine = svgRef.current?.querySelector('.wf-arrow-temp');
      if (tempLine) tempLine.remove();

      // Find target
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      let toNodeId = null;
      let toSide = 'left';

      if (target) {
        if (target.classList.contains('wf-handle')) {
          const toNodeEl = target.closest('.wf-node');
          if (toNodeEl) {
            toNodeId = toNodeEl.dataset.id;
            toSide = target.dataset.side;
          }
        } else {
          const toNodeEl = target.closest('.wf-node');
          if (toNodeEl) {
            toNodeId = toNodeEl.dataset.id;
            toSide = 'left';
          }
        }
      }

      if (toNodeId && toNodeId !== nodeId) {
        onHandleDragStart(nodeId, side, toNodeId, toSide);
      }

      setLinkingState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [nodes, onHandleDragStart]);

  // Draw connections
  useEffect(() => {
    if (!svgRef.current || !canvasRef.current) return;

    // Clear existing arrows (except temp)
    const existingArrows = svgRef.current.querySelectorAll('.wf-arrow:not(.wf-arrow-temp)');
    existingArrows.forEach(arrow => arrow.remove());

    // Draw all connections
    connections.forEach((conn) => {
      const fromNode = nodes.find(n => n.id === conn.from);
      const toNode = nodes.find(n => n.id === conn.to);
      if (!fromNode || !toNode) return;

      const fromEl = canvasRef.current.querySelector(`[data-id="${conn.from}"]`);
      const toEl = canvasRef.current.querySelector(`[data-id="${conn.to}"]`);
      if (!fromEl || !toEl) return;

      const canvasRect = canvasRef.current.getBoundingClientRect();
      const { x: fx, y: fy } = getHandlePos(fromEl, conn.fromSide, canvasRect);
      const { x: tx, y: ty } = getHandlePos(toEl, conn.toSide, canvasRect);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'wf-arrow');
      path.setAttribute('data-from', conn.from);
      path.setAttribute('data-fside', conn.fromSide);
      path.setAttribute('data-to', conn.to);
      path.setAttribute('data-tside', conn.toSide);
      path.setAttribute('d', bezierPath(fx, fy, tx, ty, conn.fromSide, conn.toSide));
      path.setAttribute('pointer-events', 'stroke');

      path.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onConnectionClick(conn, { x: (fx + tx) / 2, y: (fy + ty) / 2 });
      });

      svgRef.current.appendChild(path);
    });
  }, [nodes, connections, onConnectionClick]);

  return (
    <div className="wf-canvas" ref={canvasRef} onClick={handleCanvasClick}>
      <div className="wf-grid"></div>
      <svg className="wf-svg" ref={svgRef}></svg>
      <div
        className={`wf-drop-zone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDropInternal}
      >
        {nodes.length === 0 && (
          <div className="wf-empty-hint">
            <i className="bi bi-diagram-3"></i>
            <span>Drag components from the left to start</span>
          </div>
        )}
      </div>
      
      {nodes.map((node) => (
        <WorkflowNode
          key={node.id}
          node={node}
          isSelected={selectedNodeId === node.id}
          connectionMode={connectionMode}
          onDelete={onDeleteNode}
          onDragMove={onNodeDragMove}
          onHandleDragStart={handleHandleDragStartInternal}
          onNodeClick={onNodeClick}
        />
      ))}
    </div>
  );
};

export default Canvas;

import React, { useRef, useEffect, useState, useCallback } from 'react';
import WorkflowNode from './WorkflowNode';
import { ensureSVGDefs, getHandlePosFromState, bezierPath } from '../utils';

const Canvas = ({
  nodes,
  connections,
  connectionMode,
  selectedNodeId,
  onDrop,
  onDeleteNode,
  onNodeDragStart,
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
  const viewportRef = useRef(null);
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const [isDragOver, setIsDragOver] = useState(false);
  const [, setLinkingState] = useState(null);

  // Initialize SVG defs on mount
  useEffect(() => {
    if (svgRef.current) {
      ensureSVGDefs(svgRef.current);
    }
  }, []);

  // Wheel zoom — zoom toward cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const oldScale = viewRef.current.scale;
      const newScale = Math.min(3, Math.max(0.15, oldScale * factor));
      const ratio = newScale / oldScale;

      viewRef.current.scale = newScale;
      viewRef.current.x = cursorX + (viewRef.current.x - cursorX) * ratio;
      viewRef.current.y = cursorY + (viewRef.current.y - cursorY) * ratio;

      viewportRef.current.style.transform =
        `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${newScale})`;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const getScale = useCallback(() => viewRef.current.scale, []);

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

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - viewRef.current.x) / viewRef.current.scale;
      const y = (e.clientY - rect.top  - viewRef.current.y) / viewRef.current.scale;

      if (data.nodeType === 'artefact' && data.artefactType) {
        onDrop(data, x, y);
      } else if (data.nodeType === 'tool' && data.toolId) {
        onDrop(data, x, y);
      } else if (data.agentId && data.agentName) {
        onDrop(data, x, y);
      }
    } catch (error) {
      console.error('Invalid drop data:', error);
    }
  };

  // Canvas background mousedown — starts a pan or fires a click
  const handleCanvasMouseDown = useCallback((e) => {
    if (e.button !== 0) return;

    const isBackground =
      e.target === canvasRef.current ||
      e.target === viewportRef.current ||
      e.target.classList.contains('wf-grid') ||
      e.target.classList.contains('wf-drop-zone');

    if (!isBackground) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = viewRef.current.x;
    const startPanY = viewRef.current.y;
    let hasMoved = false;

    canvasRef.current.classList.add('is-panning');

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!hasMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      hasMoved = true;
      viewRef.current.x = startPanX + dx;
      viewRef.current.y = startPanY + dy;
      viewportRef.current.style.transform =
        `translate(${viewRef.current.x}px, ${viewRef.current.y}px) scale(${viewRef.current.scale})`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      canvasRef.current.classList.remove('is-panning');
      if (!hasMoved) onCanvasClick();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [onCanvasClick]);

  // Handle linking
  const handleHandleDragStartInternal = useCallback((nodeId, side) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setLinkingState({ fromNodeId: nodeId, fromSide: side });

    const handleMouseMove = (ev) => {
      if (svgRef.current && canvasRef.current) {
        // Source position: pure state math, no DOM query
        const { x: fx, y: fy } = getHandlePosFromState(node, side);

        // Cursor position: convert screen → viewport space
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const { x: vx, y: vy, scale } = viewRef.current;
        const tx = (ev.clientX - canvasRect.left - vx) / scale;
        const ty = (ev.clientY - canvasRect.top  - vy) / scale;

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
        // Top and bottom handles on agents are tool-link ports — only connect to tool nodes
        if (side === 'top' || side === 'bottom') {
          const toNode = nodes.find(n => n.id === toNodeId);
          if (!toNode || toNode.type !== 'tool') {
            setLinkingState(null);
            return;
          }
          onHandleDragStart(nodeId, side, toNodeId, toSide, 'tool-link');
        } else {
          onHandleDragStart(nodeId, side, toNodeId, toSide);
        }
      }

      setLinkingState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [nodes, onHandleDragStart]);

  // Draw connections
  useEffect(() => {
    if (!svgRef.current) return;

    // Clear existing arrows (except temp)
    const existingArrows = svgRef.current.querySelectorAll('.wf-arrow:not(.wf-arrow-temp)');
    existingArrows.forEach(arrow => arrow.remove());

    // Draw all connections — positions computed from state, no DOM queries
    connections.forEach((conn) => {
      const fromNode = nodes.find(n => n.id === conn.from);
      const toNode = nodes.find(n => n.id === conn.to);
      if (!fromNode || !toNode) return;

      const { x: fx, y: fy } = getHandlePosFromState(fromNode, conn.fromSide);
      const { x: tx, y: ty } = getHandlePosFromState(toNode, conn.toSide);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const arrowClass = conn.linkType === 'tool-link' ? 'wf-arrow wf-arrow--tool-link' : 'wf-arrow';
      path.setAttribute('class', arrowClass);
      path.setAttribute('data-from', conn.from);
      path.setAttribute('data-fside', conn.fromSide);
      path.setAttribute('data-to', conn.to);
      path.setAttribute('data-tside', conn.toSide);
      path.setAttribute('d', bezierPath(fx, fy, tx, ty, conn.fromSide, conn.toSide));
      path.setAttribute('pointer-events', 'stroke');

      path.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Convert viewport-space midpoint to canvas space for delete button positioning
        const { x: vx, y: vy, scale } = viewRef.current;
        const midCanvasX = (fx + tx) / 2 * scale + vx;
        const midCanvasY = (fy + ty) / 2 * scale + vy;
        onConnectionClick(conn, { x: midCanvasX, y: midCanvasY });
      });

      svgRef.current.appendChild(path);
    });
  }, [nodes, connections, onConnectionClick]);

  return (
    <div className="wf-canvas" ref={canvasRef} onMouseDown={handleCanvasMouseDown}>
      <div className="wf-viewport" ref={viewportRef}>
        <div className="wf-grid"></div>
        <div
          className={`wf-drop-zone ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDropInternal}
        >
          {nodes.length === 0 && (
            <div className="wf-empty-hint">
              <i className="bi bi-diagram-3"></i>
              <span>Drag agents from the left to start</span>
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
            onDragStart={onNodeDragStart}
            onDragMove={onNodeDragMove}
            onHandleDragStart={handleHandleDragStartInternal}
            onNodeClick={onNodeClick}
            getScale={getScale}
          />
        ))}

        {/* SVG is inside the viewport so it shares the same coordinate space as nodes */}
        <svg className="wf-svg" ref={svgRef}></svg>
      </div>
    </div>
  );
};

export default Canvas;

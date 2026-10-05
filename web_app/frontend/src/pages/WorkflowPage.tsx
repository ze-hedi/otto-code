import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './WorkflowPage.css';

/* ── Types ─────────────────────────────────────────── */

type HandleSide = 'left' | 'right' | 'top' | 'bottom';

interface AgentItem {
  id: string;
  name: string;
  icon: string;
  model: string;
}

interface WorkflowNode {
  id: string;
  type: 'agent' | 'interface';
  x: number;
  y: number;
  agentId: string;
  agentName: string;
  agentIcon: string;
}

interface Connection {
  from: string;
  fromSide: HandleSide;
  to: string;
  toSide: HandleSide;
}

/* ── Hardcoded agents ──────────────────────────────── */

const AGENTS: AgentItem[] = [
  { id: 'analyst',   name: 'Analyst',       icon: '\ud83d\udcca', model: 'claude-sonnet-4-5' },
  { id: 'coder',     name: 'Coder',         icon: '\ud83d\udcbb', model: 'claude-sonnet-4-5' },
  { id: 'reviewer',  name: 'Code Reviewer', icon: '\ud83d\udd0d', model: 'claude-sonnet-4-5' },
  { id: 'writer',    name: 'Tech Writer',   icon: '\u270d\ufe0f',  model: 'claude-haiku-4-5' },
  { id: 'planner',   name: 'Planner',       icon: '\ud83d\udccb', model: 'claude-opus-4-5' },
  { id: 'tester',    name: 'QA Tester',     icon: '\ud83e\uddea', model: 'claude-haiku-4-5' },
];

interface InterfaceItem {
  id: string;
  name: string;
  linkType: string;
  icon: string;
}

const INTERFACES: InterfaceItem[] = [
  { id: 'delegate',    name: 'Delegate',    linkType: 'One → Many', icon: '🔀' },
  { id: 'forward',     name: 'Forward',     linkType: 'One → One',  icon: '➡️' },
  { id: 'accumulate',  name: 'Accumulate',  linkType: 'Many → One', icon: '🔃' },
  { id: 'route',       name: 'Route',       linkType: 'One → One*', icon: '🔂' },
];

/* ── Constants ─────────────────────────────────────── */

const NODE_W = 180;
const NODE_H = 68;
const IFACE_SIZE = 56;

/* ── Bezier path util ──────────────────────────────── */

function getHandlePos(node: WorkflowNode, side: HandleSide) {
  const w = node.type === 'interface' ? IFACE_SIZE : NODE_W;
  const h = node.type === 'interface' ? IFACE_SIZE : NODE_H;
  const cx = node.x + w / 2;
  const cy = node.y + h / 2;
  switch (side) {
    case 'left':   return { x: node.x,      y: cy };
    case 'right':  return { x: node.x + w,  y: cy };
    case 'top':    return { x: cx,           y: node.y };
    case 'bottom': return { x: cx,           y: node.y + h };
  }
}

function bezierPath(
  x1: number, y1: number, x2: number, y2: number,
  fromSide: HandleSide = 'right', toSide: HandleSide = 'left',
) {
  const dx = Math.abs(x2 - x1) * 0.5 + 30;
  const dy = Math.abs(y2 - y1) * 0.5 + 30;
  let c1x = x1, c1y = y1, c2x = x2, c2y = y2;
  switch (fromSide) {
    case 'right':  c1x = x1 + dx; break;
    case 'left':   c1x = x1 - dx; break;
    case 'bottom': c1y = y1 + dy; break;
    case 'top':    c1y = y1 - dy; break;
  }
  switch (toSide) {
    case 'left':   c2x = x2 - dx; break;
    case 'right':  c2x = x2 + dx; break;
    case 'top':    c2y = y2 - dy; break;
    case 'bottom': c2y = y2 + dy; break;
  }
  return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ── Component ─────────────────────────────────────── */

export function WorkflowPage() {
  const navigate = useNavigate();

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Viewport pan & zoom
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Node dragging
  const dragging = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);

  // Connection dragging (handle drag-to-connect)
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const linkingRef = useRef<{ fromNodeId: string; fromSide: HandleSide } | null>(null);

  /* ── Sidebar drag ────────────────────────────────── */

  function onDragStart(e: React.DragEvent, agent: AgentItem) {
    e.dataTransfer.setData('application/json', JSON.stringify(agent));
    e.dataTransfer.effectAllowed = 'copy';
  }

  function onCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const data = JSON.parse(raw);
    const rect = e.currentTarget.getBoundingClientRect();

    if (data.type === 'interface') {
      const x = (e.clientX - rect.left - view.x) / view.scale - IFACE_SIZE / 2;
      const y = (e.clientY - rect.top - view.y) / view.scale - IFACE_SIZE / 2;
      setNodes(prev => [...prev, {
        id: generateId(),
        type: 'interface',
        x, y,
        agentId: data.id,
        agentName: data.name,
        agentIcon: data.icon,
      }]);
    } else {
      const x = (e.clientX - rect.left - view.x) / view.scale - NODE_W / 2;
      const y = (e.clientY - rect.top - view.y) / view.scale - NODE_H / 2;
      setNodes(prev => [...prev, {
        id: generateId(),
        type: 'agent',
        x, y,
        agentId: data.id,
        agentName: data.name,
        agentIcon: data.icon,
      }]);
    }
  }

  /* ── Canvas pan & zoom ───────────────────────────── */

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;

    setView(v => {
      const newScale = Math.min(3, Math.max(0.15, v.scale * factor));
      return {
        scale: newScale,
        x: mx - (mx - v.x) * (newScale / v.scale),
        y: my - (my - v.y) * (newScale / v.scale),
      };
    });
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('wf-viewport')) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - view.x, y: e.clientY - view.y };
      setSelectedNodeId(null);
    }
  }

  const onCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) {
      setView(v => ({ ...v, x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }));
    }
    const drag = dragging.current;
    if (drag) {
      const v = viewRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left - v.x) / v.scale - drag.offsetX;
      const y = (e.clientY - rect.top - v.y) / v.scale - drag.offsetY;
      const nodeId = drag.nodeId;
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, x, y } : n));
    }
  }, []);

  function onCanvasMouseUp() {
    isPanning.current = false;
    dragging.current = null;
  }

  /* ── Handle drag-to-connect ────────────────────────── */

  function onHandleMouseDown(e: React.MouseEvent, nodeId: string, side: HandleSide) {
    e.stopPropagation();
    e.preventDefault();

    const linking = { fromNodeId: nodeId, fromSide: side };
    linkingRef.current = linking;

    // Create temp dashed line in SVG
    const svg = svgRef.current;
    if (!svg) return;
    const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempLine.setAttribute('class', 'wf-arrow wf-arrow-temp');
    tempLine.setAttribute('stroke-dasharray', '5,4');
    tempLine.setAttribute('marker-end', 'url(#arrow)');
    svg.appendChild(tempLine);

    const sourceNode = nodesRef.current.find(n => n.id === nodeId);
    if (!sourceNode) return;
    const fromPos = getHandlePos(sourceNode, side);

    function onMouseMove(ev: MouseEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const canvasRect = canvas.getBoundingClientRect();
      const tx = (ev.clientX - canvasRect.left - v.x) / v.scale;
      const ty = (ev.clientY - canvasRect.top - v.y) / v.scale;
      // Recompute source pos in case node moved
      const srcNode = nodesRef.current.find(n => n.id === linking.fromNodeId);
      if (!srcNode) return;
      const fp = getHandlePos(srcNode, linking.fromSide);
      tempLine.setAttribute('d', bezierPath(fp.x, fp.y, tx, ty, linking.fromSide, 'left'));
    }

    function onMouseUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      linkingRef.current = null;

      // Remove temp line
      tempLine.remove();

      // Find target handle under cursor
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (!el) return;
      const handle = el.closest('.wf-handle') as HTMLElement | null;
      if (!handle) return;
      const toNodeId = handle.getAttribute('data-node-id');
      const toSide = handle.getAttribute('data-side') as HandleSide | null;
      if (!toNodeId || !toSide || toNodeId === nodeId) return;

      setConnections(prev => [...prev, {
        from: nodeId, fromSide: side,
        to: toNodeId, toSide,
      }]);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  /* ── Node interactions ───────────────────────────── */

  function onNodeMouseDown(e: React.MouseEvent, node: WorkflowNode) {
    e.stopPropagation();
    setSelectedNodeId(node.id);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const mx = (e.clientX - canvasRect.left - view.x) / view.scale;
    const my = (e.clientY - canvasRect.top - view.y) / view.scale;
    dragging.current = { nodeId: node.id, offsetX: mx - node.x, offsetY: my - node.y };
  }

  function deleteNode(id: string) {
    setNodes(prev => prev.filter(n => n.id !== id));
    setConnections(prev => prev.filter(c => c.from !== id && c.to !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  }

  function compileWorkflow() {
    const workflowInput = {
      components: nodes.map(n => ({
        id: n.agentId,
        type: n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
      })),
      connections: connections.map(c => {
        const fromNode = nodes.find(n => n.id === c.from);
        const toNode = nodes.find(n => n.id === c.to);
        return {
          from: fromNode?.agentId ?? c.from,
          fromSide: c.fromSide,
          to: toNode?.agentId ?? c.to,
          toSide: c.toSide,
        };
      }),
    };
    console.log('workflowInput', workflowInput);
  }

  /* ── Render ──────────────────────────────────────── */

  return (
    <div className="wf-page">
      {/* Header */}
      <div className="wf-header">
        <button className="wf-header-btn" onClick={() => navigate('/')}>&#8592; Back</button>
        <span className="wf-header-title">Workflow Builder</span>
        <div className="wf-header-actions">
          <button className="wf-header-btn" onClick={compileWorkflow}>
            Compile
          </button>
          <button
            className="wf-header-btn"
            onClick={() => { setNodes([]); setConnections([]); setSelectedNodeId(null); }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="wf-body">
        {/* Sidebar */}
        <div className="wf-sidebar">
          <div className="wf-sidebar-title">Agents</div>
          <div className="wf-sidebar-list">
            {AGENTS.map(a => (
              <div
                key={a.id}
                className="wf-sidebar-item"
                draggable
                onDragStart={e => onDragStart(e, a)}
              >
                <span className="wf-sidebar-icon">{a.icon}</span>
                <div className="wf-sidebar-info">
                  <span className="wf-sidebar-name">{a.name}</span>
                  <span className="wf-sidebar-model">{a.model}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="wf-sidebar-title">Interfaces</div>
          <div className="wf-sidebar-list">
            {INTERFACES.map(iface => (
              <div
                key={iface.id}
                className="wf-sidebar-interface"
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('application/json', JSON.stringify({ ...iface, type: 'interface' }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
              >
                <span className="wf-sidebar-icon">{iface.icon}</span>
                <div className="wf-sidebar-info">
                  <span className="wf-sidebar-name">{iface.name}</span>
                  <span className="wf-sidebar-model">{iface.linkType}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="wf-canvas"
          onDrop={onCanvasDrop}
          onDragOver={e => e.preventDefault()}
          onWheel={onWheel}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
        >
          {/* SVG connections */}
          <svg ref={svgRef} className="wf-svg" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)" />
              </marker>
            </defs>
            {connections.map((c, i) => {
              const fromNode = nodes.find(n => n.id === c.from);
              const toNode = nodes.find(n => n.id === c.to);
              if (!fromNode || !toNode) return null;
              const p1 = getHandlePos(fromNode, c.fromSide);
              const p2 = getHandlePos(toNode, c.toSide);
              return (
                <path
                  key={i}
                  d={bezierPath(p1.x, p1.y, p2.x, p2.y, c.fromSide, c.toSide)}
                  className="wf-arrow"
                  markerEnd="url(#arrow)"
                  onClick={() => setConnections(prev => prev.filter((_, j) => j !== i))}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          <div className="wf-viewport" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
            {nodes.map(node => node.type === 'interface' ? (
              <div
                key={node.id}
                className={`wf-iface-node ${selectedNodeId === node.id ? 'selected' : ''}`}
                style={{ left: node.x, top: node.y, width: IFACE_SIZE, height: IFACE_SIZE }}
                onMouseDown={e => onNodeMouseDown(e, node)}
              >
                <button className="wf-node-delete" onClick={e => { e.stopPropagation(); deleteNode(node.id); }}>x</button>
                <span className="wf-iface-icon">{node.agentIcon}</span>
                <div className="wf-handle wf-handle-left" data-node-id={node.id} data-side="left" onMouseDown={e => onHandleMouseDown(e, node.id, 'left')} />
                <div className="wf-handle wf-handle-right" data-node-id={node.id} data-side="right" onMouseDown={e => onHandleMouseDown(e, node.id, 'right')} />
              </div>
            ) : (
              <div
                key={node.id}
                className={`wf-node ${selectedNodeId === node.id ? 'selected' : ''}`}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                onMouseDown={e => onNodeMouseDown(e, node)}
              >
                <button className="wf-node-delete" onClick={e => { e.stopPropagation(); deleteNode(node.id); }}>x</button>
                <span className="wf-node-icon">{node.agentIcon}</span>
                <span className="wf-node-label">{node.agentName}</span>
                <div className="wf-handle wf-handle-left" data-node-id={node.id} data-side="left" onMouseDown={e => onHandleMouseDown(e, node.id, 'left')} />
                <div className="wf-handle wf-handle-right" data-node-id={node.id} data-side="right" onMouseDown={e => onHandleMouseDown(e, node.id, 'right')} />
              </div>
            ))}

            {nodes.length === 0 && (
              <div className="wf-empty">Drag agents from the sidebar to get started</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

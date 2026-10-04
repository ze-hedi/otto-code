import { useState, useRef, useCallback } from 'react';
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
  type: 'agent';
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

/* ── Constants ─────────────────────────────────────── */

const NODE_W = 180;
const NODE_H = 68;

/* ── Bezier path util ──────────────────────────────── */

function getHandlePos(node: WorkflowNode, side: HandleSide) {
  const cx = node.x + NODE_W / 2;
  const cy = node.y + NODE_H / 2;
  switch (side) {
    case 'left':   return { x: node.x,            y: cy };
    case 'right':  return { x: node.x + NODE_W,   y: cy };
    case 'top':    return { x: cx,                 y: node.y };
    case 'bottom': return { x: cx,                 y: node.y + NODE_H };
  }
}

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
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
  const [connectionMode, setConnectionMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);

  // Viewport pan & zoom
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Node dragging
  const dragging = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);

  /* ── Sidebar drag ────────────────────────────────── */

  function onDragStart(e: React.DragEvent, agent: AgentItem) {
    e.dataTransfer.setData('application/json', JSON.stringify(agent));
    e.dataTransfer.effectAllowed = 'copy';
  }

  function onCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const agent: AgentItem = JSON.parse(raw);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - view.x) / view.scale - NODE_W / 2;
    const y = (e.clientY - rect.top - view.y) / view.scale - NODE_H / 2;

    setNodes(prev => [...prev, {
      id: generateId(),
      type: 'agent',
      x, y,
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
    }]);
  }

  /* ── Canvas pan & zoom ───────────────────────────── */

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(3, Math.max(0.15, view.scale * factor));

    setView(v => ({
      scale: newScale,
      x: mx - (mx - v.x) * (newScale / v.scale),
      y: my - (my - v.y) * (newScale / v.scale),
    }));
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
    if (dragging.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left - view.x) / view.scale - dragging.current.offsetX;
      const y = (e.clientY - rect.top - view.y) / view.scale - dragging.current.offsetY;
      setNodes(prev => prev.map(n => n.id === dragging.current!.nodeId ? { ...n, x, y } : n));
    }
  }, [view]);

  function onCanvasMouseUp() {
    isPanning.current = false;
    dragging.current = null;
  }

  /* ── Node interactions ───────────────────────────── */

  function onNodeMouseDown(e: React.MouseEvent, node: WorkflowNode) {
    e.stopPropagation();
    if (connectionMode) {
      if (!connectSource) {
        setConnectSource(node.id);
      } else if (connectSource !== node.id) {
        setConnections(prev => [...prev, {
          from: connectSource, fromSide: 'right',
          to: node.id, toSide: 'left',
        }]);
        setConnectSource(null);
      }
      return;
    }

    setSelectedNodeId(node.id);
    const rect = (e.currentTarget.parentElement!).getBoundingClientRect();
    dragging.current = {
      nodeId: node.id,
      offsetX: (e.clientX - rect.left) / view.scale - node.x + (view.x / view.scale),
      // simplified: use direct offset
    };
    // Recalculate properly
    const canvasRect = document.querySelector('.wf-canvas')!.getBoundingClientRect();
    const mx = (e.clientX - canvasRect.left - view.x) / view.scale;
    const my = (e.clientY - canvasRect.top - view.y) / view.scale;
    dragging.current = { nodeId: node.id, offsetX: mx - node.x, offsetY: my - node.y };
  }

  function deleteNode(id: string) {
    setNodes(prev => prev.filter(n => n.id !== id));
    setConnections(prev => prev.filter(c => c.from !== id && c.to !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  }

  /* ── Render ──────────────────────────────────────── */

  return (
    <div className="wf-page">
      {/* Header */}
      <div className="wf-header">
        <button className="wf-header-btn" onClick={() => navigate('/')}>&#8592; Back</button>
        <span className="wf-header-title">Workflow Builder</span>
        <div className="wf-header-actions">
          <button
            className={`wf-header-btn ${connectionMode ? 'active' : ''}`}
            onClick={() => { setConnectionMode(!connectionMode); setConnectSource(null); }}
          >
            {connectionMode ? 'Connecting...' : 'Connect'}
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
        </div>

        {/* Canvas */}
        <div
          className={`wf-canvas ${connectionMode ? 'connect-mode' : ''}`}
          onDrop={onCanvasDrop}
          onDragOver={e => e.preventDefault()}
          onWheel={onWheel}
          onMouseDown={onCanvasMouseDown}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
        >
          {/* SVG connections */}
          <svg className="wf-svg" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
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
                  d={bezierPath(p1.x, p1.y, p2.x, p2.y)}
                  className="wf-arrow"
                  markerEnd="url(#arrow)"
                  onClick={() => setConnections(prev => prev.filter((_, j) => j !== i))}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          <div className="wf-viewport" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
            {nodes.map(node => (
              <div
                key={node.id}
                className={`wf-node ${selectedNodeId === node.id ? 'selected' : ''} ${connectSource === node.id ? 'connect-source' : ''}`}
                style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
                onMouseDown={e => onNodeMouseDown(e, node)}
              >
                <button className="wf-node-delete" onClick={e => { e.stopPropagation(); deleteNode(node.id); }}>x</button>
                <span className="wf-node-icon">{node.agentIcon}</span>
                <span className="wf-node-label">{node.agentName}</span>
                {/* Handles */}
                <div className="wf-handle wf-handle-left" />
                <div className="wf-handle wf-handle-right" />
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

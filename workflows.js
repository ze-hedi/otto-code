/* ── State ───────────────────────────────────────────────────── */
let draggedType      = null;
let droppedNodes     = [];       // { id, type, element }
let connections      = [];       // { from, fromSide, to, toSide, fromEl, toEl }
let selectedNode     = null;
let selectedConn     = null;
let deleteConnBtn    = null;
let connectionMode   = false;
let undoStack        = [];

// linking via handle drag
let linkingFrom     = null;   // element
let linkingFromSide = null;   // 'left' | 'right'
let linkingLine     = null;   // SVG path (temp)

/* ── Valid types & metadata ──────────────────────────────────── */
const VALID_TYPES = [
  'web-app','mobile-app','spa',
  'api','microservice','server','lambda',
  'database','cache','queue',
  'load-balancer','cdn','firewall'
];

const NODE_META = {
  'web-app':      { icon: '🌐', label: 'Web App' },
  'mobile-app':   { icon: '📱', label: 'Mobile App' },
  'spa':          { icon: '⚛️',  label: 'SPA' },
  'api':          { icon: '🔌', label: 'REST API' },
  'microservice': { icon: '🧩', label: 'Microservice' },
  'server':       { icon: '🖥️', label: 'Server' },
  'lambda':       { icon: '⚡', label: 'Lambda' },
  'database':     { icon: '🗄️', label: 'Database' },
  'cache':        { icon: '💾', label: 'Cache' },
  'queue':        { icon: '📬', label: 'Message Queue' },
  'load-balancer':{ icon: '⚖️', label: 'Load Balancer' },
  'cdn':          { icon: '🌍', label: 'CDN' },
  'firewall':     { icon: '🛡️', label: 'Firewall' },
};

/* ── DOM refs (resolved after DOMContentLoaded) ──────────────── */
let canvas, dropZone, svg, emptyHint, undoBtn, connectBtn;

/* ── SVG defs (arrowhead + gradient) ────────────────────────── */
function ensureSVGDefs() {
  if (svg.querySelector('defs')) return;
  const ns   = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');

  // arrowhead marker
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id',          'wf-arrowhead');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight','6');
  marker.setAttribute('refX',        '8');
  marker.setAttribute('refY',        '3');
  marker.setAttribute('orient',      'auto');
  marker.setAttribute('markerUnits', 'strokeWidth');
  const arrowPoly = document.createElementNS(ns, 'polygon');
  arrowPoly.setAttribute('points', '0 0, 8 3, 0 6');
  arrowPoly.setAttribute('fill',   '#4f46e5');
  marker.appendChild(arrowPoly);
  defs.appendChild(marker);

  svg.appendChild(defs);
}

/* ── Undo ────────────────────────────────────────────────────── */
function pushUndo(op) {
  undoStack.push(op);
  syncUndoBtn();
}

function syncUndoBtn() {
  if (!undoBtn) return;
  undoBtn.disabled = undoStack.length === 0;
}

function undoLastAction() {
  if (!undoStack.length) return;
  const op = undoStack.pop();

  if (op.action === 'add-node') {
    const entry = droppedNodes.find(n => n.id === op.nodeId);
    if (entry) _removeNode(entry);
  } else if (op.action === 'add-connection') {
    _removeConnection(op.from, op.fromSide, op.to, op.toSide);
  }
  syncUndoBtn();
}

/* ── Drop zone drag events ───────────────────────────────────── */
function initDropZone() {
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const type = draggedType || e.dataTransfer.getData('text/plain');
    if (!VALID_TYPES.includes(type)) { draggedType = null; return; }

    const rect = canvas.getBoundingClientRect();
    createNode(type, e.clientX - rect.left, e.clientY - rect.top);
    pushUndo({ action: 'add-node', nodeId: droppedNodes[droppedNodes.length - 1].id });
    draggedType = null;
    syncEmptyHint();
  });
}

/* ── Sidebar component drag ──────────────────────────────────── */
function initPaletteItems() {
  document.querySelectorAll('.wf-component').forEach(el => {
    el.addEventListener('dragstart', e => {
      const type = e.currentTarget.dataset.type;
      if (!VALID_TYPES.includes(type)) return;
      e.dataTransfer.setData('text/plain', type);
      draggedType = type;
    });
  });
}

/* ── Node creation ───────────────────────────────────────────── */
/* ── Shared node interaction wiring ──────────────────────────── */
function _wireNodeInteractions(el, id) {
  // delete button
  el.querySelector('.wf-node-delete').addEventListener('click', e => {
    e.stopPropagation();
    const entry = droppedNodes.find(n => n.id === id);
    if (entry) _removeNode(entry);
    syncEmptyHint();
  });

  // node drag (move on canvas)
  let isDragging = false, startX, startY, initLeft, initTop, rafId = null, lastEv = null;

  el.addEventListener('mousedown', e => {
    if (e.target.classList.contains('wf-node-delete') ||
        e.target.classList.contains('wf-handle')) return;
    if (e.button !== 0) return;
    e.preventDefault();

    isDragging = true;
    startX   = e.clientX;
    startY   = e.clientY;
    initLeft = el.offsetLeft;
    initTop  = el.offsetTop;

    if (connectionMode) {
      selectNode(el);
    } else {
      clearSelection();
    }

    function onMove(ev) {
      if (!isDragging) return;
      console.log("on move ") 
      console.log(ev)
      lastEv = ev;
      if (!rafId) rafId = requestAnimationFrame(applyMove);
    }

    function applyMove() {
      rafId = null;
      if (!isDragging || !lastEv) return;
      const r = canvas.getBoundingClientRect();
      const nl = Math.max(0, Math.min(initLeft + lastEv.clientX - startX, r.width  - el.offsetWidth));
      const nt = Math.max(0, Math.min(initTop  + lastEv.clientY - startY, r.height - el.offsetHeight));
      el.style.left = nl + 'px';
      el.style.top  = nt + 'px';
      updateAllConnections();
    }

    function onUp() {
      isDragging = false;
      lastEv = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // handle drag (linking)
  el.querySelectorAll('.wf-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      const side = handle.dataset.side;
      startLinking(el, side, handle);
    });
  });

}

function createNode(type, x, y) {
  const meta = NODE_META[type] || { icon: '📦', label: type };
  const id   = String(Date.now() + Math.floor(Math.random() * 9999));

  console.log("creating node !! "); 

  const el = document.createElement('div');
  el.className    = 'wf-node';
  el.style.left   = (x - 55) + 'px';
  el.style.top    = (y - 40) + 'px';
  el.dataset.id   = id;
  el.dataset.type = type;

  el.innerHTML = `
    <button class="wf-node-delete" title="Remove">×</button>
    <div class="wf-node-icon">${meta.icon}</div>
    <div class="wf-node-label">${meta.label}</div>
    <div class="wf-handle left"  data-side="left"></div>
    <div class="wf-handle right" data-side="right"></div>
  `;

  _wireNodeInteractions(el, id);

  canvas.appendChild(el);
  droppedNodes.push({ id, type, element: el });
}

/* ── Link handle drag ────────────────────────────────────────── */
function startLinking(fromEl, fromSide, handle) {
  linkingFrom     = fromEl;
  linkingFromSide = fromSide;
  handle.classList.add('active');

  if (linkingLine) { linkingLine.remove(); linkingLine = null; }
  linkingLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  linkingLine.setAttribute('class', 'wf-arrow');
  linkingLine.setAttribute('pointer-events', 'none');
  linkingLine.setAttribute('stroke-dasharray', '5,4');
  svg.appendChild(linkingLine);

  function onMove(ev) {
    drawTempArrow(fromEl, fromSide, ev.clientX, ev.clientY);
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);

    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    let toEl = null, toSide = 'left';

    if (target) {
      if (target.classList.contains('wf-handle')) {
        toEl   = target.closest('.wf-node');
        toSide = target.dataset.side;
      } else {
        let cur = target;
        while (cur && cur !== document.body) {
          if (cur.classList && cur.classList.contains('wf-node')) { toEl = cur; break; }
          cur = cur.parentElement;
        }
        toSide = 'left';
      }
    }

    if (toEl && toEl !== fromEl) {
      createConnection(fromEl, fromSide, toEl, toSide);
      pushUndo({
        action:   'add-connection',
        from:     fromEl.dataset.id,
        fromSide: fromSide,
        to:       toEl.dataset.id,
        toSide:   toSide,
      });
    }

    if (linkingLine) { linkingLine.remove(); linkingLine = null; }
    linkingFrom     = null;
    linkingFromSide = null;
    handle.classList.remove('active');
    handle.style.display = '';
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function drawTempArrow(fromEl, fromSide, mouseX, mouseY) {
  if (!linkingLine) return;
  const { x: fx, y: fy } = getHandlePos(fromEl, fromSide);
  const cr = canvas.getBoundingClientRect();
  const tx = mouseX - cr.left;
  const ty = mouseY - cr.top;
  linkingLine.setAttribute('d', bezierPath(fx, fy, tx, ty, fromSide, 'left'));
}

/* ── Connection management ───────────────────────────────────── */
function createConnection(fromEl, fromSide, toEl, toSide) {
  const fromId = fromEl.dataset.id;
  const toId   = toEl.dataset.id;
  if (connections.some(c =>
    c.from === fromId && c.fromSide === fromSide &&
    c.to   === toId   && c.toSide   === toSide
  )) return;

  connections.push({ from: fromId, fromSide, to: toId, toSide, fromEl, toEl });
  drawConnection(connections[connections.length - 1]);
}

function drawConnection(conn) {
  ensureSVGDefs();
  const ns   = 'http://www.w3.org/2000/svg';
  const old  = svg.querySelector(connSelector(conn));
  if (old) old.remove();

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class',       'wf-arrow');
  path.setAttribute('data-from',   conn.from);
  path.setAttribute('data-fside',  conn.fromSide);
  path.setAttribute('data-to',     conn.to);
  path.setAttribute('data-tside',  conn.toSide);
  path.setAttribute('fill',        'none');
  path.setAttribute('pointer-events', 'stroke');
  svg.appendChild(path);

  updateArrow(path, conn);

  path.addEventListener('mousedown', e => {
    e.stopPropagation();
    e.preventDefault();
    selectConnection(path, conn);
  });
}

function updateArrow(path, conn) {
  const { x: fx, y: fy } = getHandlePos(conn.fromEl, conn.fromSide);
  const { x: tx, y: ty } = getHandlePos(conn.toEl,   conn.toSide);
  path.setAttribute('d', bezierPath(fx, fy, tx, ty, conn.fromSide, conn.toSide));

  if (selectedConn === path && deleteConnBtn) {
    const mid = pathMidpoint(fx, fy, tx, ty);
    deleteConnBtn.style.left = (mid.x - 11) + 'px';
    deleteConnBtn.style.top  = (mid.y - 11) + 'px';
  }
}

function updateAllConnections() {
  connections.forEach(conn => {
    console.log("rewrite connections ")
    console.log(conn)
    const path = svg.querySelector(connSelector(conn));
    if (path) updateArrow(path, conn);
  });
}

function connSelector(conn) {
  return `.wf-arrow[data-from="${conn.from}"][data-fside="${conn.fromSide}"][data-to="${conn.to}"][data-tside="${conn.toSide}"]`;
}

/* ── Connection selection ────────────────────────────────────── */
function selectConnection(path, conn) {
  clearConnectionSelection();
  selectedConn = path;
  path.classList.add('selected');

  const { x: fx, y: fy } = getHandlePos(conn.fromEl, conn.fromSide);
  const { x: tx, y: ty } = getHandlePos(conn.toEl,   conn.toSide);
  const mid = pathMidpoint(fx, fy, tx, ty);

  deleteConnBtn = document.createElement('button');
  deleteConnBtn.className   = 'wf-delete-conn';
  deleteConnBtn.textContent = '×';
  deleteConnBtn.style.left  = (mid.x - 11) + 'px';
  deleteConnBtn.style.top   = (mid.y - 11) + 'px';
  canvas.appendChild(deleteConnBtn);

  deleteConnBtn.addEventListener('click', e => {
    e.stopPropagation();
    _removeConnection(conn.from, conn.fromSide, conn.to, conn.toSide);
  });
}

function clearConnectionSelection() {
  if (selectedConn) { selectedConn.classList.remove('selected'); selectedConn = null; }
  if (deleteConnBtn) { deleteConnBtn.remove(); deleteConnBtn = null; }
}

/* ── Node selection (connection-mode click) ──────────────────── */
function selectNode(el) {
  if (selectedNode && selectedNode !== el) {
    createConnection(selectedNode, 'right', el, 'left');
    pushUndo({
      action: 'add-connection',
      from: selectedNode.dataset.id, fromSide: 'right',
      to:   el.dataset.id,           toSide:   'left',
    });
    clearSelection();
  } else {
    clearSelection();
    selectedNode = el;
    el.classList.add('selected');
  }
}

function clearSelection() {
  if (selectedNode) { selectedNode.classList.remove('selected'); selectedNode = null; }
  clearConnectionSelection();
}

/* ── Internal removal helpers ────────────────────────────────── */
function _removeNode(entry) {
  const id = entry.id;
  // remove connected arrows
  connections = connections.filter(c => {
    if (c.from === id || c.to === id) {
      const p = svg.querySelector(connSelector(c));
      if (p) p.remove();
      if (selectedConn === p) clearConnectionSelection();
      return false;
    }
    return true;
  });
  droppedNodes = droppedNodes.filter(n => n.id !== id);
  if (selectedNode === entry.element) clearSelection();
  entry.element.remove();
}

function _removeConnection(from, fromSide, to, toSide) {
  connections = connections.filter(c => {
    if (c.from === from && c.fromSide === fromSide && c.to === to && c.toSide === toSide) {
      const p = svg.querySelector(connSelector(c));
      if (p) p.remove();
      return false;
    }
    return true;
  });
  clearConnectionSelection();
}

/* ── Geometry helpers ────────────────────────────────────────── */
function getHandlePos(el, side) {
  const er = el.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  const x  = side === 'left'
    ? er.left - cr.left
    : er.right - cr.left;
  const y  = er.top + er.height / 2 - cr.top;
  return { x, y };
}

function bezierPath(x1, y1, x2, y2, fromSide, toSide) {
  const dx = Math.abs(x2 - x1) * 0.5 + 30;
  const c1x = fromSide === 'right' ? x1 + dx : x1 - dx;
  const c2x = toSide   === 'left'  ? x2 - dx : x2 + dx;
  return `M${x1},${y1} C${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
}

function pathMidpoint(x1, y1, x2, y2) {
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/* ── Empty canvas hint ───────────────────────────────────────── */
function syncEmptyHint() {
  if (!emptyHint) return;
  emptyHint.style.display = droppedNodes.length === 0 ? 'flex' : 'none';
}

/* ── Toolbar actions ─────────────────────────────────────────── */
function clearCanvas() {
  droppedNodes.forEach(n => n.element.remove());
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  ensureSVGDefs();
  droppedNodes = [];
  connections  = [];
  undoStack    = [];
  clearSelection();
  syncUndoBtn();
  syncEmptyHint();
}

function toggleConnectionMode() {
  connectionMode = !connectionMode;
  connectBtn.classList.toggle('connect-active', connectionMode);
  connectBtn.querySelector('span').textContent = connectionMode ? 'Exit Connect' : 'Connect';

  // show/hide all handles
  droppedNodes.forEach(n => {
    n.element.querySelectorAll('.wf-handle').forEach(h => {
      h.style.display = connectionMode ? 'flex' : '';
      if (!connectionMode) h.classList.remove('active');
    });
  });
  clearSelection();
}

function exportSchema() {
  const schema = {
    components: droppedNodes.map(n => ({
      id:   n.id,
      type: n.type,
      x:    parseInt(n.element.style.left),
      y:    parseInt(n.element.style.top),
    })),
    connections: connections.map(c => ({
      from: c.from, fromSide: c.fromSide,
      to:   c.to,   toSide:   c.toSide,
    })),
  };
  const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'workflow-schema.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Upload / Import ─────────────────────────────────────────── */
function importSchema(schema) {
  // Validate top-level structure
  if (typeof schema !== 'object' || schema === null ||
      !Array.isArray(schema.components) || !Array.isArray(schema.connections)) {
    alert('Invalid workflow file: must contain "components" and "connections" arrays.');
    return;
  }

  const SIDES = ['left', 'right'];

  // Validate components
  for (const comp of schema.components) {
    if (typeof comp.id   !== 'string' ||
        typeof comp.type !== 'string' ||
        typeof comp.x    !== 'number' ||
        typeof comp.y    !== 'number') {
      alert('Invalid workflow file: each component must have string "id", string "type", number "x", and number "y".');
      return;
    }
    if (!VALID_TYPES.includes(comp.type)) {
      alert(`Invalid workflow file: unknown component type "${comp.type}".`);
      return;
    }
  }

  // Validate connections
  const compIds = new Set(schema.components.map(c => c.id));
  for (const conn of schema.connections) {
    if (typeof conn.from     !== 'string' ||
        typeof conn.fromSide !== 'string' ||
        typeof conn.to       !== 'string' ||
        typeof conn.toSide   !== 'string') {
      alert('Invalid workflow file: each connection must have string "from", "fromSide", "to", and "toSide".');
      return;
    }
    if (!SIDES.includes(conn.fromSide) || !SIDES.includes(conn.toSide)) {
      alert(`Invalid workflow file: connection sides must be "left" or "right".`);
      return;
    }
    if (!compIds.has(conn.from) || !compIds.has(conn.to)) {
      alert('Invalid workflow file: connection references an unknown component id.');
      return;
    }
  }

  // All valid — clear canvas and load
  clearCanvas();

  // Spawn nodes with their saved positions and ids
  const idMap = {};
  for (const comp of schema.components) {
    const meta = NODE_META[comp.type] || { icon: '📦', label: comp.type };
    const id   = comp.id;

    const el = document.createElement('div');
    el.className    = 'wf-node';
    el.style.left   = comp.x + 'px';
    el.style.top    = comp.y + 'px';
    el.dataset.id   = id;
    el.dataset.type = comp.type;

    el.innerHTML = `
      <button class="wf-node-delete" title="Remove">×</button>
      <div class="wf-node-icon">${meta.icon}</div>
      <div class="wf-node-label">${meta.label}</div>
      <div class="wf-handle left"  data-side="left"></div>
      <div class="wf-handle right" data-side="right"></div>
    `;

    _wireNodeInteractions(el, id);

    canvas.appendChild(el);
    droppedNodes.push({ id, type: comp.type, element: el });
    idMap[id] = el;
  }

  // Restore connections
  for (const conn of schema.connections) {
    const fromEl = idMap[conn.from];
    const toEl   = idMap[conn.to];
    if (fromEl && toEl) {
      createConnection(fromEl, conn.fromSide, toEl, conn.toSide);
      pushUndo({ action: 'add-connection', from: conn.from, fromSide: conn.fromSide, to: conn.to, toSide: conn.toSide });
    }
  }

  syncEmptyHint();
}

function openUploadDialog() {
  document.getElementById('wf-upload-input').value = '';
  document.getElementById('wf-upload-input').click();
}

function handleUploadFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    alert('Please select a valid JSON file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = evt => {
    let parsed;
    try {
      parsed = JSON.parse(evt.target.result);
    } catch (_) {
      alert('Invalid JSON: the file could not be parsed. Please check the file contents.');
      return;
    }
    importSchema(parsed);
  };
  reader.readAsText(file);
}


/* ── Canvas background click clears selection ────────────────── */
function initCanvasClick() {
  canvas.addEventListener('click', e => {
    if (e.target === canvas ||
        e.target.classList.contains('wf-grid') ||
        e.target.classList.contains('wf-drop-zone')) {
      clearSelection();
    }
  });
  svg.addEventListener('mousedown', e => {
    if (e.target === svg) clearConnectionSelection();
  });
}


/* ── Bootstrap ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  canvas      = document.getElementById('wf-canvas');
  dropZone    = document.getElementById('wf-drop-zone');
  svg         = document.getElementById('wf-svg');
  emptyHint   = document.getElementById('wf-empty-hint');
  undoBtn     = document.getElementById('wf-undo-btn');
  connectBtn  = document.getElementById('wf-connect-btn');

  ensureSVGDefs();
  initPaletteItems();
  initDropZone();
  initCanvasClick();
  syncUndoBtn();
  syncEmptyHint();

  // wire toolbar buttons
  document.getElementById('wf-clear-btn').addEventListener('click',   clearCanvas);
  document.getElementById('wf-export-btn').addEventListener('click',  exportSchema);
  document.getElementById('wf-connect-btn').addEventListener('click', toggleConnectionMode);
  document.getElementById('wf-undo-btn').addEventListener('click',    undoLastAction);
  document.getElementById('wf-upload-btn').addEventListener('click',  openUploadDialog);
  document.getElementById('wf-upload-input').addEventListener('change', handleUploadFile);
});

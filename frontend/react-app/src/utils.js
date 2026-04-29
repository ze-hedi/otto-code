// Get handle position relative to canvas
export function getHandlePos(nodeElement, side, canvasRect) {
  const nodeRect = nodeElement.getBoundingClientRect();
  const x = side === 'left'
    ? nodeRect.left - canvasRect.left
    : nodeRect.right - canvasRect.left;
  const y = nodeRect.top + nodeRect.height / 2 - canvasRect.top;
  return { x, y };
}

// Create bezier path for connection arrow
export function bezierPath(x1, y1, x2, y2, fromSide, toSide) {
  const dx = Math.abs(x2 - x1) * 0.5 + 30;
  const c1x = fromSide === 'right' ? x1 + dx : x1 - dx;
  const c2x = toSide === 'left' ? x2 - dx : x2 + dx;
  return `M${x1},${y1} C${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
}

// Get midpoint of a path
export function pathMidpoint(x1, y1, x2, y2) {
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

// Generate unique node ID
export function generateNodeId() {
  return String(Date.now() + Math.floor(Math.random() * 9999));
}

// Create connection selector string
export function connSelector(conn) {
  return `.wf-arrow[data-from="${conn.from}"][data-fside="${conn.fromSide}"][data-to="${conn.to}"][data-tside="${conn.toSide}"]`;
}

// Initialize SVG defs (arrowhead marker)
export function ensureSVGDefs(svgElement) {
  if (svgElement.querySelector('defs')) return;
  
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');

  // Arrowhead marker
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'wf-arrowhead');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  marker.setAttribute('markerUnits', 'strokeWidth');
  
  const arrowPoly = document.createElementNS(ns, 'polygon');
  arrowPoly.setAttribute('points', '0 0, 8 3, 0 6');
  arrowPoly.setAttribute('fill', '#4f46e5');
  
  marker.appendChild(arrowPoly);
  defs.appendChild(marker);
  svgElement.appendChild(defs);
}

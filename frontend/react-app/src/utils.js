// Shape dimensions — kept in sync with shapes.config.js and CSS geometry.
// Handle is 14×14px, offset -9px from the shape edge, so its center is ±2px from the edge.
const NODE_DIMS = {
  agent:    { width: 180, height: 68 },
  tool:     { width: 84,  height: 84 },
  artefact: { width: 80,  height: 80 },
};

// Compute handle center in viewport/canvas coordinates purely from state.
// node.x / node.y are the top-left of the .wf-node wrapper (same as the shape origin).
export function getHandlePosFromState(node, side) {
  const { width, height } = NODE_DIMS[node.type] || NODE_DIMS.agent;
  switch (side) {
    case 'left':   return { x: node.x - 2,          y: node.y + height / 2 };
    case 'right':  return { x: node.x + width + 2,  y: node.y + height / 2 };
    case 'top':    return { x: node.x + width / 2,  y: node.y - 2           };
    case 'bottom': return { x: node.x + width / 2,  y: node.y + height + 2  };
    default:       return { x: node.x + width / 2,  y: node.y + height / 2  };
  }
}

// Create bezier path for connection arrow.
// Handles all four exit/entry directions symmetrically.
export function bezierPath(x1, y1, x2, y2, fromSide, toSide) {
  const dx = Math.abs(x2 - x1) * 0.5 + 30;
  const dy = Math.abs(y2 - y1) * 0.5 + 30;

  // Exit control point — tangent direction determined by source handle side
  let c1x = x1, c1y = y1;
  if      (fromSide === 'right')  c1x = x1 + dx;
  else if (fromSide === 'left')   c1x = x1 - dx;
  else if (fromSide === 'bottom') c1y = y1 + dy;
  else if (fromSide === 'top')    c1y = y1 - dy;

  // Entry control point — tangent direction determined by target handle side
  let c2x = x2, c2y = y2;
  if      (toSide === 'left')   c2x = x2 - dx;
  else if (toSide === 'right')  c2x = x2 + dx;
  else if (toSide === 'top')    c2y = y2 - dy;
  else if (toSide === 'bottom') c2y = y2 + dy;

  return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
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

// Initialize SVG defs (arrowhead markers)
export function ensureSVGDefs(svgElement) {
  if (svgElement.querySelector('defs')) return;

  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');

  // Flow arrowhead — indigo
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

  // Tool-link arrowhead — cyan
  const markerTool = document.createElementNS(ns, 'marker');
  markerTool.setAttribute('id', 'wf-arrowhead-tool');
  markerTool.setAttribute('markerWidth', '8');
  markerTool.setAttribute('markerHeight', '6');
  markerTool.setAttribute('refX', '8');
  markerTool.setAttribute('refY', '3');
  markerTool.setAttribute('orient', 'auto');
  markerTool.setAttribute('markerUnits', 'strokeWidth');

  const arrowPolyTool = document.createElementNS(ns, 'polygon');
  arrowPolyTool.setAttribute('points', '0 0, 8 3, 0 6');
  arrowPolyTool.setAttribute('fill', '#0891b2');

  markerTool.appendChild(arrowPolyTool);
  defs.appendChild(markerTool);

  svgElement.appendChild(defs);
}

import React from 'react';

// Icon lives inside the circle; label is rendered outside (below) by the fragment.
// Handles are positioned relative to the circle shape, so they land on the equator.
const CircleShape = ({ node, onDelete, onHandleMouseDown }) => (
  <>
    <div className="wf-shape wf-shape--circle">
      <button
        className="wf-node-delete"
        onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
      >
        ×
      </button>
      <div className="wf-node-icon">{node.toolIcon || '🔧'}</div>
      <div className="wf-handle top"    data-side="top"    onMouseDown={(e) => onHandleMouseDown(e, 'top')}    />
      <div className="wf-handle bottom" data-side="bottom" onMouseDown={(e) => onHandleMouseDown(e, 'bottom')} />
    </div>
    <div className="wf-node-label wf-node-label--below">{node.toolName}</div>
  </>
);

export default CircleShape;

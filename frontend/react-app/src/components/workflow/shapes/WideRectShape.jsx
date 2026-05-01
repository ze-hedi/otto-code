import React from 'react';

const WideRectShape = ({ node, onDelete, onHandleMouseDown }) => (
  <div className="wf-shape wf-shape--wide-rect">
    <button
      className="wf-node-delete"
      onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
    >
      ×
    </button>
    <div className="wf-node-icon">{node.agentIcon || '🤖'}</div>
    <div className="wf-node-label">{node.agentName}</div>
    <div className="wf-handle left"   data-side="left"   onMouseDown={(e) => onHandleMouseDown(e, 'left')}   />
    <div className="wf-handle right"  data-side="right"  onMouseDown={(e) => onHandleMouseDown(e, 'right')}  />
    <div className="wf-handle top"    data-side="top"    onMouseDown={(e) => onHandleMouseDown(e, 'top')}    />
    <div className="wf-handle bottom" data-side="bottom" onMouseDown={(e) => onHandleMouseDown(e, 'bottom')} />
  </div>
);

export default WideRectShape;

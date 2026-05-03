import React from 'react';

const SquareShape = ({ node, onDelete, onHandleMouseDown }) => (
  <div className="wf-shape wf-shape--square">
    <button
      className="wf-node-delete"
      onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
    >
      ×
    </button>
    <div className="wf-node-icon wf-node-icon--artefact">
      {node.icon ?? '◇'}
    </div>
    <div className="wf-node-label">{node.label}</div>
    <div className="wf-handle left"  data-side="left"  onMouseDown={(e) => onHandleMouseDown(e, 'left')}  />
    <div className="wf-handle right" data-side="right" onMouseDown={(e) => onHandleMouseDown(e, 'right')} />
  </div>
);

export default SquareShape;

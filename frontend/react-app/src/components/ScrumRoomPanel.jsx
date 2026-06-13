import React from 'react';

const ScrumRoomPanel = ({ node, onClose }) => {
  return (
    <div className="wf-detail-panel">
      <div className="wf-detail-panel-header">
        <span className="wf-detail-panel-title">{node?.icon || '🏉'} Scrum Room</span>
        <button className="wf-detail-panel-close" onClick={onClose}>×</button>
      </div>
      <div className="wf-detail-panel-body">
        <div style={{ padding: '16px 0' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#a6adc8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Name
            </label>
            <div style={{ color: '#cdd6f4', fontSize: 14 }}>{node?.label || 'Scrum Room'}</div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#a6adc8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Description
            </label>
            <div style={{ color: '#cdd6f4', fontSize: 13, lineHeight: 1.5 }}>
              A collaborative scrum room interface for team coordination. Agents connected to this node can participate in scrum ceremonies and share status updates.
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#a6adc8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Status
            </label>
            <span style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              background: '#1e3a2f',
              color: '#a6e3a1',
            }}>
              Ready
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScrumRoomPanel;

import React from 'react';

function ToolDetailPanel({ tool, onClose }) {
  if (!tool) return null;

  const schema = tool.inputSchema || tool.schema;
  const properties = schema?.properties || {};
  const required = schema?.required || [];

  return (
    <div className="wf-detail-panel">
      <div className="wf-detail-panel-header">
        <span className="wf-detail-panel-title">Tool Details</span>
        <button className="wf-detail-panel-close" onClick={onClose}>&times;</button>
      </div>
      <div className="wf-detail-panel-body">
        <div className="tool-detail-identity">
          <span className="tool-detail-icon">{tool.icon || '🔧'}</span>
          <div>
            <h3 className="tool-detail-name">{tool.name}</h3>
            <span className={`tool-detail-badge ${tool.isMcp ? 'tool-detail-badge--mcp' : ''}`}>
              {tool.isMcp ? 'MCP' : 'Custom'}
            </span>
          </div>
        </div>

        <div className="tool-detail-section">
          <label className="tool-detail-label">Description</label>
          <p className="tool-detail-description">{tool.description || 'No description'}</p>
        </div>

        {Object.keys(properties).length > 0 && (
          <div className="tool-detail-section">
            <label className="tool-detail-label">Parameters</label>
            <div className="tool-detail-params">
              {Object.entries(properties).map(([name, prop]) => (
                <div key={name} className="tool-detail-param">
                  <code className="tool-detail-param-name">
                    {name}{required.includes(name) ? '' : '?'}
                  </code>
                  <span className="tool-detail-param-type">{prop.type || 'any'}</span>
                  {prop.description && (
                    <span className="tool-detail-param-desc">{prop.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ToolDetailPanel;

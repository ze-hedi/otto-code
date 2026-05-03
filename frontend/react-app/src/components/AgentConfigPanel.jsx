import React, { useEffect, useState, useCallback } from 'react';
import './AgentConfigPanel.css';

function ConfigRow({ label, value }) {
  return (
    <div className="acp-row">
      <span className="acp-label">{label}</span>
      <span className="acp-value">{value ?? '—'}</span>
    </div>
  );
}

function AgentConfigPanel({ agentId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:5000/runtime/agents/${agentId}/config`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Server error ${res.status}`);
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      setError('Could not reach the runtime server.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const cfg = data?.config;
  const tools = data?.tools;

  return (
    <div className="acp-panel">
      <div className="acp-header">
        <span className="acp-title">Agent Config</span>
        <div className="acp-header-actions">
          <button
            className="acp-refresh-btn"
            onClick={fetchConfig}
            disabled={loading}
            title="Refresh"
          >
            {loading ? '…' : '↻'}
          </button>
          <button className="acp-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="acp-body">
        {error && (
          <div className="acp-error">
            <span className="acp-error-icon">⚠</span>
            {error}
          </div>
        )}

        {cfg && (
          <section className="acp-section">
            <div className="acp-section-title">Model</div>
            <ConfigRow label="Model ID" value={cfg.model} />
            <ConfigRow label="API key set" value={cfg.hasApiKey ? 'Yes' : 'No'} />
          </section>
        )}

        {cfg && (
          <section className="acp-section">
            <div className="acp-section-title">Session</div>
            <ConfigRow label="Session mode" value={cfg.sessionMode} />
            <ConfigRow label="Thinking level" value={cfg.thinkingLevel} />
            <ConfigRow label="Working dir" value={cfg.workingDir || '(cwd)'} />
          </section>
        )}

        {cfg && (
          <section className="acp-section">
            <div className="acp-section-title">Prompt</div>
            <ConfigRow
              label="System prompt suffix"
              value={cfg.systemPromptSuffix ? '(set)' : '(none)'}
            />
            <ConfigRow
              label="Skills"
              value={
                cfg.skills?.length
                  ? cfg.skills.map((s) => s.name).join(', ')
                  : '(none)'
              }
            />
          </section>
        )}

        {tools && (
          <section className="acp-section">
            <div className="acp-section-title">Registered Tools</div>
            {tools.length === 0 ? (
              <span className="acp-empty-tools">(none)</span>
            ) : (
              tools.map((name) => (
                <div key={name} className="acp-tool-badge">{name}</div>
              ))
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default AgentConfigPanel;

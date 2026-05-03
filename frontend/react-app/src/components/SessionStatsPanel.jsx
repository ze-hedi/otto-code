import React, { useEffect, useState, useCallback } from 'react';
import './SessionStatsPanel.css';

function StatRow({ label, value }) {
  return (
    <div className="ssp-stat-row">
      <span className="ssp-stat-label">{label}</span>
      <span className="ssp-stat-value">{value ?? '—'}</span>
    </div>
  );
}

function formatCost(cost) {
  if (cost == null) return '—';
  return `$${Number(cost).toFixed(6)}`;
}

function formatPct(pct) {
  if (pct == null) return '—';
  return `${Number(pct).toFixed(1)}%`;
}

function SessionStatsPanel({ agentId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:5000/runtime/agents/${agentId}/stats`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Server error ${res.status}`);
        setData(null);
      } else {
        setData(json);
      }
    } catch (err) {
      setError('Could not reach the runtime server.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const ctx = data?.contextUsage;
  const sess = data?.sessionStats;

  return (
    <div className="ssp-panel">
      <div className="ssp-header">
        <span className="ssp-title">Session Stats</span>
        <div className="ssp-header-actions">
          <button
            className="ssp-refresh-btn"
            onClick={fetchStats}
            disabled={loading}
            title="Refresh"
          >
            {loading ? '…' : '↻'}
          </button>
          <button className="ssp-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="ssp-body">
        {error && (
          <div className="ssp-error">
            <span className="ssp-error-icon">⚠</span>
            {error}
          </div>
        )}

        {!error && !data && !loading && (
          <div className="ssp-empty">No data available.</div>
        )}

        {ctx && (
          <section className="ssp-section">
            <div className="ssp-section-title">Context Window</div>
            <StatRow label="Tokens used" value={ctx.tokens?.toLocaleString()} />
            <StatRow label="Context window size" value={ctx.contextWindow?.toLocaleString()} />
            <StatRow label="Context used" value={formatPct(ctx.percent)} />
          </section>
        )}

        {sess && (
          <section className="ssp-section">
            <div className="ssp-section-title">Session Totals</div>
            <StatRow label="User messages" value={sess.userMessages?.toLocaleString()} />
            <StatRow label="Assistant messages" value={sess.assistantMessages?.toLocaleString()} />
            <StatRow label="Tool calls" value={sess.toolCalls?.toLocaleString()} />
            <StatRow label="Input tokens" value={sess.tokens?.input?.toLocaleString()} />
            <StatRow label="Output tokens" value={sess.tokens?.output?.toLocaleString()} />
            <StatRow label="Cache read tokens" value={sess.tokens?.cacheRead?.toLocaleString()} />
            <StatRow label="Cache write tokens" value={sess.tokens?.cacheWrite?.toLocaleString()} />
            <StatRow label="Total tokens" value={sess.tokens?.total?.toLocaleString()} />
            <StatRow label="Estimated cost" value={formatCost(sess.cost)} />
          </section>
        )}
      </div>
    </div>
  );
}

export default SessionStatsPanel;

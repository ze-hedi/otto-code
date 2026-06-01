import React, { useRef } from 'react';
import ModelSelect from './ModelSelect';
import './AgentForm.css';

const AGENT_ICONS = [
  { value: '🤖', label: 'Robot' },
  { value: '🧠', label: 'Brain' },
  { value: '🔍', label: 'Researcher' },
  { value: '⚡', label: 'Fast' },
  { value: '🛠️', label: 'Builder' },
];

const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'];

const SESSION_MODES = [
  { value: 'memory', icon: '⚡', title: 'Memory', desc: 'Volatile — resets each run' },
  { value: 'disk', icon: '💾', title: 'Disk', desc: 'Persist sessions to disk' },
  { value: 'continue', icon: '↩', title: 'Continue', desc: 'Resume the most recent session' },
];

function AgentForm({
  editingAgent,
  formName,
  setFormName,
  formDescription,
  setFormDescription,
  icon,
  setIcon,
  availableTools,
  selectedTools,
  setSelectedTools,
  model,
  setModel,
  thinkingLevel,
  setThinkingLevel,
  sessionMode,
  setSessionMode,
  workingDir,
  setWorkingDir,
  playground,
  setPlayground,
  systemPromptMode,
  setSystemPromptMode,
  systemPromptText,
  setSystemPromptText,
  systemPromptFile,
  setSystemPromptFile,
  skills,
  setSkills,
  skillsDragOver,
  setSkillsDragOver,
  apiKey,
  setApiKey,
  showApiKey,
  setShowApiKey,
  compactionEnabled,
  setCompactionEnabled,
  reserveTokens,
  setReserveTokens,
  keepRecentTokens,
  setKeepRecentTokens,
  compactionInstructions,
  setCompactionInstructions,
  toolCallGuardrails,
  setToolCallGuardrails,
  handleSystemPromptLoad,
  handleSkillsLoad,
  handleSkillsDrop,
  onCancel,
  onSubmit,
  isFormValid,
}) {
  const skillsInputRef = useRef(null);

  const toggleTool = (id) => {
    setSelectedTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  return (
    <div className="create-agent-form">
      <h2 className="create-agent-title">{editingAgent ? 'Edit Agent' : 'New Agent'}</h2>

      {/* ── Identity ───────────────────────────────────────── */}
      <div className="form-section">
        <div className="form-section-title">Identity</div>
        <div className="form-group">
          <label className="form-label" htmlFor="agent-name">Name</label>
          <input
            id="agent-name"
            className="form-input"
            type="text"
            placeholder="e.g. my-coding-agent"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Icon</label>
          <div className="agent-icon-picker">
            {AGENT_ICONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`agent-icon-btn${icon === opt.value ? ' active' : ''}`}
                onClick={() => setIcon(opt.value)}
                title={opt.label}
              >
                <span className="agent-icon-emoji">{opt.value}</span>
                <span className="agent-icon-label">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="agent-description">Description</label>
          <textarea
            id="agent-description"
            className="form-textarea"
            placeholder="Describe what this agent does..."
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      {/* ── Tools ────────────────────────────────────────── */}
      <div className="form-section">
        <div className="form-section-title">Tools</div>
        <div className="form-group">
          {availableTools.length === 0 ? (
            <div className="tool-picker-empty">
              No tools available. <a href="/tools">Create a tool</a>
            </div>
          ) : (
            <div className="tool-picker-list">
              {availableTools.map((tool) => {
                const active = selectedTools.includes(tool._id);
                return (
                  <div
                    key={tool._id}
                    className={`tool-picker-row${active ? ' active' : ''}`}
                    onClick={() => toggleTool(tool._id)}
                    role="checkbox"
                    aria-checked={active}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && toggleTool(tool._id)}
                  >
                    <span className="tool-picker-icon">{tool.icon || '🔧'}</span>
                    <span className="tool-picker-name">{tool.name}</span>
                    <span className="tool-picker-id">{tool._id}</span>
                    <span className="tool-picker-check">{active ? '✓' : ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Model ─────────────────────────────────────────── */}
      <div className="form-section">
        <div className="form-section-title">Model</div>
        <div className="form-group">
          <label className="form-label" htmlFor="agent-model">Provider / Model</label>
          <ModelSelect id="agent-model" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Thinking Level</label>
          <div className="thinking-level-group">
            {THINKING_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={`thinking-level-btn${thinkingLevel === level ? ' active' : ''}`}
                onClick={() => setThinkingLevel(level)}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Session ───────────────────────────────────────── */}
      <div className="form-section">
        <div className="form-section-title">Session</div>
        <div className="form-group">
          <label className="form-label">Session Mode</label>
          <div className="session-mode-cards">
            {SESSION_MODES.map((mode) => (
              <div
                key={mode.value}
                className={`session-mode-card${sessionMode === mode.value ? ' active' : ''}`}
                onClick={() => setSessionMode(mode.value)}
                role="radio"
                aria-checked={sessionMode === mode.value}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSessionMode(mode.value)}
              >
                <span className="session-mode-icon">{mode.icon}</span>
                <span className="session-mode-title">{mode.title}</span>
                <span className="session-mode-desc">{mode.desc}</span>
              </div>
            ))}
          </div>
        </div>
        {(sessionMode === 'disk' || sessionMode === 'continue') && (
          <div className="form-group form-group--slide-in">
            <label className="form-label" htmlFor="working-dir">Working Directory</label>
            <input
              id="working-dir"
              className="form-input"
              type="text"
              placeholder="/path/to/working/directory"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
            />
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="playground">Playground</label>
          <p className="form-hint">Repository or directory the agent will operate in.</p>
          <input
            id="playground"
            className={`form-input${!playground.trim() ? ' form-input--error' : ''}`}
            type="text"
            placeholder="/path/to/your/repo"
            value={playground}
            onChange={(e) => setPlayground(e.target.value)}
          />
        </div>
      </div>

      {/* ── Prompt & Skills ───────────────────────────────── */}
      <div className="form-section">
        <div className="form-section-title">Prompt &amp; Skills</div>
        <div className="form-group">
          <div className="form-label-row">
            <label className="form-label">System Prompt Suffix</label>
            {!editingAgent && (
              <div className="tab-toggle">
                <button
                  type="button"
                  className={`tab-btn${systemPromptMode === 'write' ? ' active' : ''}`}
                  onClick={() => setSystemPromptMode('write')}
                >
                  Write
                </button>
                <button
                  type="button"
                  className={`tab-btn${systemPromptMode === 'upload' ? ' active' : ''}`}
                  onClick={() => setSystemPromptMode('upload')}
                >
                  Upload
                </button>
              </div>
            )}
          </div>
          {editingAgent || systemPromptMode === 'write' ? (
            <textarea
              className="form-textarea"
              placeholder="Additional instructions appended to Pi's default system prompt..."
              value={systemPromptText}
              onChange={(e) => setSystemPromptText(e.target.value)}
              rows={4}
            />
          ) : systemPromptFile ? (
            <div className="skills-list">
              <div className="skill-item">
                <div className="skill-item-header">
                  <span className="skill-icon">⌗</span>
                  <span className="skill-name">{systemPromptFile.name}</span>
                  <button className="skill-remove-btn" onClick={() => setSystemPromptFile(null)}>✕</button>
                </div>
              </div>
            </div>
          ) : (
            <label className="skills-upload-btn">
              + Load .md file
              <input
                type="file"
                accept=".md"
                style={{ display: 'none' }}
                onChange={handleSystemPromptLoad}
              />
            </label>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Skills</label>
          <div
            className={`skills-drop-zone${skillsDragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setSkillsDragOver(true); }}
            onDragLeave={() => setSkillsDragOver(false)}
            onDrop={handleSkillsDrop}
            onClick={() => skillsInputRef.current?.click()}
          >
            <span className="skills-drop-icon">⌗</span>
            <span className="skills-drop-text">
              Drop .md files here or <span className="skills-drop-link">browse</span>
            </span>
            <input
              ref={skillsInputRef}
              type="file"
              accept=".md"
              multiple
              style={{ display: 'none' }}
              onChange={handleSkillsLoad}
            />
          </div>
          {skills.length > 0 && (
            <div className="skills-list">
              {skills.map((skill, i) => (
                <div key={i} className="skill-item">
                  <div className="skill-item-header">
                    <span className="skill-icon">⌗</span>
                    <span className="skill-name">{skill.name}</span>
                    <button
                      className="skill-remove-btn"
                      onClick={() => setSkills((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Advanced ──────────────────────────────────────── */}
      <details className="form-advanced">
        <summary className="form-advanced-summary">
          <span>Advanced</span>
          <span className="form-advanced-arrow">›</span>
        </summary>
        <div className="form-advanced-body">
          <div className="form-group">
            <label className="form-label" htmlFor="api-key">API Key Override</label>
            <p className="form-hint">Leave blank to use the environment variable.</p>
            <div className="password-field">
              <input
                id="api-key"
                className="form-input"
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowApiKey((v) => !v)}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* ── Tool Call Guardrails ──── */}
          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label">Tool Call Guardrails</label>
            <label className="compaction-toggle">
              <input
                type="checkbox"
                checked={toolCallGuardrails}
                onChange={(e) => setToolCallGuardrails(e.target.checked)}
              />
              <span>Require approval before tool execution</span>
            </label>
          </div>

          {/* ── Context Compaction ──── */}
          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label">Context Compaction</label>
            <label className="compaction-toggle">
              <input
                type="checkbox"
                checked={compactionEnabled}
                onChange={(e) => setCompactionEnabled(e.target.checked)}
              />
              <span>Enable auto-compaction</span>
            </label>
          </div>
          {compactionEnabled && (
            <div className="form-group--slide-in">
              <div className="form-group">
                <label className="form-label" htmlFor="reserve-tokens">Reserve Tokens</label>
                <p className="form-hint">Headroom before compaction triggers. Higher = compacts sooner.</p>
                <input
                  id="reserve-tokens"
                  className="form-input"
                  type="number"
                  placeholder="16384"
                  value={reserveTokens}
                  onChange={(e) => setReserveTokens(e.target.value)}
                  min={0}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="keep-recent-tokens">Keep Recent Tokens</label>
                <p className="form-hint">How many recent tokens survive compaction (not summarized).</p>
                <input
                  id="keep-recent-tokens"
                  className="form-input"
                  type="number"
                  placeholder="20000"
                  value={keepRecentTokens}
                  onChange={(e) => setKeepRecentTokens(e.target.value)}
                  min={0}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="compaction-instructions">Summarization Instructions</label>
                <p className="form-hint">Custom focus for the compression summary (e.g. "prioritize code decisions").</p>
                <textarea
                  id="compaction-instructions"
                  className="form-input"
                  rows={2}
                  placeholder="Optional — leave blank for default"
                  value={compactionInstructions}
                  onChange={(e) => setCompactionInstructions(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </details>

      {/* ── Actions ───────────────────────────────────────── */}
      <div className="form-actions">
        <button className="agent-action-btn view-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="agent-action-btn edit-btn create-agent-submit-btn"
          onClick={onSubmit}
          disabled={!isFormValid}
        >
          {editingAgent ? 'Update Agent' : 'Create Agent'}
        </button>
      </div>
    </div>
  );
}

export default AgentForm;

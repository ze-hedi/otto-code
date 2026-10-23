import { useState, useEffect } from 'react'
import '../pages/CreateAgentForm.css'

const MODELS = [
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4-5',
  'deepseek/deepseek-v4-pro',
  'openai/gpt-4o',
  'google/gemini-2.5-pro',
  'openrouter/mistralai/mistral-large-4-0',
]

const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh'] as const

const BUILT_IN_TOOLS = ['read', 'bash', 'edit', 'write']
const EXTRA_TOOLS = ['clarify']

interface McpEntry {
  name: string
  url: string
}

interface SubAgentEntry {
  key: string
  name: string
  description: string
  model: string
  systemPrompt: string
  builtInTools: string[]
  playground: string
  promptSnippet: string
  promptGuidelines: string
}

export interface AgentFormData {
  name?: string
  description?: string
  model?: string
  systemPrompt?: string
  thinkingLevel?: string
  playground?: string
  builtInTools?: string[]
  mcpServers?: Record<string, string>
  toolCallGuardrails?: string[]
  clarificationTool?: boolean
  subAgents?: Record<string, {
    name: string
    description?: string
    model: string
    systemPrompt: string
    builtInTools?: string[]
    playground?: string
    promptSnippet?: string
    promptGuidelines?: string[]
  }>
}

interface AgentFormContentProps {
  lockedPlayground?: string
  onSuccess: (agentId: string, agentName: string, agentModel: string) => void
  onCancel?: () => void
  readOnly?: boolean
  initialData?: AgentFormData
  /** When set, the form PUTs to update this agent instead of POSTing a new one. */
  editAgentId?: string
}

export function AgentFormContent({ lockedPlayground, onSuccess, onCancel, readOnly, initialData, editAgentId }: AgentFormContentProps) {
  const [name, setName] = useState(initialData?.name ?? '')
  const [description, setDescription] = useState(initialData?.description ?? '')
  const initModel = initialData?.model && MODELS.includes(initialData.model) ? initialData.model : initialData?.model ? '__custom__' : MODELS[0]
  const [model, setModel] = useState(initModel)
  const [customModel, setCustomModel] = useState(initModel === '__custom__' ? (initialData?.model ?? '') : '')
  const [systemPrompt, setSystemPrompt] = useState(initialData?.systemPrompt ?? '')
  const [thinkingLevel, setThinkingLevel] = useState<string>(initialData?.thinkingLevel ?? 'off')
  const [playground, setPlayground] = useState(lockedPlayground ?? initialData?.playground ?? '')

  useEffect(() => {
    if (lockedPlayground) setPlayground(lockedPlayground)
  }, [lockedPlayground])
  const [selectedTools, setSelectedTools] = useState<string[]>(initialData?.builtInTools ?? ['read', 'bash', 'edit', 'write'])
  const [mcpServers, setMcpServers] = useState<McpEntry[]>(
    initialData?.mcpServers
      ? Object.entries(initialData.mcpServers).map(([name, url]) => ({ name, url }))
      : []
  )
  const [subAgents, setSubAgents] = useState<SubAgentEntry[]>(
    initialData?.subAgents
      ? Object.entries(initialData.subAgents).map(([key, sa]) => ({
          key, name: sa.name, description: sa.description ?? '', model: sa.model,
          systemPrompt: sa.systemPrompt, builtInTools: sa.builtInTools ?? [],
          playground: sa.playground ?? '', promptSnippet: sa.promptSnippet ?? '',
          promptGuidelines: sa.promptGuidelines?.join('\n') ?? '',
        }))
      : []
  )
  const [extraTools, setExtraTools] = useState<string[]>(initialData?.clarificationTool ? ['clarify'] : [])
  const [guardrails, setGuardrails] = useState(!!(initialData?.toolCallGuardrails?.length))
  const [showAdvanced, setShowAdvanced] = useState(readOnly ? (mcpServers.length > 0 || subAgents.length > 0) : false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const toggleTool = (tool: string) => {
    setSelectedTools(prev =>
      prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]
    )
  }

  const toggleExtraTool = (tool: string) => {
    setExtraTools(prev =>
      prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]
    )
  }

  const addMcpServer = () => setMcpServers(prev => [...prev, { name: '', url: '' }])

  const updateMcp = (index: number, field: 'name' | 'url', value: string) => {
    setMcpServers(prev => prev.map((entry, i) => i === index ? { ...entry, [field]: value } : entry))
  }

  const removeMcp = (index: number) => setMcpServers(prev => prev.filter((_, i) => i !== index))

  const addSubAgent = () => {
    setSubAgents(prev => [...prev, {
      key: '', name: '', description: '', model: MODELS[0],
      systemPrompt: '', builtInTools: ['read', 'bash'], playground: '',
      promptSnippet: '', promptGuidelines: '',
    }])
  }

  const updateSubAgent = (index: number, field: keyof SubAgentEntry, value: any) => {
    setSubAgents(prev => prev.map((entry, i) => i === index ? { ...entry, [field]: value } : entry))
  }

  const removeSubAgent = (index: number) => setSubAgents(prev => prev.filter((_, i) => i !== index))

  const toggleSubAgentTool = (index: number, tool: string) => {
    setSubAgents(prev => prev.map((entry, i) => {
      if (i !== index) return entry
      const tools = entry.builtInTools.includes(tool)
        ? entry.builtInTools.filter(t => t !== tool)
        : [...entry.builtInTools, tool]
      return { ...entry, builtInTools: tools }
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const finalModel = model === '__custom__' ? customModel : model

    const mcpMap: Record<string, string> = {}
    for (const entry of mcpServers) {
      if (entry.name && entry.url) mcpMap[entry.name] = entry.url
    }

    const config: Record<string, unknown> = {
      model: finalModel,
      ...(name && { name }),
      ...(description && { description }),
      ...(systemPrompt && { systemPrompt }),
      thinkingLevel,
      ...(playground && { playground }),
      builtInTools: selectedTools,
      ...(guardrails && { toolCallGuardrails: ['bash', 'write', 'edit'] }),
      ...(extraTools.includes('clarify') && { clarificationTool: true }),
      ...(Object.keys(mcpMap).length > 0 && { mcpServers: mcpMap }),
      ...(subAgents.length > 0 && {
        subAgents: Object.fromEntries(
          subAgents
            .filter(s => s.key && s.name && s.model && s.systemPrompt)
            .map(s => {
              const guidelines = s.promptGuidelines.split('\n').map(l => l.trim()).filter(Boolean)
              return [s.key, {
                name: s.name,
                description: s.description,
                model: s.model,
                systemPrompt: s.systemPrompt,
                builtInTools: s.builtInTools,
                ...(s.playground && { playground: s.playground }),
                ...(s.promptSnippet && { promptSnippet: s.promptSnippet }),
                ...(guidelines.length > 0 && { promptGuidelines: guidelines }),
              }]
            })
        ),
      }),
    }

    try {
      const url = editAgentId
        ? `http://localhost:4000/agents/${editAgentId}`
        : 'http://localhost:4000/agents'
      const res = await fetch(url, {
        method: editAgentId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      onSuccess(data.agent_id, name || data.agent_id, finalModel)
    } catch (err: any) {
      setError(err.message || (editAgentId ? 'Failed to update agent' : 'Failed to create agent'))
    } finally {
      setSubmitting(false)
    }
  }

  const ro = !!readOnly
  const disabledStyle = ro ? { opacity: 0.7, cursor: 'default' } as const : undefined

  return (
    <form onSubmit={handleSubmit}>
      {/* Name */}
      <div className="field">
        <label htmlFor="af-name">Agent Name</label>
        <input
          id="af-name"
          type="text"
          placeholder="e.g. code-reviewer, researcher..."
          value={name}
          onChange={e => setName(e.target.value)}
          readOnly={ro}
          style={disabledStyle}
        />
      </div>

      {/* Description */}
      <div className="field">
        <label htmlFor="af-description">Description</label>
        <textarea
          id="af-description"
          rows={2}
          placeholder="What does this agent do..."
          value={description}
          onChange={e => setDescription(e.target.value)}
          readOnly={ro}
          style={disabledStyle}
        />
      </div>

      {/* Model */}
      <div className="field">
        <label htmlFor="af-model">Model <span className="required">*</span></label>
        {ro ? (
          <input type="text" value={model === '__custom__' ? customModel : model} readOnly style={disabledStyle} />
        ) : (
          <select id="af-model" value={model} onChange={e => setModel(e.target.value)}>
            {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="__custom__">Custom...</option>
          </select>
        )}
        {!ro && model === '__custom__' && (
          <input
            className="mt-8"
            type="text"
            placeholder="provider/model-name"
            value={customModel}
            onChange={e => setCustomModel(e.target.value)}
            required
          />
        )}
      </div>

      {/* System Prompt */}
      <div className="field">
        <label htmlFor="af-systemPrompt">System Prompt</label>
        <textarea
          id="af-systemPrompt"
          rows={4}
          placeholder="Full system prompt for the agent..."
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          readOnly={ro}
          style={disabledStyle}
        />
      </div>

      {/* Playground Directory */}
      <div className="field">
        <label htmlFor="af-playground">Playground Directory</label>
        <input
          id="af-playground"
          type="text"
          placeholder="/path/to/repo"
          value={playground}
          onChange={e => !lockedPlayground && !editAgentId && !ro && setPlayground(e.target.value)}
          className="mono"
          readOnly={!!lockedPlayground || !!editAgentId || ro}
          style={lockedPlayground || editAgentId || ro ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        />
        {lockedPlayground && !editAgentId && !ro && (
          <p className="field-hint">Locked to the project playground directory.</p>
        )}
        {editAgentId && !ro && (
          <p className="field-hint">Playground cannot be changed after creation.</p>
        )}
      </div>

      {/* Thinking Level */}
      <div className="field">
        <label>Thinking Level</label>
        <div className="chip-group">
          {THINKING_LEVELS.map(level => (
            <button
              key={level}
              type="button"
              className={`chip ${thinkingLevel === level ? 'active' : ''}`}
              onClick={() => !ro && setThinkingLevel(level)}
              style={ro ? { pointerEvents: 'none' } : undefined}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Built-in Tools */}
      <div className="field">
        <label>Tools</label>
        <div className="chip-group">
          {BUILT_IN_TOOLS.map(tool => (
            <button
              key={tool}
              type="button"
              className={`chip tool-chip ${selectedTools.includes(tool) ? 'active' : ''}`}
              onClick={() => !ro && toggleTool(tool)}
              style={ro ? { pointerEvents: 'none' } : undefined}
            >
              <span className="tool-icon">{selectedTools.includes(tool) ? '✓' : '+'}</span>
              {tool}
            </button>
          ))}
          {EXTRA_TOOLS.map(tool => (
            <button
              key={tool}
              type="button"
              className={`chip tool-chip ${extraTools.includes(tool) ? 'active' : ''}`}
              onClick={() => !ro && toggleExtraTool(tool)}
              style={ro ? { pointerEvents: 'none' } : undefined}
            >
              <span className="tool-icon">{extraTools.includes(tool) ? '✓' : '+'}</span>
              {tool}
            </button>
          ))}
        </div>
      </div>

      {/* Tool Guardrails */}
      <div className="field">
        <label className="toggle-row" htmlFor="af-guardrails">
          <span>Tool Guardrails</span>
          <button
            type="button"
            id="af-guardrails"
            className={`toggle-switch ${guardrails ? 'on' : ''}`}
            onClick={() => !ro && setGuardrails(!guardrails)}
            role="switch"
            aria-checked={guardrails}
            style={ro ? { pointerEvents: 'none' } : undefined}
          >
            <span className="toggle-knob" />
          </button>
        </label>
        {!ro && (
          <p className="field-hint">
            When enabled, every tool call requires your approval before executing.
          </p>
        )}
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <span className={`arrow ${showAdvanced ? 'open' : ''}`}>&#9654;</span>
        Advanced Settings
      </button>

      {showAdvanced && (
        <div className="advanced-section">
          {/* MCP Servers */}
          <div className="field">
            <label>MCP Servers</label>
            {mcpServers.map((entry, i) => (
              <div key={i} className="mcp-row">
                <input
                  type="text"
                  placeholder="Server name"
                  value={entry.name}
                  onChange={e => updateMcp(i, 'name', e.target.value)}
                  readOnly={ro}
                  style={disabledStyle}
                />
                <input
                  type="text"
                  placeholder="http://localhost:3001/mcp"
                  value={entry.url}
                  onChange={e => updateMcp(i, 'url', e.target.value)}
                  className="mono"
                  readOnly={ro}
                  style={disabledStyle}
                />
                {!ro && <button type="button" className="remove-btn" onClick={() => removeMcp(i)}>&times;</button>}
              </div>
            ))}
            {!ro && <button type="button" className="add-btn" onClick={addMcpServer}>+ Add MCP Server</button>}
          </div>

          {/* Volatile Subagents */}
          <div className="field">
            <label>Volatile Subagents</label>
            <p className="field-hint">Stateless agents spawned as tools — fresh instance per call, no memory between invocations.</p>
            {subAgents.map((sa, i) => (
              <details key={i} className="subagent-card" open={ro || !sa.key}>
                <summary className="subagent-summary">
                  <span>{sa.name || sa.key || `Subagent ${i + 1}`}</span>
                  {!ro && <button type="button" className="remove-btn" onClick={e => { e.preventDefault(); removeSubAgent(i) }}>&times;</button>}
                </summary>
                <div className="subagent-fields">
                  <div className="field-row">
                    <div className="field">
                      <label>Tool Key <span className="required">*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. explorer"
                        value={sa.key}
                        onChange={e => updateSubAgent(i, 'key', e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))}
                        className="mono"
                        readOnly={ro}
                        style={disabledStyle}
                      />
                    </div>
                    <div className="field">
                      <label>Name <span className="required">*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. Code Explorer"
                        value={sa.name}
                        onChange={e => updateSubAgent(i, 'name', e.target.value)}
                        readOnly={ro}
                        style={disabledStyle}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>Description</label>
                    <input
                      type="text"
                      placeholder="What this subagent does..."
                      value={sa.description}
                      onChange={e => updateSubAgent(i, 'description', e.target.value)}
                      readOnly={ro}
                      style={disabledStyle}
                    />
                  </div>
                  <div className="field">
                    <label>Model <span className="required">*</span></label>
                    {ro ? (
                      <input type="text" value={sa.model} readOnly style={disabledStyle} />
                    ) : (
                      <select value={sa.model} onChange={e => updateSubAgent(i, 'model', e.target.value)}>
                        {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="field">
                    <label>System Prompt <span className="required">*</span></label>
                    <textarea
                      rows={3}
                      placeholder="Instructions for this subagent..."
                      value={sa.systemPrompt}
                      onChange={e => updateSubAgent(i, 'systemPrompt', e.target.value)}
                      readOnly={ro}
                      style={disabledStyle}
                    />
                  </div>
                  <div className="field">
                    <label>Playground Directory</label>
                    <input
                      type="text"
                      placeholder="/path/to/repo (optional)"
                      value={sa.playground}
                      onChange={e => updateSubAgent(i, 'playground', e.target.value)}
                      className="mono"
                      readOnly={ro}
                      style={disabledStyle}
                    />
                  </div>
                  <div className="field">
                    <label>Built-in Tools</label>
                    <div className="chip-group">
                      {BUILT_IN_TOOLS.map(tool => (
                        <button
                          key={tool}
                          type="button"
                          className={`chip tool-chip ${sa.builtInTools.includes(tool) ? 'active' : ''}`}
                          onClick={() => !ro && toggleSubAgentTool(i, tool)}
                          style={ro ? { pointerEvents: 'none' } : undefined}
                        >
                          <span className="tool-icon">{sa.builtInTools.includes(tool) ? '✓' : '+'}</span>
                          {tool}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label>Prompt Snippet</label>
                    <textarea
                      rows={2}
                      placeholder="Extra text injected into the parent's prompt about this tool..."
                      value={sa.promptSnippet}
                      onChange={e => updateSubAgent(i, 'promptSnippet', e.target.value)}
                      readOnly={ro}
                      style={disabledStyle}
                    />
                  </div>
                  <div className="field">
                    <label>Guidelines</label>
                    <textarea
                      rows={3}
                      placeholder={"One guideline per line, e.g.:\nAlways return structured JSON\nNever modify files directly"}
                      value={sa.promptGuidelines}
                      onChange={e => updateSubAgent(i, 'promptGuidelines', e.target.value)}
                      readOnly={ro}
                      style={disabledStyle}
                    />
                  </div>
                </div>
              </details>
            ))}
            {!ro && <button type="button" className="add-btn" onClick={addSubAgent}>+ Add Subagent</button>}
          </div>
        </div>
      )}

      {error && <div className="message error">{error}</div>}

      {!ro && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          {onCancel && (
            <button type="button" className="wf-header-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="submit-btn" disabled={submitting}>
            {submitting ? (editAgentId ? 'Saving...' : 'Creating...') : (editAgentId ? 'Save Changes' : 'Create Agent')}
          </button>
        </div>
      )}
    </form>
  )
}

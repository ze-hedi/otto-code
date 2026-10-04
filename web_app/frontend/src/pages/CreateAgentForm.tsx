import { useState } from 'react'
import { Link } from 'react-router-dom'
import './CreateAgentForm.css'

const MODELS = [
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-opus-4-5',
  'deepseek/deepseek-v4-pro',
  'openai/gpt-4o',
  'google/gemini-2.5-pro',
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

export function CreateAgentForm() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState(MODELS[0])
  const [customModel, setCustomModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<string>('off')
  const [playground, setPlayground] = useState('')
  const [selectedTools, setSelectedTools] = useState<string[]>(['read', 'bash', 'edit', 'write'])
  const [mcpServers, setMcpServers] = useState<McpEntry[]>([])
  const [subAgents, setSubAgents] = useState<SubAgentEntry[]>([])
  const [extraTools, setExtraTools] = useState<string[]>([])
  const [guardrails, setGuardrails] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ agent_id: string } | null>(null)
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

  const addMcpServer = () => {
    setMcpServers(prev => [...prev, { name: '', url: '' }])
  }

  const updateMcp = (index: number, field: 'name' | 'url', value: string) => {
    setMcpServers(prev => prev.map((entry, i) =>
      i === index ? { ...entry, [field]: value } : entry
    ))
  }

  const removeMcp = (index: number) => {
    setMcpServers(prev => prev.filter((_, i) => i !== index))
  }

  const addSubAgent = () => {
    setSubAgents(prev => [...prev, {
      key: '', name: '', description: '', model: MODELS[0],
      systemPrompt: '', builtInTools: ['read', 'bash'], playground: '',
      promptSnippet: '', promptGuidelines: '',
    }])
  }

  const updateSubAgent = (index: number, field: keyof SubAgentEntry, value: any) => {
    setSubAgents(prev => prev.map((entry, i) =>
      i === index ? { ...entry, [field]: value } : entry
    ))
  }

  const removeSubAgent = (index: number) => {
    setSubAgents(prev => prev.filter((_, i) => i !== index))
  }

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
    setResult(null)
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
      const res = await fetch('http://localhost:4000/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Failed to create agent')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="form-container">
      <div className="form-header">
        <Link to="/" className="form-back-link">&larr; Back to Agents</Link>
        <h1>Create Agent</h1>
        <p className="form-subtitle">Configure a new RawPiAgent instance</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Name */}
        <div className="field">
          <label htmlFor="name">Agent Name</label>
          <input
            id="name"
            type="text"
            placeholder="e.g. code-reviewer, researcher..."
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            rows={3}
            placeholder="What does this agent do..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        {/* Model */}
        <div className="field">
          <label htmlFor="model">Model <span className="required">*</span></label>
          <select id="model" value={model} onChange={e => setModel(e.target.value)}>
            {MODELS.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
          {model === '__custom__' && (
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
          <label htmlFor="systemPrompt">System Prompt</label>
          <textarea
            id="systemPrompt"
            rows={5}
            placeholder="Full system prompt for the agent..."
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
          />
        </div>

        {/* Playground Directory */}
        <div className="field">
          <label htmlFor="playground">Playground Directory</label>
          <input
            id="playground"
            type="text"
            placeholder="/path/to/repo"
            value={playground}
            onChange={e => setPlayground(e.target.value)}
            className="mono"
          />
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
                onClick={() => setThinkingLevel(level)}
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
                onClick={() => toggleTool(tool)}
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
                onClick={() => toggleExtraTool(tool)}
              >
                <span className="tool-icon">{extraTools.includes(tool) ? '✓' : '+'}</span>
                {tool}
              </button>
            ))}
          </div>
        </div>

        {/* Tool Guardrails */}
        <div className="field">
          <label className="toggle-row" htmlFor="guardrails">
            <span>Tool Guardrails</span>
            <button
              type="button"
              id="guardrails"
              className={`toggle-switch ${guardrails ? 'on' : ''}`}
              onClick={() => setGuardrails(!guardrails)}
              role="switch"
              aria-checked={guardrails}
            >
              <span className="toggle-knob" />
            </button>
          </label>
          <p className="field-hint">
            When enabled, every tool call requires your approval before executing.
          </p>
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
                  />
                  <input
                    type="text"
                    placeholder="http://localhost:3001/mcp"
                    value={entry.url}
                    onChange={e => updateMcp(i, 'url', e.target.value)}
                    className="mono"
                  />
                  <button type="button" className="remove-btn" onClick={() => removeMcp(i)}>
                    &times;
                  </button>
                </div>
              ))}
              <button type="button" className="add-btn" onClick={addMcpServer}>
                + Add MCP Server
              </button>
            </div>

            {/* Volatile Subagents */}
            <div className="field">
              <label>Volatile Subagents</label>
              <p className="field-hint">Stateless agents spawned as tools — fresh instance per call, no memory between invocations.</p>
              {subAgents.map((sa, i) => (
                <details key={i} className="subagent-card" open={!sa.key}>
                  <summary className="subagent-summary">
                    <span>{sa.name || sa.key || `Subagent ${i + 1}`}</span>
                    <button type="button" className="remove-btn" onClick={e => { e.preventDefault(); removeSubAgent(i) }}>
                      &times;
                    </button>
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
                        />
                      </div>
                      <div className="field">
                        <label>Name <span className="required">*</span></label>
                        <input
                          type="text"
                          placeholder="e.g. Code Explorer"
                          value={sa.name}
                          onChange={e => updateSubAgent(i, 'name', e.target.value)}
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
                      />
                    </div>
                    <div className="field">
                      <label>Model <span className="required">*</span></label>
                      <select value={sa.model} onChange={e => updateSubAgent(i, 'model', e.target.value)}>
                        {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>System Prompt <span className="required">*</span></label>
                      <textarea
                        rows={3}
                        placeholder="Instructions for this subagent..."
                        value={sa.systemPrompt}
                        onChange={e => updateSubAgent(i, 'systemPrompt', e.target.value)}
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
                            onClick={() => toggleSubAgentTool(i, tool)}
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
                      />
                    </div>
                    <div className="field">
                      <label>Guidelines</label>
                      <textarea
                        rows={3}
                        placeholder={"One guideline per line, e.g.:\nAlways return structured JSON\nNever modify files directly"}
                        value={sa.promptGuidelines}
                        onChange={e => updateSubAgent(i, 'promptGuidelines', e.target.value)}
                      />
                    </div>
                  </div>
                </details>
              ))}
              <button type="button" className="add-btn" onClick={addSubAgent}>
                + Add Subagent
              </button>
            </div>
          </div>
        )}

        {/* Submit */}
        <button type="submit" className="submit-btn" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Agent'}
        </button>

        {/* Result / Error */}
        {error && <div className="message error">{error}</div>}
        {result && (
          <div className="message success">
            Agent created — <code>{result.agent_id}</code>
            <Link to={`/chat/${result.agent_id}`} className="chat-link">Open Chat</Link>
          </div>
        )}
      </form>
    </div>
  )
}

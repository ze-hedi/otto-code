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

const BUILT_IN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'ls']

interface McpEntry {
  name: string
  url: string
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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ agent_id: string } | null>(null)
  const [error, setError] = useState('')

  const toggleTool = (tool: string) => {
    setSelectedTools(prev =>
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
      ...(Object.keys(mcpMap).length > 0 && { mcpServers: mcpMap }),
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
          <label>Built-in Tools</label>
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
          </div>
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

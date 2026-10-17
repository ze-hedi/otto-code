import { useState } from 'react'
import '../pages/CreateAgentForm.css'

export interface InterfaceConfigData {
  description?: string
  promptSnippet?: string
  promptGuidelines?: string[]
  paramDescriptions?: Record<string, string>
}

interface InterfaceFormContentProps {
  interfaceType: string
  initialData?: InterfaceConfigData
  defaults: InterfaceConfigData
  onSave: (config: InterfaceConfigData) => void
  onCancel: () => void
}

// Parameter labels per interface type
const PARAM_LABELS: Record<string, Record<string, string>> = {
  delegate: {
    task: 'Task Description (what the delegated task should contain)',
    agent: 'Agent Selection Description (how to pick which agent)',
  },
  forward: {
    result: 'Result Description (what the forwarded result should contain)',
  },
  accumulate: {
    agent: 'Agent Description (identifies which agent produced the result)',
    result: 'Result Description (what each accumulated result should contain)',
  },
  route: {
    route: 'Route Description (how to pick which agent to route to)',
    result: 'Result Description (what context to pass to the routed agent)',
  },
}

export function InterfaceFormContent({ interfaceType, initialData, defaults, onSave, onCancel }: InterfaceFormContentProps) {
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [promptSnippet, setPromptSnippet] = useState(initialData?.promptSnippet ?? '')
  const [guidelines, setGuidelines] = useState(initialData?.promptGuidelines?.join('\n') ?? '')
  const [paramDescs, setParamDescs] = useState<Record<string, string>>(initialData?.paramDescriptions ?? {})

  const paramLabels = PARAM_LABELS[interfaceType] ?? {}
  const defaultParams = defaults.paramDescriptions ?? {}

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const config: InterfaceConfigData = {}
    if (description.trim()) config.description = description.trim()
    if (promptSnippet.trim()) config.promptSnippet = promptSnippet.trim()
    if (guidelines.trim()) config.promptGuidelines = guidelines.trim().split('\n').filter(Boolean)
    const filteredParams = Object.fromEntries(
      Object.entries(paramDescs).filter(([, v]) => v.trim())
    )
    if (Object.keys(filteredParams).length > 0) config.paramDescriptions = filteredParams
    onSave(config)
  }

  return (
    <form onSubmit={handleSave}>
      <div className="field">
        <label>Tool Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={defaults.description}
          rows={3}
        />
      </div>

      <div className="field">
        <label>Prompt Snippet</label>
        <input
          type="text"
          value={promptSnippet}
          onChange={e => setPromptSnippet(e.target.value)}
          placeholder={defaults.promptSnippet ?? ''}
        />
      </div>

      <div className="field">
        <label>Prompt Guidelines (one per line)</label>
        <textarea
          value={guidelines}
          onChange={e => setGuidelines(e.target.value)}
          placeholder={defaults.promptGuidelines?.join('\n') ?? ''}
          rows={3}
        />
      </div>

      <h4 style={{ margin: '16px 0 8px', fontSize: '13px', color: 'var(--text-muted, #aaa)' }}>
        Tool Parameter Descriptions
      </h4>

      {Object.entries(paramLabels).map(([paramKey, label]) => (
        <div className="field" key={paramKey}>
          <label>{label}</label>
          <textarea
            value={paramDescs[paramKey] ?? ''}
            onChange={e => setParamDescs(prev => ({ ...prev, [paramKey]: e.target.value }))}
            placeholder={defaultParams[paramKey] ?? ''}
            rows={3}
          />
        </div>
      ))}

      <p style={{ fontSize: '12px', color: 'var(--text-muted, #888)', margin: '8px 0' }}>
        Leave fields empty to use defaults. The agent name list is always appended automatically.
      </p>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="wf-header-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="submit-btn">Save</button>
      </div>
    </form>
  )
}

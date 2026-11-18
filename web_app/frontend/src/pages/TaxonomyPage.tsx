import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MODELS } from '../models'
import './TaxonomyPage.css'

const API = 'http://localhost:4000'
const CUSTOM = '__custom__'

interface PipelineAgent {
  key: string
  name: string
  role: string
  defaultModel: string
  /** Set for sub-agents: the key of the agent that spawns them. */
  parent?: string
  systemPrompt: string
  tools: { name: string; description: string }[]
}

interface TaxonomyConfig {
  errorNotes: number
  sessionsWithErrors: number
  agents: PipelineAgent[]
}

// Chosen models are a per-browser convenience until the run endpoint exists.
function storedModel(agentId: string, key: string): string | null {
  try { return localStorage.getItem(`taxonomy-model:${agentId}:${key}`) } catch { return null }
}

function storeModel(agentId: string, key: string, model: string) {
  try { localStorage.setItem(`taxonomy-model:${agentId}:${key}`, model) } catch { /* ignore */ }
}

function ModelPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const known = MODELS.includes(value)
  const [custom, setCustom] = useState(!known)
  return (
    <div className="tax-model">
      <select
        value={custom ? CUSTOM : value}
        onChange={e => {
          if (e.target.value === CUSTOM) setCustom(true)
          else { setCustom(false); onChange(e.target.value) }
        }}
      >
        {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {custom && (
        <input type="text" placeholder="provider/model-name" value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}

function AgentCard({ agent, model, onModelChange, children }: {
  agent: PipelineAgent
  model: string
  onModelChange: (m: string) => void
  children?: ReactNode
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  return (
    <div className={agent.parent ? 'tax-card tax-subcard' : 'tax-card'}>
      <h3>{agent.name}{agent.parent && <span className="tax-badge">volatile sub-agent</span>}</h3>
      <p className="tax-role">{agent.role}</p>

      <label>Model</label>
      <ModelPicker value={model} onChange={onModelChange} />

      <label>Tools</label>
      {agent.tools.length === 0 ? (
        <div className="tax-muted">None</div>
      ) : (
        <ul className="tax-tools">
          {agent.tools.map(t => <li key={t.name}><code>{t.name}</code> — {t.description}</li>)}
        </ul>
      )}

      <button className="tax-link" onClick={() => setShowPrompt(v => !v)}>
        {showPrompt ? 'Hide' : 'Show'} system prompt
      </button>
      {showPrompt && <pre className="tax-prompt">{agent.systemPrompt}</pre>}
      {children}
    </div>
  )
}

export function TaxonomyPage() {
  const { projectId, agentId } = useParams<{ projectId: string; agentId: string }>()
  const navigate = useNavigate()
  const [config, setConfig] = useState<TaxonomyConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!agentId) return
    fetch(`${API}/agents/${agentId}/taxonomy/config`)
      .then(async res => {
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText)
        return res.json() as Promise<TaxonomyConfig>
      })
      .then(cfg => {
        setConfig(cfg)
        setModels(Object.fromEntries(cfg.agents.map(a => [a.key, storedModel(agentId, a.key) ?? a.defaultModel])))
      })
      .catch(e => setError(String(e.message ?? e)))
  }, [agentId])

  const setModel = (key: string, model: string) => {
    setModels(prev => ({ ...prev, [key]: model }))
    if (agentId) storeModel(agentId, key, model)
  }

  return (
    <div className="tax-page">
      <button className="obs-back" onClick={() => navigate(`/projects/${projectId}/agents/${agentId}/observability`)}>&larr; Observability</button>
      <h2>Error taxonomy</h2>
      <p className="tax-muted">
        Summarizes the context of each error note, then groups the errors into failure categories.
      </p>

      {error && <div className="tax-error">{error}</div>}
      {!config && !error && <div className="tax-muted">Loading…</div>}

      {config && (
        <>
          <div className="tax-pipeline">
            {config.agents.filter(a => !a.parent).map((a, i) => (
              <div key={a.key} className="tax-step">
                {i > 0 && <div className="tax-arrow">&rarr;</div>}
                <AgentCard agent={a} model={models[a.key] ?? a.defaultModel} onModelChange={m => setModel(a.key, m)}>
                  {config.agents.filter(sub => sub.parent === a.key).map(sub => (
                    <AgentCard key={sub.key} agent={sub} model={models[sub.key] ?? sub.defaultModel} onModelChange={m => setModel(sub.key, m)} />
                  ))}
                </AgentCard>
              </div>
            ))}
          </div>

          <div className="tax-run">
            <span>
              {config.errorNotes} error note{config.errorNotes === 1 ? '' : 's'} across {config.sessionsWithErrors} session{config.sessionsWithErrors === 1 ? '' : 's'}
            </span>
            {/* Run behaviour comes later: POST /taxonomy/run with the chosen models. */}
            <button className="primary" disabled title="Coming soon">Build taxonomy</button>
          </div>
        </>
      )}
    </div>
  )
}

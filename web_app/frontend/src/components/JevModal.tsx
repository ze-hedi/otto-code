import { useState, useEffect } from 'react'
import './JevModal.css'

const JEV_API = 'http://localhost:4000/workflows/jev'

interface Choice {
  id: string
  description: string
  /** agent that runs when this choice wins */
  agent: string
}

interface JevForm {
  apiKey: string
  /** choice: pick one of several, noul: yes/no */
  type: 'choice' | 'noul'
  instructions: string
  choices: Choice[]
}

const EMPTY: JevForm = { apiKey: '', type: 'choice', instructions: '', choices: [] }
// A yes/no Jev always has these two answers (the ids Jev uses for them)
const YES_NO: Choice[] = [
  { id: 'true', description: '', agent: '' },
  { id: 'false', description: '', agent: '' },
]

/**
 * Form of one Jev node. Without `jevId` it creates a Jev (POST /workflows/jev),
 * with one it edits it (PUT). The API key is write-only: the backend stores it
 * but never sends it back, so a loaded Jev shows an empty key field.
 */
export function JevModal({ jevId, outputs, onClose, onSaved }: {
  jevId?: string
  /** agents connected after this Jev: what the choices can run */
  outputs: { id: string; name: string }[]
  onClose: () => void
  /** Called with the new Jev's id once it has been created */
  onSaved?: (jevId: string) => void
}) {
  const [id, setId] = useState(jevId)
  const [form, setForm] = useState<JevForm>(EMPTY)
  const [savedJson, setSavedJson] = useState(JSON.stringify(EMPTY))
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(!!jevId)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dirty = JSON.stringify(form) !== savedJson

  useEffect(() => {
    if (!jevId) return
    fetch(`${JEV_API}/${jevId}`)
      .then(async r => {
        if (r.status === 404) { setId(undefined); return } // deleted elsewhere: Create starts a new one
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        const loaded: JevForm = {
          apiKey: '',
          type: data.config.type ?? 'choice',
          instructions: data.config.instructions ?? '',
          choices: data.config.choices ?? [],
        }
        setForm(loaded)
        setSavedJson(JSON.stringify(loaded))
        setHasStoredKey(data.hasApiKey)
      })
      .catch(e => setLoadError(`Couldn't load this Jev (${e.message}).`))
      .finally(() => setLoading(false))
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(id ? `${JEV_API}/${id}` : JEV_API, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        // blank rows of a choice list are dropped; the yes/no rows always stay
        body: JSON.stringify({ ...form, choices: form.choices.filter(c => c.id.trim()) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      const saved = { ...form, apiKey: '', choices: form.choices.filter(c => c.id.trim()) } // the key was sent; it doesn't stay in the form
      setForm(saved)
      setSavedJson(JSON.stringify(saved))
      setHasStoredKey(data.hasApiKey)
      if (!id) {
        setId(data.jev_id)
        onSaved?.(data.jev_id)
      }
    } catch (e: any) {
      setSaveError(e?.message ?? 'Network error')
    } finally {
      setSaving(false)
    }
  }

  function setType(type: JevForm['type']) {
    if (type !== form.type) setForm({ ...form, type, choices: type === 'noul' ? YES_NO : [] })
  }

  function setChoice(i: number, patch: Partial<Choice>) {
    setForm({ ...form, choices: form.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  }

  function agentSelect(choice: Choice, i: number) {
    const missing = choice.agent && !outputs.some(o => o.id === choice.agent)
    return (
      <select value={choice.agent} onChange={e => setChoice(i, { agent: e.target.value })}>
        <option value="">Runs which agent?</option>
        {outputs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        {missing && <option value={choice.agent}>{choice.agent} (not connected)</option>}
      </select>
    )
  }

  function close() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  return (
    <div className="jev-overlay" onClick={close}>
      <div className="jev-modal" onClick={e => e.stopPropagation()}>
        <div className="jev-header">
          <div>
            <h1>Jev</h1>
            <p>Reads the context and picks one of the connected options.</p>
          </div>
          <button className="jev-close" onClick={close} title="Close">&times;</button>
        </div>

        <div className="jev-body">
          {loading && <div className="jev-banner">Loading this Jev...</div>}
          {loadError && <div className="jev-banner jev-banner-warn">{loadError}</div>}

          <div className="jev-field">
            <label>OpenRouter API key</label>
            <div className="jev-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder={hasStoredKey ? 'Saved — leave empty to keep it' : 'sk-or-v1-...'}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="jev-secondary-btn" onClick={() => setShowKey(v => !v)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className="jev-help">
              Stored with the Jev on the backend and never sent back to the browser.
              Leave it empty to use OPENROUTER_API_KEY from the server's .env.
            </span>
          </div>

          <div className="jev-field">
            <label>Type</label>
            <div className="jev-radios">
              <label><input type="radio" checked={form.type === 'choice'} onChange={() => setType('choice')} /> Choice <small>pick one of several</small></label>
              <label><input type="radio" checked={form.type === 'noul'} onChange={() => setType('noul')} /> Yes / No</label>
            </div>
          </div>

          <div className="jev-field">
            <label>Question {form.type === 'choice' && <small>(optional)</small>}</label>
            <textarea
              rows={2}
              value={form.instructions}
              onChange={e => setForm({ ...form, instructions: e.target.value })}
              placeholder={form.type === 'noul' ? 'e.g. Is this request urgent?' : 'Which option should the workflow take next?'}
            />
            <span className="jev-help">What Jev answers about the context it receives.</span>
          </div>

          <div className="jev-field">
            <label>{form.type === 'noul' ? 'Answers' : 'Choices'}</label>
            {outputs.length === 0 && (
              <span className="jev-help">Connect this Jev to the agents it routes to, then pick them here.</span>
            )}
            {form.type === 'choice' && form.choices.length === 0 && (
              <span className="jev-help">Empty: the agents connected after this Jev are the choices, described by their own descriptions.</span>
            )}
            {form.choices.map((c, i) => (
              <div className="jev-choice" key={i}>
                {form.type === 'noul'
                  ? <span className="jev-choice-label">{c.id === 'true' ? 'Yes' : 'No'}</span>
                  : <input value={c.id} onChange={e => setChoice(i, { id: e.target.value })} placeholder="Choice name" />}
                <input value={c.description} onChange={e => setChoice(i, { description: e.target.value })} placeholder="When does it apply?" />
                {agentSelect(c, i)}
                {form.type === 'choice' && (
                  <button className="jev-secondary-btn" title="Remove" onClick={() => setForm({ ...form, choices: form.choices.filter((_, j) => j !== i) })}>&times;</button>
                )}
              </div>
            ))}
            {form.type === 'choice' && (
              <button className="jev-secondary-btn jev-add" onClick={() => setForm({ ...form, choices: [...form.choices, { id: '', description: '', agent: '' }] })}>
                + Add choice
              </button>
            )}
          </div>
        </div>

        <div className="jev-savebar">
          <span className="jev-savebar-status">
            {saveError
              ? <span className="jev-err">{saveError}</span>
              : !id ? '' : dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <button
            className="jev-primary-btn"
            onClick={save}
            disabled={saving || loading || !!loadError || (!!id && !dirty)}
          >
            {saving ? 'Saving...' : id ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

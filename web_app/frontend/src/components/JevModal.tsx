import { useState, useEffect } from 'react'
import './JevModal.css'

const JEV_API = 'http://localhost:4000/workflows/jev'

interface JevForm {
  apiKey: string
  instructions: string
}

const EMPTY: JevForm = { apiKey: '', instructions: '' }

/**
 * Form of one Jev node. Without `jevId` it creates a Jev (POST /workflows/jev),
 * with one it edits it (PUT). The API key is write-only: the backend stores it
 * but never sends it back, so a loaded Jev shows an empty key field.
 */
export function JevModal({ jevId, onClose, onSaved }: {
  jevId?: string
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
        const loaded = { apiKey: '', instructions: data.config.instructions ?? '' }
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
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      const saved = { ...form, apiKey: '' } // the key was sent; it doesn't stay in the form
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
            <label>Instructions <small>(optional)</small></label>
            <textarea
              rows={3}
              value={form.instructions}
              onChange={e => setForm({ ...form, instructions: e.target.value })}
              placeholder="Which option should the workflow take next?"
            />
            <span className="jev-help">The question Jev answers about the context it receives.</span>
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

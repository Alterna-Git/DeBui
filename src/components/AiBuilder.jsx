import { useState } from 'react'
import { buildDeckWithAI } from '../api/ai'

export default function AiBuilder({ user, onDeckBuilt }) {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function build(e) {
    e.preventDefault()
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    setStatus('Asking the AI for a deck list…')
    try {
      const { deckName, cards, unresolved } = await buildDeckWithAI(prompt, setStatus)
      onDeckBuilt(deckName, cards)
      setStatus(
        unresolved.length
          ? `Done — ${cards.length} cards added. Couldn't find: ${unresolved.join(', ')}`
          : `Done — ${cards.length} cards added to your deck.`,
      )
    } catch (err) {
      setError(err.message)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  if (!user) return <p className="muted">Sign in to use the AI deck builder.</p>

  return (
    <section className="ai-builder">
      <h3>AI Deck Builder</h3>
      <p className="muted">
        Describe the deck you want — archetype, colors, format, budget, favorite cards —
        and the AI will draft a full deck list for you to edit.
      </p>
      <form onSubmit={build}>
        <textarea
          className="input ai-prompt"
          rows={4}
          placeholder="e.g. A mono-green stompy deck for casual Standard play, built around big creatures and ramp…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy || !prompt.trim()}>
          {busy ? 'Building…' : 'Build deck with AI'}
        </button>
      </form>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

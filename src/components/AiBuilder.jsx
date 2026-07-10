import { useState } from 'react'
import { buildDeckWithAI } from '../api/ai'

export default function AiBuilder({ user, deck, onDeckBuilt }) {
  const format = deck.format ?? 'standard'
  const lockedCount = deck.cards
    .filter((c) => c.board !== 'side')
    .reduce((n, c) => n + c.count, 0)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState(null)
  const [notes, setNotes] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function build(e) {
    e.preventDefault()
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    setNotes([])
    setStatus('Asking the AI for a deck list…')
    try {
      const { deckName, commander, cards, unresolved, notes: buildNotes } = await buildDeckWithAI(prompt, format, deck, setStatus)
      onDeckBuilt(deckName, cards, commander)
      const totalCards = cards.reduce((n, c) => n + c.count, 0) + (commander ? 1 : 0)
      setStatus(`Done — ${totalCards} cards added to your deck.`)
      setNotes([
        ...buildNotes,
        ...(unresolved.length ? [`Couldn't find: ${unresolved.join(', ')}`] : []),
      ])
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
        Describe the deck you want — archetype, colors, budget, favorite cards — and the
        AI will draft a full{' '}
        <strong>{format === 'commander' ? '100-card Commander deck (with a commander)' : '60-card deck'}</strong>{' '}
        for you to edit. Switch the format in the deck panel.
      </p>
      {lockedCount > 0 && (
        <p className="muted">
          <strong>{lockedCount} card{lockedCount === 1 ? '' : 's'} already in your deck will be kept</strong> —
          the AI builds around them and completes the deck
          {format === 'commander' ? ' to exactly 100' : ''}.
        </p>
      )}
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
      {notes.length > 0 && (
        <ul className="build-notes">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

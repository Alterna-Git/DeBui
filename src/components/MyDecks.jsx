import { useEffect, useState } from 'react'
import { listDecks, deleteDeck } from '../api/decks'

export default function MyDecks({ user, onOpenDeck }) {
  const [decks, setDecks] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) return
    listDecks(user.uid).then(setDecks).catch((e) => setError(e.message))
  }, [user])

  async function remove(deck) {
    if (!confirm(`Delete "${deck.name}"?`)) return
    await deleteDeck(user.uid, deck.id)
    setDecks((cur) => cur.filter((d) => d.id !== deck.id))
  }

  if (!user) return <p className="muted">Sign in to see your saved decks.</p>
  if (error) return <p className="error">{error}</p>
  if (!decks) return <p className="muted">Loading decks…</p>
  if (!decks.length) return <p className="muted">No saved decks yet — build one and hit Save.</p>

  return (
    <div className="deck-list">
      {decks.map((deck) => {
        const count = deck.cards.reduce((n, c) => n + c.count, 0)
        return (
          <div key={deck.id} className="deck-list-item">
            <div>
              <strong>{deck.name}</strong>
              <span className="muted"> — {count} cards</span>
            </div>
            <div className="deck-list-actions">
              <button className="btn btn-primary" onClick={() => onOpenDeck(deck)}>Open</button>
              <button className="btn" onClick={() => remove(deck)}>Delete</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

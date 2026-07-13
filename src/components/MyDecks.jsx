import { useEffect, useState } from 'react'
import { listDecks, deleteDeck } from '../api/decks'
import { evaluateBracket } from '../api/bracket'

function GridCard({ card, badge }) {
  return (
    <div className="grid-card" title={`${card.count}× ${card.name}`}>
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={card.name} loading="lazy" />
      ) : (
        <div className="card-placeholder grid-placeholder">
          <strong>{card.name}</strong>
          <span>{card.type}</span>
        </div>
      )}
      {card.count > 1 && <span className="count-badge">×{card.count}</span>}
      {badge && <span className="role-badge">{badge}</span>}
    </div>
  )
}

function DeckGrid({ deck }) {
  const main = deck.cards.filter((c) => c.board !== 'side')
  const side = deck.cards.filter((c) => c.board === 'side')
  const commander = deck.commanderId ? main.find((c) => c.id === deck.commanderId) : null
  const rest = main.filter((c) => c !== commander)

  return (
    <div className="deck-grid-view">
      <div className="deck-image-grid">
        {commander && <GridCard card={commander} badge="Commander" />}
        {rest.map((c) => <GridCard key={c.id} card={c} />)}
      </div>
      {side.length > 0 && (
        <>
          <h4 className="grid-section">Sideboard</h4>
          <div className="deck-image-grid">
            {side.map((c) => <GridCard key={c.id} card={c} />)}
          </div>
        </>
      )}
    </div>
  )
}

export default function MyDecks({ user, onOpenDeck }) {
  const [decks, setDecks] = useState(null)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

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
        const expanded = expandedId === deck.id
        return (
          <div key={deck.id} className="deck-list-item-wrap">
            <div className="deck-list-item">
              <div>
                <strong>{deck.name}</strong>
                <span className="muted"> — {count} cards</span>
                {(() => {
                  const b = evaluateBracket(deck)
                  return (
                    <span className="bracket-chip" title={`Estimated bracket: ${b.name}`}>
                      Bracket {b.bracket}
                    </span>
                  )
                })()}
              </div>
              <div className="deck-list-actions">
                <button
                  className={expanded ? 'btn tab active' : 'btn'}
                  onClick={() => setExpandedId(expanded ? null : deck.id)}
                >
                  {expanded ? 'Hide grid' : 'Grid view'}
                </button>
                <button className="btn btn-primary" onClick={() => onOpenDeck(deck)}>Open</button>
                <button className="btn" onClick={() => remove(deck)}>Delete</button>
              </div>
            </div>
            {expanded && <DeckGrid deck={deck} />}
          </div>
        )
      })}
    </div>
  )
}

import ManaCurve from './ManaCurve'

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other']

function primaryType(card) {
  for (const t of TYPE_ORDER) {
    if (card.types?.includes(t)) return t
  }
  return 'Other'
}

function CardRow({ card, onChangeCount, onToggleBoard, onRemove }) {
  return (
    <li className="deck-row">
      <span className="deck-count">
        <button className="count-btn" onClick={() => onChangeCount(card, -1)}>−</button>
        {card.count}
        <button className="count-btn" onClick={() => onChangeCount(card, +1)}>+</button>
      </span>
      <span className="deck-name" title={`${card.type} — ${card.text}`}>{card.name}</span>
      <span className="deck-mana">{card.manaCost}</span>
      <button className="icon-btn" title={card.board === 'side' ? 'Move to main deck' : 'Move to sideboard'} onClick={() => onToggleBoard(card)}>
        ⇄
      </button>
      <button className="icon-btn" title="Remove" onClick={() => onRemove(card)}>✕</button>
    </li>
  )
}

export default function DeckPanel({
  deck,
  onRename,
  onChangeCount,
  onToggleBoard,
  onRemove,
  onSave,
  onClear,
  saving,
  user,
}) {
  const main = deck.cards.filter((c) => c.board !== 'side')
  const side = deck.cards.filter((c) => c.board === 'side')
  const mainCount = main.reduce((n, c) => n + c.count, 0)
  const sideCount = side.reduce((n, c) => n + c.count, 0)

  const overFour = deck.cards.filter(
    (c) => c.count > 4 && !c.types?.includes('Land') && !/Basic/.test(c.type),
  )

  const groups = TYPE_ORDER.map((t) => ({
    type: t,
    cards: main.filter((c) => primaryType(c) === t),
  })).filter((g) => g.cards.length)

  return (
    <aside className="deck-panel">
      <input
        className="input deck-title"
        value={deck.name}
        onChange={(e) => onRename(e.target.value)}
        placeholder="Deck name"
      />
      <div className="deck-meta">
        <span>{mainCount} main</span>
        <span>{sideCount} side</span>
      </div>

      {overFour.length > 0 && (
        <p className="warning">
          ⚠ More than 4 copies: {overFour.map((c) => c.name).join(', ')}
        </p>
      )}

      <ManaCurve cards={main} />

      {groups.map((g) => (
        <div key={g.type} className="deck-group">
          <h4>{g.type} ({g.cards.reduce((n, c) => n + c.count, 0)})</h4>
          <ul>
            {g.cards.map((c) => (
              <CardRow key={c.id} card={c} onChangeCount={onChangeCount} onToggleBoard={onToggleBoard} onRemove={onRemove} />
            ))}
          </ul>
        </div>
      ))}

      {side.length > 0 && (
        <div className="deck-group deck-sideboard">
          <h4>Sideboard ({sideCount})</h4>
          <ul>
            {side.map((c) => (
              <CardRow key={c.id} card={c} onChangeCount={onChangeCount} onToggleBoard={onToggleBoard} onRemove={onRemove} />
            ))}
          </ul>
        </div>
      )}

      {deck.cards.length === 0 && <p className="muted">Search for cards and add them to your deck.</p>}

      <div className="deck-actions">
        <button className="btn btn-primary" onClick={onSave} disabled={!user || saving || deck.cards.length === 0}>
          {saving ? 'Saving…' : deck.id ? 'Update deck' : 'Save deck'}
        </button>
        <button className="btn" onClick={onClear} disabled={deck.cards.length === 0 && !deck.id}>
          New deck
        </button>
      </div>
      {!user && <p className="muted">Sign in to save decks.</p>}
    </aside>
  )
}

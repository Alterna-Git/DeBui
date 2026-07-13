import { useState } from 'react'
import ManaCurve from './ManaCurve'
import FormatChecks from './FormatChecks'

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land', 'Other']

function primaryType(card) {
  for (const t of TYPE_ORDER) {
    if (card.types?.includes(t)) return t
  }
  return 'Other'
}

function canBeCommander(card) {
  return (
    card.types?.includes('Legendary') &&
    (card.types?.includes('Creature') || /can be your commander/i.test(card.text ?? ''))
  )
}

const PREVIEW_W = 244
const PREVIEW_H = 340

// "Atraxa, Praetors' Voice" → https://edhrec.com/commanders/atraxa-praetors-voice
function edhrecUrl(card, isCommanderPage) {
  const slug = card.name
    .split(' // ')[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return `https://edhrec.com/${isCommanderPage ? 'commanders' : 'cards'}/${slug}`
}

function CardRow({ card, isCommanderFormat, isTheCommander, onSetCommander, onChangeCount, onToggleBoard, onRemove }) {
  const [preview, setPreview] = useState(null)

  function showPreview(e) {
    if (!card.imageUrl) return
    const rect = e.currentTarget.getBoundingClientRect()
    setPreview({
      left: Math.max(8, rect.left - PREVIEW_W - 16),
      top: Math.max(8, Math.min(rect.top + rect.height / 2 - PREVIEW_H / 2, window.innerHeight - PREVIEW_H - 8)),
    })
  }

  return (
    <li className="deck-row">
      <span className="deck-count">
        <button className="count-btn" onClick={() => onChangeCount(card, -1)}>−</button>
        {card.count}
        <button className="count-btn" onClick={() => onChangeCount(card, +1)}>+</button>
      </span>
      <span
        className="deck-name"
        onMouseEnter={showPreview}
        onMouseLeave={() => setPreview(null)}
      >
        {card.name}
      </span>
      {preview && (
        <img
          className="card-hover-preview"
          src={card.imageUrl}
          alt={card.name}
          style={{ left: preview.left, top: preview.top }}
        />
      )}
      <span className="deck-mana">{card.manaCost}</span>
      <a
        className="icon-btn edhrec-link"
        href={edhrecUrl(card, isTheCommander)}
        target="_blank"
        rel="noopener noreferrer"
        title={isTheCommander ? 'Commander page on EDHREC' : 'View on EDHREC'}
      >
        ↗
      </a>
      {isCommanderFormat && canBeCommander(card) && (
        <button
          className={`icon-btn crown ${isTheCommander ? 'active' : ''}`}
          title={isTheCommander ? 'Remove as commander' : 'Make commander'}
          onClick={() => onSetCommander(card)}
        >
          ♛
        </button>
      )}
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
  onSetFormat,
  onSetCommander,
  onChangeCount,
  onToggleBoard,
  onRemove,
  onSave,
  onClear,
  onImport,
  onExport,
  saving,
  user,
}) {
  const format = deck.format ?? 'standard'
  const isCommanderFormat = format === 'commander'
  const commander = isCommanderFormat
    ? deck.cards.find((c) => c.id === deck.commanderId)
    : null

  const main = deck.cards.filter((c) => c.board !== 'side')
  const side = deck.cards.filter((c) => c.board === 'side')
  const sideCount = side.reduce((n, c) => n + c.count, 0)

  const groups = TYPE_ORDER.map((t) => ({
    type: t,
    cards: main.filter((c) => c !== commander && primaryType(c) === t),
  })).filter((g) => g.cards.length)

  const rowProps = { isCommanderFormat, onSetCommander, onChangeCount, onToggleBoard, onRemove }

  return (
    <aside className="deck-panel">
      <input
        className="input deck-title"
        value={deck.name}
        onChange={(e) => onRename(e.target.value)}
        placeholder="Deck name"
      />
      <select className="input format-select" value={format} onChange={(e) => onSetFormat(e.target.value)}>
        <option value="standard">60-Card (Standard / Casual)</option>
        <option value="commander">Commander (EDH)</option>
      </select>

      <FormatChecks format={format} main={main} commander={commander} />

      {isCommanderFormat && (
        <details className="rules-ref">
          <summary>Commander rules &amp; basics</summary>
          <ul>
            <li>Exactly 100 cards including your commander; every other card is a single copy (basic lands excepted).</li>
            <li>Your commander is a legendary creature — or a card that says it "can be your commander".</li>
            <li>Every card's color identity (mana symbols anywhere on the card) must fit within your commander's color identity.</li>
            <li>You start at 40 life. Your commander starts in the command zone and costs {'{2}'} more for each time it has been cast from there.</li>
            <li>21 combat damage from a single commander eliminates a player.</li>
            <li>It's a multiplayer format — decks aim for fun, resilient games, usually with ~36–38 lands and plenty of ramp and card draw.</li>
          </ul>
        </details>
      )}

      {isCommanderFormat && (
        <div className="deck-group commander-slot">
          <h4>Commander</h4>
          {commander ? (
            <ul>
              <CardRow card={commander} isTheCommander {...rowProps} />
            </ul>
          ) : (
            <p className="muted">Add a legendary creature, then crown it with ♛.</p>
          )}
        </div>
      )}

      <ManaCurve cards={main} />

      {groups.map((g) => (
        <div key={g.type} className="deck-group">
          <h4>{g.type} ({g.cards.reduce((n, c) => n + c.count, 0)})</h4>
          <ul>
            {g.cards.map((c) => (
              <CardRow key={c.id} card={c} {...rowProps} />
            ))}
          </ul>
        </div>
      ))}

      {side.length > 0 && (
        <div className="deck-group deck-sideboard">
          <h4>Sideboard ({sideCount})</h4>
          <ul>
            {side.map((c) => (
              <CardRow key={c.id} card={c} {...rowProps} />
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
      <div className="deck-actions">
        <button className="btn" onClick={onImport}>Import</button>
        <button className="btn" onClick={onExport} disabled={deck.cards.length === 0}>Export</button>
      </div>
      {!user && <p className="muted">Sign in to save decks.</p>}
    </aside>
  )
}

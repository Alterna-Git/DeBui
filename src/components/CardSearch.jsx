import { useState } from 'react'
import { searchCards } from '../api/mtg'

const COLORS = [
  { code: 'W', label: 'White' },
  { code: 'U', label: 'Blue' },
  { code: 'B', label: 'Black' },
  { code: 'R', label: 'Red' },
  { code: 'G', label: 'Green' },
]

export default function CardSearch({ onAddCard }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [colors, setColors] = useState([])
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function runSearch(e) {
    e?.preventDefault()
    if (!name && !type && !colors.length) return
    setLoading(true)
    setError(null)
    try {
      setResults(await searchCards({ name, type, colors }))
    } catch (err) {
      setError(err.message)
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  function toggleColor(code) {
    setColors((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]))
  }

  return (
    <section>
      <form className="search-form" onSubmit={runSearch}>
        <input
          className="input"
          placeholder="Card name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          placeholder="Type (e.g. Creature, Instant)…"
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
        <div className="color-filters">
          {COLORS.map(({ code, label }) => (
            <button
              type="button"
              key={code}
              className={`color-chip color-${code} ${colors.includes(code) ? 'active' : ''}`}
              title={label}
              onClick={() => toggleColor(code)}
            >
              {code}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {results?.length === 0 && <p className="muted">No cards found.</p>}

      {results?.length > 0 && (
        <div className="card-grid">
          {results.map((card) => (
            <div key={card.id} className="card-tile">
              {card.imageUrl ? (
                <img src={card.imageUrl} alt={card.name} loading="lazy" />
              ) : (
                <div className="card-placeholder">
                  <strong>{card.name}</strong>
                  <span>{card.manaCost}</span>
                  <span>{card.type}</span>
                  <p>{card.text}</p>
                </div>
              )}
              <button className="btn btn-add" onClick={() => onAddCard(card)}>
                + Add
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

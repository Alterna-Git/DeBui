import { useState } from 'react'

// Single-series bar chart of nonland card counts by mana value (0–6, 7+).
// One hue, no legend (the title names the series); per-bar hover tooltip.
const BINS = ['0', '1', '2', '3', '4', '5', '6', '7+']

export default function ManaCurve({ cards }) {
  const [hover, setHover] = useState(null)

  const counts = new Array(BINS.length).fill(0)
  for (const card of cards) {
    if (card.types?.includes('Land')) continue
    const bin = Math.min(Math.floor(card.cmc ?? 0), 7)
    counts[bin] += card.count
  }
  const max = Math.max(...counts, 1)

  return (
    <div className="mana-curve">
      <h4 className="curve-title">Mana curve</h4>
      <div className="curve-plot" onMouseLeave={() => setHover(null)}>
        {counts.map((count, i) => (
          <div
            key={BINS[i]}
            className="curve-col"
            onMouseEnter={() => setHover(i)}
          >
            {hover === i && (
              <div className="curve-tooltip" role="status">
                {count} card{count === 1 ? '' : 's'} at MV {BINS[i]}
              </div>
            )}
            <div className="curve-bar-track">
              <div
                className="curve-bar"
                style={{ height: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="curve-label">{BINS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

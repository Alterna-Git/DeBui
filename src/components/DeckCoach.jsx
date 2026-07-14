import { useState } from 'react'
import { analyzeDeckWithAI, withWakeLock } from '../api/ai'

const COUNT_LABELS = {
  lands: 'Lands',
  ramp: 'Ramp',
  cardDraw: 'Card draw',
  removal: 'Removal',
  boardWipes: 'Board wipes',
}

export default function DeckCoach({ user, deck, onApplySwap }) {
  const [analysis, setAnalysis] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState({})

  const mainCount = deck.cards
    .filter((c) => c.board !== 'side')
    .reduce((n, c) => n + c.count, 0)

  async function analyze() {
    setBusy(true)
    setError(null)
    try {
      setAnalysis(await withWakeLock(() => analyzeDeckWithAI(deck)))
      setApplied({})
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function apply(i, s) {
    setApplied((a) => ({ ...a, [i]: 'working' }))
    const ok = await onApplySwap(s.cut, s.add)
    setApplied((a) => ({ ...a, [i]: ok ? 'done' : 'failed' }))
  }

  if (!user) return <p className="muted">Sign in to use the deck coach.</p>

  return (
    <section className="deck-coach">
      <h3>Deck Coach</h3>
      <p className="muted">
        Get an honest AI review of <strong>{deck.name}</strong> ({mainCount} cards):
        what works, what's missing, and specific swaps to make it better.
      </p>
      <button className="btn btn-primary" onClick={analyze} disabled={busy || mainCount === 0}>
        {busy ? 'Analyzing deeply… (this can take a few minutes)' : analysis ? 'Re-analyze deck' : 'Analyze deck'}
      </button>
      {mainCount === 0 && <p className="muted">Add cards to your deck first.</p>}
      {error && <p className="error">{error}</p>}

      {analysis && !busy && (
        <div className="coach-report">
          <div className="coach-header">
            {analysis.rating != null && <span className="coach-rating">{analysis.rating}/10</span>}
            <p className="coach-archetype">{analysis.archetype}</p>
          </div>

          <div className="coach-columns">
            {analysis.strengths.length > 0 && (
              <div>
                <h4>Strengths</h4>
                <ul>{analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            {analysis.weaknesses.length > 0 && (
              <div>
                <h4>Weaknesses</h4>
                <ul>{analysis.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>

          {Object.keys(analysis.counts).length > 0 && (
            <div className="coach-ratios">
              <h4>Deck ratios (current → recommended)</h4>
              <ul>
                {Object.entries(COUNT_LABELS).map(([key, label]) => {
                  const has = analysis.counts[key]
                  const want = analysis.targets[key]
                  if (has == null && want == null) return null
                  const short = has != null && want != null && has < want
                  return (
                    <li key={key} className={short ? 'ratio-short' : ''}>
                      {label}: {has ?? '?'} → {want ?? '?'}{short ? ` (add ${want - has})` : ' ✓'}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {analysis.suggestions.length > 0 && (
            <div className="coach-suggestions">
              <h4>Suggested swaps</h4>
              {analysis.suggestions.map((s, i) => (
                <div key={i} className="swap-row">
                  <div className="swap-cards">
                    <span className="swap-cut">− {s.cut}</span>
                    <span className="swap-add">+ {s.add}</span>
                  </div>
                  <p className="swap-reason">{s.reason}</p>
                  <button
                    className="btn swap-apply"
                    disabled={applied[i] === 'working' || applied[i] === 'done'}
                    onClick={() => apply(i, s)}
                  >
                    {applied[i] === 'done' ? 'Applied ✓'
                      : applied[i] === 'working' ? 'Applying…'
                      : applied[i] === 'failed' ? 'Retry (card not found)'
                      : 'Apply swap'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {analysis.howToPlay && (
            <div className="coach-howto">
              <h4>How to play this deck</h4>
              {analysis.howToPlay.gameplan && <p>{analysis.howToPlay.gameplan}</p>}
              {analysis.howToPlay.keyCards.length > 0 && (
                <ul className="howto-keycards">
                  {analysis.howToPlay.keyCards.map((k, i) => (
                    <li key={i}><strong>{k.name}</strong>{k.role ? ` — ${k.role}` : ''}</li>
                  ))}
                </ul>
              )}
              <ul className="howto-stages">
                {analysis.howToPlay.mulligan && <li><strong>Opening hand:</strong> {analysis.howToPlay.mulligan}</li>}
                {analysis.howToPlay.early && <li><strong>Early game (turns 1–3):</strong> {analysis.howToPlay.early}</li>}
                {analysis.howToPlay.mid && <li><strong>Mid game (turns 4–6):</strong> {analysis.howToPlay.mid}</li>}
                {analysis.howToPlay.late && <li><strong>Late game (turn 7+):</strong> {analysis.howToPlay.late}</li>}
              </ul>
            </div>
          )}

          {analysis.plan.length > 0 && (
            <div className="coach-plan">
              <h4>How to keep improving</h4>
              <ol>{analysis.plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

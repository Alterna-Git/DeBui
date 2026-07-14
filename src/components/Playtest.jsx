import { useState } from 'react'
import { playtestDeckWithAI, withWakeLock } from '../api/ai'
import CardName from './CardName'

export default function Playtest({ user, deck }) {
  const [game, setGame] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const main = deck.cards.filter((c) => c.board !== 'side')
  const total = main.reduce((n, c) => n + c.count, 0)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setGame(await withWakeLock(() => playtestDeckWithAI(deck)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!user) return <p className="muted">Sign in to playtest your deck.</p>

  return (
    <section className="playtest">
      <h3>Playtest</h3>
      <p className="muted">
        Draw a real random opening hand from <strong>{deck.name}</strong> and let the AI
        pilot it through a simulated game against a casual pod — play by play, using
        exactly the cards you drew, with an honest read on how the deck ran.
      </p>
      <button className="btn btn-primary" onClick={run} disabled={busy || total < 40}>
        {busy ? 'Playing it out… (a few minutes)' : game ? 'Playtest again (new hand)' : 'Draw a hand & playtest'}
      </button>
      {total < 40 && <p className="muted">Add more cards first — playtesting needs a mostly complete deck.</p>}
      {error && <p className="error">{error}</p>}

      {game && !busy && (
        <div className="game-log">
          <div>
            <h4>Opening hand</h4>
            <div className="hand-cards">
              {game.hand.map((name, i) => (
                <span key={i} className="hand-card"><CardName name={name} /></span>
              ))}
            </div>
            <p className={game.mulligan.decision === 'mulligan' ? 'warning' : 'muted'}>
              {game.mulligan.decision === 'mulligan' ? '↻ Mulligan' : '✓ Keep'} — {game.mulligan.reason}
            </p>
          </div>

          <div className="turns">
            {game.turns.map((t, i) => (
              <div key={i} className="turn-row">
                <span className="turn-num">T{t.turn}</span>
                <div className="turn-body">
                  <p className="turn-play">{t.play}</p>
                  <p className="turn-board">{t.board}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="game-result">{game.result}</p>
          <p className="game-verdict">{game.verdict}</p>
          {game.observations.length > 0 && (
            <div>
              <h4>Takeaways</h4>
              <ul>{game.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

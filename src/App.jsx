import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { saveDeck } from './api/decks'
import AuthButton from './components/AuthButton'
import CardSearch from './components/CardSearch'
import DeckPanel from './components/DeckPanel'
import MyDecks from './components/MyDecks'
import AiBuilder from './components/AiBuilder'

const EMPTY_DECK = { id: null, name: 'Untitled Deck', format: 'standard', commanderId: null, cards: [] }

export default function App() {
  const [user, setUser] = useState(null)
  const [view, setView] = useState('search') // 'search' | 'ai' | 'decks'
  const [deck, setDeck] = useState(EMPTY_DECK)
  const [saving, setSaving] = useState(false)

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  function addCard(card) {
    setDeck((cur) => {
      const existing = cur.cards.find((c) => c.id === card.id && c.board !== 'side')
      if (existing) {
        return {
          ...cur,
          cards: cur.cards.map((c) => (c === existing ? { ...c, count: c.count + 1 } : c)),
        }
      }
      return { ...cur, cards: [...cur.cards, { ...card, count: 1, board: 'main' }] }
    })
  }

  function changeCount(card, delta) {
    setDeck((cur) => ({
      ...cur,
      cards: cur.cards
        .map((c) => (c === card ? { ...c, count: c.count + delta } : c))
        .filter((c) => c.count > 0),
    }))
  }

  function toggleBoard(card) {
    setDeck((cur) => ({
      ...cur,
      cards: cur.cards.map((c) =>
        c === card ? { ...c, board: c.board === 'side' ? 'main' : 'side' } : c,
      ),
    }))
  }

  function removeCard(card) {
    setDeck((cur) => ({
      ...cur,
      commanderId: cur.commanderId === card.id ? null : cur.commanderId,
      cards: cur.cards.filter((c) => c !== card),
    }))
  }

  function setFormat(format) {
    setDeck((cur) => ({ ...cur, format }))
  }

  function setCommander(card) {
    setDeck((cur) => ({
      ...cur,
      commanderId: cur.commanderId === card.id ? null : card.id,
    }))
  }

  async function handleSave() {
    if (!user) return
    setSaving(true)
    try {
      const id = await saveDeck(user.uid, deck)
      setDeck((cur) => ({ ...cur, id }))
    } catch (err) {
      alert(`Could not save deck: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  function handleAiDeck(deckName, cards, commander) {
    setDeck((cur) => ({
      ...cur,
      name: !cur.name || cur.name === 'Untitled Deck' ? deckName || 'AI Deck' : cur.name,
      commanderId: commander?.id ?? null,
      cards: [
        ...(commander ? [{ ...commander, count: 1, board: 'main' }] : []),
        ...cards.filter((c) => c.id !== commander?.id).map((c) => ({ ...c, board: 'main' })),
        ...cur.cards.filter((c) => c.board === 'side'),
      ],
    }))
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>DeBui <span className="subtitle">MTG Deck Builder</span></h1>
        <nav className="tabs">
          <button className={view === 'search' ? 'tab active' : 'tab'} onClick={() => setView('search')}>
            Card Search
          </button>
          <button className={view === 'ai' ? 'tab active' : 'tab'} onClick={() => setView('ai')}>
            AI Builder
          </button>
          <button className={view === 'decks' ? 'tab active' : 'tab'} onClick={() => setView('decks')}>
            My Decks
          </button>
        </nav>
        <a className="btn android-link" href="/debui.apk" download>
          ▾ Android app
        </a>
        <AuthButton user={user} />
      </header>

      <main className="app-main">
        <div className="app-content">
          {view === 'search' && <CardSearch onAddCard={addCard} />}
          {view === 'ai' && (
            <AiBuilder
              user={user}
              deck={deck}
              onDeckBuilt={(name, cards, commander) => { handleAiDeck(name, cards, commander); setView('search') }}
            />
          )}
          {view === 'decks' && (
            <MyDecks
              user={user}
              onOpenDeck={(d) => { setDeck(d); setView('search') }}
            />
          )}
        </div>
        <DeckPanel
          deck={deck}
          user={user}
          saving={saving}
          onRename={(name) => setDeck((cur) => ({ ...cur, name }))}
          onSetFormat={setFormat}
          onSetCommander={setCommander}
          onChangeCount={changeCount}
          onToggleBoard={toggleBoard}
          onRemove={removeCard}
          onSave={handleSave}
          onClear={() => setDeck(EMPTY_DECK)}
        />
      </main>
    </div>
  )
}

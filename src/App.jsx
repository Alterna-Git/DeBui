import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import { saveDeck } from './api/decks'
import { findCardByName } from './api/mtg'
import AuthButton from './components/AuthButton'
import CardSearch from './components/CardSearch'
import DeckPanel from './components/DeckPanel'
import MyDecks from './components/MyDecks'
import AiBuilder from './components/AiBuilder'
import DeckCoach from './components/DeckCoach'
import { ImportModal, ExportModal } from './components/ImportExport'

const EMPTY_DECK = { id: null, name: 'Untitled Deck', format: 'commander', commanderId: null, cards: [] }

export default function App() {
  const [user, setUser] = useState(null)
  const [view, setView] = useState('search') // 'search' | 'ai' | 'decks'
  const [deck, setDeck] = useState(EMPTY_DECK)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState(null) // 'import' | 'export' | null

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

  // Coach swap: remove `cutName` from the main deck and add `addName` in its place.
  async function applySwap(cutName, addName) {
    try {
      const card = await findCardByName(addName)
      if (!card) return false
      setDeck((cur) => {
        const cut = cur.cards.find(
          (c) => c.board !== 'side' && c.name.toLowerCase() === cutName.toLowerCase(),
        )
        const rest = cut ? cur.cards.filter((c) => c !== cut) : [...cur.cards]
        const alreadyIn = rest.some((c) => c.id === card.id && c.board !== 'side')
        return {
          ...cur,
          commanderId: cut && cur.commanderId === cut.id ? null : cur.commanderId,
          cards: alreadyIn ? rest : [...rest, { ...card, count: 1, board: 'main' }],
        }
      })
      return true
    } catch {
      return false
    }
  }

  function handleImported({ cards, commander }) {
    setDeck((cur) => ({
      ...cur,
      id: null,
      name: cur.name && cur.name !== 'Untitled Deck' ? cur.name : 'Imported Deck',
      format: 'commander',
      commanderId: commander?.id ?? null,
      cards: [
        ...(commander ? [{ ...commander, count: 1, board: 'main' }] : []),
        ...cards.filter((c) => !(commander && c.id === commander.id && c.board === 'main')),
      ],
    }))
  }

  function handleAiDeck(deckName, cards, commander) {
    setDeck((cur) => ({
      ...cur,
      name: !cur.name || cur.name === 'Untitled Deck' ? deckName || 'AI Deck' : cur.name,
      format: 'commander',
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
          <button className={view === 'coach' ? 'tab active' : 'tab'} onClick={() => setView('coach')}>
            Coach
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
          {view === 'coach' && <DeckCoach user={user} deck={deck} onApplySwap={applySwap} />}
          {view === 'decks' && (
            <MyDecks
              user={user}
              onOpenDeck={(d) => { setDeck({ format: 'commander', commanderId: null, ...d }); setView('search') }}
            />
          )}
        </div>
        <DeckPanel
          deck={deck}
          user={user}
          saving={saving}
          onRename={(name) => setDeck((cur) => ({ ...cur, name }))}
          onSetCommander={setCommander}
          onChangeCount={changeCount}
          onToggleBoard={toggleBoard}
          onRemove={removeCard}
          onSave={handleSave}
          onClear={() => setDeck(EMPTY_DECK)}
          onImport={() => setModal('import')}
          onExport={() => setModal('export')}
        />
      </main>
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onImported={handleImported} />}
      {modal === 'export' && <ExportModal deck={deck} onClose={() => setModal(null)} />}
    </div>
  )
}

import { useState } from 'react'
import { exportDecklist, importDecklist } from '../api/decklist'

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ExportModal({ deck, onClose }) {
  const text = exportDecklist(deck)
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function download() {
    const safe = (deck.name || 'deck').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe || 'deck'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal title="Export decklist" onClose={onClose}>
      <p className="muted">Standard text format — paste it into Moxfield, Archidekt, Arena, anywhere.</p>
      <textarea className="input decklist-text" readOnly value={text} rows={14} onFocus={(e) => e.target.select()} />
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy to clipboard'}</button>
        <button className="btn" onClick={download}>Download .txt</button>
      </div>
    </Modal>
  )
}

export function ImportModal({ onClose, onImported }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function runImport() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const { cards, commander, unresolved } = await importDecklist(text, setStatus)
      onImported({ cards, commander })
      const total = cards.reduce((n, c) => n + c.count, 0) + (commander ? 1 : 0)
      setResult({ total, unresolved })
      setStatus(null)
    } catch (err) {
      setError(err.message)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Import decklist" onClose={onClose}>
      <p className="muted">
        Paste a decklist — one card per line ("4 Lightning Bolt"). Commander / Deck / Sideboard
        headers, Arena set codes, and "SB:" prefixes are all understood.
      </p>
      <textarea
        className="input decklist-text"
        rows={14}
        placeholder={'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring\n4 Goblin Chieftain\n…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={runImport} disabled={busy || !text.trim()}>
          {busy ? 'Importing…' : 'Import deck'}
        </button>
        {result && <button className="btn" onClick={onClose}>Done</button>}
      </div>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <p className="muted">
          Imported {result.total} cards into the deck panel.
          {result.unresolved.length > 0 && (
            <> Couldn't find: {result.unresolved.join(', ')}</>
          )}
        </p>
      )}
    </Modal>
  )
}

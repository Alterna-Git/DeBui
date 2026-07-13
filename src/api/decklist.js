import { findCardByName, findCardsByNames } from './mtg.js'

// Text decklist format used by Moxfield/Arena/MTGO exports:
//   Commander            (section headers, optional)
//   1 Krenko, Mob Boss
//
//   Deck
//   4 Lightning Bolt (M10) 133   (set/collector suffixes tolerated)
//   4x Goblin Chieftain           ("Nx" counts tolerated)
//   SB: 2 Negate                  (old-style sideboard prefix)

const MAIN_HEADERS = ['deck', 'main', 'maindeck', 'main deck', 'mainboard']
const SIDE_HEADERS = ['sideboard', 'side', 'side board']
const COMMANDER_HEADERS = ['commander', 'commanders']
const SKIP_HEADERS = ['about', 'companion', 'tokens', 'considering', 'maybeboard']

export function exportDecklist(deck) {
  const main = deck.cards.filter((c) => c.board !== 'side')
  const side = deck.cards.filter((c) => c.board === 'side')
  const commander = main.find((c) => c.id === deck.commanderId)

  const lines = []
  if (commander) lines.push('Commander', `1 ${commander.name}`, '')
  lines.push('Deck')
  for (const c of main) {
    if (c !== commander) lines.push(`${c.count} ${c.name}`)
  }
  if (side.length) {
    lines.push('', 'Sideboard')
    for (const c of side) lines.push(`${c.count} ${c.name}`)
  }
  return lines.join('\n') + '\n'
}

export function parseDecklist(text) {
  const entries = []
  let section = 'main'
  let usedHeaders = false
  let blankBreak = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      if (entries.length) blankBreak = true
      continue
    }
    if (/^(#|\/\/)/.test(line)) continue

    const header = line.replace(/:$/, '').toLowerCase()
    if (MAIN_HEADERS.includes(header)) { section = 'main'; usedHeaders = true; continue }
    if (SIDE_HEADERS.includes(header)) { section = 'side'; usedHeaders = true; continue }
    if (COMMANDER_HEADERS.includes(header)) { section = 'commander'; usedHeaders = true; continue }
    if (SKIP_HEADERS.includes(header)) { section = 'skip'; usedHeaders = true; continue }
    if (section === 'skip') continue

    let rest = line
    let side = false
    if (/^sb:\s*/i.test(rest)) {
      side = true
      rest = rest.replace(/^sb:\s*/i, '')
    }
    let count = 1
    const m = rest.match(/^(\d+)\s*x?\s+(.+)$/i)
    if (m) {
      count = Math.min(Math.max(parseInt(m[1], 10), 1), 99)
      rest = m[2]
    }
    // Strip Arena-style "(SET) 123" and foil/etch markers from the end.
    const name = rest
      .replace(/\s*\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, '')
      .replace(/\s*\*[A-Za-z]+\*\s*$/, '')
      .trim()
    if (!name) continue

    const effective = side
      ? 'side'
      : usedHeaders
        ? section
        : blankBreak
          ? 'side' // headerless lists: blank line separates main from sideboard
          : 'main'
    entries.push({ count, name, section: effective })
  }
  return entries
}

// Parses the text, resolves every card via Scryfall (batch first, fuzzy for
// stragglers), and returns deck-ready cards plus anything unresolvable.
export async function importDecklist(text, onProgress) {
  const entries = parseDecklist(text)
  if (!entries.length) {
    throw new Error('No cards found — paste one card per line, e.g. "4 Lightning Bolt".')
  }

  onProgress?.(`Looking up ${entries.length} cards…`)
  const unique = [...new Set(entries.map((e) => e.name))]
  const { found, missing } = await findCardsByNames(unique)

  const unresolved = []
  for (let i = 0; i < missing.length; i++) {
    const name = missing[i]
    onProgress?.(`Searching for ${name}… (${i + 1}/${missing.length})`)
    try {
      const card = await findCardByName(name)
      if (card) found.set(name.toLowerCase(), card)
      else unresolved.push(name)
    } catch {
      unresolved.push(name)
    }
  }

  let commander = null
  const cards = []
  for (const e of entries) {
    const card = found.get(e.name.toLowerCase())
    if (!card) continue
    if (e.section === 'commander') {
      if (!commander) commander = card
      continue
    }
    const board = e.section === 'side' ? 'side' : 'main'
    const existing = cards.find((c) => c.id === card.id && c.board === board)
    if (existing) existing.count += e.count
    else cards.push({ ...card, count: e.count, board })
  }
  return { cards, commander, unresolved }
}

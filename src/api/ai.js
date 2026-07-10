import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { findCardByName, findCardsByNames } from './mtg'

const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }

function isBasicLand(card) {
  return card.types?.includes('Basic')
}

function fitsIdentity(card, identity) {
  // Cards missing identity data (shouldn't happen from Scryfall) get a pass.
  return !card.colorIdentity || card.colorIdentity.every((c) => identity.has(c))
}

// Asks the Cloud Function (which holds the OpenAI key) for deck additions,
// treating the user's current cards as locked. Resolves every suggested name
// against Scryfall, then — for Commander — enforces the rules on the ADDITIONS
// (color identity, banlist, singleton, exactly 100 cards). The user's own
// locked cards are never removed; the deck panel checklist flags those instead.
export async function buildDeckWithAI(prompt, format, currentDeck, onProgress) {
  const isCommanderFormat = format === 'commander'
  const mainExisting = (currentDeck?.cards ?? []).filter((c) => c.board !== 'side')
  const existingCommander = isCommanderFormat
    ? mainExisting.find((c) => c.id === currentDeck.commanderId) ?? null
    : null
  const lockedCards = mainExisting.filter((c) => c !== existingCommander)

  // 5-minute timeout: reasoning models can take a couple of minutes on a full deck.
  const call = httpsCallable(functions, 'buildDeckWithAI', { timeout: 300_000 })
  const { data } = await call({
    prompt,
    format,
    existing: lockedCards.map((c) => ({ name: c.name, count: c.count })),
    commanderName: existingCommander?.name ?? null,
  })
  const { deckName, commander: aiCommanderName, cards } = data

  const unresolved = []
  const notes = []

  let commander = existingCommander
  if (!commander && aiCommanderName) {
    onProgress?.(`Looking up commander ${aiCommanderName}…`)
    try {
      commander = await findCardByName(aiCommanderName)
    } catch {
      /* fall through to unresolved */
    }
    if (!commander) unresolved.push(aiCommanderName)
  }

  // Resolve the whole list in batches (1-2 requests), then fuzzy-retry only
  // the names Scryfall didn't recognize exactly.
  onProgress?.(`Looking up ${cards.length} cards…`)
  const clampCount = (count) => Math.min(Math.max(count, 1), 99)
  let additions = []
  let missing = []
  try {
    const batch = await findCardsByNames(cards.map((c) => c.name))
    for (const { name, count } of cards) {
      const card = batch.found.get(name.toLowerCase())
      if (card) additions.push({ ...card, count: clampCount(count) })
    }
    missing = batch.missing
  } catch {
    // Batch lookup failed entirely — fall back to resolving one by one.
    missing = cards.map((c) => c.name)
  }
  const countByName = new Map(cards.map((c) => [c.name, c.count]))
  for (let i = 0; i < missing.length; i++) {
    const name = missing[i]
    onProgress?.(`Searching for ${name}… (${i + 1}/${missing.length})`)
    try {
      const card = await findCardByName(name)
      if (card) {
        additions.push({ ...card, count: clampCount(countByName.get(name) ?? 1) })
      } else {
        unresolved.push(name)
      }
    } catch {
      unresolved.push(name)
    }
  }

  // Merges an addition into the deck; same-id basics stack, other repeats are skipped.
  function mergeInto(merged, addition) {
    const existing = merged.find((c) => c.id === addition.id)
    if (!existing) {
      merged.push(addition)
    } else if (isBasicLand(addition)) {
      existing.count += addition.count
    }
  }

  if (!isCommanderFormat || !commander) {
    if (isCommanderFormat && !commander) {
      notes.push('No commander could be determined — additions merged without Commander enforcement.')
    }
    const merged = lockedCards.map((c) => ({ ...c }))
    for (const a of additions) mergeInto(merged, a)
    return { deckName, commander, cards: merged, unresolved, notes }
  }

  onProgress?.('Enforcing Commander rules…')
  const identity = new Set(commander.colorIdentity ?? [])
  const identityLabel = [...identity].join('') || 'colorless'

  additions = additions.filter((c) => c.id !== commander.id)

  const offColor = additions.filter((c) => !fitsIdentity(c, identity))
  if (offColor.length) {
    notes.push(`Removed suggestions outside ${identityLabel} identity: ${offColor.map((c) => c.name).join(', ')}`)
    additions = additions.filter((c) => fitsIdentity(c, identity))
  }

  const banned = additions.filter((c) => c.commanderLegal === false)
  if (banned.length) {
    notes.push(`Removed suggestions not legal in Commander: ${banned.map((c) => c.name).join(', ')}`)
    additions = additions.filter((c) => c.commanderLegal !== false)
  }

  // Singleton: additions may not repeat themselves or any locked nonbasic.
  const lockedNonbasicIds = new Set(lockedCards.filter((c) => !isBasicLand(c)).map((c) => c.id))
  const seen = new Set()
  additions = additions.filter((c) => {
    if (isBasicLand(c)) return true
    if (lockedNonbasicIds.has(c.id) || seen.has(c.id)) return false
    seen.add(c.id)
    return true
  }).map((c) => (isBasicLand(c) ? c : { ...c, count: 1 }))

  const merged = lockedCards.map((c) => ({ ...c }))
  for (const a of additions) mergeInto(merged, a)

  const total = () => merged.reduce((n, c) => n + c.count, 0)
  const lockedTotal = lockedCards.reduce((n, c) => n + c.count, 0)

  if (lockedTotal > 99) {
    notes.push(`Your own cards already total ${lockedTotal + 1} with the commander — over 100. Nothing was removed automatically; trim the deck manually.`)
    return { deckName, commander, cards: merged, unresolved, notes }
  }

  // Exactly 99 + commander: shave basics first, then drop additions from the end.
  if (total() > 99) {
    for (let i = merged.length - 1; i >= 0 && total() > 99; i--) {
      const c = merged[i]
      if (isBasicLand(c) && c.count > 1) {
        c.count = Math.max(1, c.count - (total() - 99))
      }
    }
    const cut = []
    while (total() > 99 && merged.length > lockedCards.length) {
      cut.push(merged.pop().name)
    }
    if (cut.length) notes.push(`Cut to reach 100: ${cut.join(', ')}`)
  }

  // Short? Fill with basics matching the commander's identity, round-robin.
  if (total() < 99) {
    const basicNames = identity.size ? [...identity].map((c) => BASICS[c]) : ['Wastes']
    const deficit = 99 - total()
    for (let i = 0; i < deficit; i++) {
      const name = basicNames[i % basicNames.length]
      const existing = merged.find((c) => c.name === name)
      if (existing) {
        existing.count += 1
        continue
      }
      const land = await findCardByName(name)
      if (land) merged.push({ ...land, count: 1 })
    }
    notes.push(`Added ${deficit} basic land${deficit === 1 ? '' : 's'} to reach exactly 100`)
  }

  return { deckName, commander, cards: merged, unresolved, notes }
}

import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot, deleteDoc } from 'firebase/firestore'
import { functions, db, auth } from '../firebase'
import { findCardByName, findCardsByNames } from './mtg'

// Codes where the server rejected the request cleanly — no point waiting for
// the job doc, the function isn't running.
const FAST_FAIL = new Set([
  'functions/invalid-argument',
  'functions/unauthenticated',
  'functions/resource-exhausted',
  'functions/unavailable',
])

// Calls a Cloud Function, but also watches a Firestore "job" doc the function
// writes its result to. On mobile the connection often drops mid-call (screen
// lock, app switch) even though the function finishes — the job doc delivers
// the result anyway.
function callResilient(name, payload) {
  const uid = auth.currentUser?.uid
  if (!uid || typeof crypto?.randomUUID !== 'function') {
    return httpsCallable(functions, name, { timeout: 300_000 })(payload)
  }
  const jobId = crypto.randomUUID()
  const jobRef = doc(db, 'users', uid, 'jobs', jobId)

  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      unsubscribe()
      deleteDoc(jobRef).catch(() => {})
      fn(value)
    }
    unsubscribe = onSnapshot(
      jobRef,
      (snap) => {
        const job = snap.data()
        if (!job) return
        if (job.status === 'done') finish(resolve, { data: job.result })
        else if (job.status === 'error') finish(reject, new Error(job.message))
      },
      () => {}, // listener failure: the direct call is still in flight
    )
    httpsCallable(functions, name, { timeout: 300_000 })({ ...payload, jobId })
      .then((res) => finish(resolve, res))
      .catch((err) => {
        if (FAST_FAIL.has(err?.code)) {
          finish(reject, err)
        } else {
          // Likely a dropped connection — the function may still finish and
          // write the job doc. Give it time before giving up.
          setTimeout(() => finish(reject, err), 240_000)
        }
      })
  })
}

const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }

// Keeps the phone screen awake during a long AI call — Android pauses the
// page (and drops the connection) when the screen locks.
export async function withWakeLock(work) {
  let lock = null
  try {
    lock = await navigator.wakeLock?.request('screen')
  } catch {
    /* unsupported or denied — proceed without it */
  }
  try {
    return await work()
  } finally {
    lock?.release().catch(() => {})
  }
}

// Playtest: draw a REAL random hand client-side (honest shuffle of the actual
// deck), then have the AI pilot a simulated game using exactly those draws.
export async function playtestDeckWithAI(deck) {
  const main = deck.cards.filter((c) => c.board !== 'side')
  const commander = main.find((c) => c.id === deck.commanderId)

  const pool = []
  for (const c of main) {
    if (c === commander) continue
    for (let i = 0; i < c.count; i++) pool.push(c.name)
  }
  if (pool.length < 40) {
    throw new Error('The deck is too small to playtest — add more cards first.')
  }
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const hand = pool.slice(0, 7)
  const library = pool.slice(7, 47) // covers ~10 turns of draws plus a mulligan

  const { data } = await callResilient('playtestDeck', {
    commanderName: commander?.name ?? null,
    cards: main.filter((c) => c !== commander).map((c) => ({ name: c.name, count: c.count })),
    hand,
    library,
  })
  return { ...data, hand }
}

// Sends the current deck to the coach function and returns its structured critique.
export async function analyzeDeckWithAI(deck) {
  const main = deck.cards.filter((c) => c.board !== 'side')
  const commander = main.find((c) => c.id === deck.commanderId)
  const { data } = await callResilient('analyzeDeck', {
    commanderName: commander?.name ?? null,
    cards: main
      .filter((c) => c !== commander)
      .map((c) => ({ name: c.name, count: c.count })),
  })
  return data
}

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
export async function buildDeckWithAI(prompt, currentDeck, onProgress) {
  const mainExisting = (currentDeck?.cards ?? []).filter((c) => c.board !== 'side')
  const existingCommander =
    mainExisting.find((c) => c.id === currentDeck.commanderId) ?? null
  const lockedCards = mainExisting.filter((c) => c !== existingCommander)

  const { data } = await callResilient('buildDeckWithAI', {
    prompt,
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

  if (!commander) {
    notes.push('No commander could be determined — additions merged without Commander enforcement.')
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

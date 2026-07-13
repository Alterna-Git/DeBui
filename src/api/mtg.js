// Card data client for the Scryfall API (https://scryfall.com/docs/api) —
// the same source Moxfield uses. Free, no key, updated within hours of new
// set releases. Results are cached in localStorage for 24h.

const API_BASE = 'https://api.scryfall.com'
const CACHE_PREFIX = 'scry-cache-v3:'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw)
    if (Date.now() - at > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key)
      return null
    }
    return data
  } catch {
    return null
  }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // localStorage full — evict our oldest entries and retry once
    evictOldest()
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
    } catch {
      /* give up silently; caching is best-effort */
    }
  }
}

function evictOldest() {
  const entries = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(CACHE_PREFIX)) {
      try {
        entries.push({ k, at: JSON.parse(localStorage.getItem(k)).at })
      } catch {
        entries.push({ k, at: 0 })
      }
    }
  }
  entries.sort((a, b) => a.at - b.at)
  for (const { k } of entries.slice(0, Math.ceil(entries.length / 2))) {
    localStorage.removeItem(k)
  }
}

// Scryfall allows <10 requests/second and network-blocks offenders; space all
// requests ~120ms apart and retry once after a pause if we still get a 429.
let nextSlot = 0
async function scryfetch(url, options) {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + 120
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  let res = await fetch(url, options)
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2500))
    res = await fetch(url, options)
  }
  return res
}

// "Legendary Creature — Human Wizard" → ['Legendary', 'Creature']
function parseTypes(typeLine) {
  return (typeLine ?? '')
    .split('//')[0]
    .split('—')[0]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

// Double-faced/split cards keep most data on card_faces instead of the root.
function normalizeCard(card) {
  const face = card.card_faces?.[0]
  return {
    id: card.id,
    name: card.name,
    manaCost: card.mana_cost ?? face?.mana_cost ?? '',
    cmc: card.cmc ?? 0,
    type: card.type_line ?? face?.type_line ?? '',
    types: parseTypes(card.type_line ?? face?.type_line),
    colors: card.colors ?? face?.colors ?? [],
    colorIdentity: card.color_identity ?? [],
    commanderLegal: card.legalities ? card.legalities.commander === 'legal' : undefined,
    gameChanger: card.game_changer === true,
    rarity: card.rarity ? card.rarity[0].toUpperCase() + card.rarity.slice(1) : '',
    setName: card.set_name ?? '',
    text: card.oracle_text ?? face?.oracle_text ?? '',
    imageUrl: card.image_uris?.normal ?? face?.image_uris?.normal ?? null,
  }
}

export async function searchCards({ name, type, colors, page = 1 }) {
  const terms = []
  if (name) terms.push(name)
  if (type) terms.push(`type:"${type}"`)
  if (colors?.length) terms.push(`color:${colors.join('')}`)
  if (!terms.length) return []

  const params = new URLSearchParams({
    q: terms.join(' '),
    unique: 'cards',
    order: 'name',
    page: String(page),
  })
  const key = `search:${params.toString()}`
  const cached = cacheGet(key)
  if (cached) return cached

  const res = await scryfetch(`${API_BASE}/cards/search?${params}`)
  if (res.status === 404) {
    // Scryfall returns 404 (not an empty list) when nothing matches.
    cacheSet(key, [])
    return []
  }
  if (res.status === 429) {
    throw new Error('Card search rate limit reached — please wait a moment and try again.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.details ?? `Card search failed (${res.status})`)
  }
  const { data } = await res.json()
  const result = data.map(normalizeCard)
  cacheSet(key, result)
  return result
}

// Batch exact-name lookup via Scryfall's collection endpoint (75 per request) —
// resolves a whole AI deck list in 1-2 requests instead of ~99 rapid-fire GETs,
// which would trip Scryfall's rate limit. Returns found cards keyed by the
// lowercased requested name, plus the names that need a fuzzy retry.
export async function findCardsByNames(names) {
  const found = new Map()
  const missing = []

  const toFetch = []
  for (const name of names) {
    const cached = cacheGet(`named:${name.toLowerCase()}`)
    if (cached) found.set(name.toLowerCase(), cached)
    else toFetch.push(name)
  }

  for (let i = 0; i < toFetch.length; i += 75) {
    const chunk = toFetch.slice(i, i + 75)
    const res = await scryfetch(`${API_BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
    })
    if (!res.ok) {
      throw new Error(`Card lookup failed (${res.status})`)
    }
    const { data } = await res.json()
    const cards = data.map(normalizeCard)
    for (const requested of chunk) {
      const lower = requested.toLowerCase()
      // Double-faced cards come back as "Front // Back" even when asked by front name.
      const card = cards.find(
        (c) => c.name.toLowerCase() === lower || c.name.split(' // ')[0].toLowerCase() === lower,
      )
      if (card) {
        found.set(lower, card)
        cacheSet(`named:${lower}`, card)
      } else {
        missing.push(requested)
      }
    }
  }
  return { found, missing }
}

// Exact-name lookup with fuzzy fallback (tolerates AI misspellings); used to
// resolve AI-suggested deck lists to real cards.
export async function findCardByName(name) {
  const key = `named:${name.toLowerCase()}`
  const cached = cacheGet(key)
  if (cached) return cached

  for (const mode of ['exact', 'fuzzy']) {
    const res = await scryfetch(`${API_BASE}/cards/named?${mode}=${encodeURIComponent(name)}`)
    if (res.ok) {
      const card = normalizeCard(await res.json())
      cacheSet(key, card)
      return card
    }
    if (res.status !== 404) {
      throw new Error(`Card lookup failed (${res.status})`)
    }
  }
  return null
}

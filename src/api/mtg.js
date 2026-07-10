// Client for https://docs.magicthegathering.io/ (api.magicthegathering.io/v1)
// Search results are cached in localStorage for 24h to stay well under the
// API's 5000 requests/hour rate limit.

const API_BASE = 'https://api.magicthegathering.io/v1'
const CACHE_PREFIX = 'mtg-cache:'
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

// The API returns every printing of a card; collapse to one per card name,
// preferring printings that have an image.
function dedupeByName(cards) {
  const byName = new Map()
  for (const card of cards) {
    const existing = byName.get(card.name)
    if (!existing || (!existing.imageUrl && card.imageUrl)) {
      byName.set(card.name, card)
    }
  }
  return [...byName.values()]
}

// Gatherer serves imageUrl as http://; upgrade so images load on https pages.
function normalizeCard(card) {
  return {
    id: card.id,
    name: card.name,
    manaCost: card.manaCost ?? '',
    cmc: card.cmc ?? 0,
    type: card.type ?? '',
    types: card.types ?? [],
    colors: card.colors ?? [],
    rarity: card.rarity ?? '',
    setName: card.setName ?? '',
    text: card.text ?? '',
    imageUrl: card.imageUrl ? card.imageUrl.replace(/^http:\/\//, 'https://') : null,
  }
}

async function fetchCards(params) {
  const query = new URLSearchParams(params).toString()
  const cached = cacheGet(query)
  if (cached) return cached

  const res = await fetch(`${API_BASE}/cards?${query}`)
  if (res.status === 429) {
    throw new Error('Card API rate limit reached — please wait a minute and try again.')
  }
  if (!res.ok) {
    throw new Error(`Card search failed (${res.status})`)
  }
  const { cards } = await res.json()
  const result = dedupeByName(cards.map(normalizeCard))
  cacheSet(query, result)
  return result
}

export function searchCards({ name, type, colors, page = 1 }) {
  const params = { pageSize: 100, page }
  if (name) params.name = name
  if (type) params.type = type
  if (colors?.length) params.colors = colors.join(',')
  return fetchCards(params)
}

// Exact-name lookup, used to resolve AI-suggested deck lists to real cards.
export async function findCardByName(name) {
  const cards = await fetchCards({ name: `"${name}"`, pageSize: 20 })
  return (
    cards.find((c) => c.name.toLowerCase() === name.toLowerCase()) ??
    cards[0] ??
    null
  )
}

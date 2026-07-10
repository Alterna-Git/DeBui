import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { findCardByName } from './mtg'

// Asks the Cloud Function (which holds the OpenAI key) for a deck list, then
// resolves each suggested card name against the card API for images/details.
export async function buildDeckWithAI(prompt, format, onProgress) {
  const call = httpsCallable(functions, 'buildDeckWithAI')
  const { data } = await call({ prompt, format })
  const { deckName, commander: commanderName, cards } = data

  const unresolved = []

  let commander = null
  if (commanderName) {
    onProgress?.(`Looking up commander ${commanderName}…`)
    try {
      commander = await findCardByName(commanderName)
    } catch {
      /* fall through to unresolved */
    }
    if (!commander) unresolved.push(commanderName)
  }

  const resolved = []
  for (let i = 0; i < cards.length; i++) {
    const { name, count } = cards[i]
    onProgress?.(`Looking up ${name}… (${i + 1}/${cards.length})`)
    try {
      const card = await findCardByName(name)
      if (card) {
        resolved.push({ ...card, count: Math.min(Math.max(count, 1), 99) })
      } else {
        unresolved.push(name)
      }
    } catch {
      unresolved.push(name)
    }
  }
  return { deckName, commander, cards: resolved, unresolved }
}

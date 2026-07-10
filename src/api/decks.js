import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore'
import { db } from '../firebase'

// Decks live at users/{uid}/decks/{deckId}. Card details are snapshotted into
// the deck document so saved decks render without hitting the card API.

function decksCollection(uid) {
  return collection(db, 'users', uid, 'decks')
}

export async function listDecks(uid) {
  const snap = await getDocs(query(decksCollection(uid), orderBy('updatedAt', 'desc')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function saveDeck(uid, deck) {
  const ref = deck.id ? doc(decksCollection(uid), deck.id) : doc(decksCollection(uid))
  const { id, ...data } = deck
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    ...(deck.id ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true })
  return ref.id
}

export function deleteDeck(uid, deckId) {
  return deleteDoc(doc(decksCollection(uid), deckId))
}

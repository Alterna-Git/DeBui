// Estimates the deck's Commander Bracket (WotC's 1-5 system) from checkable
// signals: the official Game Changers list (Scryfall's game_changer flag),
// mass land denial, extra-turn spells, and tutor density. Brackets 1 vs 2 and
// 4 vs 5 are social distinctions a list alone can't settle, so those pair up.

const MLD_CARDS = new Set([
  'Armageddon', 'Ravages of War', 'Catastrophe', 'Decree of Annihilation',
  'Jokulhaups', 'Obliterate', 'Ruination', 'Sunder', 'Death Cloud',
  'Impending Disaster', 'Epicenter', 'Bend or Break', 'Global Ruin',
  'Tectonic Break', 'Fall of the Thran', 'Winter Orb', 'Static Orb',
  'Stasis', 'Rising Waters', 'Blood Moon', 'Back to Basics',
])

export function evaluateBracket(deck) {
  const main = deck.cards.filter((c) => c.board !== 'side')

  const gameChangers = main.filter((c) => c.gameChanger === true)
  const mld = main.filter((c) => MLD_CARDS.has(c.name))
  const extraTurns = main.filter((c) => /extra turn/i.test(c.text ?? ''))
  const tutors = main.filter(
    (c) => !c.types?.includes('Land') && /search your library/i.test(c.text ?? ''),
  )
  // Cards saved before the game-changer flag existed can't be checked.
  const unknown = main.filter((c) => c.gameChanger === undefined).length

  let bracket, name
  if (gameChangers.length > 3 || mld.length > 0) {
    bracket = '4–5'
    name = 'Optimized / cEDH'
  } else if (gameChangers.length > 0 || extraTurns.length > 2 || tutors.length > 4) {
    bracket = '3'
    name = 'Upgraded'
  } else {
    bracket = '1–2'
    name = 'Exhibition / Core'
  }

  return { bracket, name, gameChangers, mld, extraTurns, tutors, unknown }
}

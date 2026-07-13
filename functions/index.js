import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import Anthropic from '@anthropic-ai/sdk'

initializeApp()
const db = getFirestore()

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')

// Mobile connections often drop during a 1-2 minute AI call (screen lock, app
// switch), losing the callable response even though the work succeeded. When
// the client passes a jobId, the result is also written to a Firestore doc the
// client watches — so it arrives even after a dropped connection.
function jobRefFor(request) {
  if (!request.auth) return null
  const jobId = request.data?.jobId
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(jobId)) return null
  return db.doc(`users/${request.auth.uid}/jobs/${jobId}`)
}

async function withJobResult(request, work) {
  const jobRef = jobRefFor(request)
  try {
    const result = await work()
    if (jobRef) {
      await jobRef.set({ status: 'done', result, createdAt: FieldValue.serverTimestamp() }).catch((e) => {
        console.error('Failed to write job result', e)
      })
    }
    return result
  } catch (err) {
    if (jobRef) {
      const message = err instanceof HttpsError ? err.message : 'Something went wrong — please try again.'
      await jobRef.set({ status: 'error', message, createdAt: FieldValue.serverTimestamp() }).catch(() => {})
    }
    throw err
  }
}

const MODEL = 'claude-opus-4-8'

// Structured-output schemas: the API guarantees the response validates against
// these, so "unreadable JSON" failures can't happen.
const DECK_SCHEMA = {
  type: 'object',
  properties: {
    deckName: { type: 'string' },
    commander: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
        },
        required: ['name', 'count'],
        additionalProperties: false,
      },
    },
  },
  required: ['deckName', 'commander', 'cards'],
  additionalProperties: false,
}

const RATIO_KEYS = ['lands', 'ramp', 'cardDraw', 'removal', 'boardWipes']
const ratioObject = {
  type: 'object',
  properties: Object.fromEntries(RATIO_KEYS.map((k) => [k, { type: 'integer' }])),
  required: RATIO_KEYS,
  additionalProperties: false,
}

const COACH_SCHEMA = {
  type: 'object',
  properties: {
    rating: { type: 'integer' },
    archetype: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    counts: ratioObject,
    targets: ratioObject,
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cut: { type: 'string' },
          add: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['cut', 'add', 'reason'],
        additionalProperties: false,
      },
    },
    plan: { type: 'array', items: { type: 'string' } },
    howToPlay: {
      type: 'object',
      properties: {
        gameplan: { type: 'string' },
        keyCards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
            },
            required: ['name', 'role'],
            additionalProperties: false,
          },
        },
        mulligan: { type: 'string' },
        early: { type: 'string' },
        mid: { type: 'string' },
        late: { type: 'string' },
      },
      required: ['gameplan', 'keyCards', 'mulligan', 'early', 'mid', 'late'],
      additionalProperties: false,
    },
  },
  required: ['rating', 'archetype', 'strengths', 'weaknesses', 'counts', 'targets', 'suggestions', 'plan', 'howToPlay'],
  additionalProperties: false,
}

const SYSTEM_PROMPT_COMMANDER = `You are an expert Magic: The Gathering deck builder specializing in Commander (EDH).
Design a complete, legal, synergistic 100-card Commander deck from the user's description.

Commander: choose a legendary creature (or a card that explicitly says it can be your
commander) that best matches the request, unless the user names one.

Color identity (STRICT): every card's color identity must be a subset of the commander's.
Color identity includes mana symbols in rules text, not just the mana cost. Never include
a card with any mana symbol outside the commander's identity.

Synergy: commit to a clear game plan around the commander (tribal, tokens, aristocrats,
spellslinger, ramp/stompy, artifacts, etc.). Every nonland card should advance that plan.
Baseline package, on-theme where possible: ~10 ramp sources, ~10 card draw/advantage,
~8 targeted removal/interaction, 2-4 board wipes.

Mana base: 36-38 lands tuned to this exact deck — dual/multicolor lands available in the
identity, utility lands that support the theme, then basic lands to fill, with the color
ratio matching the deck's mana symbols.

Legality: exactly one copy of each card except basic lands; every card legal in Commander;
exactly 100 cards total including the commander.

Use only real Magic: The Gathering card names, spelled exactly as printed.
If the user message lists cards already locked into the deck, treat them as fixed: build
the synergy and mana base around them and return in "cards" ONLY the additional cards that
bring the total to exactly 100 — never repeat a locked card except basic lands.
Otherwise "cards" lists the 99 cards other than the commander (basic lands may use
count > 1; never repeat the commander in "cards").`

const SYSTEM_PROMPT_COACH = `You are a professional Magic: The Gathering deck coach.
Analyze the Commander (EDH) deck the user provides and give honest, specific, actionable
advice. Respect color identity and singleton in every suggestion. "cut" must name a card
actually in the deck; "add" must be a real card, spelled exactly as printed, legal in
Commander, and within the commander's color identity.

Field guidance:
- rating: 1-10 honest power assessment
- counts: what the deck currently has; targets: what this archetype wants
- suggestions: up to 8, most impactful first
- plan: 3-5 ordered steps for how to test and keep improving this deck
- howToPlay: written so a brand-new pilot can play the deck — gameplan (2-3 sentences on
  how it wins), up to 5 keyCards actually in the deck with when/why to play them,
  mulligan (what an opening hand must have), and early (turns 1-3) / mid (turns 4-6) /
  late (turn 7+) priorities.`

// Calls Claude with schema-enforced JSON output and converts every failure
// mode into an HttpsError with a message the app can show.
async function callClaude({ system, user, schema }) {
  const client = new Anthropic({ apiKey: anthropicApiKey.value() })
  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema },
      },
      system,
      messages: [{ role: 'user', content: user }],
    })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpsError('resource-exhausted', 'The AI service is busy right now — try again in a minute.')
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new HttpsError('unavailable', 'Could not reach the AI service — please try again.')
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error', err.status, err.message)
      throw new HttpsError('internal', 'The AI service is unavailable right now — try again shortly.')
    }
    console.error('Unexpected error calling Claude', err)
    throw new HttpsError('internal', 'Something went wrong talking to the AI — please try again.')
  }

  if (response.stop_reason === 'refusal') {
    throw new HttpsError('internal', 'The AI declined this request — try rephrasing it.')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new HttpsError('internal', 'The AI response was cut short — please try again.')
  }
  const text = response.content.find((b) => b.type === 'text')?.text
  if (!text) {
    console.error('No text block in response', JSON.stringify(response.content).slice(0, 2000))
    throw new HttpsError('internal', 'The AI returned an empty response — please try again.')
  }
  try {
    return JSON.parse(text)
  } catch {
    console.error('Unparseable AI response', text.slice(0, 2000))
    throw new HttpsError('internal', 'The AI returned an unreadable response — please try again.')
  }
}

export const buildDeckWithAI = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 300 },
  (request) => withJobResult(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to use the AI deck builder.')
    }
    const prompt = request.data?.prompt
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
      throw new HttpsError('invalid-argument', 'Provide a deck description (max 2000 characters).')
    }

    const existing = (Array.isArray(request.data?.existing) ? request.data.existing.slice(0, 150) : [])
      .filter((c) => typeof c?.name === 'string' && c.name.trim())
      .map((c) => ({
        name: c.name.trim().slice(0, 200),
        count: Number.isFinite(c.count) ? Math.min(Math.max(Math.round(c.count), 1), 99) : 1,
      }))
    const commanderName =
      typeof request.data?.commanderName === 'string' && request.data.commanderName.trim()
        ? request.data.commanderName.trim().slice(0, 200)
        : null

    const parts = [prompt]
    if (commanderName) {
      parts.push(`The commander is already chosen and fixed: ${commanderName}. Build strictly within its color identity and report it back unchanged in the "commander" field.`)
    }
    if (existing.length) {
      const lockedTotal = existing.reduce((n, c) => n + c.count, 0) + (commanderName ? 1 : 0)
      parts.push(
        `Cards already locked into the deck (${lockedTotal} cards${commanderName ? ' including the commander' : ''}). Keep all of them and do NOT repeat any of them in your response:\n` +
          existing.map((c) => `${c.count} ${c.name}`).join('\n'),
      )
      parts.push('Return ONLY the additional cards needed to complete the deck, chosen to synergize with the locked cards above.')
    }

    const parsed = await callClaude({
      system: SYSTEM_PROMPT_COMMANDER,
      user: parts.join('\n\n'),
      schema: DECK_SCHEMA,
    })

    const cards = parsed.cards
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        count: Math.min(Math.max(c.count, 1), 30),
      }))
      .slice(0, 120)

    if (!cards.length) {
      throw new HttpsError('internal', 'The AI did not return any cards — try rephrasing your request.')
    }

    return {
      deckName: parsed.deckName.slice(0, 100) || 'AI Deck',
      commander: parsed.commander.trim().slice(0, 200) || null,
      cards,
    }
  }),
)

export const analyzeDeck = onCall(
  { secrets: [anthropicApiKey], timeoutSeconds: 300 },
  (request) => withJobResult(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to use the deck coach.')
    }
    const cards = (Array.isArray(request.data?.cards) ? request.data.cards.slice(0, 200) : [])
      .filter((c) => typeof c?.name === 'string' && c.name.trim())
      .map((c) => ({
        name: c.name.trim().slice(0, 200),
        count: Number.isFinite(c.count) ? Math.min(Math.max(Math.round(c.count), 1), 99) : 1,
      }))
    if (!cards.length) {
      throw new HttpsError('invalid-argument', 'The deck is empty — add some cards first.')
    }
    const commanderName =
      typeof request.data?.commanderName === 'string' && request.data.commanderName.trim()
        ? request.data.commanderName.trim().slice(0, 200)
        : null

    const userContent = [
      'Format: Commander (EDH)',
      commanderName ? `Commander: ${commanderName}` : null,
      `Deck list:\n${cards.map((c) => `${c.count} ${c.name}`).join('\n')}`,
    ].filter(Boolean).join('\n\n')

    const parsed = await callClaude({
      system: SYSTEM_PROMPT_COACH,
      user: userContent,
      schema: COACH_SCHEMA,
    })

    const strings = (v, max) => v.filter((s) => typeof s === 'string').slice(0, max)
    return {
      rating: Math.min(Math.max(parsed.rating, 1), 10),
      archetype: parsed.archetype.slice(0, 300),
      strengths: strings(parsed.strengths, 4),
      weaknesses: strings(parsed.weaknesses, 4),
      counts: parsed.counts,
      targets: parsed.targets,
      suggestions: parsed.suggestions
        .map((s) => ({
          cut: s.cut.trim().slice(0, 200),
          add: s.add.trim().slice(0, 200),
          reason: s.reason.slice(0, 400),
        }))
        .slice(0, 8),
      plan: strings(parsed.plan, 5),
      howToPlay: {
        gameplan: parsed.howToPlay.gameplan.slice(0, 600),
        keyCards: parsed.howToPlay.keyCards
          .map((k) => ({ name: k.name.trim().slice(0, 200), role: k.role.slice(0, 300) }))
          .slice(0, 5),
        mulligan: parsed.howToPlay.mulligan.slice(0, 400),
        early: parsed.howToPlay.early.slice(0, 400),
        mid: parsed.howToPlay.mid.slice(0, 400),
        late: parsed.howToPlay.late.slice(0, 400),
      },
    }
  }),
)

// deploy: mobile job-doc resilience v2

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

const openaiApiKey = defineSecret('OPENAI_API_KEY')

const SYSTEM_PROMPT_STANDARD = `You are an expert Magic: The Gathering deck builder.
Given a user's description, design a complete, legal 60-card deck (including lands).
Use only real Magic: The Gathering card names, spelled exactly as printed.
Respect the 4-copy limit for non-basic-land cards.
If the user message lists cards already locked into the deck, treat them as fixed and
return ONLY the additional cards needed to complete the deck — never repeat a locked
card except basic lands.
Respond with JSON only, matching this shape:
{"deckName": "string", "cards": [{"name": "Card Name", "count": 4}]}`

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
the synergy and mana base around them and return ONLY the additional cards that bring the
total to exactly 100 — never repeat a locked card except basic lands.
Respond with JSON only, matching this shape:
{"deckName": "string", "commander": "Card Name", "cards": [{"name": "Card Name", "count": 1}]}
where "cards" lists the cards other than the commander (basic lands may use count > 1;
never repeat the commander).`

export const buildDeckWithAI = onCall(
  { secrets: [openaiApiKey], timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to use the AI deck builder.')
    }
    const prompt = request.data?.prompt
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
      throw new HttpsError('invalid-argument', 'Provide a deck description (max 2000 characters).')
    }
    const isCommander = request.data?.format === 'commander'

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
    const userContent = parts.join('\n\n')

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey.value()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: isCommander ? 'gpt-5.5' : 'gpt-5.4-mini',
        // Without this, GPT-5.5 defaults to its deepest reasoning and can exceed
        // the 300s function timeout. Medium finishes a full deck in ~80s.
        reasoning_effort: isCommander ? 'medium' : 'low',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: isCommander ? SYSTEM_PROMPT_COMMANDER : SYSTEM_PROMPT_STANDARD },
          { role: 'user', content: userContent },
        ],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('OpenAI error', res.status, body)
      throw new HttpsError('internal', 'The AI service is unavailable right now — try again shortly.')
    }

    const completion = await res.json()
    let parsed
    try {
      parsed = JSON.parse(completion.choices[0].message.content)
    } catch {
      throw new HttpsError('internal', 'The AI returned an unreadable deck list — try again.')
    }

    const cards = Array.isArray(parsed.cards)
      ? parsed.cards
          .filter((c) => typeof c?.name === 'string' && c.name.trim())
          .map((c) => ({
            name: c.name.trim(),
            count: Number.isFinite(c.count) ? Math.min(Math.max(Math.round(c.count), 1), 30) : 1,
          }))
          .slice(0, 120)
      : []

    if (!cards.length) {
      throw new HttpsError('internal', 'The AI did not return any cards — try rephrasing your request.')
    }

    return {
      deckName: typeof parsed.deckName === 'string' ? parsed.deckName.slice(0, 100) : 'AI Deck',
      commander:
        isCommander && typeof parsed.commander === 'string' ? parsed.commander.trim().slice(0, 200) : null,
      cards,
    }
  },
)

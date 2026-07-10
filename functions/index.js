import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

const openaiApiKey = defineSecret('OPENAI_API_KEY')

const SYSTEM_PROMPT = `You are an expert Magic: The Gathering deck builder.
Given a user's description, design a complete, legal 60-card deck (including lands).
Use only real Magic: The Gathering card names, spelled exactly as printed.
Respect the 4-copy limit for non-basic-land cards.
Respond with JSON only, matching this shape:
{"deckName": "string", "cards": [{"name": "Card Name", "count": 4}]}`

export const buildDeckWithAI = onCall(
  { secrets: [openaiApiKey], timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to use the AI deck builder.')
    }
    const prompt = request.data?.prompt
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
      throw new HttpsError('invalid-argument', 'Provide a deck description (max 2000 characters).')
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey.value()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
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
          .slice(0, 80)
      : []

    if (!cards.length) {
      throw new HttpsError('internal', 'The AI did not return any cards — try rephrasing your request.')
    }

    return {
      deckName: typeof parsed.deckName === 'string' ? parsed.deckName.slice(0, 100) : 'AI Deck',
      cards,
    }
  },
)

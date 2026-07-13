# DeBui — MTG Deck Builder

A Magic: The Gathering deck builder built with React + Vite and Firebase.

- **Card search** via the [Scryfall API](https://scryfall.com/docs/api) (the same data source Moxfield uses — every set, updated within hours of release), with 24h localStorage caching
- **Google sign-in** (Firebase Auth) and per-user deck storage (Firestore)
- **Deck panel** with counts, main/sideboard, type grouping, mana curve, and 4-copy warnings
- **AI Builder**: describe a deck, and a Claude-powered Cloud Function drafts a full list

## Setup

### 1. Firebase console (one-time)

In [console.firebase.google.com](https://console.firebase.google.com), for your project:

1. **Add a Web app** (Project settings → General → Your apps → `</>` icon) if you haven't.
2. **Enable Google sign-in**: Authentication → Sign-in method → Google → Enable.
3. **Create a Firestore database**: Firestore Database → Create database → production mode.
4. For the AI Builder: upgrade to the **Blaze plan** (Functions calling external APIs require it).

### 2. Local config

```bash
cp .env.example .env
# paste in the values from Project settings → Your apps → SDK setup and configuration
```

Also put your project id in `.firebaserc` (replace `YOUR_FIREBASE_PROJECT_ID`).

### 3. Run locally

```bash
npm install
npm run dev
```

### 4. Deploy

```bash
npm install -g firebase-tools   # once
firebase login                  # once
npm run build
firebase deploy --only hosting,firestore:rules
```

### 5. AI Builder (Cloud Function + Claude)

Create an API key at [platform.claude.com](https://platform.claude.com/settings/keys), then:

```bash
cd functions && npm install && cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY   # paste your Anthropic key when prompted
firebase deploy --only functions
```

## Architecture notes

- Deck documents live at `users/{uid}/decks/{deckId}`; `firestore.rules` restricts each user to their own decks.
- Card details are snapshotted into the deck document, so saved decks render with zero card-API calls.
- The Anthropic API key lives only in a Cloud Functions secret — never in browser code. The
  callable functions require an authenticated user. Responses use structured outputs
  (schema-enforced JSON), so malformed AI responses can't reach the app.

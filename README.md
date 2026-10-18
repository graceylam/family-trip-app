# Family Trip

An installable, mobile-first family itinerary and photo-upload PWA. It works offline, keeps the original photographs in Apple Photos, queues temporary upload copies in IndexedDB, and shares the itinerary and selected photographs through a dedicated Google Drive account.

## Run locally

Node.js 22 or newer is required.

```bash
npm install
npm run dev
```

## Validate

```bash
npm run build
npm run build:pages
node --test tests/*.test.mjs
```

`npm run build:pages` creates the static `pages-dist/` site used by GitHub Pages. Pushing `main` runs the GitHub Pages deployment workflow automatically.

## Photo safety

- Take photographs with the normal iPhone Camera app first.
- Apple Photos remains the permanent original.
- Browser storage contains temporary upload copies only.
- Uploaded copies go to Google Drive through the separately deployed family gateway.
- A requested deletion remains queued until Google Drive confirms that its copy was removed.

The Google Apps Script gateway configuration is maintained privately and is intentionally omitted from the public GitHub mirror.

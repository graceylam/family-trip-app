# Family Trip

An installable, mobile-first family itinerary and memory app. It works offline, keeps the original photographs in Apple Photos, queues temporary upload copies in IndexedDB, and shares trip data through Firebase with private photo and video objects in Cloudflare R2.

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
- Uploaded copies go to the private `family-trip-media` Cloudflare R2 bucket through an authenticated Worker.
- A requested deletion remains visible and retryable until R2 confirms that its copy was removed.

Firebase continues to provide sign-in, membership and real-time trip metadata. Google Drive is no longer used by the current media flow; its previous implementation remains recoverable from Git history.

## Private media service

The Worker source and non-secret configuration live in `r2-worker/`. Upload and delete operations require a valid Firebase ID token and an authorised trip membership. The R2 bucket remains private; viewing uses unguessable per-media access-key URLs. The service also enforces a 100 GB bucket ceiling as an additional cost guard.

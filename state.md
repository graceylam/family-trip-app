# Family Trip development state

Last updated: 22 October 2026

## Current checkpoint

- Firebase provides account sign-in, trip membership, Firestore itinerary data and media metadata.
- Cloudflare R2 now provides private photo and video object storage; Google Drive is no longer in the active media path.
- R2 bucket: `family-trip-media` (private, automatic Oceania placement, Standard storage).
- Worker: `family-trip-media-api` at `https://family-trip-media-api.grace-family-trip.workers.dev`.
- Worker binding: `MEDIA_BUCKET` -> `family-trip-media`.
- App-level storage ceiling: 100 GB (`MAX_STORAGE_BYTES=100000000000`).
- Per-file media limit: 95 MB.
- Uploads authenticate with Firebase ID tokens and verify trip membership through Firestore rules.
- Originals and thumbnails are uploaded directly from the device; Firestore stores their metadata and access-key URLs.
- Failed uploads remain in the existing IndexedDB retry queue. Failed deletions keep their Firestore record so they stay visible and retryable.
- The itinerary media picker now behaves like a messaging app: selected photos/videos appear immediately and automatically upload in the background. The durable IndexedDB queue remains underneath for offline safety, with only subtle per-tile progress/error badges and a compact status message.
- Photo Gallery has one `Save All Shared` action. It includes only successfully uploaded/shared media, never items that are still in the local offline queue.
- Stop and Gallery previews are full-screen, support horizontal swiping and swipe-down dismissal, preload neighbouring gallery photos, and use compact Share, Favourite, More and Delete controls. Share opens Apple's Share Sheet so the person can choose Save Image or Save Video. Shared media remains visible both at its assigned stop and in Photo Gallery for every trip member.
- The native iOS container now includes a local Capacitor `NativePhotos` bridge backed by Apple PhotoKit. Save and Share are separate controls: Save writes the original photo/video directly to Apple Photos after the first add-only permission prompt, while Share opens the normal system Share Sheet. The browser build retains Share Sheet/download fallback behavior.
- Stop and Gallery viewing now share one scroll-snap media carousel: photos track the finger during a swipe, cached thumbnails render immediately, full-resolution originals fade in only after decoding, and the two neighbouring originals on either side stay preloaded. Recently rendered slides stay mounted during the viewing session to avoid repeat downloads and blank frames.
- Mapbox is verified for place autocomplete, the Standard visual map style and walking routes. Web builds now receive `VITE_MAPBOX_ACCESS_TOKEN` from the GitHub Actions repository variable/secret and fail deployment instead of silently shipping maps without a token.

## Verification

- Live Worker health check passed: `{ "ok": true, "provider": "r2", "private": true }`.
- GitHub Pages production build passes.
- Six rendered-app regression tests pass.
- The Pages bundle still emits a large-chunk warning; this is a performance improvement opportunity, not a deployment failure.

## Next operational steps

1. GitHub Pages is deployed and its live bundle points to the private R2 Worker.
2. The Capacitor iOS project is synced, signed, installed and launched successfully on Grace's iPhone 13 (`com.graceylam.familytrip`).
3. Configure Cloudflare usage notifications (informational alerts, not a true billing hard cap).
4. Test one small photo and one short video from the installed iPhone app, then verify gallery display, download and deletion.

## Rollback

The previous Google Drive implementation is preserved in Git history. Roll back to the commit immediately before the R2 migration if required; do not delete the old Drive files until the R2 phone test has passed.

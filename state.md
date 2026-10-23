# Family Trip development state

Last updated: 24 October 2026

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
- Photo Gallery has one `Save All Shared` action. It includes only successfully uploaded/shared media, never items that are still in the local offline queue. Selection mode also supports Select All for the current filters, one-tap Save Selected to Apple Photos, and confirmed bulk deletion. Admins can delete any selected shared media; contributors can delete only their own.
- Gallery save/select controls sit immediately beneath the day, person and media-type filters. Each itinerary stop also has its own selection mode with a fixed 2×2 action grid: Save and Delete above Add to Sharing and Remove from Sharing. Unavailable sharing actions are disabled, and ownership/admin permissions are enforced for destructive actions. The old cloud glyph has been replaced by a privacy-neutral upward share arrow.
- Stop and Gallery previews are full-screen, support horizontal swiping and swipe-down dismissal, preload neighbouring gallery photos, and use compact Share, Favourite, More and Delete controls. Share opens Apple's Share Sheet so the person can choose Save Image or Save Video. Shared media remains visible both at its assigned stop and in Photo Gallery for every trip member.
- The native iOS container now includes a local Capacitor `NativePhotos` bridge backed by Apple PhotoKit. Save and Share are separate controls: Save writes the original photo/video directly to Apple Photos after the first add-only permission prompt, while Share opens the normal system Share Sheet. The browser build retains Share Sheet/download fallback behavior.
- Stop and Gallery viewing now share one scroll-snap media carousel: photos track the finger during a swipe, cached thumbnails render immediately, full-resolution originals fade in only after decoding, and the two neighbouring originals on either side stay preloaded. Recently rendered slides stay mounted during the viewing session to avoid repeat downloads and blank frames.
- Newly selected media receives a friendly deterministic filename before upload: `Stop Name Person Photo n.ext` or `Stop Name Person Video n.ext`. Numbering continues per stop, person and media type across later batches; previously uploaded media is not renamed.
- New photo uploads now include three R2 objects: a compact grid thumbnail, a 1920px screen-quality display copy, and the untouched original. Full-screen swiping uses the display copy while Save/Download still uses the original; older photos fall back safely to their originals. The temporary thumbnail blur is reduced from 10px to 2px.
- Both itinerary and Gallery photo viewers now lock the full dynamic viewport and paint the iPhone bottom safe area opaque dark, preventing the underlying cream/white page from appearing as a strip beneath the viewer.
- Gallery’s former `More` action is now an explicit `Caption` control. Saved captions are displayed beneath the full-screen photo above its action toolbar, and saving closes the editor to reveal the caption immediately.
- Gallery captions now use the app’s main sans-serif typography. Opening either photo viewer locks the body at its current scroll offset and restores that exact position on close. Gallery’s `Save All Shared (n)` count and action now follow the active day, person and media-type filters. The Gallery footer also paints beyond the iPhone bottom edge to prevent safe-area background bleed.
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
# Gallery viewer refinements (2026-10-23)

- Full-screen gallery viewer now paints through the iPhone bottom safe area to prevent the white strip from reappearing.
- Gallery captions use the app's regular typeface.
- Closing a photo restores the exact Gallery scroll position, including an iOS-safe second-frame restoration.
- The bulk save action is explicitly scoped to the active Day, Person, and media-type filters; its label changes to `Save Filtered (n)` whenever a filter is active.

# Native gallery and expense entry (2026-10-24)

- The iOS web view now extends beneath both safe areas; existing CSS safe-area padding continues to protect normal screens while the Gallery viewer can paint fully edge-to-edge.
- Expenses can now be added directly from the Expenses tab by choosing a day and stop, with the current member recorded automatically.
- Quick expense entry is collapsed by default and expands only when the user taps `Add expense`; it collapses again after saving or when requested.
- Its collapsed presentation is intentionally minimal: only `QUICK ENTRY` and `+ Add expense` are shown.
- On phone layouts, the `+ Add expense` button is left-aligned beneath `QUICK ENTRY` rather than centred.

## Pre-TestFlight product roadmap agreed 24 October 2026

1. Improve perceived bookshelf startup speed by rendering cached trip summaries immediately and refreshing Firebase data in the background. Implemented 24 October 2026: the shelf is cached per signed-in account, Firebase trip references render before cover enrichment, and live data refreshes the cache silently.
2. Improve Gallery feedback: expose captions outside the full-screen viewer. Duplicate-download detection was deliberately dropped; users may save the same media more than once.
3. Choose the product name and visual identity, then apply the icon/logo to the iPhone home screen, launch experience and appropriate in-app surfaces.
4. Give Trip Settings a cosmetic cleanup.
5. Leave the larger Memory Lane revision until last: repair highlight-video duration/export, add an editable Instagram-style Story builder, and persist completed stories.
6. Distribute privately to family through TestFlight after the above pass; their phones should not need Developer Mode.

The laptop experience remains the web/PWA build backed by the same Firebase, R2 and Mapbox services, so it shares accounts and trip data with the iPhone app.

## Saved Places ownership (2026-10-24)

- A Saved Places entry can be deleted only by the family member who originally added it. Other members do not see a delete action.
- Deleting a saved entry does not remove a stop that was already added to the itinerary; that remains a separate deliberate action.

## Saved Places scheduler sizing (2026-10-24)

- The `Add to Itinerary` Day and Time controls now share a contained two-column grid with equal widths.
- The scheduler uses its card margins as its width boundary, and the iOS time control no longer pushes beyond the right edge on narrow phones.

## Trip Settings cleanup (2026-10-24)

- Cover-photo controls are collapsed by default and show a compact status row.
- The earlier trip-level icon control was corrected: avatar customisation belongs to each traveller, not the trip.
- Each traveller can choose their initial or any emoji for their personal bubble and select from pastel pink, purple, sunset, yellow, green, blue and teal colours. Their choice follows their account across joined trips.
- Family profiles now come only from real Firebase trip memberships. Legacy placeholder profiles and personal copy-link controls were removed.
- Invitations use only the QR code or private group name and invite code; the copy-link button was removed.
- Connection details remain collapsed by default and show a complete one-line status summary.
- Connection details use a fully contained two-line summary on narrow phones so neither the account mode nor sync/Mapbox status is clipped.
- Trip Settings includes a shared default trip currency. Changing it updates every joined traveller and preselects that currency for new expenses.
- The redundant `Refresh shared trip` button was removed: Firebase already refreshes shared trip data live, and the button only checked connectivity before closing Settings.
- Visible product wording now uses `group` and `group members` instead of assuming every trip is a family trip.
- Connection Details sits farther below the settings actions and the mobile sheet has extra bottom scroll clearance.

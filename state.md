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

## TestFlight preparation (24 October 2026)

- Zora 1.0 build 2 is synced with the latest web assets and archived successfully for generic iOS distribution.
- Bundle ID: `com.graceylam.familytrip`; Apple team: `FXAU5S68HU`; minimum iOS version: 15.0.
- App Store Connect sign-in is the remaining prerequisite before creating/verifying the Zora app record, uploading build 2, completing export-compliance details and inviting the first tester.

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
- Gallery upload bubbles resolve against the live group-member profile, so existing photos immediately adopt a person’s latest display name initial, emoji and pastel colour.
- The mobile Settings close action is no longer sticky over the content; Connection Details now has a clear protected gap above its full top border.

## Native document preview (2026-10-24)

- PDFs and other compatible attachments now open in Apple Quick Look inside the iPhone app, with every page available, native scrolling and zoom, and a full-screen Done control.
- Images retain the app’s existing full-screen preview, while the laptop/web build retains its embedded document preview.

## Zora loading identity (2026-10-24)

- Initial account loading now uses the Zora splash identity: a Georgia wordmark, system-font `Your trip. All together.` tagline, layered blue landscape and an explicit animated three-dot loading state.
- The trip shelf refresh uses a compact version of the same loader so loading feedback remains branded without taking over the whole bookshelf.
- The landscape/river mark is the `Z` itself and is followed only by Georgia `ora`, preventing the lockup from reading as a separate logo plus the word Zora.
- The iPhone and installable web app now use the supplied dark-blue Zora landscape icon artwork.
- The splash lockup uses Grace’s supplied light-background Z artwork directly (rather than redrawing it), followed only by Georgia `ora`, and sits in the upper portion with deliberate breathing room.
- Mapbox public-token rotation on 24 October 2026 is applied to local/iPhone builds and the GitHub Pages repository variable; the token remains excluded from Git history.
- Trip cover headers now use an even dark translucent overlay instead of a pale gradient, with light high-contrast text that remains readable over any cover photo.

## TestFlight deployment (2026-10-24)

- Apple Developer App ID `com.graceylam.familytrip` and the App Store Connect record `Zora: Trips Together` are registered.
- Zora 1.0 build 2 archived successfully and uploaded to App Store Connect with no errors (delivery UUID `e49570fd-8d4b-4c94-bab7-1669ebd4becd`).
- Apple finished processing build 2 and its export-compliance response was completed.
- The correct external TestFlight group is `Lambs Testers`; build 2 is attached and three external testers have been added. Their email addresses are intentionally not stored in this public repository.
- Build 2 is waiting for Apple Beta App Review. Once approved, the external testers can accept their TestFlight invitations without Developer Mode or App Store Connect access.
- An earlier `Lambs` internal group also exists but should not be used for family testers unless they are deliberately added as App Store Connect users.

## Local post-TestFlight refinements (2026-10-25)

- These changes are implemented locally and synced into the local iOS project, but have **not** been uploaded as a new TestFlight or App Store build.
- The full-screen Zora loader now more closely follows the approved splash prototype and retains an animated three-dot loading indicator so startup never appears frozen.
- The cover photo inside an opened trip uses a stronger, even dark veil on iPhone, with light text and controls matching the trip shelf treatment.
- The Gallery has a compact `Upload photos` action. A member chooses the destination day and stop before selecting multiple photos or videos; the files then use the existing durable upload queue and shared R2 flow.
- Expense quick entry still records the signed-in member by default. A collapsed `Expense for someone else?` control lets a member attribute the entry to another current group member when needed.
- The native iPhone launch asset and the in-app loader now share the corrected lower artwork: relaxed layered mountain ridges, a pale lake, soft reflections and the floating sun from the approved prototype. The corrected local build was installed directly on Grace's iPhone without TestFlight.
- The opened-trip cover veil was reduced from roughly 80% to roughly 60% opacity so the cover remains recognisable while the white hero text and controls retain contrast. The shelf treatment is unchanged.
- Memory Lane day-cover photos now have a gentle, even dark veil with a slightly stronger lower edge, keeping the chosen memory visible while maintaining white-text contrast.
- The Memory Lane veil was subsequently deepened by one small step after on-device review; this change applies only to day covers in Memory Lane.

## Memory Lane Story Builder MVP (2026-10-25)

- Each trip day now has a Stories studio without replacing the existing scrapbook or Memory Map.
- Any joined group member can create a personal vertical story, add photo or text slides, reorder slides, choose full-photo/caption/quote/split layouts, enter free text and any emoji, choose a colour and set slide duration.
- Stories can be saved as drafts or finished stories, previewed in an edge-to-edge tap-through player, reopened by their creator and deleted only by their creator.
- Saved stories live in the shared Firebase trip JSON and carry creator identity and timestamps. Concurrent story additions merge by story ID, so one member's new story does not overwrite another's.
- The next agreed Memory Lane phases remain: expand the entirely user-authored per-day scrapbook (free text, arbitrary emoji, configurable tape/borders, optional weather and animated stickers), then rebuild Highlight Video Studio around themes, selected media, bundled royalty-free music and native iOS export.
- On-device Story Builder review showed that the initial mobile editor looked like a single static photo because its large preview appeared before the controls. The creation flow now opens an explicit photo-or-text chooser first; editing controls appear before a smaller preview on phones, and the picker is layered above the editor correctly.

### Superseded by trip-wide Highlights

- The day-owned Story prototype above has been replaced by trip-wide `Highlights`; a Highlight is deliberately independent of any one itinerary day.
- Creation is title-first, followed by photos chosen from anywhere in the trip. Each vertical slide supports freely positioned text, arbitrary emoji and decorative stickers that can be dragged, resized and rotated.
- Highlights are shared in the trip JSON, retain creator ownership for editing/deletion, merge safely by ID, and play as full-screen timed slideshows.
- The scrapbook remains a separate, collaborative per-day canvas. The later Movie Studio will support both an automatic themed render and a manual editor; it is intentionally not part of this Highlights-first change.

## Streamlined Memory Lane navigation (2026-10-25)

- Memory Lane is now divided into `Highlights`, `Days` and `Map`, with Highlights as the calm default view. The previous `Added by everyone` feed has been removed.
- Highlights contains the trip-wide handcrafted slideshow library; a compact Short Clips preview marks the next creation format without mixing the unfinished video editor into this view.
- Days contains the day selector, collaborative scrapbook and the existing automatic `Create Day n Video` flow.
- Map contains the photo map, photo-pin controls and Trip Statistics. Photos assigned to a stop now appear at its pin automatically.
- Members can hide individual photos from a pin or hide an entire pin. These presentation choices are reversible and never delete the source photo, itinerary stop or saved location; newly uploaded stop photos appear automatically unless explicitly hidden.

## Digital Scrapbook Studio (2026-10-25)

- The former day/stop recap layout is replaced by a page library. Members can create either an original freeform page or an optional guided Day Recap page, so chronology is a template rather than a restriction.
- Day Recap includes free writing, three favourite things, split temperature/description weather fields, optional steps/distance, a favourite-memory prompt and one optional photo or video at the bottom. Existing recap pages remain compatible and are normalised to three favourites when edited.
- Page elements can be dragged, resized and rotated on coloured paper. Scrapbook pages are stored in shared trip state, carry creator identity and merge safely by page ID.
- Freeform pages now include original Zora blank, journal, pinboard, photo-wall, postcard and film-inspired starting templates. Members can mix photos, videos, classic/handwritten/cut-out/outline/label text, arbitrary emoji, stickers, coloured tape, pins and clips.
- Photos and videos can use plain, white, Polaroid, film or postcard frames, with tape/pin/clip attachments. Selected elements can also move forward/backward, duplicate, resize, rotate or be deleted for a more tactile layered-page feel.
- Template verification found and fixed an incomplete first implementation: Photo Wall had opened as a blank page and template styling was not preserved distinctly. All six template choices now create a recognisably different saved starting page, and the media-frame selector exposes all five documented frame styles.
- Photo Wall uses a blank-page-first workflow. Adding a photo opens the proven original Story Wall composer: choose one trip photo, give that photo its own caption and emoji, and attach tape, a pin or a postmark. The resulting card moves as one item. Members can then keep adding independently captioned photo cards plus ad-hoc text, emojis, stickers, tape, pins and clips anywhere on the same page.
- Every open scrapbook page now has an unmistakable floating `+ Add` control on iPhone. It opens a bottom creation tray for photos, text, emoji, stickers, tape, pins, clips and postmarks, avoiding reliance on the cramped desktop-style sidebar on mobile.
- Tapping any existing scrapbook object on iPhone now opens a visible object inspector. Text, emojis and stickers can be rewritten; photo cards can edit their attached caption and emoji; photos/videos can change frame and attachment; and every object supports live resize, rotation, layer order, duplication and deletion.
- The redundant desktop-style `Add to page` sidebar was removed from underneath the page; the floating Add tray and tap-to-edit inspector are now the only controls on phone and laptop. Scrapbook text automatically changes to warm white on dark paper, and dark cut-out/label/outline styles explicitly retain white lettering.
- The Memory Map is now one combined all-trip map. Its management list is collapsed by default; opening it asks for a day before showing that day's stops, preventing an overwhelming list.

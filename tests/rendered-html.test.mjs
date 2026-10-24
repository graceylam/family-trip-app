import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Family Trip app", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Our Shared Adventure<\/title>/i);
  assert.match(html, /Opening your adventures/);
  assert.match(html, /Your trip\. All together\./);
  assert.match(html, /zora-loading-progress/);
  assert.doesNotMatch(html, /Google OAuth client ID|Connect Drive/);
});

test("uses Firebase for trip sync and private R2 photo and video storage", async () => {
  const [driveClient, firebaseTripState, firebaseAccounts, firebaseMedia, r2Worker, firestoreRules, storageRules, page, gallery, memoryLane, stopsBank, mapbox, queue, service, pagesWorkflow, pagesConfig, styles] = await Promise.all([
    readFile(new URL("../lib/googleDrive.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/firebaseTripState.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/firebaseAccounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/firebaseMedia.ts", import.meta.url), "utf8"),
    readFile(new URL("../r2-worker/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../storage.rules", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Gallery.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MemoryLane.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/StopsBank.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/mapbox.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/photoQueue.ts", import.meta.url), "utf8"),
    readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../vite.pages.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(driveClient, /script\.google\.com\/macros\/s\//);
  assert.match(driveClient, /configureGoogleDriveGateway/);
  assert.doesNotMatch(driveClient, /const sharedSecret = "[a-f0-9]{32,}"/);
  assert.match(driveClient, /form\.submit\(\)/);
  assert.match(driveClient, /blobToBase64/);
  assert.doesNotMatch(driveClient, /accounts\.google\.com|initTokenClient|access_token/);
  assert.match(firebaseTripState, /observeFirebaseTripState/);
  assert.match(firebaseTripState, /runTransaction/);
  assert.match(firebaseTripState, /mergeTripState/);
  assert.match(firebaseAccounts, /persistentLocalCache/);
  assert.match(firestoreRules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
  assert.match(page, /saveFirebaseTripState/);
  assert.match(page, /initializeFirebaseTripState/);
  assert.match(page, /private link Grace prepared for you/);
  assert.match(queue, /indexedDB\.open/);
  assert.match(queue, /pendingCloudDeletion/);
  assert.match(queue, /photo-state/);
  assert.match(queue, /const \{ blob: _blob, \.\.\.metadata \} = updated/);
  assert.match(queue, /family-trip-photo-queue-clean-v1/);
  assert.match(service, /window\.top\.postMessage/);
  assert.match(service, /file\.setTrashed\(true\)/);
  assert.match(driveClient, /action: "organize"/);
  assert.match(firebaseMedia, /XMLHttpRequest/);
  assert.match(firebaseMedia, /VITE_R2_MEDIA_API_URL/);
  assert.match(firebaseMedia, /getFamilyIdToken/);
  assert.match(firebaseMedia, /observeTripMedia/);
  assert.match(firebaseMedia, /thumbnailPath/);
  assert.match(firebaseMedia, /displayPath/);
  assert.match(firebaseMedia, /resizeImage\(image, 1920, \.86\)/);
  assert.match(r2Worker, /MEDIA_BUCKET/);
  assert.match(r2Worker, /original\|display\|thumbnail/);
  assert.match(r2Worker, /100_000_000_000/);
  assert.match(r2Worker, /firestore\.googleapis\.com/);
  assert.match(storageRules, /tripMember/);
  assert.match(page, /accept="image\/\*,video\/\*"/);
  assert.match(page, /friendlyMediaName/);
  assert.match(page, /\$\{stopName\.trim\(\)\} \$\{personName\.trim\(\)\} \$\{kind\} \$\{sequence\}/);
  assert.match(page, /uploadTripMedia/);
  assert.match(page, /autoUploadCount/);
  assert.match(page, /Sharing \$\{uploadProgress/);
  assert.match(page, /Photos & videos/);
  assert.match(page, /selectedSharedPhotos/);
  assert.match(styles, /camera-roll-grid/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(page, /Refresh Drive folders|Drive connected|Drive offline|Checking Drive/);
  assert.match(gallery, /Photos and videos/);
  assert.match(gallery, /Favourites/);
  assert.match(gallery, /Save All Shared/);
  assert.match(gallery, /Save Selected to Photos/);
  assert.match(gallery, /Save to Photos/);
  assert.match(gallery, /saveUrlToPhotos/);
  assert.match(page, /saveBlobToNativePhotos/);
  assert.match(gallery, /gallery-lightbox/);
  assert.match(service, /"Day " \+ dayNumber \+ " - " \+ dayName/);
  assert.match(service, /file\.moveTo\(getPhotoFolder_\(payload\)\)/);
  assert.match(driveClient, /getSharedTrip/);
  assert.match(driveClient, /saveSharedTrip/);
  assert.match(page, /vienna-2026-family-trip/);
  assert.match(page, /readOnly=\{!currentMember\}/);
  assert.match(service, /Trip itinerary\.json/);
  assert.match(service, /mergeTripState_/);
  assert.match(service, /'s version\)/);
  assert.match(driveClient, /baseTrip/);
  assert.match(service, /previousTripId/);
  assert.match(page, /Private invitation needed/);
  assert.doesNotMatch(page, /Copy link/);
  assert.doesNotMatch(page, /updateTripIconPresentation/);
  assert.match(page, /tripAccountMembers\.map/);
  assert.match(firebaseAccounts, /avatarEmoji/);
  assert.match(firebaseAccounts, /avatarColor/);
  assert.match(firebaseAccounts, /updateTripDefaultCurrency/);
  assert.match(page, /Default trip currency/);
  assert.match(page, /memberIdKey/);
  assert.match(page, /storedMemberId \|\| queryMemberId/);
  assert.match(page, /profile locked to this device/);
  assert.doesNotMatch(page, /copyMemberLink/);
  assert.doesNotMatch(page, /Use here/);
  assert.match(page, /readOnly=\{!isAdmin\}/);
  assert.match(page, /Mapbox location/);
  assert.match(page, /Itinerary View/);
  assert.match(page, /Map View/);
  assert.match(page, /DayPinMap/);
  assert.match(page, /createFamilyMap/);
  assert.match(page, /Location for Stop/);
  assert.doesNotMatch(page, /tile\.openstreetmap\.org/);
  assert.match(mapbox, /mapbox:\/\/styles\/mapbox\/standard/);
  assert.match(mapbox, /requireMapboxToken/);
  assert.match(pagesWorkflow, /VITE_MAPBOX_ACCESS_TOKEN/);
  assert.match(pagesWorkflow, /Verify Mapbox configuration/);
  assert.match(mapbox, /search\/searchbox\/v1\/suggest/);
  assert.match(mapbox, /text: item\.name/);
  assert.match(mapbox, /secondaryText: item\.full_address/);
  assert.match(mapbox, /search\/searchbox\/v1\/retrieve/);
  assert.doesNotMatch(page, /computeRoutes|DirectionsService/);
  assert.match(page, /Open map/);
  assert.match(page, /Directions/);
  assert.match(page, /maps\.apple\.com/);
  assert.doesNotMatch(page, /www\.google\.com\/maps\/search/);
  assert.match(page, /Powered by Mapbox/);
  assert.match(page, /Mapbox connected/);
  assert.match(page, /Photo Gallery/);
  assert.match(page, /Memory Lane/);
  assert.match(page, /<MemoryLane/);
  assert.doesNotMatch(memoryLane, /Every place has a story/);
  assert.match(memoryLane, /Turn this day into a highlight/);
  assert.match(memoryLane, /Choose this day&apos;s cover/);
  assert.match(page, /Day subtitle/);
  assert.doesNotMatch(memoryLane, /connectPins: true/);
  assert.match(memoryLane, /onPin/);
  assert.match(memoryLane, /shared group memory/i);
  assert.match(memoryLane, /Last edited by/);
  assert.match(memoryLane, /Search Mapbox location/);
  assert.match(memoryLane, /Maximum|of 20 selected/);
  assert.match(memoryLane, /MediaRecorder/);
  assert.ok(memoryLane.includes("canvas.captureStream"));
  assert.match(memoryLane, /Save or Share Video/);
  assert.match(memoryLane, /Make a memory/);
  assert.match(memoryLane, /Add to scrapbook/);
  assert.match(memoryLane, /Thought or quote/);
  assert.match(memoryLane, /Decorated photo/);
  assert.match(memoryLane, /Memory Map/);
  assert.match(memoryLane, /Movie style/);
  assert.match(memoryLane, /Closing message/);
  assert.match(memoryLane, /Photo highlights on the map/);
  assert.match(memoryLane, /Choose your highlights/);
  assert.match(memoryLane, /The first photo becomes the pin cover/);
  assert.match(memoryLane, /Tap one to open that location&apos;s collection/);
  assert.match(stopsBank, /useState<"list" \| "map">\("list"\)/);
  assert.ok(stopsBank.indexOf("☷ List") < stopsBank.indexOf("⌖ Map"));
  assert.match(stopsBank, /Saved Places/);
  assert.match(stopsBank, /Shortlisted/);
  assert.match(stopsBank, /Scheduled/);
  assert.match(stopsBank, /Add to Itinerary/);
  assert.doesNotMatch(stopsBank, /Add to a day &amp; time|Add to day/);
  assert.doesNotMatch(stopsBank, /Must do|🤔 Maybe|All stages/);
  assert.match(stopsBank, /Love it/);
  assert.match(stopsBank, /Open to it/);
  assert.match(stopsBank, /Not for me/);
  assert.match(stopsBank, /vote-fill/);
  assert.match(stopsBank, /voters\.map\(\(item\) => item\.memberName\)/);
  assert.doesNotMatch(stopsBank, /saved-place-art/);
  assert.match(styles, /\.place-votes \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.place-votes button \{[^}]*min-width: 0;[^}]*max-width: 100%/);
  assert.match(styles, /\.place-votes button \{[^}]*box-sizing: border-box;[^}]*height: 48px/);
  assert.match(styles, /\.place-scheduler input\[type="time"\]::\-webkit-date-and-time-value/);
  assert.match(styles, /\.place-scheduler \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); width: auto; \}/);
  assert.match(styles, /\.saved-place-card \.place-votes, \.saved-place-card \.place-scheduler, \.saved-place-card \.schedule-place-button \{ margin-inline: 13px; \}/);
  assert.match(stopsBank, /\["Sights", "Food & Drink", "Shopping", "Activities", "Nature", "Other"\]/);
  assert.doesNotMatch(stopsBank, /"Transport", "Hotel"/);
  assert.ok(memoryLane.includes("navigator.share"));
  assert.match(memoryLane, /generated video stays on your device/);
  assert.match(gallery, /navigator\.canShare/);
  assert.match(gallery, /Save All Shared/);
  assert.match(gallery, /new .*memories.*since your last visit/);
  assert.match(page, /uploadCandidates\.slice\(start, start \+ 2\)/);
  assert.match(page, /Expenses/);
  assert.match(page, /Local Currency/);
  assert.match(page, /Trip Documents/);
  assert.match(page, /Add files/);
  assert.match(page, /Add screenshots/);
  assert.match(page, /document-preview-modal/);
  assert.match(page, /document-preview-done/);
  assert.match(page, /canPreviewDocumentsNatively/);
  assert.match(page, /previewBlobNatively/);
  assert.match(page, />Done<\/button>/);
  assert.match(page, /Open \/ Share/);
  assert.match(styles, /\.modal\.document-preview-modal \{[^}]*width: 100vw;[^}]*height: 100dvh/);
  assert.match(styles, /\.modal-backdrop\.document-preview-backdrop \{[^}]*z-index: 5000;[^}]*padding: 0/);
  assert.match(page, /stop-detail-disclosure notes-disclosure/);
  assert.match(page, /stop-detail-disclosure documents-disclosure/);
  assert.match(page, /activeTab === "documents"/);
  assert.match(page, /uploadDocumentToDrive/);
  assert.match(driveClient, /export async function uploadDocumentToDrive/);
  assert.match(driveClient, /getSharedFileBlob/);
  assert.match(page, /Home Currency/);
  assert.match(page, /expensePersonFilter/);
  assert.match(page, /expenseDayFilter/);
  assert.match(page, /expenseCategoryFilter/);
  assert.match(page, /Add expense as/);
  assert.match(page, /startEditingExpense/);
  assert.match(page, /saveEditedExpense/);
  assert.match(page, /Edit expense item/);
  assert.match(page, /Save expense/);
  assert.match(page, /<th>Item<\/th><th>Location<\/th>/);
  assert.match(page, /<tfoot>/);
  assert.match(page, /scope="row">Total/);
  assert.match(page, /expenseTotals\.homeAmount/);
  assert.match(page, /localByCurrency/);
  assert.match(page, /data-label="Location">\{stop\.title\}/);
  assert.match(page, /openExpenseEditor/);
  assert.doesNotMatch(page, /newExpenseHomeAmount|aria-label="Home amount"/);
  assert.match(page, /getLatestExchangeRate/);
  assert.match(page, /Refresh \$\{account\.homeCurrency\} conversions/);
  assert.match(page, /className="stop-workspace"/);
  assert.match(page, /className="memory-panel selected-stop-panel"/);
  assert.match(page, /className="stop-expenses"/);
  assert.match(page, /className="photo-panel"/);
  assert.doesNotMatch(page, /className=\{`connection-card/);
  assert.doesNotMatch(page, /Ready for the trip|Travelling offline/);
  assert.doesNotMatch(page, /Photo Upload Status/);
  assert.match(page, /Photo upload progress/);
  assert.match(page, /Adding to this stop/);
  assert.match(page, /could not be uploaded after three attempts/);
  assert.match(page, /pendingQueuePhotos/);
  assert.match(page, /media-add-button/);
  assert.match(page, /waiting safely for a connection/);
  assert.doesNotMatch(page, /Shared gallery ready/);
  assert.match(page, /id="selected-stop-title">Selected stop/);
  assert.match(page, /id="add-photos-title">Photos & videos/);
  assert.match(page, /<p>Day \{dayIndex \+ 1\}<\/p>/);
  assert.match(page, /className="tab-icon"/);
  assert.match(page, /timelineGapHeight\(stop\.time, nextStop\.time\)/);
  assert.doesNotMatch(page, /className="photo-count"/);
  assert.match(page, /className="adventure-shortcuts"/);
  assert.match(page, /Upload cover photo|Replace cover photo/);
  assert.match(page, /Generally in November/);
  assert.match(page, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(page, /Live forecasts will appear here automatically/);
  assert.match(page, /promoteTripMemberToAdmin/);
  assert.match(page, /Make admin/);
  assert.match(firebaseAccounts, /observeTripAccountMembers/);
  assert.match(firebaseAccounts, /promoteTripMemberToAdmin/);
  assert.match(firebaseAccounts, /deleteAccountTrip/);
  assert.match(page, /Delete trip for everyone/);
  assert.match(page, /Export shared photos and videos first/);
  assert.match(firestoreRules, /allow delete: if \(signedIn\(\) && request\.auth\.uid == userId\) \|\| isTripAdmin\(tripId\)/);
  assert.match(driveClient, /uploadTripCoverToDrive/);
  assert.match(service, /uploadCoverPhoto_/);
  assert.match(gallery, /Our Snapshots/);
  assert.match(gallery, /memberProfilesByUid/);
  assert.match(gallery, /avatarEmoji/);
  assert.match(gallery, /avatarColor/);
  assert.match(gallery, /Save Selected to Photos/);
  assert.match(mapbox, /searchMapboxPlaces/);
  assert.match(mapbox, /directions\/v5\/mapbox/);
  assert.match(mapbox, /inferMapPinCategory/);
  assert.match(page, /travelModeToNext/);
  assert.match(page, /Train \/ flight/);
  assert.doesNotMatch(page, /getPlacesUsage/);
  assert.match(driveClient, /placesAutocomplete/);
  assert.match(driveClient, /getPlacesUsage/);
  assert.match(driveClient, /getSharedPhotos/);
  assert.match(driveClient, /getSharedPhotoBlob/);
  assert.match(service, /listPhotos_/);
  assert.match(service, /getPhoto_/);
  assert.match(service, /collectPhotoFiles_/);
  assert.match(service, /placesSafeLimit: 8000/);
  assert.match(service, /placesGoogleFreeAllowance: 10000/);
  assert.match(service, /GOOGLE_PLACES_API_KEY/);
  assert.match(service, /monthly Google Places safety cap/);
  assert.match(service, /restrictTripNames_/);
  assert.match(service, /mergeExpenses_/);
  assert.match(service, /mergeStopMemory_/);
  assert.match(service, /updatedByMemberName/);
  assert.match(service, /exchangeRateDate/);
  assert.match(service, /memberName/);
  assert.match(page, /Add another day/);
  assert.match(page, /Delete stop/);
  assert.match(page, /pendingLocalRemoval/);
  assert.match(queue, /pendingLocalRemoval/);
  assert.match(page, /family-trip-pending-save-v1/);
  assert.match(page, /tripSaveInFlightRef/);
  assert.match(page, /preservePendingOnExit/);
  assert.match(page, /attempt <= 3/);
  assert.match(page, /latestWasAcknowledged/);
  assert.match(page, /Your changes are still safe on this device/);
  assert.match(page, /Retry itinerary save/);
  assert.match(page, /Saved at/);
  assert.match(page, /sortItineraryChronologically/);
  assert.doesNotMatch(page, /moveSelectedDay|moveSelectedStop|Move day earlier|Move day later/);
  assert.match(page, /function FittedDayTitle/);
  assert.match(page, /className="day-name-title"/);
  assert.match(page, /Day \{selectedDayNumber\} ·/);
  assert.match(page, /Edit Day Details/);
  assert.match(page, /\+ Add Stop/);
  assert.match(page, /id="edit-day-title">Edit day details/);
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /id="delete-day-title">Delete Day/);
  assert.doesNotMatch(page, /aria-label="Change selected day name"|aria-label="Change selected trip day date"/);
  assert.match(pagesWorkflow, /actions\/deploy-pages@v4/);
  assert.match(pagesConfig, /outDir: "pages-dist"/);
});

test("keeps the itinerary day title on one fitted line", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.day-name-title\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /\.day-date-line\s*\{/);
  assert.match(css, /\.day-toolbar\s*\{/);
});

test("keeps autocomplete drafts local and rebases edits made during a save", async () => {
  const [page, memoryLane, merge] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/MemoryLane.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/tripMerge.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /setPlaceSearchDraft\(value\)/);
  assert.match(page, /Use typed location/);
  assert.match(page, /baseTrip: sending\.draft/);
  assert.match(page, /updateStopInDay\(target\.dayId, target\.stopId/);
  assert.match(memoryLane, /locationDraftValue/);
  assert.match(merge, /valuesConflict/);
  assert.match(merge, /stopLocation/);
});

test("keeps expenses in a scrollable table on narrow screens", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.expenses-table-scroll\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /\.expenses-table\s*\{[^}]*min-width:\s*880px;/s);
  assert.doesNotMatch(css, /\.expenses-table,\s*\.expenses-table tbody[^\{]*\{[^}]*display:\s*block/s);
  assert.doesNotMatch(css, /\.expenses-table thead\s*\{[^}]*display:\s*none/);
});

test("provides a responsive Memory Lane map and recap layout", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.memory-lane-layout\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.memory-map-column\s*\{[^}]*position:\s*sticky;/s);
  assert.match(css, /\.memory-photo-row\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.memory-lane-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(css, /\.highlight-progress\s*\{/);
});

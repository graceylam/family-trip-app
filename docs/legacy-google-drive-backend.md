# Legacy Google Drive backend rollback

Status: preserved during the Firebase migration.

The repository tag `drive-backend-last-known-good-2026-08-20` identifies the last working version in which Google Apps Script and `Trip itinerary.json` are authoritative for itinerary data as well as shared media.

## What remains on Drive during migration

- The existing Vienna `Trip itinerary.json` is the read-only migration source and rollback copy.
- Existing shared photos and the trip cover remain in the family-owned Drive.
- Upload, gallery, deletion, folder organisation, Google Places proxying, and cover-photo actions continue through the Apps Script gateway until Firebase Storage is enabled and verified.

## What moves to Firebase first

- Accounts and trip membership already use Firebase Authentication and Firestore.
- The itinerary, expenses, stop memories, day stories, and their revision metadata move to `trips/{tripId}/state/itinerary` in Firestore.
- The application imports the Drive itinerary only when the Firestore itinerary does not yet exist and only an admin can initialise that record.

## Rollback procedure

1. Do not delete the Drive trip folder or Apps Script deployment.
2. Check out the rollback tag locally, or restore the Drive itinerary adapter from that tag.
3. Rebuild the web/PWA and Capacitor bundles.
4. Confirm the Apps Script deployment URL and its script properties still match the family account.
5. Open the Vienna trip and verify the Drive JSON revision before allowing edits.

Never publish `apps-script/Code.gs`, private invitation material, script properties, or family secrets to the public GitHub mirror. The public deployment must continue to use a secret-safe source export.

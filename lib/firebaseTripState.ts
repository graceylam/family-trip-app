import { doc, getDoc, onSnapshot, runTransaction, type Unsubscribe } from "firebase/firestore";
import type { AccountTrip, FamilyAccount } from "./firebaseAccounts";
import { getFamilyFirestore } from "./firebaseAccounts";
import type { SharedTripState, TripMember } from "./googleDrive";
import { mergeTripState } from "./tripMerge";

const itineraryDocumentId = "itinerary";

type StoredTripState = SharedTripState & {
  schemaVersion?: number;
  updatedByUid?: string;
  updatedByName?: string;
};

function itineraryReference(tripId: string) {
  return doc(getFamilyFirestore(), "trips", tripId, "state", itineraryDocumentId);
}

function cleanTripState(value: Partial<SharedTripState>, tripId: string): SharedTripState {
  const days = Array.isArray(value.days) ? value.days : [];
  const members = Array.isArray(value.members) ? value.members : [];
  return {
    tripId,
    tripName: String(value.tripName || "Family Trip"),
    coverPhotoId: String(value.coverPhotoId || ""),
    days,
    members,
    highlights: Array.isArray(value.highlights) ? value.highlights : [],
    scrapbookPages: Array.isArray(value.scrapbookPages) ? value.scrapbookPages : [],
    updatedAt: String(value.updatedAt || new Date().toISOString()),
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
  };
}

function storedTripState(state: SharedTripState, account: FamilyAccount): StoredTripState {
  return {
    ...state,
    schemaVersion: 1,
    updatedByUid: account.uid,
    updatedByName: account.displayName,
  };
}

export async function getFirebaseTripState(tripId: string): Promise<SharedTripState | null> {
  const snapshot = await getDoc(itineraryReference(tripId));
  return snapshot.exists() ? cleanTripState(snapshot.data() as Partial<SharedTripState>, tripId) : null;
}

export function observeFirebaseTripState(
  tripId: string,
  listener: (trip: SharedTripState | null, pendingLocalWrites: boolean) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    itineraryReference(tripId),
    { includeMetadataChanges: true },
    (snapshot) => listener(
      snapshot.exists() ? cleanTripState(snapshot.data() as Partial<SharedTripState>, tripId) : null,
      snapshot.metadata.hasPendingWrites,
    ),
    (error) => onError(error),
  );
}

export async function initializeFirebaseTripState(
  account: FamilyAccount,
  trip: AccountTrip,
  seed: SharedTripState,
): Promise<SharedTripState> {
  if (trip.role !== "admin") throw new Error("The trip admin needs to finish connecting this itinerary first.");
  const reference = itineraryReference(trip.id);
  return runTransaction(getFamilyFirestore(), async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists()) return cleanTripState(existing.data() as Partial<SharedTripState>, trip.id);
    const initial = cleanTripState({ ...seed, tripId: trip.id, revision: 1, updatedAt: new Date().toISOString() }, trip.id);
    transaction.set(reference, storedTripState(initial, account));
    return initial;
  });
}

export async function saveFirebaseTripState(
  account: FamilyAccount,
  trip: AccountTrip,
  draft: SharedTripState,
  member: TripMember,
  base: SharedTripState,
): Promise<SharedTripState> {
  const reference = itineraryReference(trip.id);
  return runTransaction(getFamilyFirestore(), async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error("The shared Firestore itinerary has not been initialised yet.");
    const current = cleanTripState(snapshot.data() as Partial<SharedTripState>, trip.id);
    const merged = mergeTripState(
      current,
      cleanTripState({ ...draft, tripId: trip.id }, trip.id),
      cleanTripState({ ...base, tripId: trip.id }, trip.id),
      member.name || account.displayName,
      trip.role === "admin",
    );
    const saved: SharedTripState = {
      ...merged,
      tripId: trip.id,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    transaction.set(reference, storedTripState(saved, account));
    return saved;
  });
}

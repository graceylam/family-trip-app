import { doc, onSnapshot, runTransaction, type Unsubscribe } from "firebase/firestore";
import { getFamilyFirestore, type FamilyAccount } from "./firebaseAccounts";

export type SavedPlaceVote = "love" | "open" | "not_for_me" | "maybe";
export type SavedPlaceStatus = "dreaming" | "shortlisted" | "scheduled" | "visited";

export type SavedPlace = {
  id: string;
  name: string;
  location: string;
  category: string;
  note: string;
  sourceUrl?: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
  status: SavedPlaceStatus;
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  votes: Record<string, { value: SavedPlaceVote; memberName: string }>;
};

type SavedPlacesState = {
  schemaVersion: 1;
  tripId: string;
  places: SavedPlace[];
  revision: number;
  updatedAt: string;
  updatedByUid: string;
};

function reference(tripId: string) {
  return doc(getFamilyFirestore(), "trips", tripId, "state", "saved-places");
}

function cleanPlace(value: Partial<SavedPlace>): SavedPlace {
  return {
    id: String(value.id || crypto.randomUUID()),
    name: String(value.name || "Saved place"),
    location: String(value.location || ""),
    category: String(value.category || "Other"),
    note: String(value.note || ""),
    ...(value.sourceUrl ? { sourceUrl: String(value.sourceUrl) } : {}),
    ...(value.placeId ? { placeId: String(value.placeId) } : {}),
    ...(Number.isFinite(value.latitude) ? { latitude: Number(value.latitude) } : {}),
    ...(Number.isFinite(value.longitude) ? { longitude: Number(value.longitude) } : {}),
    ...(value.googleMapsUrl ? { googleMapsUrl: String(value.googleMapsUrl) } : {}),
    status: (["dreaming", "shortlisted", "scheduled", "visited"] as SavedPlaceStatus[]).includes(value.status as SavedPlaceStatus)
      ? value.status as SavedPlaceStatus
      : "dreaming",
    createdByUid: String(value.createdByUid || ""),
    createdByName: String(value.createdByName || "Family member"),
    createdAt: String(value.createdAt || new Date().toISOString()),
    votes: value.votes && typeof value.votes === "object" ? value.votes : {},
  };
}

function cleanState(value: Partial<SavedPlacesState>, tripId: string): SavedPlacesState {
  return {
    schemaVersion: 1,
    tripId,
    places: Array.isArray(value.places) ? value.places.map(cleanPlace) : [],
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    updatedAt: String(value.updatedAt || new Date().toISOString()),
    updatedByUid: String(value.updatedByUid || ""),
  };
}

export function observeSavedPlaces(
  tripId: string,
  listener: (places: SavedPlace[], pending: boolean) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(reference(tripId), { includeMetadataChanges: true }, (snapshot) => {
    const state = snapshot.exists() ? cleanState(snapshot.data() as Partial<SavedPlacesState>, tripId) : cleanState({}, tripId);
    listener(state.places, snapshot.metadata.hasPendingWrites);
  }, onError);
}

export async function updateSavedPlaces(
  account: FamilyAccount,
  tripId: string,
  updater: (places: SavedPlace[]) => SavedPlace[],
): Promise<void> {
  const target = reference(tripId);
  await runTransaction(getFamilyFirestore(), async (transaction) => {
    const snapshot = await transaction.get(target);
    const current = snapshot.exists()
      ? cleanState(snapshot.data() as Partial<SavedPlacesState>, tripId)
      : cleanState({}, tripId);
    const next: SavedPlacesState = {
      schemaVersion: 1,
      tripId,
      places: updater(current.places.map((place) => ({ ...place, votes: { ...place.votes } }))),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedByUid: account.uid,
    };
    transaction.set(target, next);
  });
}

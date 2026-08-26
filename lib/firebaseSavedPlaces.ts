import { doc, onSnapshot, runTransaction, type Unsubscribe } from "firebase/firestore";
import { getFamilyFirestore, type FamilyAccount } from "./firebaseAccounts";

export type SavedPlaceVote = "love" | "maybe";

export type SavedPlace = {
  id: string;
  name: string;
  location: string;
  category: string;
  note: string;
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

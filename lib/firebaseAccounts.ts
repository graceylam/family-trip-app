import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

type PublicFirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

type FirebaseEnvironment = Partial<Record<
  "VITE_FIREBASE_API_KEY" | "VITE_FIREBASE_AUTH_DOMAIN" | "VITE_FIREBASE_PROJECT_ID" | "VITE_FIREBASE_APP_ID",
  string
>>;

const environment = ((import.meta as ImportMeta & { env?: FirebaseEnvironment }).env ?? {});

// Firebase's web configuration identifies the public client application; it is
// not a server credential. Security is enforced by Authentication and the
// Firestore rules in firestore.rules.
const firebaseConfig: PublicFirebaseConfig = {
  apiKey: environment.VITE_FIREBASE_API_KEY?.trim() || "AIzaSyC0CFWNhKcDoSoXRaQ-V3G5M90gVWuD9tU",
  authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN?.trim() || "family-trip-app-4d00e.firebaseapp.com",
  projectId: environment.VITE_FIREBASE_PROJECT_ID?.trim() || "family-trip-app-4d00e",
  appId: environment.VITE_FIREBASE_APP_ID?.trim() || "1:920791463665:web:723cd70585dd8b31afdb50",
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestore: Firestore | null = null;

function services(): { auth: Auth; db: Firestore } {
  if (!firebaseConfigured) {
    throw new Error("Family accounts are still being connected. Please try again shortly.");
  }
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = initializeAuth(firebaseApp, { persistence: browserLocalPersistence });
    firestore = initializeFirestore(firebaseApp, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { auth: firebaseAuth!, db: firestore! };
}

export function getFamilyFirestore(): Firestore {
  return services().db;
}

export type FamilyAccount = {
  uid: string;
  email: string;
  displayName: string;
};

export type TripRole = "admin" | "contributor";

export type AccountTrip = {
  id: string;
  name: string;
  role: TripRole;
  ownerUid: string;
  ownerName: string;
  startDate: string;
  endDate: string;
  memberName: string;
  legacyDriveTripId?: string;
};

export type CreatedTrip = {
  trip: AccountTrip;
  inviteCode: string;
  inviteId: string;
  groupName: string;
};

export type TripInvite = {
  id: string;
  tripId: string;
  tripName: string;
  groupName: string;
  inviteCode?: string;
};

type TripReferenceDocument = Omit<AccountTrip, "id"> & { updatedAt?: unknown };

function accountFromUser(user: User): FamilyAccount {
  return {
    uid: user.uid,
    email: user.email ?? "",
    displayName: user.displayName?.trim() || user.email?.split("@")[0] || "Traveller",
  };
}

export function observeFamilyAccount(listener: (account: FamilyAccount | null) => void): Unsubscribe {
  if (!firebaseConfigured) {
    listener(null);
    return () => undefined;
  }
  const { auth } = services();
  return onAuthStateChanged(auth, (user) => listener(user ? accountFromUser(user) : null));
}

export async function createFamilyAccount(displayName: string, email: string, password: string): Promise<FamilyAccount> {
  const { auth, db } = services();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const cleanName = displayName.trim();
  await updateProfile(credential.user, { displayName: cleanName });
  await setDoc(doc(db, "users", credential.user.uid), {
    displayName: cleanName,
    email: credential.user.email ?? email.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return accountFromUser(credential.user);
}

export async function signInToFamilyAccount(email: string, password: string): Promise<FamilyAccount> {
  const { auth } = services();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return accountFromUser(credential.user);
}

export async function signOutOfFamilyAccount(): Promise<void> {
  const { auth } = services();
  await signOut(auth);
}

export async function getFamilyAccountToken(): Promise<string> {
  const { auth } = services();
  if (!auth.currentUser) throw new Error("Sign in to your family account first.");
  return auth.currentUser.getIdToken();
}

export async function resetFamilyPassword(email: string): Promise<void> {
  const { auth } = services();
  await sendPasswordResetEmail(auth, email.trim());
}

export function observeAccountTrips(account: FamilyAccount, listener: (trips: AccountTrip[]) => void): Unsubscribe {
  const { db } = services();
  return onSnapshot(collection(db, "users", account.uid, "trips"), (snapshot) => {
    const trips = snapshot.docs.map((tripDocument) => ({
      id: tripDocument.id,
      ...(tripDocument.data() as TripReferenceDocument),
    }));
    trips.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.name.localeCompare(right.name));
    listener(trips);
  });
}

function normalizeGroupName(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU").replace(/\s+/g, " ");
}

async function inviteIdentifier(groupName: string, code: string): Promise<string> {
  const input = new TextEncoder().encode(`${normalizeGroupName(groupName)}|${code.trim().toUpperCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function tripReference(
  tripId: string,
  name: string,
  account: FamilyAccount,
  role: TripRole,
  startDate: string,
  endDate: string,
  legacyDriveTripId?: string,
): AccountTrip {
  return {
    id: tripId,
    name,
    role,
    ownerUid: account.uid,
    ownerName: account.displayName,
    memberName: account.displayName,
    startDate,
    endDate,
    ...(legacyDriveTripId ? { legacyDriveTripId } : {}),
  };
}

function tripReferenceData(trip: AccountTrip): Omit<AccountTrip, "id"> {
  return {
    name: trip.name,
    role: trip.role,
    ownerUid: trip.ownerUid,
    ownerName: trip.ownerName,
    startDate: trip.startDate,
    endDate: trip.endDate,
    memberName: trip.memberName,
    ...(trip.legacyDriveTripId ? { legacyDriveTripId: trip.legacyDriveTripId } : {}),
  };
}

export async function createAccountTrip(
  account: FamilyAccount,
  details: { name: string; groupName: string; startDate: string; endDate: string },
): Promise<CreatedTrip> {
  const { db } = services();
  const tripId = crypto.randomUUID();
  const inviteCode = newInviteCode();
  const inviteId = await inviteIdentifier(details.groupName, inviteCode);
  const trip = tripReference(tripId, details.name.trim(), account, "admin", details.startDate, details.endDate);
  const referenceData = tripReferenceData(trip);
  const batch = writeBatch(db);

  batch.set(doc(db, "trips", tripId), {
    name: trip.name,
    ownerUid: account.uid,
    ownerName: account.displayName,
    startDate: details.startDate,
    endDate: details.endDate,
    groupName: details.groupName.trim(),
    activeInviteId: inviteId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "trips", tripId, "members", account.uid), {
    userId: account.uid,
    displayName: account.displayName,
    email: account.email,
    role: "admin",
    joinedAt: serverTimestamp(),
  });
  const firstDayId = crypto.randomUUID();
  batch.set(doc(db, "trips", tripId, "state", "itinerary"), {
    schemaVersion: 1,
    tripId,
    tripName: trip.name,
    coverPhotoId: "",
    days: [{ id: `day-${firstDayId}`, date: details.startDate, label: "First Day", stops: [] }],
    members: [{ id: account.uid, name: account.displayName }],
    revision: 1,
    updatedAt: new Date().toISOString(),
    updatedByUid: account.uid,
    updatedByName: account.displayName,
  });
  batch.set(doc(db, "users", account.uid, "trips", tripId), {
    ...referenceData,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, "invites", inviteId), {
    tripId,
    tripName: trip.name,
    groupName: details.groupName.trim(),
    groupLookup: normalizeGroupName(details.groupName),
    ownerUid: account.uid,
    ownerName: account.displayName,
    startDate: details.startDate,
    endDate: details.endDate,
    active: true,
    createdByUid: account.uid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  await setDoc(doc(db, "trips", tripId, "private", "invite"), {
    inviteId,
    inviteCode,
    groupName: details.groupName.trim(),
    updatedAt: serverTimestamp(),
  });
  return { trip, inviteCode, inviteId, groupName: details.groupName.trim() };
}

async function readActiveInvite(inviteId: string): Promise<TripInvite> {
  const { db } = services();
  const inviteSnapshot = await getDoc(doc(db, "invites", inviteId));
  if (!inviteSnapshot.exists() || inviteSnapshot.data().active !== true) {
    throw new Error("That invitation is invalid or has been replaced by the trip admin.");
  }
  const invite = inviteSnapshot.data();
  return {
    id: inviteId,
    tripId: String(invite.tripId),
    tripName: String(invite.tripName),
    groupName: String(invite.groupName),
  };
}

export async function joinTripWithCode(account: FamilyAccount, groupName: string, code: string): Promise<AccountTrip> {
  return joinTripWithInvite(account, await inviteIdentifier(groupName, code));
}

export async function joinTripWithInvite(account: FamilyAccount, inviteId: string): Promise<AccountTrip> {
  const { db } = services();
  const invite = await readActiveInvite(inviteId.trim());
  const inviteSnapshot = await getDoc(doc(db, "invites", invite.id));
  const tripData = inviteSnapshot.data() || {};
  const trip: AccountTrip = {
    id: invite.tripId,
    name: String(tripData.name || invite.tripName),
    role: "contributor",
    ownerUid: String(tripData.ownerUid),
    ownerName: String(tripData.ownerName || "Trip admin"),
    memberName: account.displayName,
    startDate: String(tripData.startDate || ""),
    endDate: String(tripData.endDate || ""),
    ...(tripData.legacyDriveTripId ? { legacyDriveTripId: String(tripData.legacyDriveTripId) } : {}),
  };
  const referenceData = tripReferenceData(trip);
  const batch = writeBatch(db);
  batch.set(doc(db, "trips", invite.tripId, "members", account.uid), {
    userId: account.uid,
    displayName: account.displayName,
    email: account.email,
    role: "contributor",
    inviteId: invite.id,
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(db, "users", account.uid, "trips", invite.tripId), {
    ...referenceData,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return trip;
}

export async function rotateTripInvite(account: FamilyAccount, trip: AccountTrip, groupName: string): Promise<{ inviteId: string; inviteCode: string }> {
  const { db } = services();
  const tripSnapshot = await getDoc(doc(db, "trips", trip.id));
  if (!tripSnapshot.exists() || tripSnapshot.data().ownerUid !== account.uid) {
    throw new Error("Only the trip admin can replace its invitation code.");
  }
  const previousInviteId = String(tripSnapshot.data().activeInviteId || "");
  const inviteCode = newInviteCode();
  const inviteId = await inviteIdentifier(groupName, inviteCode);
  const batch = writeBatch(db);
  if (previousInviteId) batch.update(doc(db, "invites", previousInviteId), { active: false, replacedAt: serverTimestamp() });
  batch.set(doc(db, "invites", inviteId), {
    tripId: trip.id,
    tripName: trip.name,
    groupName: groupName.trim(),
    groupLookup: normalizeGroupName(groupName),
    ownerUid: trip.ownerUid,
    ownerName: trip.ownerName,
    startDate: trip.startDate,
    endDate: trip.endDate,
    ...(trip.legacyDriveTripId ? { legacyDriveTripId: trip.legacyDriveTripId } : {}),
    active: true,
    createdByUid: account.uid,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, "trips", trip.id), { activeInviteId: inviteId, groupName: groupName.trim(), updatedAt: serverTimestamp() });
  await batch.commit();
  await setDoc(doc(db, "trips", trip.id, "private", "invite"), {
    inviteId,
    inviteCode,
    groupName: groupName.trim(),
    updatedAt: serverTimestamp(),
  });
  return { inviteId, inviteCode };
}

export async function readTripInviteForAdmin(account: FamilyAccount, trip: AccountTrip): Promise<TripInvite | null> {
  const { db } = services();
  if (trip.role !== "admin") return null;
  const tripSnapshot = await getDoc(doc(db, "trips", trip.id));
  if (!tripSnapshot.exists() || tripSnapshot.data().ownerUid !== account.uid) return null;
  const inviteId = String(tripSnapshot.data().activeInviteId || "");
  if (!inviteId) return null;
  const invite = await readActiveInvite(inviteId);
  const privateInvite = await getDoc(doc(db, "trips", trip.id, "private", "invite"));
  return {
    ...invite,
    inviteCode: privateInvite.exists() ? String(privateInvite.data().inviteCode || "") : "",
  };
}

export async function attachLegacyViennaTrip(account: FamilyAccount): Promise<AccountTrip> {
  const { db } = services();
  const tripId = "vienna-2026-family-trip";
  let existing: Awaited<ReturnType<typeof getDoc>> | null = null;
  try {
    existing = await getDoc(doc(db, "trips", tripId));
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (!code.includes("permission-denied")) throw error;
    // A signed-in user cannot read a trip before becoming a member. For this
    // deterministic one-time migration, a denied read therefore proceeds to
    // the create batch; Firestore will still reject it if another owner exists.
  }
  const trip = tripReference(tripId, "2026 Vienna Trip", account, "admin", "2026-10-31", "2026-11-03", tripId);
  const referenceData = tripReferenceData(trip);
  if (!existing?.exists()) {
    const groupName = "Grace Vienna 2026";
    const inviteCode = newInviteCode();
    const inviteId = await inviteIdentifier(groupName, inviteCode);
    const batch = writeBatch(db);
    batch.set(doc(db, "trips", tripId), {
      name: trip.name,
      ownerUid: account.uid,
      ownerName: account.displayName,
      startDate: trip.startDate,
      endDate: trip.endDate,
      groupName,
      activeInviteId: inviteId,
      legacyDriveTripId: tripId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "invites", inviteId), {
      tripId,
      tripName: trip.name,
      groupName,
      groupLookup: normalizeGroupName(groupName),
      ownerUid: account.uid,
      ownerName: account.displayName,
      startDate: trip.startDate,
      endDate: trip.endDate,
      legacyDriveTripId: tripId,
      active: true,
      createdByUid: account.uid,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, "trips", tripId, "members", account.uid), {
      userId: account.uid,
      displayName: account.displayName,
      email: account.email,
      role: "admin",
      legacyMemberId: "grace",
      joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, "users", account.uid, "trips", tripId), {
      ...referenceData,
      memberName: "Grace",
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await setDoc(doc(db, "trips", tripId, "private", "invite"), {
      inviteId,
      inviteCode,
      groupName,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(doc(db, "users", account.uid, "trips", tripId), {
      ...referenceData,
      memberName: "Grace",
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
  return { ...trip, memberName: "Grace" };
}

export function firebaseErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("invalid-credential")) return "That email or password is not correct.";
  if (code.includes("email-already-in-use")) return "An account already exists for that email. Try signing in instead.";
  if (code.includes("weak-password")) return "Choose a password with at least six characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("too-many-requests")) return "Too many attempts were made. Please wait a little while and try again.";
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export async function renameAccountTrip(account: FamilyAccount, trip: AccountTrip, name: string): Promise<void> {
  const { db } = services();
  if (trip.role !== "admin") throw new Error("Only the trip admin can rename this trip.");
  const cleanName = name.trim();
  await updateDoc(doc(db, "trips", trip.id), { name: cleanName, updatedAt: serverTimestamp() });
  await setDoc(doc(db, "users", account.uid, "trips", trip.id), { name: cleanName, updatedAt: serverTimestamp() }, { merge: true });
}

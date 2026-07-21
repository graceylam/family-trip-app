"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sortItineraryChronologically } from "../lib/chronology";
import { convertedAmount, getLatestExchangeRate } from "../lib/exchangeRates";
import {
  addQueuedPhotos,
  deleteQueuedPhoto,
  getStorageHealth,
  getQueuedPhoto,
  listQueuedPhotos,
  type QueuedPhotoView,
  requestPersistentStorage,
  type StorageHealth,
  type StoredQueuedPhoto,
  updateQueuedPhoto,
} from "../lib/photoQueue";
import {
  checkGoogleDriveGateway,
  configureGoogleDriveGateway,
  deleteDriveFile,
  type DrivePhotoLocation,
  getPlaceDetails,
  getPlacesUsage,
  getSharedPhotoBlob,
  getSharedPhotos,
  getSharedTrip,
  GoogleDriveError,
  organizeDriveFile,
  type PlaceSuggestion,
  type PlacesUsage,
  saveSharedTrip,
  searchPlaces,
  type SharedPhoto,
  type SharedTripState,
  type TripDay,
  type TripExpense,
  type TripMember,
  type TripStop,
  uploadPhotoToDrive,
} from "../lib/googleDrive";

const initialDays: TripDay[] = [
  {
    id: "day-vienna",
    date: "2026-09-18",
    label: "Vienna",
    stops: [
      {
        id: "schonbrunn",
        time: "9:30",
        title: "Schönbrunn Palace",
        place: "Schönbrunner Schloßstraße 47",
        note: "Garden tickets saved with the booking details.",
      },
      {
        id: "naschmarkt",
        time: "13:00",
        title: "Naschmarkt lunch",
        place: "Naschmarkt, Vienna",
        note: "Choose somewhere when we arrive.",
      },
      {
        id: "evening-walk",
        time: "18:30",
        title: "Evening walk",
        place: "Innere Stadt",
        note: "Flexible route before dinner.",
      },
    ],
  },
  {
    id: "day-bratislava",
    date: "2026-09-19",
    label: "Bratislava",
    stops: [
      {
        id: "train-bratislava",
        time: "8:45",
        title: "Train to Bratislava",
        place: "Wien Hauptbahnhof",
        note: "Platform details to be confirmed.",
      },
    ],
  },
];

const initialMembers: TripMember[] = [{ id: "grace", name: "Grace" }];

const itineraryKey = "family-trip-itinerary-v1";
const tripNameKey = "family-trip-name-v1";
const tripIdKey = "family-trip-id-v1";
const adminKey = "family-trip-admin-key-v1";
const memberIdKey = "family-trip-member-id-v1";
const tripAccessKeyStorageKey = "family-trip-access-key-v1";
const pendingTripSaveKey = "family-trip-pending-save-v1";
const lastTripSavedAtKey = "family-trip-last-saved-at-v1";
const sharedTripId = "vienna-2026-family-trip";
const initialTripName = "2026 Vienna Trip";
const expenseCategories = ["Food & Drink", "Transport", "Accommodation", "Tickets & Activities", "Shopping", "Other"];
const currencyOptions = ["EUR", "AUD", "USD", "GBP", "CZK", "HUF", "CHF"];

type PendingTripSave = {
  version: 1;
  fingerprint: string;
  queuedAt: string;
  draft: SharedTripState;
  baseTrip: SharedTripState;
};

function tripFingerprint(tripName: string, days: TripDay[], members: TripMember[]): string {
  return JSON.stringify({ tripName, days, members });
}

function sharedTripFingerprint(trip: SharedTripState): string {
  return tripFingerprint(trip.tripName, trip.days, trip.members);
}

function normalizeSharedTripChronology(trip: SharedTripState): SharedTripState {
  return { ...trip, days: sortItineraryChronologically(trip.days) };
}

function readPendingTripSave(): PendingTripSave | null {
  try {
    const raw = window.localStorage.getItem(pendingTripSaveKey);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingTripSave>;
    if (
      pending.version !== 1 ||
      !pending.fingerprint ||
      !pending.draft ||
      !pending.baseTrip ||
      pending.draft.tripId !== sharedTripId ||
      pending.baseTrip.tripId !== sharedTripId
    ) {
      window.localStorage.removeItem(pendingTripSaveKey);
      return null;
    }
    const completePending = pending as PendingTripSave;
    const draft = normalizeSharedTripChronology(completePending.draft);
    return {
      ...completePending,
      draft,
      fingerprint: sharedTripFingerprint(draft),
    };
  } catch {
    window.localStorage.removeItem(pendingTripSaveKey);
    return null;
  }
}

function writePendingTripSave(pending: PendingTripSave): void {
  window.localStorage.setItem(pendingTripSaveKey, JSON.stringify(pending));
}

function clearPendingTripSave(): void {
  window.localStorage.removeItem(pendingTripSaveKey);
}

function savedTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Shared trip synced";
  return `Saved at ${date.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}`;
}

function timeInputValue(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function googleMapsSearchUrl(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.trim())}`;
}

function googleMapsDirectionsUrl(place: string, placeId?: string): string {
  const placeIdParameter = placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.trim())}${placeIdParameter}`;
}

function galleryDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function expenseDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function expenseMoney(amount: number | null, currency: string): string {
  if (amount === null || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function FittedDayTitle({ children }: { children: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const fitTitle = () => {
      title.style.fontSize = "";
      let size = Number.parseFloat(window.getComputedStyle(title).fontSize);
      while (title.scrollWidth > title.clientWidth && size > 18) {
        size -= 1;
        title.style.fontSize = `${size}px`;
      }
    };
    fitTitle();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitTitle);
    observer?.observe(title);
    return () => observer?.disconnect();
  }, [children]);

  return <h2 className="day-name-title" ref={titleRef}>{children}</h2>;
}

function groupPhotosByPerson(photos: SharedPhoto[]): Array<{ id: string; name: string; photos: SharedPhoto[] }> {
  const groups = new Map<string, { id: string; name: string; photos: SharedPhoto[] }>();
  photos.forEach((photo) => {
    const id = photo.memberId || photo.memberName;
    const existing = groups.get(id);
    if (existing) existing.photos.push(photo);
    else groups.set(id, { id, name: photo.memberName || "Family member", photos: [photo] });
  });
  return Array.from(groups.values());
}

export default function Home() {
  const [tripName, setTripName] = useState(initialTripName);
  const tripId = sharedTripId;
  const [previousTripId, setPreviousTripId] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [tripAccessKey, setTripAccessKey] = useState("");
  const [members, setMembers] = useState<TripMember[]>(initialMembers);
  const [currentMemberId, setCurrentMemberId] = useState("");
  const [tripRevision, setTripRevision] = useState(1);
  const [sharedStateReady, setSharedStateReady] = useState(false);
  const [tripSyncState, setTripSyncState] = useState<"loading" | "synced" | "unsaved" | "saving" | "offline" | "error">("loading");
  const [hasPendingTripSave, setHasPendingTripSave] = useState(false);
  const [lastTripSavedAt, setLastTripSavedAt] = useState("");
  const [googleState, setGoogleState] = useState<"disconnected" | "connecting" | "connected" | "uploading">("disconnected");
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [days, setDays] = useState<TripDay[]>(initialDays);
  const [selectedDayId, setSelectedDayId] = useState(initialDays[0].id);
  const [selectedStopId, setSelectedStopId] = useState(initialDays[0].stops[0].id);
  const [queuedPhotos, setQueuedPhotos] = useState<QueuedPhotoView[]>([]);
  const [queueState, setQueueState] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [queueError, setQueueError] = useState<string | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [showEditDay, setShowEditDay] = useState(false);
  const [showDeleteDayConfirm, setShowDeleteDayConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newStopName, setNewStopName] = useState("");
  const [newStopTime, setNewStopTime] = useState("12:00");
  const [newDayName, setNewDayName] = useState("");
  const [newDayDate, setNewDayDate] = useState("");
  const [editDayName, setEditDayName] = useState("");
  const [editDayDate, setEditDayDate] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [copiedMemberId, setCopiedMemberId] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placeSearchState, setPlaceSearchState] = useState<"idle" | "searching" | "choosing">("idle");
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [placesUsage, setPlacesUsage] = useState<PlacesUsage | null>(null);
  const [activeTab, setActiveTab] = useState<"itinerary" | "gallery" | "expenses">("itinerary");
  const [newExpenseItem, setNewExpenseItem] = useState("");
  const [newExpenseAmount, setNewExpenseAmount] = useState("");
  const [newExpenseCategory, setNewExpenseCategory] = useState(expenseCategories[0]);
  const [newExpenseLocalCurrency, setNewExpenseLocalCurrency] = useState("EUR");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseEditDraft, setExpenseEditDraft] = useState({ item: "", amount: "", category: expenseCategories[0], localCurrency: "EUR" });
  const [expenseConversionState, setExpenseConversionState] = useState<"idle" | "converting">("idle");
  const [expenseConversionError, setExpenseConversionError] = useState<string | null>(null);
  const [expensePersonFilter, setExpensePersonFilter] = useState("");
  const [expenseDayFilter, setExpenseDayFilter] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [sharedPhotos, setSharedPhotos] = useState<SharedPhoto[]>([]);
  const [sharedPhotoUrls, setSharedPhotoUrls] = useState<Record<string, string>>({});
  const [galleryState, setGalleryState] = useState<"idle" | "loading" | "ready" | "offline" | "error">("idle");
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [hasLoadedLocalState, setHasLoadedLocalState] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Map<string, string>());
  const sharedPhotoUrlsRef = useRef(new Map<string, string>());
  const galleryRequestRef = useRef(0);
  const lastSavedTripRef = useRef("");
  const lastSyncedTripRef = useRef<SharedTripState | null>(null);
  const pendingTripSaveRef = useRef<PendingTripSave | null>(null);
  const tripSaveInFlightRef = useRef(false);
  const latestTripDraftRef = useRef({
    tripName: initialTripName,
    days: initialDays,
    members: initialMembers,
    revision: 1,
  });
  const placeSearchTimerRef = useRef<number | null>(null);
  const placeSearchRequestRef = useRef(0);
  const placeSessionTokenRef = useRef("");
  const isAdmin = Boolean(adminSecret);
  const currentMember = useMemo(
    () => members.find((member) => member.id === currentMemberId),
    [currentMemberId, members],
  );
  latestTripDraftRef.current = { tripName, days, members, revision: tripRevision };

  const processPendingTripSave = useCallback(async () => {
    if (
      tripSaveInFlightRef.current ||
      !currentMember ||
      isOffline ||
      !navigator.onLine
    ) return;

    tripSaveInFlightRef.current = true;
    try {
      while (pendingTripSaveRef.current && navigator.onLine) {
        const sending = pendingTripSaveRef.current;
        setTripSyncState("saving");
        setGoogleError(null);

        let saved: SharedTripState | null = null;
        let finalError: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            saved = await saveSharedTrip(
              sending.draft,
              currentMember,
              sending.baseTrip,
              adminSecret || undefined,
            );
            break;
          } catch (error) {
            finalError = error;
            const retryable = error instanceof GoogleDriveError ? error.retryable : true;
            if (!retryable || attempt === 3 || !navigator.onLine) break;
            await new Promise((resolve) => window.setTimeout(resolve, 700 * 2 ** (attempt - 1)));
          }
        }

        if (!saved) {
          setTripSyncState(navigator.onLine ? "error" : "offline");
          setGoogleError(
            finalError instanceof Error
              ? `${finalError.message} Your changes are still safe on this device.`
              : "The itinerary could not be saved after three attempts. Your changes are still safe on this device.",
          );
          return;
        }

        const savedFingerprint = sharedTripFingerprint(saved);
        const chronologicalSaved = normalizeSharedTripChronology(saved);
        lastSyncedTripRef.current = saved;
        lastSavedTripRef.current = savedFingerprint;
        setLastTripSavedAt(saved.updatedAt);
        window.localStorage.setItem(lastTripSavedAtKey, saved.updatedAt);
        setGoogleState((current) => current === "uploading" ? current : "connected");

        const latestPending = pendingTripSaveRef.current;
        const latestWasAcknowledged =
          !latestPending ||
          latestPending.fingerprint === sending.fingerprint ||
          latestPending.fingerprint === savedFingerprint;

        if (latestWasAcknowledged) {
          pendingTripSaveRef.current = null;
          clearPendingTripSave();
          setHasPendingTripSave(false);
          setTripName(chronologicalSaved.tripName);
          setDays(chronologicalSaved.days);
          setMembers(chronologicalSaved.members);
          setTripRevision(chronologicalSaved.revision);
          setSelectedDayId((current) => chronologicalSaved.days.some((day) => day.id === current) ? current : chronologicalSaved.days[0]?.id ?? "");
          setSelectedStopId((current) => chronologicalSaved.days.some((day) => day.stops.some((stop) => stop.id === current))
            ? current
            : chronologicalSaved.days[0]?.stops[0]?.id ?? "");
          setTripSyncState("synced");
          setGoogleError(null);
          return;
        }

        // A newer edit arrived while this request was running. Keep it on screen
        // and in local storage, then send it only after the earlier save completes.
        setTripSyncState("unsaved");
      }
    } finally {
      tripSaveInFlightRef.current = false;
    }
  }, [adminSecret, currentMember, isOffline]);

  const refreshSharedGallery = useCallback(async () => {
    if (!navigator.onLine) {
      setGalleryState("offline");
      return;
    }

    const requestId = galleryRequestRef.current + 1;
    galleryRequestRef.current = requestId;
    setGalleryState("loading");
    setGalleryError(null);

    try {
      const photos = await getSharedPhotos(sharedTripId, tripName.trim() || initialTripName);
      if (galleryRequestRef.current !== requestId) return;
      setSharedPhotos(photos);

      const liveFileIds = new Set(photos.map((photo) => photo.fileId));
      sharedPhotoUrlsRef.current.forEach((url, fileId) => {
        if (!liveFileIds.has(fileId)) {
          URL.revokeObjectURL(url);
          sharedPhotoUrlsRef.current.delete(fileId);
        }
      });

      const missing = photos.filter((photo) => !sharedPhotoUrlsRef.current.has(photo.fileId));
      let unavailableCount = 0;
      for (let start = 0; start < missing.length; start += 3) {
        const batch = missing.slice(start, start + 3);
        const loaded = await Promise.all(batch.map(async (photo) => {
          try {
            const downloaded = await getSharedPhotoBlob(sharedTripId, photo.fileId);
            return { photo, url: URL.createObjectURL(downloaded.blob) };
          } catch {
            return { photo, url: "" };
          }
        }));
        if (galleryRequestRef.current !== requestId) {
          loaded.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url); });
          return;
        }
        loaded.forEach(({ photo, url }) => {
          if (url) sharedPhotoUrlsRef.current.set(photo.fileId, url);
          else unavailableCount += 1;
        });
        setSharedPhotoUrls(Object.fromEntries(sharedPhotoUrlsRef.current));
      }

      setSharedPhotoUrls(Object.fromEntries(sharedPhotoUrlsRef.current));
      setGalleryState("ready");
      if (unavailableCount > 0) {
        setGalleryError(`${unavailableCount} shared snapshot${unavailableCount === 1 ? "" : "s"} could not be opened. Tap Refresh to try again.`);
      }
    } catch (error) {
      if (galleryRequestRef.current !== requestId) return;
      setGalleryState("error");
      setGalleryError(error instanceof Error ? error.message : "The shared photo gallery could not be loaded.");
    }
  }, [tripName]);

  const refreshSharedItinerary = useCallback(async () => {
    if (!navigator.onLine) {
      setTripSyncState("offline");
      setSharedStateReady(true);
      return false;
    }

    setTripSyncState("loading");
    try {
      const trip = await getSharedTrip(
        sharedTripId,
        { tripName: initialTripName, days: initialDays, members: initialMembers },
      );
      const chronologicalTrip = normalizeSharedTripChronology(trip);
      lastSyncedTripRef.current = trip;
      lastSavedTripRef.current = sharedTripFingerprint(trip);
      setLastTripSavedAt(trip.updatedAt);
      window.localStorage.setItem(lastTripSavedAtKey, trip.updatedAt);

      const pending = pendingTripSaveRef.current;
      if (pending && pending.fingerprint !== lastSavedTripRef.current) {
        setHasPendingTripSave(true);
        setTripSyncState("unsaved");
      } else {
        if (pending) {
          pendingTripSaveRef.current = null;
          clearPendingTripSave();
          setHasPendingTripSave(false);
        }
        setTripName(chronologicalTrip.tripName);
        setDays(chronologicalTrip.days);
        setMembers(chronologicalTrip.members);
        setSelectedDayId((current) => chronologicalTrip.days.some((day) => day.id === current) ? current : chronologicalTrip.days[0]?.id ?? "");
        setSelectedStopId((current) => chronologicalTrip.days.some((day) => day.stops.some((stop) => stop.id === current))
          ? current
          : chronologicalTrip.days[0]?.stops[0]?.id ?? "");
        setTripRevision(chronologicalTrip.revision);
        setTripSyncState("synced");
      }
      setSharedStateReady(true);
      setGoogleState((current) => current === "uploading" ? current : "connected");
      setGoogleError(null);
      return true;
    } catch (error) {
      setSharedStateReady(true);
      setTripSyncState("error");
      setGoogleState("disconnected");
      setGoogleError(error instanceof Error ? error.message : "The shared itinerary could not be loaded.");
      return false;
    }
  }, []);

  useEffect(() => {
    let localDays = initialDays;
    const saved = window.localStorage.getItem(itineraryKey);
    if (saved) {
      try {
        localDays = JSON.parse(saved) as TripDay[];
      } catch {
        window.localStorage.removeItem(itineraryKey);
      }
    }
    const localTripName = window.localStorage.getItem(tripNameKey) || initialTripName;
    const pending = readPendingTripSave();
    const localTrip = normalizeSharedTripChronology(pending?.draft ?? {
      tripId: sharedTripId,
      tripName: localTripName,
      days: localDays,
      members: initialMembers,
      revision: 1,
      updatedAt: new Date().toISOString(),
    });
    const localBase = pending?.baseTrip ?? localTrip;
    pendingTripSaveRef.current = pending;
    lastSyncedTripRef.current = localBase;
    lastSavedTripRef.current = sharedTripFingerprint(localBase);
    // This mount-only hydration intentionally restores the durable local draft
    // before the first remote refresh can replace anything on screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasPendingTripSave(Boolean(pending));
    setTripName(localTrip.tripName);
    setDays(localTrip.days);
    setMembers(localTrip.members);
    setTripRevision(localTrip.revision);
    setLastTripSavedAt(window.localStorage.getItem(lastTripSavedAtKey) || "");

    const savedTripId = window.localStorage.getItem(tripIdKey) || "";
    if (savedTripId && savedTripId !== sharedTripId) setPreviousTripId(savedTripId);
    window.localStorage.setItem(tripIdKey, sharedTripId);

    const query = new URLSearchParams(window.location.search);
    const queryAdminSecret = query.get("admin")?.trim() || "";
    const queryMemberId = query.get("member")?.trim() || "";
    const queryTripAccessKey = query.get("key")?.trim() || "";
    const storedAdminSecret = window.localStorage.getItem(adminKey) || "";
    const storedMemberId = window.localStorage.getItem(memberIdKey) || "";
    const storedTripAccessKey = window.localStorage.getItem(tripAccessKeyStorageKey) || "";
    const resolvedAdminSecret = queryAdminSecret || storedAdminSecret;
    const resolvedMemberId = queryAdminSecret
      ? queryMemberId || "grace"
      : storedMemberId || queryMemberId || (resolvedAdminSecret ? "grace" : "");
    const resolvedTripAccessKey = queryTripAccessKey || storedTripAccessKey;
    if (queryAdminSecret) {
      window.localStorage.setItem(adminKey, queryAdminSecret);
    }
    if (resolvedMemberId) {
      window.localStorage.setItem(memberIdKey, resolvedMemberId);
    }
    if (queryTripAccessKey) {
      window.localStorage.setItem(tripAccessKeyStorageKey, queryTripAccessKey);
    }
    configureGoogleDriveGateway(resolvedTripAccessKey);
    if (queryAdminSecret || queryMemberId || queryTripAccessKey) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    }
    setAdminSecret(resolvedAdminSecret);
    setTripAccessKey(resolvedTripAccessKey);
    setCurrentMemberId(resolvedMemberId);
    setHasLoadedLocalState(true);

    setIsOffline(!navigator.onLine);
    const updateConnection = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    const preservePendingOnExit = () => {
      const latest = latestTripDraftRef.current;
      const chronologicalDays = sortItineraryChronologically(latest.days);
      const fingerprint = tripFingerprint(latest.tripName, chronologicalDays, latest.members);
      const existing = pendingTripSaveRef.current;
      if ((fingerprint === lastSavedTripRef.current && !existing) || !lastSyncedTripRef.current) return;
      if (existing?.fingerprint === fingerprint) return;
      const pendingBeforeExit: PendingTripSave = {
        version: 1,
        fingerprint,
        queuedAt: new Date().toISOString(),
        draft: {
          tripId: sharedTripId,
          tripName: latest.tripName.trim() || initialTripName,
          days: chronologicalDays,
          members: latest.members,
          revision: latest.revision,
          updatedAt: new Date().toISOString(),
        },
        baseTrip: existing?.baseTrip ?? lastSyncedTripRef.current,
      };
      pendingTripSaveRef.current = pendingBeforeExit;
      writePendingTripSave(pendingBeforeExit);
    };
    window.addEventListener("pagehide", preservePendingOnExit);

    if (navigator.onLine) setGoogleState("connecting");
    void refreshSharedItinerary();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    }

    let queueLoadCancelled = false;
    const previewUrls = previewUrlsRef.current;
    void Promise.all([listQueuedPhotos(), getStorageHealth()])
      .then(([records, health]) => {
        if (queueLoadCancelled) return;
        const views = records.map((record) => {
          const previewUrl = URL.createObjectURL(record.blob);
          previewUrls.set(record.id, previewUrl);
          return { ...record, previewUrl };
        });
        setQueuedPhotos(views);
        setStorageHealth(health);
        setQueueState("ready");
      })
      .catch((error: unknown) => {
        if (queueLoadCancelled) return;
        setQueueError(error instanceof Error ? error.message : "The offline photo queue is unavailable.");
        setQueueState("unavailable");
      });

    return () => {
      queueLoadCancelled = true;
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("pagehide", preservePendingOnExit);
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.clear();
    };
  }, [refreshSharedItinerary]);

  useEffect(() => () => {
    galleryRequestRef.current += 1;
    sharedPhotoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    sharedPhotoUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    if (activeTab !== "gallery" || !hasLoadedLocalState || !tripAccessKey) return;
    const initialRefreshId = window.setTimeout(() => void refreshSharedGallery(), 0);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refreshSharedGallery();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialRefreshId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeTab, hasLoadedLocalState, refreshSharedGallery, tripAccessKey]);

  useEffect(() => {
    if (!hasLoadedLocalState) return;
    window.localStorage.setItem(itineraryKey, JSON.stringify(days));
  }, [days, hasLoadedLocalState]);

  useEffect(() => {
    if (!hasLoadedLocalState) return;
    window.localStorage.setItem(tripNameKey, tripName);
  }, [tripName, hasLoadedLocalState]);

  useEffect(() => {
    if (!hasLoadedLocalState || !currentMemberId) return;
    window.localStorage.setItem(memberIdKey, currentMemberId);
  }, [currentMemberId, hasLoadedLocalState]);

  useEffect(() => {
    if (!hasLoadedLocalState) return;

    const refreshWhenActive = () => {
      if (pendingTripSaveRef.current) return;
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refreshSharedItinerary();
      }
    };
    const intervalId = window.setInterval(refreshWhenActive, 15_000);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [currentMember, days, hasLoadedLocalState, members, refreshSharedItinerary, tripName]);

  useEffect(() => {
    if (!hasLoadedLocalState || !sharedStateReady || !currentMember || !lastSyncedTripRef.current) return;
    const fingerprint = tripFingerprint(tripName, days, members);
    const existingPending = pendingTripSaveRef.current;
    if (fingerprint === lastSavedTripRef.current && !existingPending) {
      setHasPendingTripSave(false);
      return;
    }

    if (!existingPending || existingPending.fingerprint !== fingerprint) {
      const draft: SharedTripState = {
        tripId: sharedTripId,
        tripName: tripName.trim() || initialTripName,
        days: sortItineraryChronologically(days),
        members,
        revision: tripRevision,
        updatedAt: new Date().toISOString(),
      };
      const pending: PendingTripSave = {
        version: 1,
        fingerprint,
        queuedAt: new Date().toISOString(),
        draft,
        // Keep the original base until the backend merges this change. Replacing
        // it with a newer remote response could turn another person's edit into
        // an accidental local deletion.
        baseTrip: existingPending?.baseTrip ?? lastSyncedTripRef.current,
      };
      pendingTripSaveRef.current = pending;
      writePendingTripSave(pending);
    }

    setHasPendingTripSave(true);
    setTripSyncState(isOffline ? "offline" : "unsaved");
    if (isOffline || !navigator.onLine) return;

    const timeoutId = window.setTimeout(() => {
      void processPendingTripSave();
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [currentMember, days, hasLoadedLocalState, isOffline, members, processPendingTripSave, sharedStateReady, tripName, tripRevision]);

  const selectedDay = useMemo(
    () => days.find((day) => day.id === selectedDayId) ?? days[0],
    [days, selectedDayId],
  );

  const selectedStop = useMemo(
    () => selectedDay?.stops.find((stop) => stop.id === selectedStopId) ?? selectedDay?.stops[0],
    [selectedDay, selectedStopId],
  );
  const selectedDayNumber = Math.max(1, days.findIndex((day) => day.id === selectedDay?.id) + 1);

  const expenseRows = useMemo(() => days.flatMap((day, dayIndex) =>
    day.stops.flatMap((stop, stopIndex) => (stop.expenses ?? []).map((expense) => ({
      day,
      dayIndex,
      stop,
      stopIndex,
      expense,
    }))),
  ), [days]);
  const expenseFilterCategories = useMemo(
    () => Array.from(new Set(expenseRows.map(({ expense }) => expense.category))).sort(),
    [expenseRows],
  );
  const filteredExpenseRows = useMemo(() => expenseRows.filter(({ day, expense }) =>
    (!expensePersonFilter || expense.memberId === expensePersonFilter) &&
    (!expenseDayFilter || day.id === expenseDayFilter) &&
    (!expenseCategoryFilter || expense.category === expenseCategoryFilter),
  ), [expenseCategoryFilter, expenseDayFilter, expensePersonFilter, expenseRows]);
  const expenseTotals = useMemo(() => {
    const localByCurrency = new Map<string, number>();
    let homeAmount = 0;
    let missingHomeAmounts = 0;
    filteredExpenseRows.forEach(({ expense }) => {
      localByCurrency.set(
        expense.localCurrency,
        (localByCurrency.get(expense.localCurrency) ?? 0) + expense.localAmount,
      );
      if (expense.homeAmount === null) missingHomeAmounts += 1;
      else homeAmount += expense.homeAmount;
    });
    return {
      local: Array.from(localByCurrency.entries())
        .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
        .map(([currency, amount]) => expenseMoney(amount, currency))
        .join(" + "),
      homeAmount,
      missingHomeAmounts,
    };
  }, [filteredExpenseRows]);

  const profileInitials = (currentMember?.name || "Family")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  useEffect(() => {
    if (showSettings && isAdmin && navigator.onLine) void refreshPlacesUsage();
  }, [showSettings, isAdmin]);

  const selectedPhotos = queuedPhotos.filter((photo) => photo.stopId === selectedStop?.id);
  const waitingCount = queuedPhotos.filter(
    (photo) =>
      (!photo.isPrivate && (photo.status === "waiting" || photo.status === "needsAttention")) ||
      photo.pendingCloudDeletion,
  ).length;
  const hasDriveCopies = queuedPhotos.some(
    (photo) => photo.status === "uploaded" && Boolean(photo.googleDriveFileId),
  );
  const queuedBytes = queuedPhotos.reduce((total, photo) => total + photo.size, 0);
  const tripSyncLabel = isOffline
    ? hasPendingTripSave ? "Offline · changes kept safely" : "Offline copy"
    : tripSyncState === "saving"
      ? "Saving changes…"
      : tripSyncState === "unsaved"
        ? "Unsaved changes"
      : tripSyncState === "loading"
        ? "Refreshing shared trip…"
        : tripSyncState === "error"
          ? hasPendingTripSave ? "Save failed · changes kept safely" : "Shared trip needs attention"
          : lastTripSavedAt ? savedTimeLabel(lastTripSavedAt) : "Shared trip synced";

  function clearPlaceSearch() {
    setPlaceSuggestions([]);
    setPlaceSearchError(null);
    setPlaceSearchState("idle");
    placeSessionTokenRef.current = "";
    placeSearchRequestRef.current += 1;
    if (placeSearchTimerRef.current !== null) window.clearTimeout(placeSearchTimerRef.current);
  }

  function selectStop(stopId: string) {
    clearPlaceSearch();
    setSelectedStopId(stopId);
  }

  function selectDay(day: TripDay) {
    clearPlaceSearch();
    setSelectedDayId(day.id);
    setSelectedStopId(day.stops[0]?.id ?? "");
  }

  function addFamilyMember() {
    const name = newMemberName.trim();
    if (!isAdmin || !name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";
    const member = { id: `${slug}-${crypto.randomUUID().slice(0, 6)}`, name };
    setMembers((current) => [...current, member]);
    setNewMemberName("");
  }

  async function copyMemberLink(member: TripMember) {
    const link = new URL(window.location.href);
    link.search = "";
    link.hash = "";
    link.searchParams.set("member", member.id);
    if (tripAccessKey) link.searchParams.set("key", tripAccessKey);
    if (member.id === currentMember?.id && adminSecret) link.searchParams.set("admin", adminSecret);
    try {
      await navigator.clipboard.writeText(link.toString());
      setCopiedMemberId(member.id);
      window.setTimeout(() => setCopiedMemberId(""), 1600);
    } catch {
      setGoogleError("The personal profile link could not be copied on this device.");
    }
  }

  async function refreshStorageHealth() {
    try {
      setStorageHealth(await getStorageHealth());
    } catch {
      // Storage estimates are helpful but never block the queue itself.
    }
  }

  function updatePhotoView(
    photoId: string,
    changes: Partial<Omit<QueuedPhotoView, "id" | "previewUrl">>,
  ) {
    setQueuedPhotos((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, ...changes } : photo)),
    );
  }

  async function savePhotoChanges(
    photoId: string,
    changes: Parameters<typeof updateQueuedPhoto>[1],
  ) {
    await updateQueuedPhoto(photoId, changes);
    updatePhotoView(photoId, changes);
  }

  async function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selectedStop || files.length === 0) return;
    if (!currentMember) {
      setQueueError("Choose your family profile before adding photos.");
      setShowSettings(true);
      return;
    }

    setQueueState("saving");
    setQueueError(null);

    const additions: StoredQueuedPhoto[] = files.map((file) => ({
      id: crypto.randomUUID(),
      stopId: selectedStop.id,
      name: file.name || "Trip photo",
      mimeType: file.type || "image/jpeg",
      size: file.size,
      createdAt: new Date().toISOString(),
      status: "waiting",
      isPrivate: false,
      pendingCloudDeletion: false,
      pendingLocalRemoval: false,
      uploadAttempts: 0,
      lastError: null,
      googleDriveFileId: null,
      memberId: currentMember.id,
      memberName: currentMember.name,
      blob: file,
    }));

    try {
      setStorageHealth(await requestPersistentStorage());
      await addQueuedPhotos(additions);
      const views = additions.map((record) => {
        const previewUrl = URL.createObjectURL(record.blob);
        previewUrlsRef.current.set(record.id, previewUrl);
        const { blob: _blob, ...metadata } = record;
        void _blob;
        return { ...metadata, previewUrl };
      });
      setQueuedPhotos((current) => [...views, ...current]);
      setQueueState("ready");
      await refreshStorageHealth();
    } catch (error) {
      setQueueError(
        error instanceof DOMException && error.name === "QuotaExceededError"
          ? "This iPhone does not have enough browser storage for those temporary copies. The originals remain safe in Apple Photos."
          : error instanceof Error
            ? error.message
            : "The photos could not be added to the offline queue. The originals remain safe in Apple Photos.",
      );
      setQueueState("ready");
    }
  }

  function addStop() {
    const title = newStopName.trim();
    if (!currentMember || !title || !selectedDay) return;

    const stop: TripStop = {
      id: crypto.randomUUID(),
      time: newStopTime,
      title,
      place: "",
      note: "",
    };

    setDays((current) =>
      sortItineraryChronologically(current.map((day) =>
        day.id === selectedDay.id ? { ...day, stops: [...day.stops, stop] } : day,
      )),
    );
    selectStop(stop.id);
    setNewStopName("");
    setShowAddStop(false);
  }

  function addDay() {
    const label = newDayName.trim();
    if (!currentMember || !label || !newDayDate) return;
    const day: TripDay = {
      id: crypto.randomUUID(),
      date: newDayDate,
      label,
      stops: [],
    };
    setDays((current) => sortItineraryChronologically([...current, day]));
    setSelectedDayId(day.id);
    selectStop("");
    setNewDayName("");
    setNewDayDate("");
    setShowAddDay(false);
  }

  function openAddDay() {
    const latestDate = days.map((day) => day.date).sort().at(-1);
    const suggestedDate = latestDate ? new Date(`${latestDate}T12:00:00`) : new Date();
    suggestedDate.setDate(suggestedDate.getDate() + 1);
    setNewDayDate(suggestedDate.toISOString().slice(0, 10));
    setNewDayName(`Trip day ${days.length + 1}`);
    setShowAddDay(true);
  }

  function updateSelectedStop(changes: Partial<TripStop>) {
    if (!currentMember || !selectedDay || !selectedStop) return;
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === selectedDay.id
      ? { ...day, stops: day.stops.map((stop) => stop.id === selectedStop.id ? { ...stop, ...changes } : stop) }
      : day)));
  }

  async function addExpense() {
    if (!currentMember || !selectedStop) return;
    const item = newExpenseItem.trim();
    const localAmount = Number(newExpenseAmount);
    if (!item || !Number.isFinite(localAmount) || localAmount <= 0) return;

    setExpenseConversionState("converting");
    setExpenseConversionError(null);
    let exchangeRate: number | undefined;
    let exchangeRateDate: string | undefined;
    let homeAmount: number | null = null;
    try {
      const conversion = await getLatestExchangeRate(newExpenseLocalCurrency, "AUD");
      exchangeRate = conversion.rate;
      exchangeRateDate = conversion.date;
      homeAmount = convertedAmount(localAmount, conversion.rate);
    } catch {
      setExpenseConversionError("Expense saved in its local currency, but AUD conversion is waiting. Use Refresh AUD conversions from the Expenses tab when online.");
    }

    const expense: TripExpense = {
      id: crypto.randomUUID(),
      item,
      category: newExpenseCategory,
      memberId: currentMember.id,
      memberName: currentMember.name,
      localAmount,
      localCurrency: newExpenseLocalCurrency,
      homeAmount,
      homeCurrency: "AUD",
      exchangeRate,
      exchangeRateDate,
      createdAt: new Date().toISOString(),
    };
    updateSelectedStop({ expenses: [...(selectedStop.expenses ?? []), expense] });
    setNewExpenseItem("");
    setNewExpenseAmount("");
    setExpenseConversionState("idle");
  }

  async function refreshAudConversions() {
    if (!currentMember || isOffline) return;
    const missingCurrencies = Array.from(new Set(expenseRows
      .filter(({ expense }) => expense.homeAmount === null)
      .map(({ expense }) => expense.localCurrency)));
    if (missingCurrencies.length === 0) return;

    setExpenseConversionState("converting");
    setExpenseConversionError(null);
    try {
      const rates = new Map(await Promise.all(missingCurrencies.map(async (currency) => {
        const conversion = await getLatestExchangeRate(currency, "AUD");
        return [currency, conversion] as const;
      })));
      setDays((current) => current.map((day) => ({
        ...day,
        stops: day.stops.map((stop) => ({
          ...stop,
          expenses: (stop.expenses ?? []).map((expense) => {
            if (expense.homeAmount !== null) return expense;
            const conversion = rates.get(expense.localCurrency);
            return conversion ? {
              ...expense,
              homeAmount: convertedAmount(expense.localAmount, conversion.rate),
              homeCurrency: "AUD",
              exchangeRate: conversion.rate,
              exchangeRateDate: conversion.date,
            } : expense;
          }),
        })),
      })));
    } catch {
      setExpenseConversionError("AUD conversion is temporarily unavailable. Local amounts remain saved and unchanged.");
    } finally {
      setExpenseConversionState("idle");
    }
  }

  function deleteExpense(expenseId: string) {
    if (!currentMember || !selectedStop) return;
    const expense = (selectedStop.expenses ?? []).find((item) => item.id === expenseId);
    if (!expense || (!isAdmin && expense.memberId !== currentMember.id)) return;
    updateSelectedStop({ expenses: (selectedStop.expenses ?? []).filter((item) => item.id !== expenseId) });
  }

  function startEditingExpense(expense: TripExpense) {
    if (!currentMember || (!isAdmin && expense.memberId !== currentMember.id)) return;
    setExpenseEditDraft({
      item: expense.item,
      amount: String(expense.localAmount),
      category: expense.category,
      localCurrency: expense.localCurrency,
    });
    setExpenseConversionError(null);
    setEditingExpenseId(expense.id);
  }

  function cancelEditingExpense() {
    setEditingExpenseId(null);
    setExpenseConversionError(null);
  }

  function openExpenseEditor(dayId: string, stopId: string, expense: TripExpense) {
    if (!currentMember || (!isAdmin && expense.memberId !== currentMember.id)) return;
    setSelectedDayId(dayId);
    setSelectedStopId(stopId);
    startEditingExpense(expense);
    setActiveTab("itinerary");
  }

  async function saveEditedExpense(expenseId: string) {
    if (!currentMember || !selectedStop) return;
    const existingExpense = (selectedStop.expenses ?? []).find((expense) => expense.id === expenseId);
    if (!existingExpense || (!isAdmin && existingExpense.memberId !== currentMember.id)) return;
    const item = expenseEditDraft.item.trim();
    const localAmount = Number(expenseEditDraft.amount);
    if (!item || !Number.isFinite(localAmount) || localAmount <= 0) return;

    setExpenseConversionState("converting");
    setExpenseConversionError(null);
    let exchangeRate: number | undefined;
    let exchangeRateDate: string | undefined;
    let homeAmount: number | null = null;
    try {
      const conversion = await getLatestExchangeRate(expenseEditDraft.localCurrency, "AUD");
      exchangeRate = conversion.rate;
      exchangeRateDate = conversion.date;
      homeAmount = convertedAmount(localAmount, conversion.rate);
    } catch {
      setExpenseConversionError("Expense updated in its local currency, but AUD conversion is waiting. Use Refresh AUD conversions from the Expenses tab when online.");
    }

    updateSelectedStop({
      expenses: (selectedStop.expenses ?? []).map((expense) => expense.id === expenseId ? {
        ...expense,
        item,
        category: expenseEditDraft.category,
        localAmount,
        localCurrency: expenseEditDraft.localCurrency,
        homeAmount,
        homeCurrency: "AUD",
        exchangeRate,
        exchangeRateDate,
      } : expense),
    });
    setEditingExpenseId(null);
    setExpenseConversionState("idle");
  }

  function handleLocationChange(value: string) {
    if (!currentMember || !selectedStop) return;
    updateSelectedStop({
      place: value,
      placeId: undefined,
      latitude: undefined,
      longitude: undefined,
      googleMapsUrl: undefined,
    });
    setPlaceSuggestions([]);
    setPlaceSearchError(null);
    placeSearchRequestRef.current += 1;
    const requestNumber = placeSearchRequestRef.current;
    if (placeSearchTimerRef.current !== null) window.clearTimeout(placeSearchTimerRef.current);
    if (value.trim().length < 3 || !navigator.onLine) {
      setPlaceSearchState("idle");
      return;
    }

    if (!placeSessionTokenRef.current) placeSessionTokenRef.current = crypto.randomUUID().replaceAll("-", "");
    setPlaceSearchState("searching");
    placeSearchTimerRef.current = window.setTimeout(() => {
      void searchPlaces(value.trim(), placeSessionTokenRef.current)
        .then(({ suggestions, usage }) => {
          if (placeSearchRequestRef.current !== requestNumber) return;
          setPlaceSuggestions(suggestions);
          setPlacesUsage(usage);
          setPlaceSearchState("idle");
        })
        .catch((error: unknown) => {
          if (placeSearchRequestRef.current !== requestNumber) return;
          setPlaceSuggestions([]);
          setPlaceSearchState("idle");
          setPlaceSearchError(error instanceof Error ? error.message : "Google suggestions are unavailable. You can keep typing the location manually.");
        });
    }, 500);
  }

  async function choosePlace(suggestion: PlaceSuggestion) {
    if (!currentMember) return;
    setPlaceSearchState("choosing");
    setPlaceSearchError(null);
    try {
      const { place, usage } = await getPlaceDetails(suggestion.placeId, placeSessionTokenRef.current);
      updateSelectedStop({
        place: place.address || place.name || suggestion.text,
        placeId: place.placeId,
        latitude: place.latitude ?? undefined,
        longitude: place.longitude ?? undefined,
        googleMapsUrl: place.googleMapsUrl || undefined,
      });
      setPlacesUsage(usage);
      setPlaceSuggestions([]);
      placeSessionTokenRef.current = "";
    } catch (error) {
      setPlaceSearchError(error instanceof Error ? error.message : "That Google location could not be saved. You can keep the location as typed.");
    } finally {
      setPlaceSearchState("idle");
    }
  }

  function openEditDayDetails() {
    if (!currentMember || !selectedDay) return;
    setEditDayName(selectedDay.label);
    setEditDayDate(selectedDay.date);
    setShowEditDay(true);
  }

  function saveDayDetails() {
    if (!currentMember || !selectedDay || !editDayDate || (isAdmin && !editDayName.trim())) return;
    const selectedDayId = selectedDay.id;
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === selectedDayId ? {
      ...day,
      date: editDayDate,
      label: isAdmin ? editDayName.trim() : day.label,
    } : day)));
    setShowEditDay(false);
  }

  function deleteSelectedDay() {
    if (!currentMember || !selectedDay || days.length <= 1) return;
    const index = days.findIndex((day) => day.id === selectedDay.id);
    const remaining = days.filter((day) => day.id !== selectedDay.id);
    const nextDay = remaining[Math.min(index, remaining.length - 1)];
    setDays(sortItineraryChronologically(remaining));
    setSelectedDayId(nextDay.id);
    selectStop(nextDay.stops[0]?.id ?? "");
    setShowDeleteDayConfirm(false);
    setShowEditDay(false);
  }

  function deleteSelectedStop() {
    if (!currentMember || !selectedDay || !selectedStop) return;
    const localPhotoCount = queuedPhotos.filter((photo) => photo.stopId === selectedStop.id).length;
    const warning = localPhotoCount > 0
      ? `This stop has ${localPhotoCount} photo ${localPhotoCount === 1 ? "copy" : "copies"} on this device. Apple Photos and Drive copies will remain, but they will no longer be assigned in the itinerary. Delete the stop?`
      : "Delete this stop from the shared itinerary? Photos already in Apple Photos or Drive will not be deleted.";
    if (!window.confirm(warning)) return;
    const index = selectedDay.stops.findIndex((stop) => stop.id === selectedStop.id);
    const remainingStops = selectedDay.stops.filter((stop) => stop.id !== selectedStop.id);
    setDays((current) => sortItineraryChronologically(
      current.map((day) => day.id === selectedDay.id ? { ...day, stops: remainingStops } : day),
    ));
    selectStop(remainingStops[Math.min(index, remainingStops.length - 1)]?.id ?? "");
  }

  async function togglePrivacy(photoId: string) {
    const photo = queuedPhotos.find((item) => item.id === photoId);
    if (!photo || photo.pendingLocalRemoval) return;
    const isPrivate = !photo.isPrivate;
    const pendingCloudDeletion = isPrivate && photo.status === "uploaded" && Boolean(photo.googleDriveFileId);
    setQueueError(null);
    try {
      await savePhotoChanges(photoId, {
        isPrivate,
        pendingCloudDeletion: isPrivate ? pendingCloudDeletion : false,
        pendingLocalRemoval: false,
      });
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : "The privacy change could not be saved.");
    }
  }

  async function deletePhotoLocally(photoId: string) {
    await deleteQueuedPhoto(photoId);
    const previewUrl = previewUrlsRef.current.get(photoId);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrlsRef.current.delete(photoId);
    setQueuedPhotos((current) => current.filter((item) => item.id !== photoId));
    await refreshStorageHealth();
  }

  async function removePhoto(photoId: string) {
    const photo = queuedPhotos.find((item) => item.id === photoId);
    if (!photo) return;
    setQueueError(null);
    try {
      if (!photo.googleDriveFileId) {
        await deletePhotoLocally(photoId);
        return;
      }

      if (navigator.onLine) {
        try {
          await deleteDriveFile(tripId, photo.googleDriveFileId, previousTripId || undefined);
          await deletePhotoLocally(photoId);
          return;
        } catch {
          // Preserve the record below so Drive deletion can be retried safely.
        }
      }

      await savePhotoChanges(photoId, {
        isPrivate: true,
        pendingCloudDeletion: true,
        pendingLocalRemoval: true,
        status: "needsAttention",
        lastError: navigator.onLine
          ? "Drive removal will be retried the next time you tap Upload now."
          : "Drive removal is waiting for an internet connection.",
      });
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : "The photo could not be removed safely.");
    }
  }

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return "Unknown";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function statusLabel(photo: QueuedPhotoView): string {
    if (photo.pendingLocalRemoval) return "Removal pending";
    if (photo.isPrivate && photo.pendingCloudDeletion) return "Private · removal pending";
    if (photo.isPrivate) return "Private";
    if (photo.status === "uploading") return "Uploading";
    if (photo.status === "uploaded") return "Safely uploaded";
    if (photo.status === "needsAttention") return "Upload needs attention";
    return "Waiting for Wi-Fi";
  }

  async function connectGoogleDrive() {
    if (!navigator.onLine) {
      setGoogleError("Connect to the internet before checking Google Drive.");
      return;
    }

    setGoogleState("connecting");
    setGoogleError(null);
    try {
      if (await refreshSharedItinerary()) {
        setGoogleState("connected");
        setShowSettings(false);
      }
    } catch (error) {
      setGoogleState("disconnected");
      setGoogleError(error instanceof Error ? error.message : "Google Drive could not be connected.");
    }
  }

  async function refreshPlacesUsage() {
    try {
      setPlacesUsage(await getPlacesUsage());
    } catch (error) {
      setPlaceSearchError(error instanceof Error ? error.message : "Google Places usage is unavailable.");
    }
  }

  async function waitBeforeRetry(attempt: number) {
    await new Promise((resolve) => window.setTimeout(resolve, 700 * 2 ** (attempt - 1)));
  }

  function driveLocationForStop(stopId: string, memberId: string, memberName: string): DrivePhotoLocation | null {
    const dayIndex = days.findIndex((day) => day.stops.some((stop) => stop.id === stopId));
    const day = days[dayIndex];
    const stop = day?.stops.find((item) => item.id === stopId);
    if (!day || !stop || !tripId) return null;

    return {
      tripId,
      tripName: tripName.trim() || "Family Trip",
      dayId: day.id,
      dayNumber: dayIndex + 1,
      dayName: day.label.trim() || `Trip day ${dayIndex + 1}`,
      stopId: stop.id,
      stopName: stop.title.trim() || "Unplanned stop",
      memberId,
      memberName,
      previousTripId: previousTripId || undefined,
    };
  }

  async function uploadQueuedPhotos() {
    if (!navigator.onLine) {
      setGoogleError("You are offline. The photos will remain safely queued.");
      return;
    }
    if (!tripId) {
      setGoogleError("The trip is still loading. Try again in a moment.");
      return;
    }
    if (!currentMember) {
      setGoogleError("Choose your family profile before syncing photos.");
      setShowSettings(true);
      return;
    }

    setGoogleState("uploading");
    setGoogleError(null);

    try {
      await checkGoogleDriveGateway();

      for (const photo of queuedPhotos.filter((item) => item.pendingCloudDeletion && item.googleDriveFileId)) {
        try {
          await deleteDriveFile(tripId, photo.googleDriveFileId!, previousTripId || undefined);
          if (photo.pendingLocalRemoval) {
            await deletePhotoLocally(photo.id);
            continue;
          }
          await savePhotoChanges(photo.id, {
            pendingCloudDeletion: false,
            pendingLocalRemoval: false,
            googleDriveFileId: null,
            status: "waiting",
            uploadAttempts: 0,
            lastError: null,
          });
        } catch (error) {
          await savePhotoChanges(photo.id, {
            status: "needsAttention",
            lastError: error instanceof Error ? error.message : "The private cloud copy could not be removed.",
          });
        }
      }

      let organizationFailures = 0;
      const uploadedCopies = queuedPhotos.filter(
        (photo) =>
          !photo.isPrivate &&
          !photo.pendingCloudDeletion &&
          photo.status === "uploaded" &&
          Boolean(photo.googleDriveFileId),
      );

      for (const photo of uploadedCopies) {
        const location = driveLocationForStop(photo.stopId, photo.memberId, photo.memberName);
        if (!location) continue;

        try {
          await organizeDriveFile(location, photo.googleDriveFileId!);
          if (photo.lastError) await savePhotoChanges(photo.id, { lastError: null });
        } catch (error) {
          organizationFailures += 1;
          await savePhotoChanges(photo.id, {
            lastError: error instanceof Error ? error.message : "The Drive folders could not be refreshed.",
          });
        }
      }

      const uploadCandidates = queuedPhotos.filter(
        (photo) =>
          !photo.isPrivate &&
          !photo.pendingCloudDeletion &&
          photo.status !== "uploaded",
      );

      for (const queuedPhoto of uploadCandidates) {
        const record = await getQueuedPhoto(queuedPhoto.id);
        if (!record || record.isPrivate) continue;
        const location = driveLocationForStop(record.stopId, record.memberId, record.memberName);
        if (!location) {
          await savePhotoChanges(record.id, {
            status: "needsAttention",
            lastError: "This photo no longer has a matching day and location.",
          });
          continue;
        }

        let uploaded = false;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await savePhotoChanges(record.id, {
            status: "uploading",
            uploadAttempts: attempt,
            lastError: null,
          });

          try {
            const driveFileId = await uploadPhotoToDrive(
              location,
              record,
            );
            await savePhotoChanges(record.id, {
              status: "uploaded",
              uploadAttempts: attempt,
              lastError: null,
              googleDriveFileId: driveFileId,
            });
            uploaded = true;
            break;
          } catch (error) {
            const retryable = error instanceof GoogleDriveError ? error.retryable : true;
            if (!retryable || attempt === 3) {
              await savePhotoChanges(record.id, {
                status: "needsAttention",
                uploadAttempts: attempt,
                lastError: error instanceof Error ? error.message : "Upload failed.",
              });
              break;
            }
            await waitBeforeRetry(attempt);
          }
        }

        if (!uploaded) continue;
      }

      setGoogleState("connected");
      if (organizationFailures > 0) {
        setGoogleError(
          `${organizationFailures} existing Drive ${organizationFailures === 1 ? "copy" : "copies"} could not be reorganized. Tap refresh to try again.`,
        );
      }
      if (activeTab === "gallery") void refreshSharedGallery();
      await refreshStorageHealth();
    } catch (error) {
      setGoogleState("disconnected");
      setGoogleError(error instanceof Error ? error.message : "Google Drive sync failed.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Family trip</p>
          <input
            className="trip-title-input"
            value={tripName}
            onChange={(event) => setTripName(event.target.value)}
            aria-label="Trip name"
            readOnly={!isAdmin}
          />
          <p className="shared-role">
            {currentMember?.name || "Choose profile"} · {isAdmin ? "Admin" : "Contributor"} · {tripSyncLabel}
          </p>
        </div>
        {isAdmin ? (
          <button className="avatar" aria-label="Open admin settings" onClick={() => setShowSettings(true)}>{profileInitials}</button>
        ) : (
          <span className="avatar locked" aria-label={`${currentMember?.name || "Family member"} profile locked to this device`}>{profileInitials}</span>
        )}
      </header>

      <nav className="primary-tabs" aria-label="App sections">
        <button
          className={activeTab === "itinerary" ? "active" : ""}
          aria-current={activeTab === "itinerary" ? "page" : undefined}
          onClick={() => setActiveTab("itinerary")}
        >
          Itinerary
        </button>
        <button
          className={activeTab === "gallery" ? "active" : ""}
          aria-current={activeTab === "gallery" ? "page" : undefined}
          onClick={() => setActiveTab("gallery")}
        >
          Photo Gallery
        </button>
        <button
          className={activeTab === "expenses" ? "active" : ""}
          aria-current={activeTab === "expenses" ? "page" : undefined}
          onClick={() => setActiveTab("expenses")}
        >
          Expenses
        </button>
      </nav>

      <section className={`connection-card ${isOffline ? "offline" : "online"}`}>
        <span className="connection-dot" aria-hidden="true" />
        <div>
          <strong>{isOffline ? "Travelling offline" : "Ready for the trip"}</strong>
          <p>
            {isOffline
              ? hasPendingTripSave
                ? "Your itinerary changes are saved on this device and will retry when you reconnect."
                : "Your itinerary works here. Photos will wait safely for Wi-Fi."
              : googleState === "uploading"
                ? "Syncing eligible photos with Google Drive now."
                : googleState === "connected" && waitingCount > 0
                  ? `${waitingCount} photo action${waitingCount === 1 ? " is" : "s are"} waiting for Google Drive.`
                  : googleState === "connected"
                    ? `${currentMember?.name || "Choose profile"} · ${tripSyncLabel}`
                    : googleState === "connecting"
                      ? "Itinerary available offline · checking Google Drive"
                      : "Itinerary available offline · Google Drive needs a connection check"}
          </p>
        </div>
        <div className="connection-actions">
          <button className="text-button" onClick={() => setShowSafety((value) => !value)}>
            Safety
          </button>
          {hasPendingTripSave && tripSyncState === "error" && (
            <button className="sync-button" onClick={() => void processPendingTripSave()}>
              Retry itinerary save
            </button>
          )}
          {googleState === "connected" && waitingCount > 0 ? (
            <button className="sync-button" onClick={uploadQueuedPhotos}>
              Upload now — I’m on Wi-Fi
            </button>
          ) : googleState === "uploading" ? (
            <button className="sync-button" disabled>Uploading…</button>
          ) : googleState === "connected" ? (
            hasDriveCopies ? (
              <button className="sync-button" onClick={uploadQueuedPhotos}>Refresh Drive folders</button>
            ) : (
              <button className="sync-button" disabled>Drive connected</button>
            )
          ) : (
            <button className="sync-button" onClick={connectGoogleDrive} disabled={googleState === "connecting"}>
              {googleState === "connecting" ? "Checking…" : "Check Drive"}
            </button>
          )}
        </div>
      </section>

      {googleError && <aside className="sync-error" role="alert">{googleError}</aside>}

      {showSafety && (
        <aside className="safety-note">
          <strong>Your originals stay in Apple Photos.</strong>
          <p>
            This app only holds temporary upload copies. If its offline queue is ever cleared,
            select the originals from Apple Photos again—your memories remain safe.
          </p>
          <dl className="storage-facts">
            <div>
              <dt>Offline queue</dt>
              <dd>{queuedPhotos.length} photos · {formatBytes(queuedBytes)}</dd>
            </div>
            <div>
              <dt>Storage protection</dt>
              <dd>{storageHealth?.persistent ? "Persistent" : "Best effort"}</dd>
            </div>
            <div>
              <dt>Browser storage</dt>
              <dd>{formatBytes(storageHealth?.usage ?? null)} of {formatBytes(storageHealth?.quota ?? null)}</dd>
            </div>
          </dl>
        </aside>
      )}

      {activeTab === "itinerary" ? (
        <>
      <nav className="day-strip" aria-label="Trip days">
        {days.map((day, index) => {
          const date = new Date(`${day.date}T12:00:00`);
          const active = day.id === selectedDay?.id;
          return (
            <button
              key={day.id}
              className={`day-chip ${active ? "active" : ""}`}
              onClick={() => selectDay(day)}
            >
              <span>Day {index + 1}</span>
              <strong>{date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })}</strong>
              <small>{day.label}</small>
            </button>
          );
        })}
        <button className="day-chip add-day-chip" onClick={openAddDay} disabled={!currentMember}>
          <span>Itinerary</span>
          <strong>+ Add day</strong>
          <small>Choose a date</small>
        </button>
      </nav>

      <section className="content-grid">
        <div className="timeline-panel">
          <header className="day-overview">
            <FittedDayTitle>{selectedDay?.label ?? "Trip day"}</FittedDayTitle>
            <p className="day-date-line">Day {selectedDayNumber}: <time dateTime={selectedDay?.date}>{galleryDate(selectedDay?.date ?? "")}</time></p>
            <div className="day-toolbar" aria-label="Day actions">
              <button className="day-tool-button" onClick={openEditDayDetails} disabled={!currentMember}>Edit Day Details</button>
              <button className="day-tool-button primary" onClick={() => setShowAddStop(true)} disabled={!currentMember}>+ Add Stop</button>
            </div>
          </header>

          <div className="timeline">
            {selectedDay?.stops.map((stop) => {
              const active = stop.id === selectedStop?.id;
              const count = queuedPhotos.filter((photo) => photo.stopId === stop.id).length;
              return (
                <button
                  key={stop.id}
                  className={`stop-card ${active ? "active" : ""}`}
                  onClick={() => selectStop(stop.id)}
                >
                  <time>{stop.time}</time>
                  <span className="timeline-marker" aria-hidden="true" />
                  <span className="stop-copy">
                    <strong>{stop.title}</strong>
                    <small>{stop.place || "Location to be added"}</small>
                  </span>
                  {count > 0 && <span className="photo-count">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {selectedStop && (
          <div className="stop-workspace">
            <section className="memory-panel selected-stop-panel" aria-labelledby="selected-stop-title">
              <div className="memory-hero">
                <p className="eyebrow">Itinerary details</p>
                <h2 id="selected-stop-title">Selected stop</h2>
                <div className="stop-editor">
                <label>
                  <span>Stop name</span>
                  <input value={selectedStop.title} onChange={(event) => updateSelectedStop({ title: event.target.value })} readOnly={!currentMember} />
                </label>
                <div className="stop-editor-row">
                  <label>
                    <span>Time</span>
                    <input type="time" value={timeInputValue(selectedStop.time)} onChange={(event) => updateSelectedStop({ time: event.target.value })} disabled={!currentMember} />
                  </label>
                  <div className="location-field">
                    <label>
                      <span>Location</span>
                      <input
                        type="search"
                        value={selectedStop.place}
                        onChange={(event) => handleLocationChange(event.target.value)}
                        placeholder="Search Google Maps or type a location"
                        readOnly={!currentMember}
                        autoComplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={placeSuggestions.length > 0}
                        aria-controls="place-suggestions"
                      />
                    </label>
                    {placeSearchState === "searching" && <span className="place-search-status">Searching Google Maps…</span>}
                    {placeSuggestions.length > 0 && (
                      <div className="place-suggestions" id="place-suggestions" role="listbox">
                        {placeSuggestions.map((suggestion) => (
                          <button key={suggestion.placeId} type="button" role="option" aria-selected="false" onClick={() => void choosePlace(suggestion)} disabled={placeSearchState === "choosing"}>
                            <span aria-hidden="true">●</span>
                            <strong>{suggestion.text}</strong>
                          </button>
                        ))}
                        <small>Powered by Google</small>
                      </div>
                    )}
                    {placeSearchError && <span className="place-search-error">{placeSearchError}</span>}
                    {selectedStop.place.trim() ? (
                      <div className="maps-place-card" aria-label={`Google Maps location: ${selectedStop.place}`}>
                        <span className="maps-place-pin" aria-hidden="true">●</span>
                        <span className="maps-place-copy">
                          <small>Google Maps location</small>
                          <strong>{selectedStop.place}</strong>
                        </span>
                        <span className="maps-place-actions">
                          <a href={selectedStop.googleMapsUrl || googleMapsSearchUrl(selectedStop.place)} target="_blank" rel="noopener noreferrer">Open map ↗</a>
                          <a href={googleMapsDirectionsUrl(selectedStop.place, selectedStop.placeId)} target="_blank" rel="noopener noreferrer">Directions ↗</a>
                        </span>
                      </div>
                    ) : (
                      <span className="maps-place-empty">Add a location to attach Google Maps</span>
                    )}
                  </div>
                </div>
                <label>
                  <span>Notes</span>
                  <textarea value={selectedStop.note} onChange={(event) => updateSelectedStop({ note: event.target.value })} placeholder="Add a note" readOnly={!currentMember} />
                </label>
                <div className="stop-management" aria-label="Stop actions">
                  <button className="danger-action" onClick={deleteSelectedStop} disabled={!currentMember}>Delete stop</button>
                </div>
                </div>
              </div>
            </section>

            <section className="stop-expenses" aria-labelledby="stop-expenses-title">
              <div className="stop-expenses-heading">
                <div>
                  <p className="eyebrow">Shared spending</p>
                  <h3 id="stop-expenses-title">Expenses at this stop</h3>
                </div>
                <span>{(selectedStop.expenses ?? []).length}</span>
              </div>
              <div className="expense-entry-grid">
                <label>
                  <span>Item</span>
                  <input value={newExpenseItem} onChange={(event) => setNewExpenseItem(event.target.value)} placeholder="Train tickets" />
                </label>
                <label>
                  <span>Amount</span>
                  <div className="money-input">
                    <select value={newExpenseLocalCurrency} onChange={(event) => setNewExpenseLocalCurrency(event.target.value)} aria-label="Local currency">
                      {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                    </select>
                    <input type="number" inputMode="decimal" min="0" step="0.01" value={newExpenseAmount} onChange={(event) => setNewExpenseAmount(event.target.value)} placeholder="0.00" aria-label="Local amount" />
                  </div>
                </label>
                <label>
                  <span>Category</span>
                  <select value={newExpenseCategory} onChange={(event) => setNewExpenseCategory(event.target.value)}>
                    {expenseCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              <button className="primary-button add-expense-button" onClick={() => void addExpense()} disabled={!currentMember || !newExpenseItem.trim() || !(Number(newExpenseAmount) > 0) || expenseConversionState === "converting"}>
                {expenseConversionState === "converting" ? "Converting to AUD…" : `Add expense as ${currentMember?.name || "family member"}`}
              </button>
              <p className="expense-rate-note">AUD is calculated automatically using the latest daily reference rate and saved with the expense.</p>
              {expenseConversionError && <p className="expense-conversion-alert" role="alert">{expenseConversionError}</p>}
              {(selectedStop.expenses ?? []).length > 0 && (
                <div className="stop-expense-list">
                  {(selectedStop.expenses ?? []).map((expense) => editingExpenseId === expense.id ? (
                    <div className="expense-edit-card" key={expense.id}>
                      <div className="expense-edit-grid">
                        <label>
                          <span>Item</span>
                          <input value={expenseEditDraft.item} onChange={(event) => setExpenseEditDraft((draft) => ({ ...draft, item: event.target.value }))} aria-label="Edit expense item" />
                        </label>
                        <label>
                          <span>Amount</span>
                          <div className="money-input">
                            <select value={expenseEditDraft.localCurrency} onChange={(event) => setExpenseEditDraft((draft) => ({ ...draft, localCurrency: event.target.value }))} aria-label="Edit expense currency">
                              {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                            </select>
                            <input type="number" inputMode="decimal" min="0" step="0.01" value={expenseEditDraft.amount} onChange={(event) => setExpenseEditDraft((draft) => ({ ...draft, amount: event.target.value }))} aria-label="Edit expense amount" />
                          </div>
                        </label>
                        <label>
                          <span>Category</span>
                          <select value={expenseEditDraft.category} onChange={(event) => setExpenseEditDraft((draft) => ({ ...draft, category: event.target.value }))} aria-label="Edit expense category">
                            {expenseCategories.map((category) => <option key={category}>{category}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="expense-edit-actions">
                        <button className="text-button" onClick={cancelEditingExpense} disabled={expenseConversionState === "converting"}>Cancel</button>
                        <button className="primary-button" onClick={() => void saveEditedExpense(expense.id)} disabled={!expenseEditDraft.item.trim() || !(Number(expenseEditDraft.amount) > 0) || expenseConversionState === "converting"}>
                          {expenseConversionState === "converting" ? "Updating AUD…" : "Save expense"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="stop-expense-row" key={expense.id}>
                      <div><strong>{expense.item}</strong><small>{expense.category} · {expense.memberName}</small></div>
                      <strong>{expenseMoney(expense.localAmount, expense.localCurrency)}</strong>
                      {(isAdmin || expense.memberId === currentMember?.id) && (
                        <div className="stop-expense-actions">
                          <button onClick={() => startEditingExpense(expense)} aria-label={`Edit ${expense.item} expense`}>Edit</button>
                          <button onClick={() => deleteExpense(expense.id)} aria-label={`Delete ${expense.item} expense`}>Delete</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="photo-panel" aria-labelledby="add-photos-title">
              <div className="photo-panel-heading">
                <p className="eyebrow">Photo upload</p>
                <h3 id="add-photos-title">Add photos</h3>
              </div>
              <div className="photo-actions">
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoSelection}
              />
              <button
                className="primary-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={queueState !== "ready"}
              >
                {queueState === "saving" ? "Saving temporary copies…" : "Choose from Apple Photos"}
              </button>
              <p>Take photos with the iPhone Camera first, then choose them here.</p>
              {queueState === "loading" && <p className="queue-message">Opening your offline photo queue…</p>}
              {queueError && <p className="queue-message error" role="alert">{queueError}</p>}
              </div>

              <div className="gallery-heading">
              <h3>Memories from this stop</h3>
              <span>{selectedPhotos.length} queued</span>
              </div>

              {selectedPhotos.length === 0 ? (
              <div className="empty-gallery">
                <div className="empty-icon">▧</div>
                <strong>No photos assigned yet</strong>
                <p>Your originals will always remain safely in Apple Photos.</p>
              </div>
            ) : (
              <div className="photo-grid">
                {selectedPhotos.map((photo) => (
                  <figure key={photo.id} className="photo-card">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.previewUrl} alt={photo.name} />
                    <figcaption>
                      <div className="photo-meta">
                        <span className={`status-pill ${photo.isPrivate ? "private" : photo.status}`}>
                          {statusLabel(photo)}
                        </span>
                        <small>By {photo.memberName}</small>
                      </div>
                      <div>
                        <button onClick={() => togglePrivacy(photo.id)} disabled={photo.pendingLocalRemoval}>
                          {photo.isPrivate ? "Share" : "Keep private"}
                        </button>
                        <button onClick={() => removePhoto(photo.id)}>{photo.pendingLocalRemoval ? "Retry removal" : "Delete"}</button>
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
              )}
            </section>
          </div>
        )}
      </section>
        </>
      ) : activeTab === "gallery" ? (
        <section className="gallery-page" aria-labelledby="gallery-title">
          <header className="gallery-page-heading">
            <div>
              <p className="eyebrow">Shared family memories</p>
              <h1 id="gallery-title">Photo Gallery</h1>
              <p>Every uploaded snapshot, organised by day, stop and photographer.</p>
            </div>
            <button className="secondary-button" onClick={() => void refreshSharedGallery()} disabled={galleryState === "loading" || isOffline}>
              {galleryState === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </header>

          {galleryError && <p className="gallery-alert" role="alert">{galleryError}</p>}
          {galleryState === "offline" && (
            <p className="gallery-alert">The shared gallery needs an internet connection. Your itinerary and queued uploads remain available offline.</p>
          )}

          <div className="gallery-days">
            {days.map((day, dayIndex) => (
              <section className="gallery-day" key={day.id} aria-labelledby={`gallery-${day.id}`}>
                <header className="gallery-day-heading">
                  <h2 id={`gallery-${day.id}`}>Day {dayIndex + 1}: {day.label}</h2>
                  <time dateTime={day.date}>{galleryDate(day.date)}</time>
                </header>

                <div className="gallery-stops">
                  {day.stops.length === 0 ? (
                    <div className="gallery-empty-stop">No stops have been added to this day yet.</div>
                  ) : day.stops.map((stop, stopIndex) => {
                    const stopPhotos = sharedPhotos.filter((photo) => photo.dayId === day.id && photo.stopId === stop.id);
                    const groups = groupPhotosByPerson(stopPhotos);
                    return (
                      <article className="gallery-stop" key={stop.id}>
                        <header className="gallery-stop-heading">
                          <div>
                            <p>Stop {stopIndex + 1}</p>
                            <h3>{stop.title}</h3>
                          </div>
                          {stop.time && <time>{stop.time}</time>}
                        </header>

                        {groups.length === 0 ? (
                          <div className="gallery-empty-stop">
                            <span aria-hidden="true">▧</span>
                            <p>No shared snapshots yet.</p>
                          </div>
                        ) : groups.map((group) => (
                          <section className="person-snapshots" key={group.id} aria-labelledby={`snapshots-${stop.id}-${group.id}`}>
                            <div className="person-snapshots-heading">
                              <span className="member-avatar" aria-hidden="true">{group.name.slice(0, 1).toUpperCase()}</span>
                              <h4 id={`snapshots-${stop.id}-${group.id}`}>{group.name}&apos;s Snapshots</h4>
                              <small>{group.photos.length} photo{group.photos.length === 1 ? "" : "s"}</small>
                            </div>
                            <div className="shared-photo-grid">
                              {group.photos.map((photo) => {
                                const photoUrl = sharedPhotoUrls[photo.fileId];
                                return (
                                  <figure className="shared-photo-card" key={photo.fileId}>
                                    {photoUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={photoUrl} alt={`${group.name}'s snapshot at ${stop.title}`} loading="lazy" />
                                    ) : (
                                      <div className="shared-photo-loading">Loading snapshot…</div>
                                    )}
                                    <figcaption>
                                      <time dateTime={photo.createdAt}>
                                        {new Date(photo.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}
                                      </time>
                                      {photoUrl && <a href={photoUrl} download={photo.name}>Save photo</a>}
                                    </figcaption>
                                  </figure>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : (
        <section className="expenses-page" aria-labelledby="expenses-title">
          <header className="expenses-page-heading">
            <div>
              <p className="eyebrow">Shared family spending</p>
              <h1 id="expenses-title">Expenses</h1>
              <p>Costs entered at itinerary stops, with the person recorded automatically.</p>
            </div>
            {expenseRows.some(({ expense }) => expense.homeAmount === null) && (
              <button className="secondary-button" onClick={() => void refreshAudConversions()} disabled={isOffline || expenseConversionState === "converting"}>
                {expenseConversionState === "converting" ? "Converting…" : "Refresh AUD conversions"}
              </button>
            )}
          </header>

          {expenseConversionError && <p className="gallery-alert" role="alert">{expenseConversionError}</p>}

          <div className="expense-filters" aria-label="Expense filters">
            <label>
              <span>Person</span>
              <select value={expensePersonFilter} onChange={(event) => setExpensePersonFilter(event.target.value)}>
                <option value="">All people</option>
                {members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label>
              <span>Day</span>
              <select value={expenseDayFilter} onChange={(event) => setExpenseDayFilter(event.target.value)}>
                <option value="">All days</option>
                {days.map((day, index) => <option value={day.id} key={day.id}>Day {index + 1}: {day.label}</option>)}
              </select>
            </label>
            <label>
              <span>Category</span>
              <select value={expenseCategoryFilter} onChange={(event) => setExpenseCategoryFilter(event.target.value)}>
                <option value="">All categories</option>
                {expenseFilterCategories.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
            </label>
            {(expensePersonFilter || expenseDayFilter || expenseCategoryFilter) && (
              <button className="text-button" onClick={() => { setExpensePersonFilter(""); setExpenseDayFilter(""); setExpenseCategoryFilter(""); }}>Clear filters</button>
            )}
          </div>

          <div className="expenses-table-card">
            <div className="expenses-table-scroll">
              <table className="expenses-table">
                <thead><tr><th>Date</th><th>Item</th><th>Location</th><th>Category</th><th>Person</th><th>Local Currency</th><th>Home Currency</th></tr></thead>
                <tbody>
                  {filteredExpenseRows.map(({ day, dayIndex, stop, stopIndex, expense }) => (
                    <tr key={expense.id}>
                      <td data-label="Date"><time dateTime={day.date}>{expenseDate(day.date)}</time></td>
                      <td data-label="Item">
                        <strong>{expense.item}</strong>
                        {(isAdmin || expense.memberId === currentMember?.id) && <button className="expense-table-edit" onClick={() => openExpenseEditor(day.id, stop.id, expense)} aria-label={`Edit ${expense.item} from Day ${dayIndex + 1}, Stop ${stopIndex + 1}`}>Edit</button>}
                      </td>
                      <td data-label="Location">{stop.title}</td>
                      <td data-label="Category"><span className="expense-category">{expense.category}</span></td>
                      <td data-label="Person">{expense.memberName}</td>
                      <td data-label="Local Currency">{expenseMoney(expense.localAmount, expense.localCurrency)}</td>
                      <td data-label="Home Currency">{expenseMoney(expense.homeAmount, "AUD")}{expense.exchangeRateDate && <small>Rate dated {expense.exchangeRateDate}</small>}</td>
                    </tr>
                  ))}
                </tbody>
                {filteredExpenseRows.length > 0 && (
                  <tfoot>
                    <tr>
                      <th colSpan={5} scope="row">Total</th>
                      <td>{expenseTotals.local}</td>
                      <td>
                        <strong>{expenseMoney(expenseTotals.homeAmount, "AUD")}</strong>
                        {expenseTotals.missingHomeAmounts > 0 && <small>{expenseTotals.missingHomeAmounts} awaiting conversion</small>}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {filteredExpenseRows.length === 0 && (
              <div className="expenses-empty">
                <span aria-hidden="true">$</span>
                <strong>{expenseRows.length === 0 ? "No expenses yet" : "No expenses match these filters"}</strong>
                <p>{expenseRows.length === 0 ? "Open an itinerary stop to add the first shared expense." : "Clear or change the filters to see more expenses."}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {showSettings && isAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSettings(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Trip settings</p>
            <h2 id="settings-title">Family profiles</h2>
            <p className="modal-copy">
              Grace manages the family profiles and their private links. Contributor links stay locked to their assigned person on each browser.
            </p>
            <div className="member-list">
              {members.map((member) => (
                <div className={`member-row ${member.id === currentMember?.id ? "active" : ""}`} key={member.id}>
                  <span className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</span>
                  <strong>{member.name}</strong>
                  <span className="member-role">{member.id === currentMember?.id ? "Admin" : "Contributor"}</span>
                  <button className="member-action" onClick={() => void copyMemberLink(member)}>
                    {copiedMemberId === member.id ? "Copied" : "Copy link"}
                  </button>
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="add-member-row">
                <input
                  value={newMemberName}
                  onChange={(event) => setNewMemberName(event.target.value)}
                  placeholder="Family member name"
                  aria-label="New family member name"
                />
                <button className="secondary-button" onClick={addFamilyMember} disabled={!newMemberName.trim()}>Add</button>
              </div>
            )}
            <p className="settings-note">
              This device is <strong>{currentMember?.name || "not assigned"}</strong> in admin mode. Everyone can add and edit itinerary items under their own locked profile; only Grace can manage profiles. If two people change the same item before syncing, both versions are kept and the newer copy is labelled with its contributor.
            </p>
            <section className="places-usage" aria-labelledby="places-usage-title">
              <div className="places-usage-heading">
                <div>
                  <p className="eyebrow">Monthly safety cap</p>
                  <h3 id="places-usage-title">Google Places usage</h3>
                </div>
                <button className="member-action" onClick={() => void refreshPlacesUsage()}>Refresh</button>
              </div>
              {placesUsage ? (
                <>
                  {!placesUsage.enabled && <p className="places-setup-note">Places setup is not finished yet. Manual locations and map links still work.</p>}
                  <div className="usage-row">
                    <span>Autocomplete searches</span>
                    <strong>{placesUsage.autocompleteRemaining.toLocaleString()} remaining</strong>
                    <progress max={placesUsage.safeLimit} value={placesUsage.autocompleteUsed} />
                    <small>{placesUsage.autocompleteUsed.toLocaleString()} of {placesUsage.safeLimit.toLocaleString()} used</small>
                  </div>
                  <div className="usage-row">
                    <span>Saved-place lookups</span>
                    <strong>{placesUsage.detailsRemaining.toLocaleString()} remaining</strong>
                    <progress max={placesUsage.safeLimit} value={placesUsage.detailsUsed} />
                    <small>{placesUsage.detailsUsed.toLocaleString()} of {placesUsage.safeLimit.toLocaleString()} used</small>
                  </div>
                  <p className="usage-footnote">
                    The app blocks each request type at {placesUsage.safeLimit.toLocaleString()}, below Google&apos;s {placesUsage.googleFreeAllowance.toLocaleString()} monthly free allowance. Resets {placesUsage.resetDate}.
                  </p>
                </>
              ) : (
                <p className="places-setup-note">Loading Google Places usage…</p>
              )}
            </section>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowSettings(false)}>Close</button>
              <button className="primary-button" onClick={connectGoogleDrive} disabled={googleState === "connecting"}>
                {googleState === "connecting" ? "Refreshing…" : "Refresh shared trip"}
              </button>
            </div>
          </section>
        </div>
      )}

      {sharedStateReady && !currentMember && !showSettings && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <p className="eyebrow">Welcome to the trip</p>
            <h2 id="profile-title">Private invitation needed</h2>
            <p className="modal-copy">Open the private link Grace prepared for you. It connects this browser to your own locked family profile.</p>
          </section>
        </div>
      )}

      {showAddStop && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAddStop(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-stop-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Itinerary</p>
            <h2 id="add-stop-title">Add an unplanned stop</h2>
            <label>
              Stop name
              <input value={newStopName} onChange={(event) => setNewStopName(event.target.value)} placeholder="Naschmarkt visit" autoFocus />
            </label>
            <label>
              Time
              <input type="time" value={newStopTime} onChange={(event) => setNewStopTime(event.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowAddStop(false)}>Cancel</button>
              <button className="primary-button" onClick={addStop} disabled={!newStopName.trim()}>Add stop</button>
            </div>
          </section>
        </div>
      )}

      {showEditDay && selectedDay && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowEditDay(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-day-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Day {selectedDayNumber}</p>
            <h2 id="edit-day-title">Edit day details</h2>
            <label>
              Day name
              <input value={editDayName} onChange={(event) => setEditDayName(event.target.value)} readOnly={!isAdmin} aria-label="Edit day name" />
            </label>
            {!isAdmin && <p className="modal-field-note">Only Grace can rename an existing day.</p>}
            <label>
              Date
              <input type="date" value={editDayDate} onChange={(event) => setEditDayDate(event.target.value)} aria-label="Edit day date" />
            </label>
            <div className="modal-danger-zone">
              <button className="danger-button" onClick={() => { setShowEditDay(false); setShowDeleteDayConfirm(true); }} disabled={days.length <= 1}>Delete Day</button>
              {days.length <= 1 && <small>A trip must keep at least one day.</small>}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowEditDay(false)}>Cancel</button>
              <button className="primary-button" onClick={saveDayDetails} disabled={!editDayDate || (isAdmin && !editDayName.trim())}>Save changes</button>
            </div>
          </section>
        </div>
      )}

      {showDeleteDayConfirm && selectedDay && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { setShowDeleteDayConfirm(false); setShowEditDay(true); }}>
          <section className="modal confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-day-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Please confirm</p>
            <h2 id="delete-day-title">Delete Day {selectedDayNumber}?</h2>
            <p className="modal-copy">
              {queuedPhotos.some((photo) => selectedDay.stops.some((stop) => stop.id === photo.stopId))
                ? "This day has photos on this device. Their Apple Photos and Drive copies will remain, but they will no longer be assigned in this itinerary."
                : "This removes the day from the shared itinerary. Photos already in Apple Photos or Drive will not be deleted."}
            </p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => { setShowDeleteDayConfirm(false); setShowEditDay(true); }}>Keep day</button>
              <button className="danger-button solid" onClick={deleteSelectedDay}>Delete Day</button>
            </div>
          </section>
        </div>
      )}

      {showAddDay && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAddDay(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-day-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Itinerary</p>
            <h2 id="add-day-title">Add another day</h2>
            <label>
              Day name
              <input value={newDayName} onChange={(event) => setNewDayName(event.target.value)} placeholder="Vienna museums" autoFocus />
            </label>
            <label>
              Date
              <input type="date" value={newDayDate} onChange={(event) => setNewDayDate(event.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowAddDay(false)}>Cancel</button>
              <button className="primary-button" onClick={addDay} disabled={!newDayName.trim() || !newDayDate}>Add day</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

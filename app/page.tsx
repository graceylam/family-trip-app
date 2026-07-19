"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getSharedTrip,
  GoogleDriveError,
  organizeDriveFile,
  saveSharedTrip,
  type SharedTripState,
  type TripDay,
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
const sharedTripId = "vienna-2026-family-trip";
const initialTripName = "2026 Vienna Trip";

function tripFingerprint(tripName: string, days: TripDay[], members: TripMember[]): string {
  return JSON.stringify({ tripName, days, members });
}

function timeInputValue(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function googleMapsSearchUrl(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.trim())}`;
}

function googleMapsDirectionsUrl(place: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.trim())}`;
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
  const [tripSyncState, setTripSyncState] = useState<"loading" | "synced" | "saving" | "offline" | "error">("loading");
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
  const [showSettings, setShowSettings] = useState(false);
  const [newStopName, setNewStopName] = useState("");
  const [newStopTime, setNewStopTime] = useState("12:00");
  const [newDayName, setNewDayName] = useState("");
  const [newDayDate, setNewDayDate] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [copiedMemberId, setCopiedMemberId] = useState("");
  const [hasLoadedLocalState, setHasLoadedLocalState] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Map<string, string>());
  const lastSavedTripRef = useRef("");
  const lastSyncedTripRef = useRef<SharedTripState | null>(null);
  const isAdmin = Boolean(adminSecret);
  const currentMember = useMemo(
    () => members.find((member) => member.id === currentMemberId),
    [currentMemberId, members],
  );

  const refreshSharedItinerary = useCallback(async () => {
    if (!navigator.onLine) {
      setTripSyncState("offline");
      setSharedStateReady(true);
      return false;
    }

    setTripSyncState("loading");
    try {
      const [trip] = await Promise.all([
        getSharedTrip(sharedTripId, { tripName: initialTripName, days: initialDays, members: initialMembers }),
        checkGoogleDriveGateway(),
      ]);
      setTripName(trip.tripName);
      setDays(trip.days);
      setMembers(trip.members);
      setSelectedDayId((current) => trip.days.some((day) => day.id === current) ? current : trip.days[0]?.id ?? "");
      setSelectedStopId((current) => trip.days.some((day) => day.stops.some((stop) => stop.id === current))
        ? current
        : trip.days[0]?.stops[0]?.id ?? "");
      setTripRevision(trip.revision);
      lastSyncedTripRef.current = trip;
      lastSavedTripRef.current = tripFingerprint(trip.tripName, trip.days, trip.members);
      setSharedStateReady(true);
      setTripSyncState("synced");
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
    const saved = window.localStorage.getItem(itineraryKey);
    if (saved) {
      try {
        setDays(JSON.parse(saved));
      } catch {
        window.localStorage.removeItem(itineraryKey);
      }
    }
    const savedTripName = window.localStorage.getItem(tripNameKey);
    if (savedTripName) setTripName(savedTripName);
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

    if (navigator.onLine) setGoogleState("connecting");
    void refreshSharedItinerary();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    }

    let queueLoadCancelled = false;
    void Promise.all([listQueuedPhotos(), getStorageHealth()])
      .then(([records, health]) => {
        if (queueLoadCancelled) return;
        const views = records.map((record) => {
          const previewUrl = URL.createObjectURL(record.blob);
          previewUrlsRef.current.set(record.id, previewUrl);
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
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, [refreshSharedItinerary]);

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
      if (currentMember && tripFingerprint(tripName, days, members) !== lastSavedTripRef.current) return;
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
    if (!hasLoadedLocalState || !sharedStateReady || !currentMember || !lastSyncedTripRef.current || isOffline) return;
    const fingerprint = tripFingerprint(tripName, days, members);
    if (fingerprint === lastSavedTripRef.current) return;

    const timeoutId = window.setTimeout(() => {
      setTripSyncState("saving");
      const draft: SharedTripState = {
        tripId: sharedTripId,
        tripName: tripName.trim() || initialTripName,
        days,
        members,
        revision: tripRevision,
        updatedAt: new Date().toISOString(),
      };
      void saveSharedTrip(draft, currentMember, lastSyncedTripRef.current!, adminSecret || undefined)
        .then((saved) => {
          setTripName(saved.tripName);
          setDays(saved.days);
          setTripRevision(saved.revision);
          setMembers(saved.members);
          lastSyncedTripRef.current = saved;
          lastSavedTripRef.current = tripFingerprint(saved.tripName, saved.days, saved.members);
          setTripSyncState("synced");
          setGoogleError(null);
        })
        .catch((error: unknown) => {
          setTripSyncState("error");
          setGoogleError(error instanceof Error ? error.message : "The itinerary change could not be shared.");
        });
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [adminSecret, currentMember, days, hasLoadedLocalState, isOffline, members, sharedStateReady, tripName, tripRevision]);

  const selectedDay = useMemo(
    () => days.find((day) => day.id === selectedDayId) ?? days[0],
    [days, selectedDayId],
  );

  const selectedStop = useMemo(
    () => selectedDay?.stops.find((stop) => stop.id === selectedStopId) ?? selectedDay?.stops[0],
    [selectedDay, selectedStopId],
  );

  const profileInitials = (currentMember?.name || "Family")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const selectedDayIndex = days.findIndex((day) => day.id === selectedDay?.id);
  const selectedStopIndex = selectedDay?.stops.findIndex((stop) => stop.id === selectedStop?.id) ?? -1;

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
    ? "Offline copy"
    : tripSyncState === "saving"
      ? "Sharing changes…"
      : tripSyncState === "loading"
        ? "Refreshing shared trip…"
        : tripSyncState === "error"
          ? "Shared trip needs attention"
          : "Shared trip synced";

  function selectDay(day: TripDay) {
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
      current.map((day) =>
        day.id === selectedDay.id ? { ...day, stops: [...day.stops, stop] } : day,
      ),
    );
    setSelectedStopId(stop.id);
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
    setDays((current) => [...current, day]);
    setSelectedDayId(day.id);
    setSelectedStopId("");
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
    setDays((current) => current.map((day) => day.id === selectedDay.id
      ? { ...day, stops: day.stops.map((stop) => stop.id === selectedStop.id ? { ...stop, ...changes } : stop) }
      : day));
  }

  function moveSelectedDay(offset: -1 | 1) {
    if (!currentMember || !selectedDay) return;
    setDays((current) => {
      const from = current.findIndex((day) => day.id === selectedDay.id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const reordered = [...current];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return reordered;
    });
  }

  function moveSelectedStop(offset: -1 | 1) {
    if (!currentMember || !selectedDay || !selectedStop) return;
    setDays((current) => current.map((day) => {
      if (day.id !== selectedDay.id) return day;
      const from = day.stops.findIndex((stop) => stop.id === selectedStop.id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= day.stops.length) return day;
      const reordered = [...day.stops];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      return { ...day, stops: reordered };
    }));
  }

  function deleteSelectedDay() {
    if (!currentMember || !selectedDay || days.length <= 1) return;
    const hasLocalPhotos = queuedPhotos.some((photo) => selectedDay.stops.some((stop) => stop.id === photo.stopId));
    const warning = hasLocalPhotos
      ? "This day has photos on this device. Their Apple Photos and Drive copies will remain, but they will no longer be assigned in this itinerary. Delete the day?"
      : "Delete this day from the shared itinerary? Photos already in Apple Photos or Drive will not be deleted.";
    if (!window.confirm(warning)) return;
    const index = days.findIndex((day) => day.id === selectedDay.id);
    const remaining = days.filter((day) => day.id !== selectedDay.id);
    const nextDay = remaining[Math.min(index, remaining.length - 1)];
    setDays(remaining);
    setSelectedDayId(nextDay.id);
    setSelectedStopId(nextDay.stops[0]?.id ?? "");
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
    setDays((current) => current.map((day) => day.id === selectedDay.id ? { ...day, stops: remainingStops } : day));
    setSelectedStopId(remainingStops[Math.min(index, remainingStops.length - 1)]?.id ?? "");
  }

  function updateSelectedDayDate(date: string) {
    if (!currentMember || !selectedDay || !date) return;
    setDays((current) =>
      current.map((day) => (day.id === selectedDay.id ? { ...day, date } : day)),
    );
  }

  function updateSelectedDayLabel(label: string) {
    if (!isAdmin || !selectedDay) return;
    setDays((current) =>
      current.map((day) => (day.id === selectedDay.id ? { ...day, label } : day)),
    );
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

      <section className={`connection-card ${isOffline ? "offline" : "online"}`}>
        <span className="connection-dot" aria-hidden="true" />
        <div>
          <strong>{isOffline ? "Travelling offline" : "Ready for the trip"}</strong>
          <p>
            {isOffline
              ? "Your itinerary works here. Photos will wait safely for Wi-Fi."
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
          <div className="section-heading">
            <div>
              <p className="eyebrow">{selectedDay?.label}</p>
              <h2>Today’s plan</h2>
            </div>
            <div className="day-actions">
              <label className="date-control name-control">
                <span>Day name</span>
                <input
                  type="text"
                  value={selectedDay?.label ?? ""}
                  onChange={(event) => updateSelectedDayLabel(event.target.value)}
                  aria-label="Change selected day name"
                  placeholder="Vienna"
                  readOnly={!isAdmin}
                />
              </label>
              <label className="date-control">
                <span>Date</span>
                <input
                  type="date"
                  value={selectedDay?.date ?? ""}
                  onChange={(event) => updateSelectedDayDate(event.target.value)}
                  aria-label="Change selected trip day date"
                  disabled={!currentMember}
                />
              </label>
              <button className="secondary-button" onClick={() => setShowAddStop(true)} disabled={!currentMember}>+ Add stop</button>
              <div className="compact-actions" aria-label="Day actions">
                <button onClick={() => moveSelectedDay(-1)} disabled={!currentMember || selectedDayIndex <= 0} aria-label="Move day earlier">↑</button>
                <button onClick={() => moveSelectedDay(1)} disabled={!currentMember || selectedDayIndex < 0 || selectedDayIndex >= days.length - 1} aria-label="Move day later">↓</button>
                <button className="danger-action" onClick={deleteSelectedDay} disabled={!currentMember || days.length <= 1}>Delete day</button>
              </div>
            </div>
          </div>

          <div className="timeline">
            {selectedDay?.stops.map((stop) => {
              const active = stop.id === selectedStop?.id;
              const count = queuedPhotos.filter((photo) => photo.stopId === stop.id).length;
              return (
                <button
                  key={stop.id}
                  className={`stop-card ${active ? "active" : ""}`}
                  onClick={() => setSelectedStopId(stop.id)}
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
          <article className="memory-panel">
            <div className="memory-hero">
              <p className="eyebrow">Selected stop</p>
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
                      <input type="search" value={selectedStop.place} onChange={(event) => updateSelectedStop({ place: event.target.value })} placeholder="Searchable place or address" readOnly={!currentMember} />
                    </label>
                    {selectedStop.place.trim() ? (
                      <div className="maps-place-card" aria-label={`Google Maps location: ${selectedStop.place}`}>
                        <span className="maps-place-pin" aria-hidden="true">●</span>
                        <span className="maps-place-copy">
                          <small>Google Maps location</small>
                          <strong>{selectedStop.place}</strong>
                        </span>
                        <span className="maps-place-actions">
                          <a href={googleMapsSearchUrl(selectedStop.place)} target="_blank" rel="noopener noreferrer">Open map ↗</a>
                          <a href={googleMapsDirectionsUrl(selectedStop.place)} target="_blank" rel="noopener noreferrer">Directions ↗</a>
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
                  <button onClick={() => moveSelectedStop(-1)} disabled={!currentMember || selectedStopIndex <= 0}>Move earlier</button>
                  <button onClick={() => moveSelectedStop(1)} disabled={!currentMember || selectedStopIndex < 0 || selectedStopIndex >= selectedDay.stops.length - 1}>Move later</button>
                  <button className="danger-action" onClick={deleteSelectedStop} disabled={!currentMember}>Delete stop</button>
                </div>
              </div>
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
          </article>
        )}
      </section>

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

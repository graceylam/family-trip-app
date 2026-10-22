"use client";

import { ChangeEvent, FormEvent, Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountPortal from "./AccountPortal";
import Gallery from "./Gallery";
import MemoryLane from "./MemoryLane";
import StopsBank from "./StopsBank";
import "mapbox-gl/dist/mapbox-gl.css";
import { createFamilyMap, getMapboxPlace, searchMapboxPlaces, type FamilyMapTravelMode } from "../lib/mapbox";
import type { SavedPlace } from "../lib/firebaseSavedPlaces";
import { deleteAccountTrip, observeTripAccountMembers, promoteTripMemberToAdmin, updateTripCoverPresentation, type AccountTrip, type FamilyAccount, type TripAccountMember } from "../lib/firebaseAccounts";
import {
  getFirebaseTripState,
  initializeFirebaseTripState,
  observeFirebaseTripState,
  saveFirebaseTripState,
} from "../lib/firebaseTripState";
import { deleteTripMedia, observeTripMedia, updateTripMedia, uploadTripMedia, type TripMedia } from "../lib/firebaseMedia";
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
  configureGoogleDriveGateway,
  deleteDriveFile,
  type DrivePhotoLocation,
  getSharedFileBlob,
  getSharedTrip,
  type PlaceSuggestion,
  type SharedTripState,
  type TripDay,
  type TripDocument,
  type TripExpense,
  type TripMember,
  type TripStop,
  type TripScrapbookEntry,
  uploadDocumentToDrive,
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
const legacySharedTripId = "vienna-2026-family-trip";
const initialTripName = "2026 Vienna Trip";
const expenseCategories = ["Food & Drink", "Transport", "Accommodation", "Tickets & Activities", "Shopping", "Other"];
const currencyOptions = ["EUR", "AUD", "USD", "GBP", "CZK", "HUF", "CHF"];

type ViennaWeather = {
  kind: "current" | "forecast";
  heading: string;
  detail: string;
  icon: string;
};

function viennaDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function weatherDescription(code: number): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: "☀️" };
  if (code <= 3) return { label: "Partly cloudy", icon: "⛅" };
  if (code <= 48) return { label: "Foggy", icon: "🌫️" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { label: "Rainy", icon: "🌧️" };
  if (code <= 77 || (code >= 85 && code <= 86)) return { label: "Snowy", icon: "🌨️" };
  if (code >= 95) return { label: "Thunderstorms", icon: "⛈️" };
  return { label: "Changeable", icon: "🌦️" };
}

async function coverThumbnail(file: File): Promise<string> {
  const image = new Image();
  const source = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The cover photo could not be opened."));
      image.src = source;
    });
    const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .72);
  } finally { URL.revokeObjectURL(source); }
}

type PendingTripSave = {
  version: 1;
  fingerprint: string;
  queuedAt: string;
  draft: SharedTripState;
  baseTrip: SharedTripState;
};

function tripFingerprint(tripName: string, coverPhotoId: string, days: TripDay[], members: TripMember[]): string {
  return JSON.stringify({ tripName, coverPhotoId, days, members });
}

function sharedTripFingerprint(trip: SharedTripState): string {
  return tripFingerprint(trip.tripName, trip.coverPhotoId || "", trip.days, trip.members);
}

function normalizeSharedTripChronology(trip: SharedTripState): SharedTripState {
  return { ...trip, days: sortItineraryChronologically(trip.days) };
}

function scopedStorageKey(key: string, tripId: string): string {
  return `${key}:${tripId}`;
}

function readPendingTripSave(tripId: string): PendingTripSave | null {
  const storageKey = scopedStorageKey(pendingTripSaveKey, tripId);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingTripSave>;
    if (
      pending.version !== 1 ||
      !pending.fingerprint ||
      !pending.draft ||
      !pending.baseTrip ||
      pending.draft.tripId !== tripId ||
      pending.baseTrip.tripId !== tripId
    ) {
      window.localStorage.removeItem(storageKey);
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
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function writePendingTripSave(tripId: string, pending: PendingTripSave): void {
  window.localStorage.setItem(scopedStorageKey(pendingTripSaveKey, tripId), JSON.stringify(pending));
}

function clearPendingTripSave(tripId: string): void {
  window.localStorage.removeItem(scopedStorageKey(pendingTripSaveKey, tripId));
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

function minutesFromTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function timelineGapHeight(currentTime: string, nextTime: string): number {
  const current = minutesFromTime(currentTime);
  const next = minutesFromTime(nextTime);
  if (current === null || next === null || next <= current) return 10;

  // Keep a subtle duration cue without letting long breaks stretch the phone
  // itinerary into a mostly empty page.
  return Math.min(42, Math.max(5, Math.round((next - current) / 6)));
}

function externalMapUrl(place: string, latitude?: number, longitude?: number): string {
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(place.trim())}`;
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(place.trim())}`;
}

function externalDirectionsUrl(place: string, latitude?: number, longitude?: number): string {
  const destination = Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude},${longitude}` : place.trim();
  return `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`;
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

function DayPinMap({ day, onTravelModeChange }: { day: TripDay; onTravelModeChange: (stopId: string, mode: FamilyMapTravelMode) => void }) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState("");
  const locatedStops = day.stops.filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));

  useEffect(() => {
    let disposed = false;
    let map: ReturnType<typeof createFamilyMap> | null = null;
    try {
      if (!mapElementRef.current) return;
      const pins = locatedStops.map((stop) => ({
        id: stop.id,
        latitude: stop.latitude!,
        longitude: stop.longitude!,
        number: day.stops.indexOf(stop) + 1,
        title: stop.title,
        subtitle: stop.place,
      }));
      const routeSegments = locatedStops.slice(0, -1).map((stop, index) => ({
        id: `${stop.id}-${locatedStops[index + 1].id}`,
        from: [stop.longitude!, stop.latitude!] as [number, number],
        to: [locatedStops[index + 1].longitude!, locatedStops[index + 1].latitude!] as [number, number],
        mode: stop.travelModeToNext || "walking" as FamilyMapTravelMode,
      }));
      map = createFamilyMap(mapElementRef.current, pins, { routeSegments, onRouteError: (message) => setMapError(message) });
    } catch (error) {
      if (!disposed) setMapError(error instanceof Error ? error.message : "The map could not be opened.");
    }
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [day]);

  return (
    <div className="day-map-canvas-wrap">
      <div ref={mapElementRef} className="day-map-canvas" aria-label={`Map of ${day.label}`} />
      {locatedStops.length === 0 && !mapError && <p className="day-map-overlay">Add a Mapbox location to a stop to place its numbered pin.</p>}
      {mapError && <p className="day-map-overlay error" role="alert">{mapError}</p>}
      {locatedStops.length > 1 && <div className="map-route-mode-list" aria-label="Travel modes between stops">
        {locatedStops.slice(0, -1).map((stop, index) => <label key={stop.id}>
          <span>{index + 1} → {index + 2}</span>
          <select value={stop.travelModeToNext || "walking"} onChange={(event) => onTravelModeChange(stop.id, event.target.value as FamilyMapTravelMode)}>
            <option value="walking">Walk</option><option value="driving">Drive</option><option value="cycling">Cycle</option><option value="direct">Train / flight</option>
          </select>
        </label>)}
      </div>}
    </div>
  );
}

function groupPhotosByPerson(photos: TripMedia[]): Array<{ id: string; name: string; photos: TripMedia[] }> {
  const groups = new Map<string, { id: string; name: string; photos: TripMedia[] }>();
  photos.forEach((photo) => {
    const id = photo.memberId || photo.memberName;
    const existing = groups.get(id);
    if (existing) existing.photos.push(photo);
    else groups.set(id, { id, name: photo.memberName || "Family member", photos: [photo] });
  });
  return Array.from(groups.values());
}

type AppIconName = "calendar" | "pin" | "camera" | "receipt" | "document" | "heart" | "overview" | "settings";

function AppIcon({ name }: { name: AppIconName }) {
  const paths: Record<AppIconName, ReactNode> = {
    calendar: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 13h3v3H8z" /></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="4" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    heart: <path d="M20.8 8.7c0 5.3-8.8 10.3-8.8 10.3S3.2 14 3.2 8.7A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.8 2.3Z" />,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  };
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type TripWorkspaceProps = {
  account: FamilyAccount;
  accountTrip: AccountTrip;
  onBackToTrips: () => void;
};

function TripWorkspace({ account, accountTrip, onBackToTrips }: TripWorkspaceProps) {
  const sharedTripId = accountTrip.legacyDriveTripId || accountTrip.id;
  const workspaceInitialName = accountTrip.name || initialTripName;
  const workspaceInitialDays = useMemo<TripDay[]>(() => accountTrip.legacyDriveTripId
    ? initialDays
    : [{ id: `day-${crypto.randomUUID()}`, date: accountTrip.startDate, label: "First Day", stops: [] }],
  [accountTrip.legacyDriveTripId, accountTrip.startDate]);
  const workspaceInitialMembers = useMemo<TripMember[]>(() => accountTrip.legacyDriveTripId
    ? initialMembers
    : [{ id: account.uid, name: accountTrip.memberName || account.displayName }],
  [account.displayName, account.uid, accountTrip.legacyDriveTripId, accountTrip.memberName]);
  const [tripName, setTripName] = useState(workspaceInitialName);
  const [tripCoverPhotoId, setTripCoverPhotoId] = useState("");
  const [tripCoverUrl, setTripCoverUrl] = useState("");
  const [tripCoverPositionX, setTripCoverPositionX] = useState(accountTrip.coverPositionX ?? 50);
  const [tripCoverPositionY, setTripCoverPositionY] = useState(accountTrip.coverPositionY ?? 50);
  const [tripCoverThumbnail, setTripCoverThumbnail] = useState(accountTrip.coverThumbnailDataUrl || "");
  const [coverUploadState, setCoverUploadState] = useState<"idle" | "uploading" | "error">("idle");
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const tripId = sharedTripId;
  const [previousTripId, setPreviousTripId] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [tripAccessKey, setTripAccessKey] = useState("");
  const [members, setMembers] = useState<TripMember[]>(workspaceInitialMembers);
  const [currentMemberId, setCurrentMemberId] = useState("");
  const [tripRevision, setTripRevision] = useState(1);
  const [sharedStateReady, setSharedStateReady] = useState(false);
  const [tripSyncState, setTripSyncState] = useState<"loading" | "synced" | "unsaved" | "saving" | "offline" | "error">("loading");
  const [hasPendingTripSave, setHasPendingTripSave] = useState(false);
  const [lastTripSavedAt, setLastTripSavedAt] = useState("");
  const [googleState, setGoogleState] = useState<"disconnected" | "connecting" | "connected" | "uploading">("disconnected");
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [tripSyncError, setTripSyncError] = useState<string | null>(null);
  const [days, setDays] = useState<TripDay[]>(workspaceInitialDays);
  const [selectedDayId, setSelectedDayId] = useState(workspaceInitialDays[0]?.id || "");
  const [selectedStopId, setSelectedStopId] = useState("");
  const [inlineStopContainer, setInlineStopContainer] = useState<HTMLDivElement | null>(null);
  const inlineStopContainerRef = useCallback((node: HTMLDivElement | null) => setInlineStopContainer(node), []);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [documentNavigationTarget, setDocumentNavigationTarget] = useState<{ stopId: string; documentId: string } | null>(null);
  const [queuedPhotos, setQueuedPhotos] = useState<QueuedPhotoView[]>([]);
  const [previewQueuedPhotoId, setPreviewQueuedPhotoId] = useState("");
  const [previewSharedMediaId, setPreviewSharedMediaId] = useState("");
  const [queueState, setQueueState] = useState<"loading" | "ready" | "saving" | "unavailable">("loading");
  const [queueError, setQueueError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [showEditDay, setShowEditDay] = useState(false);
  const [showDeleteDayConfirm, setShowDeleteDayConfirm] = useState(false);
  const [downloadDayId, setDownloadDayId] = useState("");
  const [selectedDownloadStopIds, setSelectedDownloadStopIds] = useState<string[]>([]);
  const [bulkDownloadState, setBulkDownloadState] = useState<"idle" | "downloading">("idle");
  const [bulkDownloadError, setBulkDownloadError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteTripConfirm, setShowDeleteTripConfirm] = useState(false);
  const [deleteTripConfirmation, setDeleteTripConfirmation] = useState("");
  const [deleteTripState, setDeleteTripState] = useState<"idle" | "deleting" | "error">("idle");
  const [deleteTripError, setDeleteTripError] = useState("");
  const [showOverview, setShowOverview] = useState(false);
  const [tripAccountMembers, setTripAccountMembers] = useState<TripAccountMember[]>([]);
  const [adminUpdateUid, setAdminUpdateUid] = useState("");
  const [adminUpdateError, setAdminUpdateError] = useState("");
  const [viennaWeather, setViennaWeather] = useState<ViennaWeather | null>(null);
  const [invitationLink, setInvitationLink] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [newStopName, setNewStopName] = useState("");
  const [newStopTime, setNewStopTime] = useState("12:00");
  const [newDayName, setNewDayName] = useState("");
  const [newDayDate, setNewDayDate] = useState("");
  const [editDayName, setEditDayName] = useState("");
  const [editDayDate, setEditDayDate] = useState("");
  const [editDayStoryTitle, setEditDayStoryTitle] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [copiedMemberId, setCopiedMemberId] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placeSearchState, setPlaceSearchState] = useState<"idle" | "searching" | "choosing">("idle");
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [placeSearchTarget, setPlaceSearchTarget] = useState<{ dayId: string; stopId: string } | null>(null);
  const [placeSearchDraft, setPlaceSearchDraft] = useState("");
  const [activeTab, setActiveTab] = useState<"itinerary" | "stops" | "gallery" | "expenses" | "documents" | "memory">("itinerary");
  const [itineraryView, setItineraryView] = useState<"itinerary" | "map">("itinerary");
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
  const [sharedPhotos, setSharedPhotos] = useState<TripMedia[]>([]);
  const [sharedPhotoUrls, setSharedPhotoUrls] = useState<Record<string, string>>({});
  const [galleryState, setGalleryState] = useState<"idle" | "loading" | "ready" | "offline" | "error">("idle");
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [documentUploadState, setDocumentUploadState] = useState<"idle" | "uploading">("idle");
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentProgress, setDocumentProgress] = useState({ completed: 0, total: 0 });
  const [documentPreview, setDocumentPreview] = useState<{ document: TripDocument; url: string; blob: Blob; name: string } | null>(null);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState<TripDocument | null>(null);
  const [hasLoadedLocalState, setHasLoadedLocalState] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const tripCoverUrlRef = useRef("");
  const previewUrlsRef = useRef(new Map<string, string>());
  const sharedPhotoUrlsRef = useRef(new Map<string, string>());
  const sharedPhotoBlobsRef = useRef(new Map<string, Blob>());
  const galleryRequestRef = useRef(0);
  const lastSavedTripRef = useRef("");
  const lastSyncedTripRef = useRef<SharedTripState | null>(null);
  const pendingTripSaveRef = useRef<PendingTripSave | null>(null);
  const tripSaveInFlightRef = useRef(false);
  const latestTripDraftRef = useRef({
    tripName: workspaceInitialName,
    coverPhotoId: "",
    days: workspaceInitialDays,
    members: workspaceInitialMembers,
    revision: 1,
  });
  const placeSearchTimerRef = useRef<number | null>(null);
  const placeSearchRequestRef = useRef(0);
  const placeSessionTokenRef = useRef("");
  const isAdmin = accountTrip.role === "admin" || Boolean(adminSecret);
  const tripCoverDisplayUrl = tripCoverUrl || tripCoverThumbnail;
  const currentMember = useMemo(
    () => members.find((member) => member.id === currentMemberId),
    [currentMemberId, members],
  );
  latestTripDraftRef.current = { tripName, coverPhotoId: tripCoverPhotoId, days, members, revision: tripRevision };

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
        setTripSyncError(null);

        let saved: SharedTripState | null = null;
        let finalError: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            saved = await saveFirebaseTripState(
              account,
              accountTrip,
              sending.draft,
              currentMember,
              sending.baseTrip,
            );
            break;
          } catch (error) {
            finalError = error;
            if (attempt === 3 || !navigator.onLine) break;
            await new Promise((resolve) => window.setTimeout(resolve, 700 * 2 ** (attempt - 1)));
          }
        }

        if (!saved) {
          setTripSyncState(navigator.onLine ? "error" : "offline");
          setTripSyncError(
            finalError instanceof Error
              ? `${finalError.message} Your changes are still safe on this device.`
              : "The itinerary could not be saved after three attempts. Your changes are still safe on this device.",
          );
          return;
        }

        const chronologicalSaved = normalizeSharedTripChronology(saved);
        const savedFingerprint = sharedTripFingerprint(chronologicalSaved);
        lastSyncedTripRef.current = chronologicalSaved;
        lastSavedTripRef.current = savedFingerprint;
        setLastTripSavedAt(saved.updatedAt);
        window.localStorage.setItem(scopedStorageKey(lastTripSavedAtKey, sharedTripId), saved.updatedAt);

        const latestPending = pendingTripSaveRef.current;
        const latestWasAcknowledged =
          !latestPending ||
          latestPending.fingerprint === sending.fingerprint ||
          latestPending.fingerprint === savedFingerprint;

        if (latestWasAcknowledged) {
          pendingTripSaveRef.current = null;
          clearPendingTripSave(sharedTripId);
          setHasPendingTripSave(false);
          setTripName(chronologicalSaved.tripName);
          setTripCoverPhotoId(chronologicalSaved.coverPhotoId || "");
          setDays(chronologicalSaved.days);
          setMembers(chronologicalSaved.members);
          setTripRevision(chronologicalSaved.revision);
          setSelectedDayId((current) => chronologicalSaved.days.some((day) => day.id === current) ? current : chronologicalSaved.days[0]?.id ?? "");
          setSelectedStopId((current) => chronologicalSaved.days.some((day) => day.stops.some((stop) => stop.id === current))
            ? current
            : chronologicalSaved.days[0]?.stops[0]?.id ?? "");
          setTripSyncState("synced");
          setTripSyncError(null);
          return;
        }

        // A newer edit arrived while this request was running. Keep it on screen
        // and in local storage, then send it only after the earlier save completes.
        // The newer draft was made on top of the draft that just saved, so use
        // that submitted draft as its three-way merge base. Keeping the older
        // base would make two sequential edits by Grace look concurrent.
        const rebasedPending = {
          ...latestPending,
          baseTrip: sending.draft,
        };
        pendingTripSaveRef.current = rebasedPending;
        writePendingTripSave(sharedTripId, rebasedPending);
        setTripSyncState("unsaved");
      }
    } finally {
      tripSaveInFlightRef.current = false;
    }
  }, [account, accountTrip, currentMember, isOffline, sharedTripId]);

  const refreshSharedGallery = useCallback(async () => {
    setGalleryState(navigator.onLine ? "ready" : "offline");
  }, []);

  const refreshSharedItinerary = useCallback(async () => {
    if (!navigator.onLine) {
      setTripSyncState("offline");
      setSharedStateReady(true);
      return false;
    }

    setTripSyncState("loading");
    try {
      let trip = await getFirebaseTripState(accountTrip.id);
      if (!trip) {
        const seed = accountTrip.legacyDriveTripId
          ? await getSharedTrip(
              sharedTripId,
              { tripName: workspaceInitialName, days: workspaceInitialDays, members: workspaceInitialMembers },
            )
          : {
              tripId: accountTrip.id,
              tripName: workspaceInitialName,
              coverPhotoId: "",
              days: workspaceInitialDays,
              members: workspaceInitialMembers,
              revision: 1,
              updatedAt: new Date().toISOString(),
            };
        trip = await initializeFirebaseTripState(account, accountTrip, { ...seed, tripId: accountTrip.id });
      }
      const chronologicalTrip = normalizeSharedTripChronology(trip);
      lastSyncedTripRef.current = chronologicalTrip;
      lastSavedTripRef.current = sharedTripFingerprint(chronologicalTrip);
      setLastTripSavedAt(trip.updatedAt);
      window.localStorage.setItem(scopedStorageKey(lastTripSavedAtKey, sharedTripId), trip.updatedAt);

      const pending = pendingTripSaveRef.current;
      if (pending && pending.fingerprint !== lastSavedTripRef.current) {
        setHasPendingTripSave(true);
        setTripSyncState("unsaved");
      } else {
        if (pending) {
          pendingTripSaveRef.current = null;
          clearPendingTripSave(sharedTripId);
          setHasPendingTripSave(false);
        }
        setTripName(chronologicalTrip.tripName);
        setTripCoverPhotoId(chronologicalTrip.coverPhotoId || "");
        setDays(chronologicalTrip.days);
        setMembers(chronologicalTrip.members);
        setCurrentMemberId((current) => {
          if (chronologicalTrip.members.some((member) => member.id === current)) return current;
          return chronologicalTrip.members.find((member) => member.name.toLocaleLowerCase("en-AU") === accountTrip.memberName.toLocaleLowerCase("en-AU"))?.id
            || (accountTrip.legacyDriveTripId ? current : account.uid);
        });
        setSelectedDayId((current) => chronologicalTrip.days.some((day) => day.id === current) ? current : chronologicalTrip.days[0]?.id ?? "");
        setSelectedStopId((current) => chronologicalTrip.days.some((day) => day.stops.some((stop) => stop.id === current))
          ? current
          : chronologicalTrip.days[0]?.stops[0]?.id ?? "");
        setTripRevision(chronologicalTrip.revision);
        setTripSyncState("synced");
      }
      setSharedStateReady(true);
      setTripSyncError(null);
      return true;
    } catch (error) {
      setSharedStateReady(true);
      setTripSyncState("error");
      setTripSyncError(error instanceof Error ? error.message : "The shared itinerary could not be loaded.");
      return false;
    }
  }, [account, accountTrip, sharedTripId, workspaceInitialDays, workspaceInitialMembers, workspaceInitialName]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Capacitor" in window) {
      document.documentElement.classList.add("native-app");
    }

    let localDays = workspaceInitialDays;
    const itineraryStorageKey = scopedStorageKey(itineraryKey, sharedTripId);
    const tripNameStorageKey = scopedStorageKey(tripNameKey, sharedTripId);
    const saved = window.localStorage.getItem(itineraryStorageKey)
      || (sharedTripId === legacySharedTripId ? window.localStorage.getItem(itineraryKey) : null);
    if (saved) {
      try {
        localDays = JSON.parse(saved) as TripDay[];
      } catch {
        window.localStorage.removeItem(itineraryStorageKey);
      }
    }
    const localTripName = window.localStorage.getItem(tripNameStorageKey)
      || (sharedTripId === legacySharedTripId ? window.localStorage.getItem(tripNameKey) : null)
      || workspaceInitialName;
    const pending = readPendingTripSave(sharedTripId);
    const localTrip = normalizeSharedTripChronology(pending?.draft ?? {
      tripId: sharedTripId,
      tripName: localTripName,
      days: localDays,
      members: workspaceInitialMembers,
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
    setTripCoverPhotoId(localTrip.coverPhotoId || "");
    setDays(localTrip.days);
    setMembers(localTrip.members);
    setTripRevision(localTrip.revision);
    setLastTripSavedAt(window.localStorage.getItem(scopedStorageKey(lastTripSavedAtKey, sharedTripId))
      || (sharedTripId === legacySharedTripId ? window.localStorage.getItem(lastTripSavedAtKey) : null)
      || "");

    const savedTripId = window.localStorage.getItem(scopedStorageKey(tripIdKey, sharedTripId)) || "";
    if (savedTripId && savedTripId !== sharedTripId) setPreviousTripId(savedTripId);
    window.localStorage.setItem(scopedStorageKey(tripIdKey, sharedTripId), sharedTripId);

    const query = new URLSearchParams(window.location.search);
    const queryAdminSecret = query.get("admin")?.trim() || "";
    const queryMemberId = query.get("member")?.trim() || "";
    const queryTripAccessKey = query.get("key")?.trim() || "";
    const storedAdminSecret = window.localStorage.getItem(scopedStorageKey(adminKey, sharedTripId))
      || (sharedTripId === legacySharedTripId ? window.localStorage.getItem(adminKey) : null)
      || "";
    const storedMemberId = window.localStorage.getItem(scopedStorageKey(memberIdKey, sharedTripId))
      || (sharedTripId === legacySharedTripId ? window.localStorage.getItem(memberIdKey) : null)
      || "";
    const storedTripAccessKey = window.localStorage.getItem(scopedStorageKey(tripAccessKeyStorageKey, sharedTripId))
      || (sharedTripId === legacySharedTripId ? window.localStorage.getItem(tripAccessKeyStorageKey) : null)
      || "";
    const resolvedAdminSecret = queryAdminSecret || storedAdminSecret;
    const resolvedMemberId = queryAdminSecret
      ? queryMemberId || "grace"
      : storedMemberId || queryMemberId || (resolvedAdminSecret ? "grace" : accountTrip.legacyDriveTripId ? "" : account.uid);
    const resolvedTripAccessKey = queryTripAccessKey || storedTripAccessKey;
    if (queryAdminSecret) {
      window.localStorage.setItem(scopedStorageKey(adminKey, sharedTripId), queryAdminSecret);
    }
    if (resolvedMemberId) {
      window.localStorage.setItem(scopedStorageKey(memberIdKey, sharedTripId), resolvedMemberId);
    }
    if (queryTripAccessKey) {
      window.localStorage.setItem(scopedStorageKey(tripAccessKeyStorageKey, sharedTripId), queryTripAccessKey);
    }
    configureGoogleDriveGateway(resolvedTripAccessKey, accountTrip.id);
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
      const fingerprint = tripFingerprint(latest.tripName, latest.coverPhotoId, chronologicalDays, latest.members);
      const existing = pendingTripSaveRef.current;
      if ((fingerprint === lastSavedTripRef.current && !existing) || !lastSyncedTripRef.current) return;
      if (existing?.fingerprint === fingerprint) return;
      const pendingBeforeExit: PendingTripSave = {
        version: 1,
        fingerprint,
        queuedAt: new Date().toISOString(),
        draft: {
          tripId: sharedTripId,
          tripName: latest.tripName.trim() || workspaceInitialName,
          coverPhotoId: latest.coverPhotoId,
          days: chronologicalDays,
          members: latest.members,
          revision: latest.revision,
          updatedAt: new Date().toISOString(),
        },
        baseTrip: existing?.baseTrip ?? lastSyncedTripRef.current,
      };
      pendingTripSaveRef.current = pendingBeforeExit;
      writePendingTripSave(sharedTripId, pendingBeforeExit);
    };
    window.addEventListener("pagehide", preservePendingOnExit);

    if (navigator.onLine) {
      setGoogleState("connected");
    }
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
  }, [account.uid, accountTrip.id, accountTrip.legacyDriveTripId, refreshSharedItinerary, sharedTripId, workspaceInitialDays, workspaceInitialMembers, workspaceInitialName]);

  function connectPrivateInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvitationError("");

    try {
      const invitation = new URL(invitationLink.trim());
      const invitedAdminSecret = invitation.searchParams.get("admin")?.trim() || "";
      const invitedMemberId = invitation.searchParams.get("member")?.trim() || (invitedAdminSecret ? "grace" : "");
      const invitedAccessKey = invitation.searchParams.get("key")?.trim() || "";

      if (!invitedMemberId || !invitedAccessKey) {
        throw new Error("This does not look like a complete Family Trip invitation link.");
      }

      if (invitedAdminSecret) window.localStorage.setItem(scopedStorageKey(adminKey, sharedTripId), invitedAdminSecret);
      window.localStorage.setItem(scopedStorageKey(memberIdKey, sharedTripId), invitedMemberId);
      window.localStorage.setItem(scopedStorageKey(tripAccessKeyStorageKey, sharedTripId), invitedAccessKey);
      window.location.reload();
    } catch (error) {
      setInvitationError(error instanceof Error ? error.message : "That invitation link could not be opened.");
    }
  }

  useEffect(() => () => {
    galleryRequestRef.current += 1;
    sharedPhotoUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    sharedPhotoUrlsRef.current.clear();
    sharedPhotoBlobsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!hasLoadedLocalState) return;
    return observeFirebaseTripState(
      accountTrip.id,
      (remoteTrip, pendingLocalWrites) => {
        if (!remoteTrip) return;
        const chronologicalTrip = normalizeSharedTripChronology(remoteTrip);
        const remoteFingerprint = sharedTripFingerprint(chronologicalTrip);
        const pending = pendingTripSaveRef.current;
        if (pending && pending.fingerprint !== remoteFingerprint) {
          setHasPendingTripSave(true);
          setTripSyncState(isOffline ? "offline" : "unsaved");
          return;
        }

        if (pending) {
          pendingTripSaveRef.current = null;
          clearPendingTripSave(sharedTripId);
          setHasPendingTripSave(false);
        }
        lastSyncedTripRef.current = chronologicalTrip;
        lastSavedTripRef.current = remoteFingerprint;
        setTripName(chronologicalTrip.tripName);
        setTripCoverPhotoId(chronologicalTrip.coverPhotoId || "");
        setDays(chronologicalTrip.days);
        setMembers(chronologicalTrip.members);
        setTripRevision(chronologicalTrip.revision);
        setLastTripSavedAt(chronologicalTrip.updatedAt);
        window.localStorage.setItem(scopedStorageKey(lastTripSavedAtKey, sharedTripId), chronologicalTrip.updatedAt);
        setCurrentMemberId((current) => {
          if (chronologicalTrip.members.some((member) => member.id === current)) return current;
          return chronologicalTrip.members.find((member) => member.name.toLocaleLowerCase("en-AU") === accountTrip.memberName.toLocaleLowerCase("en-AU"))?.id
            || account.uid;
        });
        setSelectedDayId((current) => chronologicalTrip.days.some((day) => day.id === current) ? current : chronologicalTrip.days[0]?.id ?? "");
        setSelectedStopId((current) => chronologicalTrip.days.some((day) => day.stops.some((stop) => stop.id === current))
          ? current
          : chronologicalTrip.days[0]?.stops[0]?.id ?? "");
        setSharedStateReady(true);
        setTripSyncState(pendingLocalWrites ? "saving" : "synced");
        setTripSyncError(null);
      },
      (error) => {
        setSharedStateReady(true);
        setTripSyncState(pendingTripSaveRef.current ? "unsaved" : "error");
        setTripSyncError(`${error.message} ${pendingTripSaveRef.current ? "Your changes remain safe on this device." : ""}`.trim());
      },
    );
  }, [account.uid, accountTrip.id, accountTrip.memberName, hasLoadedLocalState, isOffline, sharedTripId]);

  useEffect(() => {
    if (tripCoverUrl || !accountTrip.coverThumbnailDataUrl) return;
    setTripCoverThumbnail(accountTrip.coverThumbnailDataUrl);
    setTripCoverPositionX(accountTrip.coverPositionX ?? 50);
    setTripCoverPositionY(accountTrip.coverPositionY ?? 50);
  }, [accountTrip.coverPositionX, accountTrip.coverPositionY, accountTrip.coverThumbnailDataUrl, tripCoverUrl]);

  useEffect(() => observeTripAccountMembers(accountTrip.id, setTripAccountMembers), [accountTrip.id]);

  useEffect(() => {
    if (!showOverview || !navigator.onLine) return;
    let cancelled = false;
    const parameters = new URLSearchParams({
      latitude: "48.2082",
      longitude: "16.3738",
      current: "temperature_2m,apparent_temperature,weather_code",
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      timezone: "Europe/Vienna",
      forecast_days: "16",
    });
    void fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`).then(async (response) => {
      if (!response.ok) throw new Error("Weather unavailable");
      return response.json() as Promise<{
        current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
        daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
      }>;
    }).then((forecast) => {
      if (cancelled) return;
      const today = viennaDateKey();
      const isTripToday = days.some((day) => day.date === today);
      if (isTripToday && Number.isFinite(forecast.current?.temperature_2m)) {
        const condition = weatherDescription(Number(forecast.current?.weather_code ?? 3));
        setViennaWeather({
          kind: "current",
          heading: `${Math.round(forecast.current!.temperature_2m!)}°C · ${condition.label}`,
          detail: `Feels like ${Math.round(forecast.current?.apparent_temperature ?? forecast.current!.temperature_2m!)}°C in Vienna now.`,
          icon: condition.icon,
        });
        return;
      }
      const nextTripDate = [...days].map((day) => day.date).filter((date) => date >= today).sort()[0];
      const index = nextTripDate ? forecast.daily?.time?.indexOf(nextTripDate) ?? -1 : -1;
      if (index >= 0) {
        const condition = weatherDescription(Number(forecast.daily?.weather_code?.[index] ?? 3));
        setViennaWeather({
          kind: "forecast",
          heading: `${Math.round(forecast.daily?.temperature_2m_max?.[index] ?? 0)}° / ${Math.round(forecast.daily?.temperature_2m_min?.[index] ?? 0)}°C`,
          detail: `${condition.label} forecast for the next trip day in Vienna.`,
          icon: condition.icon,
        });
      } else setViennaWeather(null);
    }).catch(() => { if (!cancelled) setViennaWeather(null); });
    return () => { cancelled = true; };
  }, [days, showOverview]);

  useEffect(() => {
    if (!hasLoadedLocalState || !accountTrip.id) return;
    setGalleryState(navigator.onLine ? "loading" : "offline");
    return observeTripMedia(accountTrip.id, (items) => {
      setSharedPhotos(items);
      setSharedPhotoUrls(Object.fromEntries(items.map((item) => [item.fileId, item.thumbnailUrl || item.downloadUrl])));
      sharedPhotoUrlsRef.current = new Map(items.map((item) => [item.fileId, item.downloadUrl]));
      setGalleryState(navigator.onLine ? "ready" : "offline");
      setGoogleState(navigator.onLine ? "connected" : "disconnected");
      setGalleryError(null);
    }, (cause) => {
      setGalleryState(navigator.onLine ? "error" : "offline");
      setGalleryError(cause.message);
    });
  }, [accountTrip.id, hasLoadedLocalState]);

  useEffect(() => {
    if (!hasLoadedLocalState) return;
    window.localStorage.setItem(scopedStorageKey(itineraryKey, sharedTripId), JSON.stringify(days));
  }, [days, hasLoadedLocalState, sharedTripId]);

  useEffect(() => {
    if (!hasLoadedLocalState) return;
    window.localStorage.setItem(scopedStorageKey(tripNameKey, sharedTripId), tripName);
  }, [tripName, hasLoadedLocalState, sharedTripId]);

  useEffect(() => {
    if (!hasLoadedLocalState || !currentMemberId) return;
    window.localStorage.setItem(scopedStorageKey(memberIdKey, sharedTripId), currentMemberId);
  }, [currentMemberId, hasLoadedLocalState, sharedTripId]);

  useEffect(() => {
    if (!hasLoadedLocalState || !sharedStateReady || !currentMember || !lastSyncedTripRef.current) return;
    const fingerprint = tripFingerprint(tripName, tripCoverPhotoId, days, members);
    const existingPending = pendingTripSaveRef.current;
    if (fingerprint === lastSavedTripRef.current && !existingPending) {
      setHasPendingTripSave(false);
      return;
    }

    if (!existingPending || existingPending.fingerprint !== fingerprint) {
      const draft: SharedTripState = {
        tripId: sharedTripId,
        tripName: tripName.trim() || workspaceInitialName,
        coverPhotoId: tripCoverPhotoId,
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
      writePendingTripSave(sharedTripId, pending);
    }

    setHasPendingTripSave(true);
    setTripSyncState(isOffline ? "offline" : "unsaved");
    if (isOffline || !navigator.onLine) return;

    const timeoutId = window.setTimeout(() => {
      void processPendingTripSave();
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [currentMember, days, hasLoadedLocalState, isOffline, members, processPendingTripSave, sharedStateReady, sharedTripId, tripCoverPhotoId, tripName, tripRevision, workspaceInitialName]);

  const selectedDay = useMemo(
    () => days.find((day) => day.id === selectedDayId) ?? days[0],
    [days, selectedDayId],
  );

  const selectedStop = useMemo(
    () => selectedDay?.stops.find((stop) => stop.id === selectedStopId),
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
  const documentRows = useMemo(() => days.flatMap((day, dayIndex) =>
    day.stops.flatMap((stop, stopIndex) => (stop.documents ?? []).map((document) => ({ day, dayIndex, stop, stopIndex, document })))),
  [days]);
  const expenseFilterCategories = useMemo(
    () => Array.from(new Set(expenseRows.map(({ expense }) => expense.category))).sort(),
    [expenseRows],
  );
  const filteredExpenseRows = useMemo(() => expenseRows.filter(({ day, expense }) =>
    (!expensePersonFilter || expense.memberId === expensePersonFilter) &&
    (!expenseDayFilter || day.id === expenseDayFilter) &&
    (!expenseCategoryFilter || expense.category === expenseCategoryFilter),
  ), [expenseCategoryFilter, expenseDayFilter, expensePersonFilter, expenseRows]);
  const downloadDay = useMemo(() => days.find((day) => day.id === downloadDayId), [days, downloadDayId]);
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
  const tripCountdown = useMemo(() => {
    const datedDays = [...days].filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)).sort((left, right) => left.date.localeCompare(right.date));
    if (!datedDays.length) return { kind: "unknown" as const, value: "—", label: "Add trip dates" };
    const today = viennaDateKey();
    const todayDay = datedDays.find((day) => day.date === today);
    if (todayDay) return { kind: "today" as const, value: "TODAY", label: todayDay.label };
    if (today < datedDays[0].date) {
      const [todayYear, todayMonth, todayDate] = today.split("-").map(Number);
      const [startYear, startMonth, startDate] = datedDays[0].date.split("-").map(Number);
      const count = Math.max(0, Math.round((Date.UTC(startYear, startMonth - 1, startDate) - Date.UTC(todayYear, todayMonth - 1, todayDate)) / 86_400_000));
      return { kind: "countdown" as const, value: String(count), label: count === 1 ? "day to go!" : "days to go!" };
    }
    if (today > datedDays[datedDays.length - 1].date) return { kind: "complete" as const, value: "HOME", label: "Time to relive the memories" };
    return { kind: "travelling" as const, value: "AWAY", label: "The adventure continues" };
  }, [days]);
  const tripSpendAud = useMemo(() => expenseRows.reduce((total, { expense }) => total + (expense.homeAmount ?? 0), 0), [expenseRows]);


  const selectedPhotos = queuedPhotos.filter((photo) => photo.stopId === selectedStop?.id);
  const selectedSharedPhotos = sharedPhotos.filter((photo) => photo.stopId === selectedStop?.id);
  const selectedLocalMediaIds = new Set(selectedPhotos.map((photo) => photo.firebaseMediaId).filter(Boolean));
  const sharedOnlyPhotos = selectedSharedPhotos.filter((photo) => !selectedLocalMediaIds.has(photo.fileId));
  const previewQueuedPhoto = queuedPhotos.find((photo) => photo.id === previewQueuedPhotoId) ?? null;
  const previewSharedMedia = sharedPhotos.find((photo) => photo.fileId === previewSharedMediaId) ?? null;
  const pendingQueuePhotos = queuedPhotos.filter(
    (photo) =>
      (!photo.isPrivate && photo.status !== "uploaded") ||
      photo.pendingCloudDeletion,
  );
  const waitingCount = pendingQueuePhotos.length;
  const uploadProgressPercent = uploadProgress?.total
    ? Math.round((uploadProgress.completed / uploadProgress.total) * 100)
    : 0;
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
    setPlaceSearchTarget(null);
    setPlaceSearchDraft("");
  }

  function beginPlaceSearch(dayId: string, stopId: string, savedPlace: string) {
    const sameTarget = placeSearchTarget?.dayId === dayId && placeSearchTarget.stopId === stopId;
    if (sameTarget) return;
    clearPlaceSearch();
    setPlaceSearchTarget({ dayId, stopId });
    setPlaceSearchDraft(savedPlace);
  }

  function locationInputValue(dayId: string, stopId: string, savedPlace: string) {
    return placeSearchTarget?.dayId === dayId && placeSearchTarget.stopId === stopId
      ? placeSearchDraft
      : savedPlace;
  }

  function hasLocationDraftChange(dayId: string, stopId: string, savedPlace: string) {
    return placeSearchTarget?.dayId === dayId
      && placeSearchTarget.stopId === stopId
      && placeSearchDraft.trim() !== savedPlace.trim();
  }

  function selectStop(stopId: string) {
    clearPlaceSearch();
    setDocumentsExpanded(false);
    setDocumentNavigationTarget(null);
    setSelectedStopId(stopId);
  }

  function selectDay(day: TripDay) {
    clearPlaceSearch();
    setSelectedDayId(day.id);
    setSelectedStopId("");
  }

  function goToDocumentStop(dayId: string, stopId: string, documentId: string) {
    clearPlaceSearch();
    setItineraryView("itinerary");
    setSelectedDayId(dayId);
    setSelectedStopId(stopId);
    setDocumentsExpanded(true);
    setDocumentNavigationTarget({ stopId, documentId });
    setActiveTab("itinerary");
  }

  useEffect(() => {
    if (!documentNavigationTarget || activeTab !== "itinerary" || !inlineStopContainer) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`itinerary-stop-${documentNavigationTarget.stopId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const timer = window.setTimeout(() => setDocumentNavigationTarget(null), 2400);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [activeTab, documentNavigationTarget, inlineStopContainer]);

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
      firebaseMediaId: null,
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

  async function saveBlobToPhotos(blob: Blob, name: string, mimeType: string) {
    const file = new File([blob], name, { type: mimeType || blob.type || "application/octet-stream" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveQueuedMemoryToPhotos(photo: QueuedPhotoView) {
    setQueueError(null);
    try {
      const record = await getQueuedPhoto(photo.id);
      if (!record) throw new Error("This temporary copy is no longer on this device.");
      await saveBlobToPhotos(record.blob, record.name, record.mimeType);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setQueueError(error instanceof Error ? error.message : "This memory could not be opened in the Share Sheet.");
    }
  }

  async function saveSharedMemoryToPhotos(media: TripMedia) {
    setQueueError(null);
    try {
      const response = await fetch(media.downloadUrl);
      if (!response.ok) throw new Error("The shared original could not be downloaded.");
      await saveBlobToPhotos(await response.blob(), media.name, media.mimeType);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setQueueError(error instanceof Error ? error.message : "This memory could not be opened in the Share Sheet.");
    }
  }

  async function handleCoverSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !isAdmin) return;
    if (!navigator.onLine) {
      setCoverUploadState("error");
      setCoverUploadError("Connect to the internet before changing the shared trip cover.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setCoverUploadState("error");
      setCoverUploadError("Choose a photo file for the trip cover.");
      return;
    }
    setCoverUploadState("uploading");
    setCoverUploadError(null);
    const previewUrl = URL.createObjectURL(file);
    if (tripCoverUrlRef.current) URL.revokeObjectURL(tripCoverUrlRef.current);
    tripCoverUrlRef.current = previewUrl;
    setTripCoverUrl(previewUrl);
    try {
      const thumbnail = await coverThumbnail(file);
      setTripCoverPhotoId("");
      setTripCoverThumbnail(thumbnail);
      setTripCoverPositionX(50);
      setTripCoverPositionY(50);
      await updateTripCoverPresentation(account, accountTrip, { coverThumbnailDataUrl: thumbnail, coverPositionX: 50, coverPositionY: 50 });
      setCoverUploadState("idle");
    } catch (error) {
      setCoverUploadState("error");
      setCoverUploadError(error instanceof Error ? error.message : "The cover photo could not be uploaded.");
    }
  }

  async function saveCoverPosition() {
    if (!isAdmin) return;
    setCoverUploadState("uploading"); setCoverUploadError(null);
    try {
      await updateTripCoverPresentation(account, accountTrip, { coverThumbnailDataUrl: tripCoverThumbnail || undefined, coverPositionX: tripCoverPositionX, coverPositionY: tripCoverPositionY });
      setCoverUploadState("idle");
    } catch (error) {
      setCoverUploadState("error");
      setCoverUploadError(error instanceof Error ? error.message : "The cover position could not be saved.");
    }
  }

  async function makeTripAdmin(member: TripAccountMember) {
    if (!isAdmin || member.role === "admin") return;
    setAdminUpdateUid(member.userId);
    setAdminUpdateError("");
    try {
      await promoteTripMemberToAdmin(account, accountTrip, member);
    } catch (error) {
      setAdminUpdateError(error instanceof Error ? error.message : "That person could not be made an admin.");
    } finally {
      setAdminUpdateUid("");
    }
  }

  function openDeleteTripConfirmation() {
    setShowSettings(false);
    setDeleteTripConfirmation("");
    setDeleteTripError("");
    setDeleteTripState("idle");
    setShowDeleteTripConfirm(true);
  }

  async function deleteTripForEveryone() {
    if (!isAdmin || deleteTripConfirmation.trim() !== tripName.trim()) return;
    setDeleteTripState("deleting");
    setDeleteTripError("");
    try {
      await deleteAccountTrip(account, accountTrip);
      [itineraryKey, tripNameKey, tripIdKey, adminKey, memberIdKey, tripAccessKeyStorageKey, pendingTripSaveKey, lastTripSavedAtKey]
        .forEach((key) => window.localStorage.removeItem(scopedStorageKey(key, sharedTripId)));
      setShowDeleteTripConfirm(false);
      onBackToTrips();
    } catch (error) {
      setDeleteTripState("error");
      setDeleteTripError(error instanceof Error ? error.message : "The trip could not be deleted. Please try again.");
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

  function scheduleSavedPlace(place: SavedPlace, dayId: string, time: string) {
    if (!currentMember) return;
    const stop: TripStop = {
      id: crypto.randomUUID(),
      time,
      title: place.name,
      place: place.location,
      note: place.note,
    };
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === dayId
      ? { ...day, stops: [...day.stops, stop] }
      : day)));
    setSelectedDayId(dayId);
    selectStop(stop.id);
    setActiveTab("itinerary");
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
    updateStopInDay(selectedDay.id, selectedStop.id, changes);
  }

  function updateStopInDay(dayId: string, stopId: string, changes: Partial<TripStop>) {
    if (!currentMember) return;
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === dayId
      ? { ...day, stops: day.stops.map((stop) => stop.id === stopId ? { ...stop, ...changes } : stop) }
      : day)));
  }

  function saveStopMemory(dayId: string, stopId: string, comment: string) {
    if (!currentMember) return;
    const now = new Date().toISOString();
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === dayId ? {
      ...day,
      stops: day.stops.map((stop) => {
        if (stop.id !== stopId) return stop;
        const entries = stop.memory?.entries ?? [];
        return { ...stop, memory: comment || entries.length > 0 ? {
          comment,
          entries,
          updatedByMemberId: currentMember.id,
          updatedByMemberName: currentMember.name,
          updatedAt: now,
        } : undefined };
      }),
    } : day)));
  }

  function addScrapbookEntry(dayId: string, stopId: string, entry: Omit<TripScrapbookEntry, "id" | "memberId" | "memberName" | "createdAt" | "updatedAt">) {
    if (!currentMember) return;
    const now = new Date().toISOString();
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === dayId ? {
      ...day,
      stops: day.stops.map((stop) => {
        if (stop.id !== stopId) return stop;
        const memory = stop.memory ?? {
          comment: "",
          updatedByMemberId: currentMember.id,
          updatedByMemberName: currentMember.name,
          updatedAt: now,
        };
        return { ...stop, memory: {
          ...memory,
          entries: [...(memory.entries ?? []), {
            ...entry,
            id: `scrap-${crypto.randomUUID()}`,
            memberId: currentMember.id,
            memberName: currentMember.name,
            createdAt: now,
            updatedAt: now,
          }],
          updatedByMemberId: currentMember.id,
          updatedByMemberName: currentMember.name,
          updatedAt: now,
        } };
      }),
    } : day)));
  }

  function deleteScrapbookEntry(dayId: string, stopId: string, entryId: string) {
    if (!currentMember) return;
    updateStopInDay(dayId, stopId, {
      memory: (() => {
        const stop = days.find((day) => day.id === dayId)?.stops.find((item) => item.id === stopId);
        if (!stop?.memory) return undefined;
        return { ...stop.memory, entries: (stop.memory.entries ?? []).filter((entry) => entry.id !== entryId), updatedAt: new Date().toISOString() };
      })(),
    });
  }

  function updateMemoryMapPhotos(dayId: string, stopId: string, photoIds: string[]) {
    if (!currentMember) return;
    const now = new Date().toISOString();
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === dayId ? {
      ...day,
      stops: day.stops.map((stop) => stop.id === stopId ? { ...stop, memory: {
        ...(stop.memory ?? { comment: "", entries: [] }),
        mapPhotoIds: photoIds.slice(0, 4),
        updatedByMemberId: currentMember.id,
        updatedByMemberName: currentMember.name,
        updatedAt: now,
      } } : stop),
    } : day)));
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
      const conversion = await getLatestExchangeRate(newExpenseLocalCurrency, account.homeCurrency);
      exchangeRate = conversion.rate;
      exchangeRateDate = conversion.date;
      homeAmount = convertedAmount(localAmount, conversion.rate);
    } catch {
      setExpenseConversionError(`Expense saved in its local currency, but ${account.homeCurrency} conversion is waiting. Use Refresh conversions from the Expenses tab when online.`);
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
      homeCurrency: account.homeCurrency,
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
        const conversion = await getLatestExchangeRate(currency, account.homeCurrency);
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
              homeCurrency: account.homeCurrency,
              exchangeRate: conversion.rate,
              exchangeRateDate: conversion.date,
            } : expense;
          }),
        })),
      })));
    } catch {
      setExpenseConversionError(`${account.homeCurrency} conversion is temporarily unavailable. Local amounts remain saved and unchanged.`);
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
      const conversion = await getLatestExchangeRate(expenseEditDraft.localCurrency, account.homeCurrency);
      exchangeRate = conversion.rate;
      exchangeRateDate = conversion.date;
      homeAmount = convertedAmount(localAmount, conversion.rate);
    } catch {
      setExpenseConversionError(`Expense updated in its local currency, but ${account.homeCurrency} conversion is waiting. Use Refresh conversions from the Expenses tab when online.`);
    }

    updateSelectedStop({
      expenses: (selectedStop.expenses ?? []).map((expense) => expense.id === expenseId ? {
        ...expense,
        item,
        category: expenseEditDraft.category,
        localAmount,
        localCurrency: expenseEditDraft.localCurrency,
        homeAmount,
        homeCurrency: account.homeCurrency,
        exchangeRate,
        exchangeRateDate,
      } : expense),
    });
    setEditingExpenseId(null);
    setExpenseConversionState("idle");
  }

  function handleLocationChange(value: string) {
    if (!currentMember || !selectedStop) return;
    handleLocationChangeForStop(selectedStop.id, value);
  }

  function focusMemoryLocation(dayId: string, stopId: string) {
    const stop = days.find((day) => day.id === dayId)?.stops.find((candidate) => candidate.id === stopId);
    setSelectedDayId(dayId);
    setSelectedStopId(stopId);
    beginPlaceSearch(dayId, stopId, stop?.place ?? "");
  }

  function handleLocationChangeForStop(stopId: string, value: string, dayId = selectedDay?.id) {
    if (!currentMember || !dayId) return;
    if (dayId) setSelectedDayId(dayId);
    setSelectedStopId(stopId);
    setPlaceSearchTarget({ dayId, stopId });
    setPlaceSearchDraft(value);
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
      void searchMapboxPlaces(value.trim(), placeSessionTokenRef.current)
        .then((suggestions) => {
          if (placeSearchRequestRef.current !== requestNumber) return;
          setPlaceSuggestions(suggestions);
          setPlaceSearchState("idle");
        })
        .catch((error: unknown) => {
          if (placeSearchRequestRef.current !== requestNumber) return;
          setPlaceSuggestions([]);
          setPlaceSearchState("idle");
          setPlaceSearchError(error instanceof Error ? error.message : "Mapbox suggestions are unavailable. You can keep typing the location manually.");
        });
    }, 325);
  }

  async function choosePlace(suggestion: PlaceSuggestion) {
    if (!currentMember || !placeSearchTarget) return;
    const target = placeSearchTarget;
    const requestNumber = ++placeSearchRequestRef.current;
    setPlaceSearchState("choosing");
    setPlaceSearchError(null);
    try {
      const place = await getMapboxPlace(suggestion.placeId, placeSessionTokenRef.current);
      if (placeSearchRequestRef.current !== requestNumber) return;
      updateStopInDay(target.dayId, target.stopId, {
        place: place.name || suggestion.text || place.address,
        placeId: place.placeId,
        latitude: place.latitude ?? undefined,
        longitude: place.longitude ?? undefined,
        googleMapsUrl: place.mapUrl || undefined,
      });
      clearPlaceSearch();
    } catch (error) {
      if (placeSearchRequestRef.current !== requestNumber) return;
      setPlaceSearchError(error instanceof Error ? error.message : "That Mapbox location could not be saved. You can keep the location as typed.");
    } finally {
      if (placeSearchRequestRef.current === requestNumber) setPlaceSearchState("idle");
    }
  }

  function confirmTypedLocation(dayId: string, stopId: string) {
    if (!currentMember || placeSearchTarget?.dayId !== dayId || placeSearchTarget.stopId !== stopId) return;
    updateStopInDay(dayId, stopId, {
      place: placeSearchDraft.trim(),
      placeId: undefined,
      latitude: undefined,
      longitude: undefined,
      googleMapsUrl: undefined,
    });
    clearPlaceSearch();
  }

  function openEditDayDetails() {
    if (!currentMember || !selectedDay) return;
    setEditDayName(selectedDay.label);
    setEditDayDate(selectedDay.date);
    setEditDayStoryTitle(selectedDay.storyTitle ?? "");
    setShowEditDay(true);
  }

  function saveDayDetails() {
    if (!currentMember || !selectedDay || !editDayDate || (isAdmin && !editDayName.trim())) return;
    const selectedDayId = selectedDay.id;
    setDays((current) => sortItineraryChronologically(current.map((day) => day.id === selectedDayId ? {
      ...day,
      date: editDayDate,
      label: isAdmin ? editDayName.trim() : day.label,
      storyTitle: editDayStoryTitle.trim(),
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

  function updateDayStory(dayId: string, changes: Partial<Pick<TripDay, "storyTitle" | "coverPhotoId">>) {
    if (!currentMember) return;
    setDays((current) => current.map((day) => day.id === dayId ? { ...day, ...changes } : day));
  }

  function deleteSelectedStop() {
    if (!currentMember || !selectedDay || !selectedStop) return;
    const localPhotoCount = queuedPhotos.filter((photo) => photo.stopId === selectedStop.id).length;
    const warning = localPhotoCount > 0
      ? `This stop has ${localPhotoCount} ${localPhotoCount === 1 ? "memory" : "memories"} on this device. Apple Photos and shared gallery copies will remain, but they will no longer be assigned in the itinerary. Delete the stop?`
      : "Delete this stop from the shared itinerary? Originals in Apple Photos and shared gallery copies will not be deleted.";
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
    const pendingCloudDeletion = isPrivate && photo.status === "uploaded" && Boolean(photo.firebaseMediaId);
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
      if (!photo.firebaseMediaId) {
        await deletePhotoLocally(photoId);
        return;
      }

      if (navigator.onLine) {
        try {
          const shared = sharedPhotos.find((item) => item.fileId === photo.firebaseMediaId);
          if (shared) await deleteTripMedia(accountTrip.id, shared);
          await deletePhotoLocally(photoId);
          return;
        } catch {
          // Preserve the record below so cloud deletion can be retried safely.
        }
      }

      await savePhotoChanges(photoId, {
        isPrivate: true,
        pendingCloudDeletion: true,
        pendingLocalRemoval: true,
        status: "needsAttention",
        lastError: navigator.onLine
          ? "Shared gallery removal will be retried the next time you tap Upload now."
          : "Shared gallery removal is waiting for an internet connection.",
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
      setGoogleError("Connect to the internet before checking the shared gallery.");
      return;
    }
    setGoogleError(null);
    setGoogleState("connected");
    setShowSettings(false);
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

  async function handleDocumentSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selectedDay || !selectedStop || !currentMember || files.length === 0) return;
    if (!navigator.onLine) {
      setDocumentError("Documents need an internet connection to upload. The original files have not been changed.");
      return;
    }
    const oversized = files.find((file) => file.size > 15 * 1024 * 1024);
    if (oversized) {
      setDocumentError(`${oversized.name} is larger than the current 15 MB document limit.`);
      return;
    }
    const location = driveLocationForStop(selectedStop.id, currentMember.id, currentMember.name);
    if (!location) {
      setDocumentError("This stop is still loading. Please try the document again in a moment.");
      return;
    }

    setDocumentUploadState("uploading");
    setDocumentError(null);
    setDocumentProgress({ completed: 0, total: files.length });
    const uploaded: TripDocument[] = [];
    try {
      for (const file of files) {
        const id = crypto.randomUUID();
        const fileId = await uploadDocumentToDrive(location, file, id);
        uploaded.push({
          id,
          fileId,
          name: file.name || "Trip document",
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          memberId: currentMember.id,
          memberName: currentMember.name,
          createdAt: new Date().toISOString(),
        });
        setDocumentProgress({ completed: uploaded.length, total: files.length });
      }
      updateStopInDay(selectedDay.id, selectedStop.id, { documents: [...(selectedStop.documents ?? []), ...uploaded] });
    } catch (error) {
      if (uploaded.length > 0) updateStopInDay(selectedDay.id, selectedStop.id, { documents: [...(selectedStop.documents ?? []), ...uploaded] });
      setDocumentError(error instanceof Error ? error.message : "The document could not be uploaded.");
    } finally {
      setDocumentUploadState("idle");
    }
  }

  async function viewDocument(document: TripDocument) {
    setDocumentError(null);
    setDocumentPreviewLoading(document);
    try {
      const { blob, name } = await getSharedFileBlob(tripId, document.fileId);
      const url = URL.createObjectURL(blob);
      setDocumentPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { document, url, blob, name: name || document.name };
      });
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : "The document could not be opened.");
    } finally {
      setDocumentPreviewLoading(null);
    }
  }

  function closeDocumentPreview() {
    setDocumentPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function shareDocument(document: TripDocument) {
    setDocumentError(null);
    try {
      const loaded = documentPreview?.document.id === document.id
        ? { blob: documentPreview.blob, name: documentPreview.name }
        : await getSharedFileBlob(tripId, document.fileId);
      const file = new File([loaded.blob], loaded.name || document.name, { type: document.mimeType || loaded.blob.type });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: document.name });
        return;
      }
      const url = URL.createObjectURL(loaded.blob);
      const link = window.document.createElement("a");
      link.href = url; link.download = document.name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDocumentError(error instanceof Error ? error.message : "The document could not be shared.");
    }
  }

  async function removeDocument(dayId: string, stopId: string, document: TripDocument) {
    if (!currentMember || (!isAdmin && document.memberId !== currentMember.id)) return;
    if (!window.confirm(`Delete ${document.name} from this trip?`)) return;
    setDocumentError(null);
    try {
      await deleteDriveFile(tripId, document.fileId, previousTripId || undefined);
      const stop = days.find((day) => day.id === dayId)?.stops.find((item) => item.id === stopId);
      updateStopInDay(dayId, stopId, { documents: (stop?.documents ?? []).filter((item) => item.id !== document.id) });
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : "The document could not be deleted.");
    }
  }

  async function uploadQueuedPhotos(stopId?: string) {
    if (!navigator.onLine) {
      setGoogleError("You are offline. Your photos and videos will remain safely queued.");
      return;
    }
    if (!tripId) {
      setGoogleError("The trip is still loading. Try again in a moment.");
      return;
    }
    if (!currentMember) {
      setGoogleError("Choose your family profile before sharing memories.");
      setShowSettings(true);
      return;
    }

    setGoogleState("uploading");
    setGoogleError(null);
    setUploadProgress(null);

    try {
      for (const photo of queuedPhotos.filter((item) => item.pendingCloudDeletion && item.firebaseMediaId)) {
        try {
          const shared = sharedPhotos.find((item) => item.fileId === photo.firebaseMediaId);
          if (shared) await deleteTripMedia(accountTrip.id, shared);
          if (photo.pendingLocalRemoval) {
            await deletePhotoLocally(photo.id);
            continue;
          }
          await savePhotoChanges(photo.id, {
            pendingCloudDeletion: false,
            pendingLocalRemoval: false,
            firebaseMediaId: null,
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

      const uploadCandidates = queuedPhotos.filter(
        (photo) =>
          !photo.isPrivate &&
          !photo.pendingCloudDeletion &&
          photo.status !== "uploaded" &&
          (!stopId || photo.stopId === stopId),
      );
      setUploadProgress({ completed: 0, total: uploadCandidates.length });
      const finishUploadProgress = () => setUploadProgress((current) => current
        ? { ...current, completed: Math.min(current.completed + 1, current.total) }
        : current);

      const uploadOnePhoto = async (queuedPhoto: QueuedPhotoView) => {
        const record = await getQueuedPhoto(queuedPhoto.id);
        if (!record || record.isPrivate) {
          finishUploadProgress();
          return;
        }
        const location = driveLocationForStop(record.stopId, record.memberId, record.memberName);
        if (!location) {
          await savePhotoChanges(record.id, {
            status: "needsAttention",
            lastError: "This photo no longer has a matching day and location.",
          });
          finishUploadProgress();
          return;
        }

        let uploaded = false;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await savePhotoChanges(record.id, {
            status: "uploading",
            uploadAttempts: attempt,
            lastError: null,
          });

          try {
            const uploadedMedia = await uploadTripMedia(
              account,
              accountTrip.id,
              record,
              { dayId: location.dayId, stopId: location.stopId },
            );
            await savePhotoChanges(record.id, {
              status: "uploaded",
              uploadAttempts: attempt,
              lastError: null,
              firebaseMediaId: uploadedMedia.fileId,
              googleDriveFileId: null,
            });
            uploaded = true;
            break;
          } catch (error) {
            if (attempt === 3) {
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

        finishUploadProgress();
        return uploaded;
      };

      let uploadFailures = 0;
      for (let start = 0; start < uploadCandidates.length; start += 2) {
        const results = await Promise.all(uploadCandidates.slice(start, start + 2).map(uploadOnePhoto));
        uploadFailures += results.filter((uploaded) => uploaded !== true).length;
      }

      setGoogleState("connected");
      if (uploadFailures > 0) {
        setGoogleError(
          `${uploadFailures} ${uploadFailures === 1 ? "memory" : "memories"} could not be uploaded after three attempts. The originals remain safe in Apple Photos; tap Upload now to retry.`,
        );
      }
      if (activeTab === "gallery" || activeTab === "memory") void refreshSharedGallery();
      await refreshStorageHealth();
    } catch (error) {
      setGoogleState("disconnected");
      setGoogleError(error instanceof Error ? error.message : "Shared gallery sync failed.");
    } finally {
      window.setTimeout(() => setUploadProgress(null), 1200);
    }
  }

  function openDayDownload(day: TripDay) {
    const stopIdsWithPhotos = day.stops
      .filter((stop) => sharedPhotos.some((photo) => photo.dayId === day.id && photo.stopId === stop.id))
      .map((stop) => stop.id);
    setDownloadDayId(day.id);
    setSelectedDownloadStopIds(stopIdsWithPhotos);
    setBulkDownloadError(null);
  }

  function toggleDownloadStop(stopId: string) {
    setSelectedDownloadStopIds((current) => current.includes(stopId)
      ? current.filter((id) => id !== stopId)
      : [...current, stopId]);
  }

  async function shareSelectedStops() {
    if (!downloadDay || selectedDownloadStopIds.length === 0) return;
    const photos = sharedPhotos.filter((photo) =>
      photo.dayId === downloadDay.id && selectedDownloadStopIds.includes(photo.stopId),
    );
    if (photos.length === 0) return;

    const files = photos.map((photo) => {
      const blob = sharedPhotoBlobsRef.current.get(photo.fileId);
      return blob ? new File([blob], photo.name, { type: blob.type || "image/jpeg" }) : null;
    });
    if (files.some((file) => file === null)) {
      setBulkDownloadError("Some selected photos are still loading. Wait for the gallery to finish, then open the Share Sheet again.");
      void refreshSharedGallery();
      return;
    }

    setBulkDownloadState("downloading");
    setBulkDownloadError(null);
    try {
      const shareFiles = files.filter((file): file is File => file !== null);
      if (navigator.share && navigator.canShare?.({ files: shareFiles })) {
        await navigator.share({
          files: shareFiles,
          title: `${tripName} · ${downloadDay.label}`,
        });
      } else {
        photos.forEach((photo) => {
          const url = sharedPhotoUrlsRef.current.get(photo.fileId);
          if (!url) return;
          const link = document.createElement("a");
          link.href = url;
          link.download = photo.name;
          document.body.appendChild(link);
          link.click();
          link.remove();
        });
      }
      setDownloadDayId("");
      setSelectedDownloadStopIds([]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setBulkDownloadError(error instanceof Error ? error.message : "The selected photos could not be shared.");
    } finally {
      setBulkDownloadState("idle");
    }
  }

  return (
    <main className="app-shell">
      <header
        className={`topbar adventure-hero ${tripCoverDisplayUrl ? "has-trip-cover" : ""}`}
        style={tripCoverDisplayUrl ? { backgroundImage: `linear-gradient(90deg, rgba(255,250,241,.88) 0%, rgba(255,250,241,.68) 45%, rgba(255,250,241,.18) 82%), url(${tripCoverDisplayUrl})`, backgroundPosition: `center, ${tripCoverPositionX}% ${tripCoverPositionY}%` } : undefined}
      >
        <div className="hero-copy">
          <button className="back-to-trips" onClick={onBackToTrips} aria-label="Back to My Adventures">← My Adventures</button>
          <p className="eyebrow">Our next adventure</p>
          <input
            className="trip-title-input"
            value={tripName}
            onChange={(event) => setTripName(event.target.value)}
            aria-label="Trip name"
            readOnly={!isAdmin}
          />
          <div className="trip-meta-row">
            <p className="shared-role">
              {currentMember?.name || "Choose profile"} · {isAdmin ? "Admin" : "Contributor"} · {tripSyncLabel}
            </p>
            <div className="trip-meta-actions">
              <button className="overview-button" aria-label="Open trip overview" onClick={() => setShowOverview(true)}><AppIcon name="overview" /> Overview</button>
              {isAdmin && <button className="settings-button" aria-label="Open trip settings" onClick={() => setShowSettings(true)}><AppIcon name="settings" /> Trip Settings</button>}
            </div>
          </div>
        </div>
      </header>

      <section className="adventure-shortcuts" aria-label="Adventure sections">
        <button className="shortcut-card itinerary-shortcut" onClick={() => setActiveTab("itinerary")}><span><AppIcon name="calendar" /></span><strong>Itinerary</strong><small>Plan the adventure</small><b aria-hidden="true">›</b></button>
        <button className="shortcut-card stops-shortcut" onClick={() => setActiveTab("stops")}><span><AppIcon name="pin" /></span><strong>Saved Places</strong><small>Dream and vote</small><b aria-hidden="true">›</b></button>
        <button className="shortcut-card gallery-shortcut" onClick={() => setActiveTab("gallery")}><span><AppIcon name="camera" /></span><strong>Photo Gallery</strong><small>Our snapshots</small><b aria-hidden="true">›</b></button>
        <button className="shortcut-card expenses-shortcut" onClick={() => setActiveTab("expenses")}><span><AppIcon name="receipt" /></span><strong>Expenses</strong><small>The practical bit</small><b aria-hidden="true">›</b></button>
        <button className="shortcut-card memory-shortcut" onClick={() => setActiveTab("memory")}><span><AppIcon name="heart" /></span><strong>Memory Lane</strong><small>Relive the story</small><b aria-hidden="true">›</b></button>
      </section>

      <nav className="primary-tabs" aria-label="App sections">
        <button
          className={activeTab === "itinerary" ? "active" : ""}
          aria-current={activeTab === "itinerary" ? "page" : undefined}
          onClick={() => setActiveTab("itinerary")}
        >
          <span className="tab-icon"><AppIcon name="calendar" /></span>
          <small>Itinerary</small>
        </button>
        <button
          className={activeTab === "gallery" ? "active" : ""}
          aria-current={activeTab === "gallery" ? "page" : undefined}
          onClick={() => setActiveTab("gallery")}
        >
          <span className="tab-icon"><AppIcon name="camera" /></span>
          <small>Gallery</small>
        </button>
        <button
          className={activeTab === "expenses" ? "active" : ""}
          aria-current={activeTab === "expenses" ? "page" : undefined}
          onClick={() => setActiveTab("expenses")}
        >
          <span className="tab-icon"><AppIcon name="receipt" /></span>
          <small>Expenses</small>
        </button>
        <button
          className={activeTab === "documents" ? "active" : ""}
          aria-current={activeTab === "documents" ? "page" : undefined}
          onClick={() => setActiveTab("documents")}
        >
          <span className="tab-icon"><AppIcon name="document" /></span>
          <small>Documents</small>
        </button>
        <button
          className={activeTab === "stops" ? "active" : ""}
          aria-current={activeTab === "stops" ? "page" : undefined}
          onClick={() => setActiveTab("stops")}
        >
          <span className="tab-icon"><AppIcon name="pin" /></span>
          <small>Stops</small>
        </button>
        <button
          className={activeTab === "memory" ? "active" : ""}
          aria-current={activeTab === "memory" ? "page" : undefined}
          onClick={() => setActiveTab("memory")}
        >
          <span className="tab-icon"><AppIcon name="heart" /></span>
          <small>Memory Lane</small>
        </button>
      </nav>

      {tripSyncError && tripSyncState === "error" && (
        <aside className="sync-error" role="alert">
          <span>{tripSyncError}</span>
          <button className="sync-button" onClick={() => void (hasPendingTripSave ? processPendingTripSave() : refreshSharedItinerary())}>
            {hasPendingTripSave ? "Retry itinerary save" : "Retry itinerary connection"}
          </button>
        </aside>
      )}

      {activeTab === "itinerary" ? (
        <>
      <div className="itinerary-dashboard">
      <div className="itinerary-main-column">
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

      <section className={`content-grid ${itineraryView === "map" ? "map-mode" : ""}`}>
        <div className="timeline-panel">
          <header className="day-overview">
            <p className="day-kicker">Day {selectedDayNumber}</p>
            <FittedDayTitle>{selectedDay?.label ?? "Trip day"}</FittedDayTitle>
            {selectedDay?.storyTitle && <p className="day-story-title">{selectedDay.storyTitle}</p>}
            <p className="day-date-line">Day {selectedDayNumber} · <time dateTime={selectedDay?.date}>{galleryDate(selectedDay?.date ?? "")}</time></p>
            <div className="day-view-toggle" aria-label="Itinerary display">
              <button className={itineraryView === "itinerary" ? "active" : ""} aria-pressed={itineraryView === "itinerary"} onClick={() => setItineraryView("itinerary")}>Itinerary View</button>
              <button className={itineraryView === "map" ? "active" : ""} aria-pressed={itineraryView === "map"} onClick={() => setItineraryView("map")}>Map View</button>
            </div>
            <div className="day-toolbar" aria-label="Day actions">
              <button className="day-tool-button" onClick={openEditDayDetails} disabled={!currentMember}>Edit Day Details</button>
              <button className="day-tool-button primary" onClick={() => setShowAddStop(true)} disabled={!currentMember}>+ Add Stop</button>
            </div>
          </header>

          {itineraryView === "itinerary" ? <div className="timeline">
            {selectedDay?.stops.map((stop, index) => {
              const active = stop.id === selectedStop?.id;
              const nextStop = selectedDay.stops[index + 1];
              return (
                <Fragment key={stop.id}>
                  <button
                    className={`stop-card ${active ? "active" : ""}`}
                    onClick={() => selectStop(active ? "" : stop.id)}
                    aria-expanded={active}
                  >
                    <time>{stop.time}</time>
                    <span className="timeline-marker" aria-hidden="true" />
                    <span className="stop-copy">
                      <strong>{stop.title}</strong>
                      <small>{stop.place || "Location to be added"}</small>
                    </span>
                  </button>
                  {active && <div id={`itinerary-stop-${stop.id}`} className="inline-stop-workspace-host" ref={inlineStopContainerRef} />}
                  {nextStop && (
                    <span
                      className="timeline-gap"
                      style={{ height: `${timelineGapHeight(stop.time, nextStop.time)}px` }}
                      aria-hidden="true"
                    />
                  )}
                </Fragment>
              );
            })}
          </div> : selectedDay ? (
            <div className="day-map-layout">
              <DayPinMap day={selectedDay} onTravelModeChange={(stopId, mode) => updateStopInDay(selectedDay.id, stopId, { travelModeToNext: mode })} />
              <aside className="map-stop-sidebar" aria-label="Day stop locations">
                <div className="map-stop-sidebar-heading">
                  <strong>Day locations</strong>
                  <small>Numbered pins follow the itinerary. Mapbox plots each route using its selected travel mode.</small>
                </div>
                {selectedDay.stops.map((stop, index) => {
                  const hasPin = Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude);
                  const isSelectedMapStop = stop.id === selectedStop?.id;
                  return (
                    <div className={`map-stop-location ${hasPin ? "located" : "missing"}`} key={stop.id}>
                      <span className="map-stop-number">{index + 1}</span>
                      <div>
                        <strong>Stop {index + 1}: {stop.title}</strong>
                        {hasPin ? (
                          <>
                            <small>{stop.place}</small>
                            <a href={externalMapUrl(stop.place, stop.latitude, stop.longitude)} target="_blank" rel="noopener noreferrer">Open in Maps ↗</a>
                          </>
                        ) : (
                          <div className="map-missing-location-field">
                            <input
                              type="search"
                              value={locationInputValue(selectedDay.id, stop.id, stop.place)}
                              onFocus={() => {
                                setSelectedStopId(stop.id);
                                beginPlaceSearch(selectedDay.id, stop.id, stop.place);
                              }}
                              onChange={(event) => handleLocationChangeForStop(stop.id, event.target.value, selectedDay.id)}
                              placeholder="Add a Mapbox location"
                              aria-label={`Location for Stop ${index + 1}: ${stop.title}`}
                              autoComplete="off"
                              readOnly={!currentMember}
                            />
                            {isSelectedMapStop && placeSearchState === "searching" && <small>Searching Mapbox…</small>}
                            {isSelectedMapStop && placeSuggestions.length > 0 && (
                              <div className="map-place-suggestions">
                                {placeSuggestions.map((suggestion) => (
                                  <button key={suggestion.placeId} type="button" onClick={() => void choosePlace(suggestion)} disabled={placeSearchState === "choosing"}><strong>{suggestion.text}</strong>{suggestion.secondaryText && suggestion.secondaryText !== suggestion.text && <small>{suggestion.secondaryText}</small>}</button>
                                ))}
                                <small>Powered by Mapbox</small>
                              </div>
                            )}
                            {hasLocationDraftChange(selectedDay.id, stop.id, stop.place) && (
                              <button className="location-confirm-button" type="button" onClick={() => confirmTypedLocation(selectedDay.id, stop.id)}>
                                {placeSearchDraft.trim() ? "Use typed location" : "Clear saved location"}
                              </button>
                            )}
                            {isSelectedMapStop && placeSearchError && <small className="error">{placeSearchError}</small>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </aside>
            </div>
          ) : null}
        </div>

        {itineraryView === "itinerary" && selectedStop && inlineStopContainer && createPortal(
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
                        value={locationInputValue(selectedDay.id, selectedStop.id, selectedStop.place)}
                        onFocus={() => beginPlaceSearch(selectedDay.id, selectedStop.id, selectedStop.place)}
                        onChange={(event) => handleLocationChange(event.target.value)}
                        placeholder="Search Mapbox or type a location"
                        readOnly={!currentMember}
                        autoComplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={placeSuggestions.length > 0}
                        aria-controls="place-suggestions"
                      />
                    </label>
                    {placeSearchState === "searching" && <span className="place-search-status">Searching Mapbox…</span>}
                    {placeSuggestions.length > 0 && (
                      <div className="place-suggestions" id="place-suggestions" role="listbox">
                        {placeSuggestions.map((suggestion) => (
                          <button key={suggestion.placeId} type="button" role="option" aria-selected="false" onClick={() => void choosePlace(suggestion)} disabled={placeSearchState === "choosing"}>
                            <span aria-hidden="true">●</span>
                            <span className="place-suggestion-copy"><strong>{suggestion.text}</strong>{suggestion.secondaryText && suggestion.secondaryText !== suggestion.text && <small>{suggestion.secondaryText}</small>}</span>
                          </button>
                        ))}
                        <small>Powered by Mapbox</small>
                      </div>
                    )}
                    {hasLocationDraftChange(selectedDay.id, selectedStop.id, selectedStop.place) && (
                      <button className="location-confirm-button" type="button" onClick={() => confirmTypedLocation(selectedDay.id, selectedStop.id)}>
                        {placeSearchDraft.trim() ? "Use typed location" : "Clear saved location"}
                      </button>
                    )}
                    {placeSearchError && <span className="place-search-error">{placeSearchError}</span>}
                    {selectedStop.place.trim() ? (
                      <div className="maps-place-card" aria-label={`Map location: ${selectedStop.place}`}>
                        <span className="maps-place-pin" aria-hidden="true">●</span>
                        <span className="maps-place-copy">
                          <small>Mapbox location</small>
                          <strong>{selectedStop.place}</strong>
                        </span>
                        <span className="maps-place-actions">
                          <a href={externalMapUrl(selectedStop.place, selectedStop.latitude, selectedStop.longitude)} target="_blank" rel="noopener noreferrer">Open map ↗</a>
                          <a href={externalDirectionsUrl(selectedStop.place, selectedStop.latitude, selectedStop.longitude)} target="_blank" rel="noopener noreferrer">Directions ↗</a>
                        </span>
                      </div>
                    ) : (
                      <span className="maps-place-empty">Add a location to place it on Mapbox</span>
                    )}
                  </div>
                </div>
                <details className="stop-detail-disclosure notes-disclosure">
                  <summary><span><strong>Notes</strong><small>{selectedStop.note.trim() ? "A note has been added" : "Add reminders or useful details"}</small></span></summary>
                  <label className="stop-disclosure-body">
                    <span className="visually-hidden">Notes</span>
                    <textarea value={selectedStop.note} onChange={(event) => updateSelectedStop({ note: event.target.value })} placeholder="Add a note" readOnly={!currentMember} />
                  </label>
                </details>
                <details className="stop-detail-disclosure documents-disclosure" open={documentsExpanded} onToggle={(event) => setDocumentsExpanded(event.currentTarget.open)}>
                  <summary><span><strong>Documents &amp; attachments</strong><small>Tickets, bookings and saved email files</small></span><b>{(selectedStop.documents ?? []).length}</b></summary>
                  <section className="stop-documents" aria-label="Documents and attachments">
                  <input ref={documentInputRef} className="visually-hidden" type="file" multiple onChange={(event) => void handleDocumentSelection(event)} />
                  <input ref={screenshotInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => void handleDocumentSelection(event)} />
                  <div className="document-upload-actions">
                    <button className="secondary-button document-upload-button" onClick={() => documentInputRef.current?.click()} disabled={!currentMember || documentUploadState === "uploading" || isOffline}>
                      <AppIcon name="document" /> {documentUploadState === "uploading" ? `Uploading ${documentProgress.completed} of ${documentProgress.total}…` : "Add files"}
                    </button>
                    <button className="secondary-button document-upload-button" onClick={() => screenshotInputRef.current?.click()} disabled={!currentMember || documentUploadState === "uploading" || isOffline}>
                      <AppIcon name="camera" /> Add screenshots
                    </button>
                  </div>
                  <small>PDFs, tickets, office files, saved email attachments and screenshots up to 15 MB each.</small>
                  {(selectedStop.documents ?? []).length > 0 && <div className="stop-document-list">
                    {(selectedStop.documents ?? []).map((document) => <div key={document.id} className={`stop-document-row ${documentNavigationTarget?.documentId === document.id ? "navigation-highlight" : ""}`}>
                      <AppIcon name="document" />
                      <button className="document-name-button" onClick={() => void viewDocument(document)}><strong>{document.name}</strong><small>{formatBytes(document.size)} · {document.memberName}</small></button>
                      {(isAdmin || document.memberId === currentMember?.id) && <button className="document-delete-button" onClick={() => void removeDocument(selectedDay.id, selectedStop.id, document)} aria-label={`Delete ${document.name}`}>×</button>}
                    </div>)}
                  </div>}
                  {documentError && <p className="document-alert" role="alert">{documentError}</p>}
                  </section>
                </details>
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
                {expenseConversionState === "converting" ? `Converting to ${account.homeCurrency}…` : `Add expense as ${currentMember?.name || "family member"}`}
              </button>
              <p className="expense-rate-note">{account.homeCurrency} is calculated automatically using the latest daily reference rate and saved with the expense.</p>
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
                <div>
                  <p className="eyebrow">Photo upload</p>
                  <h3 id="add-photos-title">Add photos or videos</h3>
                </div>
                {isOffline ? (
                  <button className="sync-button" disabled>Cloud offline</button>
                ) : googleState === "uploading" ? (
                  <button className="sync-button" disabled>Uploading…</button>
                ) : googleState === "connected" ? (
                  <button className="sync-button" disabled>Shared gallery ready</button>
                ) : (
                  <button className="sync-button" onClick={connectGoogleDrive} disabled={googleState === "connecting"}>
                    {googleState === "connecting" ? "Checking gallery…" : "Connect shared gallery"}
                  </button>
                )}
              </div>
              <div className="photo-actions">
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handlePhotoSelection}
              />
              <button
                className="primary-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={queueState !== "ready"}
              >
                {queueState === "saving" ? "Saving temporary copies…" : "+ Choose Photos or Videos"}
              </button>
              <button
                className="share-trip-button"
                onClick={() => void uploadQueuedPhotos()}
                disabled={waitingCount === 0 || googleState === "uploading" || isOffline}
              >
                {googleState === "uploading"
                  ? "Uploading all…"
                  : `Upload All Waiting${waitingCount ? ` (${waitingCount})` : ""}`}
              </button>
              <small className="share-trip-explainer">Uploads every waiting memory to its assigned stop for everyone in the trip.</small>
              {(googleError || googleState === "uploading" || isOffline) && <div className={`photo-upload-feedback ${googleError ? "error" : ""}`} role={googleError ? "alert" : "status"} aria-live="polite">
                <strong>
                  {googleError
                    ? googleError
                    : googleState === "uploading"
                      ? `Uploading ${uploadProgress?.completed ?? 0} of ${uploadProgress?.total ?? waitingCount} memories…`
                      : isOffline
                        ? `${waitingCount} ${waitingCount === 1 ? "memory" : "memories"} safely waiting offline`
                        : waitingCount > 0
                          ? `${waitingCount} ${waitingCount === 1 ? "memory needs" : "memories need"} uploading`
                          : "All selected memories are uploaded"}
                </strong>
                {googleState === "uploading" && uploadProgress && uploadProgress.total > 0 && (
                  <>
                    <progress value={uploadProgress.completed} max={uploadProgress.total} aria-label="Photo upload progress" />
                    <small>{uploadProgressPercent}% complete</small>
                  </>
                )}
              </div>}
              <p>Take photos with the iPhone Camera first, then choose them here.</p>
              {queueState === "loading" && <p className="queue-message">Opening your offline photo queue…</p>}
              {queueError && <p className="queue-message error" role="alert">{queueError}</p>}
              </div>

              <div className="gallery-heading">
              <h3>Selected for this stop</h3>
              <span>{selectedPhotos.length} on this device</span>
              </div>

              {selectedPhotos.length === 0 ? (
              <div className="empty-gallery">
                <div className="empty-icon">▧</div>
                <strong>No photos assigned yet</strong>
                <p>Your originals will always remain safely in Apple Photos.</p>
              </div>
            ) : (
              <div className="photo-grid camera-roll-grid">
                {selectedPhotos.map((photo) => (
                  <figure key={photo.id} className="camera-roll-tile">
                    <button className="camera-roll-preview" onClick={() => setPreviewQueuedPhotoId(photo.id)} aria-label={`Preview ${photo.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photo.mimeType.startsWith("video/")
                      ? <video src={photo.previewUrl} muted playsInline preload="metadata" />
                      : <img src={photo.previewUrl} alt={photo.name} />}
                    <span className={`camera-roll-status ${photo.isPrivate ? "private" : photo.status}`}>
                      {photo.status === "uploaded" && !photo.isPrivate ? "✓" : photo.status === "uploading" ? "↑" : photo.status === "needsAttention" ? "!" : photo.isPrivate ? "Private" : "Ready"}
                    </span>
                    {photo.mimeType.startsWith("video/") && <span className="camera-roll-video">▶ Video</span>}
                    <span className="camera-roll-name">{photo.name}</span>
                    </button>
                    <button
                      className="camera-roll-remove"
                      aria-label={`Remove ${photo.name}`}
                      onClick={() => void removePhoto(photo.id)}
                    >×</button>
                  </figure>
                ))}
              </div>
              )}

              <div className="gallery-heading shared-stop-heading">
                <div><h3>Shared at this stop</h3><small>Visible here and in Photo Gallery</small></div>
                <span>{selectedSharedPhotos.length} shared</span>
              </div>
              {selectedSharedPhotos.length === 0 ? (
                <div className="shared-stop-empty">Shared memories from every family member will appear here.</div>
              ) : (
                <div className="photo-grid camera-roll-grid shared-stop-grid">
                  {selectedPhotos.filter((photo) => photo.status === "uploaded" && photo.firebaseMediaId).map((photo) => (
                    <button key={`local-${photo.id}`} className="camera-roll-tile shared" onClick={() => setPreviewQueuedPhotoId(photo.id)} aria-label={`Open shared ${photo.name}`}>
                      {photo.mimeType.startsWith("video/") ? <video src={photo.previewUrl} muted playsInline preload="metadata" /> : <img src={photo.previewUrl} alt={photo.name} />}
                      <span className="camera-roll-status uploaded">✓ Shared</span>
                      <span className="camera-roll-person">You</span>
                    </button>
                  ))}
                  {sharedOnlyPhotos.map((photo) => (
                    <button key={photo.fileId} className="camera-roll-tile shared" onClick={() => setPreviewSharedMediaId(photo.fileId)} aria-label={`Open ${photo.memberName}'s ${photo.mediaType}`}>
                      {photo.mediaType === "video" ? <video src={photo.thumbnailUrl || photo.downloadUrl} muted playsInline preload="metadata" /> : <img src={photo.thumbnailUrl || photo.downloadUrl} alt={photo.caption || photo.name} loading="lazy" />}
                      {photo.mediaType === "video" && <span className="camera-roll-video">▶ Video</span>}
                      <span className="camera-roll-person">{photo.memberName}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>,
          inlineStopContainer,
        )}
      </section>
      </div>
      </div>
        </>
      ) : activeTab === "stops" ? (
        <StopsBank
          account={account}
          tripId={accountTrip.id}
          days={days}
          currentMember={currentMember}
          onSchedule={scheduleSavedPlace}
        />
      ) : activeTab === "gallery" ? (
        <Gallery
          tripId={accountTrip.id}
          days={days}
          media={sharedPhotos}
          currentUid={account.uid}
          state={galleryState}
          error={galleryError}
          onUpdate={async (item, changes) => updateTripMedia(accountTrip.id, item.fileId, changes)}
          onDelete={async (item) => deleteTripMedia(accountTrip.id, item)}
        />
      ) : activeTab === "documents" ? (
        <section className="documents-page" aria-labelledby="documents-title">
          <header className="documents-page-heading">
            <div><p className="eyebrow">Everything in one place</p><h1 id="documents-title">Trip Documents</h1><p>Tickets, confirmations, itineraries and attachments shared across the family.</p></div>
            <span>{documentRows.length} file{documentRows.length === 1 ? "" : "s"}</span>
          </header>
          {documentError && <p className="document-alert page-alert" role="alert">{documentError}</p>}
          {documentRows.length === 0 ? (
            <div className="documents-empty"><AppIcon name="document" /><strong>No documents yet</strong><p>Open an itinerary stop and choose <b>Add documents or email attachments</b>.</p></div>
          ) : (
            <div className="documents-days">
              {days.map((day, dayIndex) => {
                const dayDocuments = documentRows.filter((row) => row.day.id === day.id);
                if (dayDocuments.length === 0) return null;
                return <section className="documents-day" key={day.id}>
                  <header><div><p>Day {dayIndex + 1}</p><h2>{day.label}</h2></div><time dateTime={day.date}>{galleryDate(day.date)}</time></header>
                  <div className="documents-grid">
                    {dayDocuments.map(({ stop, stopIndex, document }) => <div className="document-card-group" key={document.id}>
                      <div className="document-stop-link">
                        <span>Stop {stopIndex + 1} · {stop.title}</span>
                        <button onClick={() => goToDocumentStop(day.id, stop.id, document.id)}>Go to stop →</button>
                      </div>
                      <article className="document-card">
                        <span className="document-file-icon"><AppIcon name="document" /></span>
                        <div className="document-card-copy"><strong>{document.name}</strong><span>{formatBytes(document.size)} · Added by {document.memberName}</span></div>
                        <div className="document-card-actions"><button onClick={() => void viewDocument(document)}>{documentPreviewLoading?.id === document.id ? "Opening…" : "View"}</button>{(isAdmin || document.memberId === currentMember?.id) && <button className="delete" onClick={() => void removeDocument(day.id, stop.id, document)}>Delete</button>}</div>
                      </article>
                    </div>)}
                  </div>
                </section>;
              })}
            </div>
          )}
        </section>
      ) : activeTab === "memory" ? (
        <MemoryLane
          tripName={tripName}
          days={days}
          currentMember={currentMember}
          sharedPhotos={sharedPhotos.filter((item) => item.mediaType === "photo")}
          sharedPhotoUrls={sharedPhotoUrls}
          galleryState={galleryState}
          galleryError={galleryError}
          selectedLocationStopId={placeSearchTarget?.stopId ?? ""}
          locationDraftValue={placeSearchTarget ? placeSearchDraft : null}
          placeSuggestions={placeSuggestions}
          placeSearchState={placeSearchState}
          placeSearchError={placeSearchError}
          onRefreshPhotos={() => void refreshSharedGallery()}
          onSaveMemory={saveStopMemory}
          onAddScrapbookEntry={addScrapbookEntry}
          onDeleteScrapbookEntry={deleteScrapbookEntry}
          onUpdateMapPhotos={updateMemoryMapPhotos}
          onUpdateDayStory={updateDayStory}
          onFocusLocation={focusMemoryLocation}
          onLocationChange={(dayId, stopId, value) => handleLocationChangeForStop(stopId, value, dayId)}
          onUseTypedLocation={confirmTypedLocation}
          onChoosePlace={(suggestion) => void choosePlace(suggestion)}
        />
      ) : (
        <section className="expenses-page" aria-labelledby="expenses-title">
          <header className="expenses-page-heading">
            <div>
              <p className="eyebrow">The practical details</p>
              <h1 id="expenses-title">The Adventure So Far</h1>
              <p>Every ticket, treat and train ride—kept tidy while the story stays fun.</p>
            </div>
            {expenseRows.some(({ expense }) => expense.homeAmount === null) && (
              <button className="secondary-button" onClick={() => void refreshAudConversions()} disabled={isOffline || expenseConversionState === "converting"}>
                {expenseConversionState === "converting" ? "Converting…" : `Refresh ${account.homeCurrency} conversions`}
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
                      <td data-label="Home Currency">{expenseMoney(expense.homeAmount, expense.homeCurrency || account.homeCurrency)}{expense.exchangeRateDate && <small>Rate dated {expense.exchangeRateDate}</small>}</td>
                    </tr>
                  ))}
                </tbody>
                {filteredExpenseRows.length > 0 && (
                  <tfoot>
                    <tr>
                      <th colSpan={5} scope="row">Total</th>
                      <td>{expenseTotals.local}</td>
                      <td>
                        <strong>{expenseMoney(expenseTotals.homeAmount, account.homeCurrency)}</strong>
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

      {documentPreview && (
        <div className="modal-backdrop document-preview-backdrop" role="presentation" onMouseDown={closeDocumentPreview}>
          <section className="modal document-preview-modal" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="document-preview-heading">
              <button className="document-preview-done" onClick={closeDocumentPreview}>Done</button>
              <div><h2 id="document-preview-title">{documentPreview.document.name}</h2><small>{formatBytes(documentPreview.document.size)} · Added by {documentPreview.document.memberName}</small></div>
              <button className="document-preview-share" onClick={() => void shareDocument(documentPreview.document)}>Open / Share</button>
            </header>
            <div className="document-preview-stage">
              {documentPreview.document.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={documentPreview.url} alt={documentPreview.document.name} />
              ) : documentPreview.document.mimeType === "application/pdf" || documentPreview.document.name.toLowerCase().endsWith(".pdf") ? (
                <iframe src={documentPreview.url} title={documentPreview.document.name} />
              ) : (
                <div className="document-preview-unavailable"><AppIcon name="document" /><strong>This file needs another app to display it</strong><p>Use Open / Share to choose Word, Mail, Files or another compatible app.</p></div>
              )}
            </div>
          </section>
        </div>
      )}

      {showOverview && (
        <div className="modal-backdrop overview-backdrop" role="presentation" onMouseDown={() => setShowOverview(false)}>
          <aside className="trip-overview-sheet" role="dialog" aria-modal="true" aria-labelledby="overview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="overview-sheet-heading">
              <div><p className="eyebrow">At a glance</p><h2 id="overview-title">Trip Overview</h2></div>
              <button className="overview-close" aria-label="Close trip overview" onClick={() => setShowOverview(false)}>×</button>
            </header>
            <div className="overview-widget-grid">
              <section className="trip-widget countdown-widget">
                <p className="eyebrow">Countdown</p>
                <strong className={tripCountdown.kind === "today" ? "countdown-today" : ""}>{tripCountdown.value}</strong>
                <span>{tripCountdown.label}</span>
              </section>
              <section className="trip-widget weather-widget">
                <div className="widget-heading"><p className="eyebrow">Vienna weather</p><span aria-hidden="true">{viennaWeather?.icon || "🌦️"}</span></div>
                <strong>{viennaWeather?.heading || "Generally in November"}</strong>
                <p>{viennaWeather?.detail || "Cool and changeable, usually around 4–10°C. Live forecasts will appear here automatically when the trip enters the 16-day forecast window."}</p>
                <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">{viennaWeather ? "Live forecast · Open-Meteo ↗" : "Weather source · Open-Meteo ↗"}</a>
              </section>
              <section className="trip-widget spending-widget">
                <p className="eyebrow">Trip spending</p>
                <strong>{expenseMoney(tripSpendAud, account.homeCurrency)}</strong>
                <span>{expenseRows.length} recorded expense{expenseRows.length === 1 ? "" : "s"}</span>
                <button onClick={() => { setShowOverview(false); setActiveTab("expenses"); }}>View expenses →</button>
              </section>
              <section className="trip-widget travellers-widget">
                <p className="eyebrow">Travellers</p>
                <div className="traveller-bubbles" aria-label={`${members.length} family travellers`}>
                  {members.slice(0, 6).map((member) => <span key={member.id} title={member.name}>{member.name.slice(0, 1).toUpperCase()}</span>)}
                </div>
                <strong>{members.length} traveller{members.length === 1 ? "" : "s"}</strong>
              </section>
            </div>
          </aside>
        </div>
      )}

      {showSettings && isAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSettings(false)}>
          <section className="modal trip-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="trip-settings-heading"><div><p className="eyebrow">Admin controls</p><h2 id="settings-title">Trip Settings</h2></div><button className="overview-close" aria-label="Close trip settings" onClick={() => setShowSettings(false)}>×</button></div>
            <section className="cover-settings" aria-labelledby="cover-settings-title">
              <div className={`cover-settings-preview ${tripCoverDisplayUrl ? "has-image" : ""}`} style={tripCoverDisplayUrl ? { backgroundImage: `url(${tripCoverDisplayUrl})`, backgroundPosition: `${tripCoverPositionX}% ${tripCoverPositionY}%` } : undefined}>
                {!tripCoverDisplayUrl && <span aria-hidden="true">🏛️</span>}
              </div>
              <div>
                <h3 id="cover-settings-title">Trip cover photo</h3>
                <p>Choose one landscape photo for the shared app header. A lightweight copy is saved with the trip and appears for everyone.</p>
                <input ref={coverInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleCoverSelection} />
                <button className="secondary-button" onClick={() => coverInputRef.current?.click()} disabled={coverUploadState === "uploading"}>
                  {coverUploadState === "uploading" ? "Uploading cover…" : tripCoverPhotoId ? "Replace cover photo" : "Upload cover photo"}
                </button>
                {tripCoverDisplayUrl && <div className="cover-focal-controls focal-controls"><label><span>Move left or right</span><input type="range" min="0" max="100" value={tripCoverPositionX} onChange={(event) => setTripCoverPositionX(Number(event.target.value))} /></label><label><span>Move up or down</span><input type="range" min="0" max="100" value={tripCoverPositionY} onChange={(event) => setTripCoverPositionY(Number(event.target.value))} /></label><button className="text-button" onClick={() => void saveCoverPosition()} disabled={coverUploadState === "uploading"}>Save framing</button></div>}
                {coverUploadError && <small className="cover-upload-error" role="alert">{coverUploadError}</small>}
              </div>
            </section>
            <h3 className="settings-section-title">Family profiles</h3>
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
            <h3 className="settings-section-title admin-section-title">Trip administrators</h3>
            <p className="modal-copy admin-copy">Admins can rename the trip, edit day names, manage profiles and promote another signed-in member.</p>
            <div className="member-list admin-member-list">
              {tripAccountMembers.map((member) => (
                <div className="member-row" key={member.userId}>
                  <span className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span>
                  <strong>{member.displayName}</strong>
                  <span className={`member-role ${member.role}`}>{member.role === "admin" ? "Admin" : "Contributor"}</span>
                  {member.role === "admin" ? <span className="admin-confirmed">Admin</span> : <button className="member-action" onClick={() => void makeTripAdmin(member)} disabled={Boolean(adminUpdateUid)}>{adminUpdateUid === member.userId ? "Updating…" : "Make admin"}</button>}
                </div>
              ))}
            </div>
            {adminUpdateError && <p className="gallery-alert" role="alert">{adminUpdateError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowSettings(false)}>Close</button>
              <button className="primary-button" onClick={connectGoogleDrive} disabled={googleState === "connecting"}>
                {googleState === "connecting" ? "Refreshing…" : "Refresh shared trip"}
              </button>
            </div>
            <details className="admin-technical-details">
              <summary>Connection details</summary>
              <p className="settings-note">
                This device is <strong>{currentMember?.name || "not assigned"}</strong> in {isAdmin ? "admin" : "contributor"} mode, with its profile locked to this device. If two people change the same item before syncing, both versions are preserved.
              </p>
              <section className="places-usage" aria-labelledby="places-usage-title">
                <div className="places-usage-heading">
                  <div><p className="eyebrow">Maps &amp; location search</p><h3 id="places-usage-title">Mapbox connected</h3></div>
                  <span className="place-status visited">Active</span>
                </div>
                <p className="places-setup-note">Itinerary, Saved Places and Memory Lane use the same Mapbox maps and search.</p>
              </section>
            </details>
            <div className="modal-danger-zone trip-delete-zone">
              <div><strong>Delete this trip</strong><small>Removes the trip from every traveller&apos;s app. Export shared photos and videos first.</small></div>
              <button className="danger-button" onClick={openDeleteTripConfirmation}>Delete trip</button>
            </div>
          </section>
        </div>
      )}

      {showDeleteTripConfirm && isAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => deleteTripState !== "deleting" && setShowDeleteTripConfirm(false)}>
          <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-trip-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Permanent action</p>
            <h2 id="delete-trip-title">Delete trip for everyone?</h2>
            <p className="modal-copy">This removes <strong>{tripName}</strong>, its itinerary, expenses, saved places, invitations and membership from every traveller&apos;s app. This cannot be undone.</p>
            <p className="delete-trip-memory-note"><strong>Your original photos and videos remain in Apple Photos.</strong> Export anything you need from the shared gallery before deleting the trip.</p>
            <label>
              Type <strong>{tripName}</strong> to confirm
              <input value={deleteTripConfirmation} onChange={(event) => setDeleteTripConfirmation(event.target.value)} autoComplete="off" disabled={deleteTripState === "deleting"} />
            </label>
            {deleteTripError && <p className="gallery-alert" role="alert">{deleteTripError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowDeleteTripConfirm(false)} disabled={deleteTripState === "deleting"}>Cancel</button>
              <button className="danger-button solid" onClick={() => void deleteTripForEveryone()} disabled={deleteTripConfirmation.trim() !== tripName.trim() || deleteTripState === "deleting"}>
                {deleteTripState === "deleting" ? "Deleting trip…" : "Delete trip for everyone"}
              </button>
            </div>
          </section>
        </div>
      )}

      {downloadDay && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => bulkDownloadState === "idle" && setDownloadDayId("")}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="download-day-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Photo Gallery</p>
            <h2 id="download-day-title">Share Day {days.findIndex((day) => day.id === downloadDay.id) + 1}</h2>
            <p className="modal-copy">Choose the stops, then use the iPhone Share Sheet and tap <strong>Save Images</strong> to add them directly to Apple Photos. Browsers without file sharing will use Downloads as a fallback.</p>
            <div className="download-stop-list">
              {downloadDay.stops.map((stop, stopIndex) => {
                const photoCount = sharedPhotos.filter((photo) => photo.dayId === downloadDay.id && photo.stopId === stop.id).length;
                return (
                  <label className="download-stop-option" key={stop.id}>
                    <input type="checkbox" checked={selectedDownloadStopIds.includes(stop.id)} onChange={() => toggleDownloadStop(stop.id)} disabled={photoCount === 0 || bulkDownloadState === "downloading"} />
                    <span><strong>Stop {stopIndex + 1}: {stop.title}</strong><small>{photoCount} photo{photoCount === 1 ? "" : "s"}</small></span>
                  </label>
                );
              })}
            </div>
            {bulkDownloadError && <p className="gallery-alert" role="alert">{bulkDownloadError}</p>}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setDownloadDayId("")} disabled={bulkDownloadState === "downloading"}>Cancel</button>
              <button className="primary-button" onClick={() => void shareSelectedStops()} disabled={selectedDownloadStopIds.length === 0 || bulkDownloadState === "downloading"}>
                {bulkDownloadState === "downloading" ? "Opening Share Sheet…" : "Open Share Sheet"}
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
            <p className="modal-copy">Paste the private link Grace prepared for you. You only need to do this once on this device.</p>
            <form className="invitation-link-form" onSubmit={connectPrivateInvitation}>
              <label>
                Private invitation link
                <input
                  type="url"
                  value={invitationLink}
                  onChange={(event) => setInvitationLink(event.target.value)}
                  placeholder="https://graceylam.github.io/…"
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                />
              </label>
              {invitationError && <p className="gallery-alert" role="alert">{invitationError}</p>}
              <button className="primary-button" type="submit">Connect this device</button>
            </form>
          </section>
        </div>
      )}

      {previewQueuedPhoto && (
        <div className="media-preview-backdrop" role="presentation" onMouseDown={() => setPreviewQueuedPhotoId("")}>
          <section className="media-preview" role="dialog" aria-modal="true" aria-label={`Preview ${previewQueuedPhoto.name}`} onMouseDown={(event) => event.stopPropagation()}>
            <header><button onClick={() => setPreviewQueuedPhotoId("")}>Done</button><div><strong>{previewQueuedPhoto.name}</strong><small>{statusLabel(previewQueuedPhoto)} · {previewQueuedPhoto.memberName}</small></div><span /></header>
            <div className="media-preview-stage">
              {previewQueuedPhoto.mimeType.startsWith("video/")
                ? <video src={previewQueuedPhoto.previewUrl} controls autoPlay playsInline />
                : <img src={previewQueuedPhoto.previewUrl} alt={previewQueuedPhoto.name} />}
            </div>
            <footer>
              <button className="secondary-button" onClick={() => void saveQueuedMemoryToPhotos(previewQueuedPhoto)}>Save to Photos</button>
              <button className="secondary-button" onClick={() => void togglePrivacy(previewQueuedPhoto.id)} disabled={previewQueuedPhoto.pendingLocalRemoval}>
                {previewQueuedPhoto.isPrivate ? "Share with trip" : "Keep private"}
              </button>
              <button className="danger-button" onClick={() => { void removePhoto(previewQueuedPhoto.id); setPreviewQueuedPhotoId(""); }}>
                {previewQueuedPhoto.pendingLocalRemoval ? "Retry removal" : "Remove"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {previewSharedMedia && (
        <div className="media-preview-backdrop" role="presentation" onMouseDown={() => setPreviewSharedMediaId("")}>
          <section className="media-preview" role="dialog" aria-modal="true" aria-label={`Shared by ${previewSharedMedia.memberName}`} onMouseDown={(event) => event.stopPropagation()}>
            <header><button onClick={() => setPreviewSharedMediaId("")}>Done</button><div><strong>{previewSharedMedia.caption || previewSharedMedia.name}</strong><small>Shared by {previewSharedMedia.memberName}</small></div><span /></header>
            <div className="media-preview-stage">
              {previewSharedMedia.mediaType === "video"
                ? <video src={previewSharedMedia.downloadUrl} controls autoPlay playsInline />
                : <img src={previewSharedMedia.downloadUrl} alt={previewSharedMedia.caption || previewSharedMedia.name} />}
            </div>
            <footer><button className="secondary-button" onClick={() => void saveSharedMemoryToPhotos(previewSharedMedia)}>Save to Photos</button></footer>
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
          <section className="modal edit-day-modal" role="dialog" aria-modal="true" aria-labelledby="edit-day-title" onMouseDown={(event) => event.stopPropagation()}>
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
            <label>
              Day subtitle
              <input
                value={editDayStoryTitle}
                onChange={(event) => setEditDayStoryTitle(event.target.value)}
                placeholder="Palaces, pastries & sore feet"
                maxLength={120}
                aria-label="Edit day subtitle"
              />
            </label>
            <p className="modal-field-note">Everyone can add the line that captures what made this day special.</p>
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
                ? "This day has memories on this device. Their Apple Photos and shared gallery copies will remain, but they will no longer be assigned in this itinerary."
                : "This removes the day from the shared itinerary. Originals in Apple Photos and shared gallery copies will not be deleted."}
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

export default function Home() {
  return (
    <AccountPortal
      renderTrip={(account, trip, onBack) => (
        <TripWorkspace key={trip.id} account={account} accountTrip={trip} onBackToTrips={onBack} />
      )}
    />
  );
}

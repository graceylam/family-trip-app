"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PlaceSuggestion,
  SharedPhoto,
  TripScrapbookEntry,
  TripStory,
  TripDay,
  TripMember,
  TripStop,
} from "../lib/googleDrive";
import { createFamilyMap } from "../lib/mapbox";
import StoryBuilder from "./StoryBuilder";

type MemoryLaneProps = {
  tripName: string;
  days: TripDay[];
  currentMember?: TripMember;
  sharedPhotos: SharedPhoto[];
  sharedPhotoUrls: Record<string, string>;
  galleryState: "idle" | "loading" | "ready" | "offline" | "error";
  galleryError: string | null;
  selectedLocationStopId: string;
  locationDraftValue: string | null;
  placeSuggestions: PlaceSuggestion[];
  placeSearchState: "idle" | "searching" | "choosing";
  placeSearchError: string | null;
  onRefreshPhotos: () => void;
  onSaveMemory: (dayId: string, stopId: string, comment: string) => void;
  onAddScrapbookEntry: (dayId: string, stopId: string, entry: Omit<TripScrapbookEntry, "id" | "memberId" | "memberName" | "createdAt" | "updatedAt">) => void;
  onDeleteScrapbookEntry: (dayId: string, stopId: string, entryId: string) => void;
  onUpdateMapPresentation: (dayId: string, stopId: string, changes: { hidden?: boolean; hiddenPhotoIds?: string[] }) => void;
  onUpdateDayStory: (dayId: string, changes: Partial<Pick<TripDay, "storyTitle" | "coverPhotoId" | "stories">>) => void;
  highlights: TripStory[];
  onUpdateHighlights: (highlights: TripStory[]) => void;
  onFocusLocation: (dayId: string, stopId: string) => void;
  onLocationChange: (dayId: string, stopId: string, value: string) => void;
  onUseTypedLocation: (dayId: string, stopId: string) => void;
  onChoosePlace: (suggestion: PlaceSuggestion) => void;
};

type HighlightOrientation = "portrait" | "landscape";
type HighlightStep = "scope" | "photos" | "arrange" | "preview" | "rendering" | "done";
type HighlightTheme = "postcard" | "adventure" | "polaroid" | "cinematic";

const scrapbookEmojis = ["✨", "❤️", "😂", "🥹", "😍", "🌟", "🍜", "🏛️", "🚂", "🌅", "🎉", "✈️"];
const scrapbookStickers = ["none", "ticket", "postmark", "tape", "heart", "sparkles"] as const;
const scrapbookFrames: Array<NonNullable<TripScrapbookEntry["frame"]>> = ["polaroid", "postcard", "clean"];
const scrapbookFilters: Array<NonNullable<TripScrapbookEntry["filter"]>> = ["none", "warm", "soft", "mono"];

function memoryDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function stopPhotos(photos: SharedPhoto[], dayId: string, stopId: string): SharedPhoto[] {
  return photos.filter((photo) => photo.dayId === dayId && photo.stopId === stopId);
}

function distanceInKm(a: TripStop, b: TripStop): number {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) return 0;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians((b.latitude as number) - (a.latitude as number));
  const longitudeDelta = radians((b.longitude as number) - (a.longitude as number));
  const startLatitude = radians(a.latitude as number);
  const endLatitude = radians(b.latitude as number);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function MemoryMap({
  day,
  photos,
  photoUrls,
  expanded,
  onPin,
}: {
  day: TripDay;
  photos: SharedPhoto[];
  photoUrls: Record<string, string>;
  expanded?: boolean;
  onPin: (stopId: string) => void;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState("");
  const locatedStops = day.stops.filter((stop) => !stop.memory?.mapHidden && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));

  useEffect(() => {
    let disposed = false;
    let map: ReturnType<typeof createFamilyMap> | null = null;
    try {
      if (!mapElementRef.current) return;
      map = createFamilyMap(mapElementRef.current, locatedStops.map((stop) => {
        const availablePhotos = stopPhotos(photos, day.id, stop.id);
        const hiddenPhotoIds = new Set(stop.memory?.mapHiddenPhotoIds ?? []);
        const selectedPhotos = availablePhotos.filter((photo) => !hiddenPhotoIds.has(photo.fileId) && photoUrls[photo.fileId]);
        return {
          id: stop.id,
          latitude: stop.latitude!,
          longitude: stop.longitude!,
          number: day.stops.indexOf(stop) + 1,
          title: stop.title,
          subtitle: selectedPhotos.length ? `${selectedPhotos.length} highlight${selectedPhotos.length === 1 ? "" : "s"}` : "Choose highlight photos",
          badge: selectedPhotos.length,
          photoUrl: selectedPhotos[0] ? photoUrls[selectedPhotos[0].fileId] : undefined,
        };
      }), { onPin });
    } catch (error) {
      if (!disposed) setMapError(error instanceof Error ? error.message : "The map could not be opened.");
    }
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [day, expanded, onPin, photos, photoUrls]);

  return (
    <div className={`memory-map-wrap ${expanded ? "expanded" : ""}`}>
      <div ref={mapElementRef} className="memory-map-canvas" aria-label={`Memory map for ${day.label}`} />
      {locatedStops.length === 0 && !mapError && (
        <p className="memory-map-message">Add a Mapbox location to a stop to place its photo pin.</p>
      )}
      {mapError && <p className="memory-map-message error" role="alert">{mapError}</p>}
    </div>
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("One selected photo could not be prepared."));
    image.src = url;
  });
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  zoom: number,
  offset: number,
) {
  const baseScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const scale = baseScale * zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const overflowX = Math.max(0, drawWidth - width);
  const overflowY = Math.max(0, drawHeight - height);
  const x = -(overflowX * (0.35 + offset * 0.3));
  const y = -(overflowY * (0.35 + offset * 0.2));
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines;
}

async function createHighlightVideo({
  tripName,
  day,
  selectedPhotos,
  photoUrls,
  captions,
  orientation,
  secondsPerPhoto,
  theme,
  openingTitle,
  closingMessage,
  onProgress,
  isCancelled,
}: {
  tripName: string;
  day: TripDay;
  selectedPhotos: SharedPhoto[];
  photoUrls: Record<string, string>;
  captions: Record<string, string>;
  orientation: HighlightOrientation;
  secondsPerPhoto: number;
  theme: HighlightTheme;
  openingTitle: string;
  closingMessage: string;
  onProgress: (completed: number, total: number, label: string) => void;
  isCancelled: () => boolean;
}): Promise<{ blob: Blob; extension: "mp4" | "webm" }> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot create a video yet. Try the latest Safari or Chrome.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = orientation === "portrait" ? 720 : 1280;
  canvas.height = orientation === "portrait" ? 1280 : 720;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.captureStream !== "function") {
    throw new Error("Video creation is unavailable on this device.");
  }

  const mimeType = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const stream = canvas.captureStream(15);
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("The video recorder stopped unexpectedly."));
  });
  recorder.start(1000);

  const fps = 15;
  const totalFrames = (4 + selectedPhotos.length * secondsPerPhoto) * fps;
  let completedFrames = 0;
  const render = async (seconds: number, label: string, paint: (progress: number) => void) => {
    const frames = seconds * fps;
    for (let frame = 0; frame < frames; frame += 1) {
      if (isCancelled()) throw new DOMException("Video creation cancelled.", "AbortError");
      paint(frame / Math.max(1, frames - 1));
      completedFrames += 1;
      onProgress(completedFrames, totalFrames, label);
      await wait(1000 / fps);
    }
  };

  const themeColours: Record<HighlightTheme, [string, string, string]> = {
    postcard: ["#f6eee1", "#dbeaf0", "#d86f5c"],
    adventure: ["#174d68", "#2d7da0", "#f6c966"],
    polaroid: ["#f8f4e9", "#dfd7c7", "#315b70"],
    cinematic: ["#111d24", "#243642", "#d6b26b"],
  };
  const [themeStart, themeEnd, themeAccent] = themeColours[theme];
  const drawTitleCard = (heading: string, subheading: string) => {
    const { width, height } = canvas;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, themeStart);
    gradient.addColorStop(1, themeEnd);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = themeAccent;
    context.fillRect(width * 0.12, height * 0.25, width * 0.13, 7);
    context.fillStyle = "#fffdf8";
    context.font = `${orientation === "portrait" ? 56 : 54}px Georgia`;
    const lines = wrapCanvasText(context, heading, width * 0.76);
    lines.slice(0, 3).forEach((line, index) => {
      context.fillText(line, width * 0.12, height * 0.36 + index * 70);
    });
    context.fillStyle = "#cfe1d5";
    context.font = `700 ${orientation === "portrait" ? 25 : 24}px Arial`;
    context.fillText(subheading, width * 0.12, height * 0.36 + Math.min(lines.length, 3) * 70 + 36);
  };

  try {
    await render(2, "Creating the opening card", () => {
      drawTitleCard(openingTitle || day.label, memoryDate(day.date));
    });

    for (let index = 0; index < selectedPhotos.length; index += 1) {
      const photo = selectedPhotos[index];
      const url = photoUrls[photo.fileId];
      if (!url) throw new Error("Wait for all selected photos to finish loading, then try again.");
      const image = await loadImage(url);
      const stop = day.stops.find((item) => item.id === photo.stopId);
      await render(secondsPerPhoto, `Rendering photo ${index + 1} of ${selectedPhotos.length}`, (progress) => {
        context.save();
        context.fillStyle = "#102c22";
        context.fillRect(0, 0, canvas.width, canvas.height);
        drawCover(context, image, canvas.width, canvas.height, 1.02 + progress * 0.06, progress);
        if (theme === "polaroid") {
          context.strokeStyle = "rgba(255,255,255,.94)";
          context.lineWidth = 22;
          context.strokeRect(15, 15, canvas.width - 30, canvas.height - 30);
        }
        const fade = Math.min(1, progress / 0.13, (1 - progress) / 0.13);
        context.globalAlpha = Math.max(0, fade);
        const caption = captions[photo.stopId]?.trim();
        if (stop || caption) {
          const panelHeight = caption ? 190 : 120;
          context.fillStyle = "rgba(16, 44, 34, .78)";
          context.fillRect(0, canvas.height - panelHeight, canvas.width, panelHeight);
          context.fillStyle = "#eabf67";
          context.font = "700 24px Arial";
          context.fillText(stop?.title || "Trip memory", 45, canvas.height - panelHeight + 48);
          if (caption) {
            context.fillStyle = "#fffdf8";
            context.font = "28px Georgia";
            wrapCanvasText(context, caption, canvas.width - 90).slice(0, 3).forEach((line, lineIndex) => {
              context.fillText(line, 45, canvas.height - panelHeight + 91 + lineIndex * 35);
            });
          }
        }
        context.restore();
      });
    }

    await render(2, "Creating the closing card", () => {
      drawTitleCard(tripName, closingMessage || "Made together in Memory Lane");
    });
    recorder.stop();
    await stopped;
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    await stopped.catch(() => undefined);
    throw error;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }

  const outputType = recorder.mimeType || mimeType || "video/webm";
  return {
    blob: new Blob(chunks, { type: outputType }),
    extension: outputType.includes("mp4") ? "mp4" : "webm",
  };
}

export default function MemoryLane({
  tripName,
  days,
  currentMember,
  sharedPhotos,
  sharedPhotoUrls,
  galleryState,
  galleryError,
  selectedLocationStopId,
  locationDraftValue,
  placeSuggestions,
  placeSearchState,
  placeSearchError,
  onRefreshPhotos,
  onSaveMemory,
  onAddScrapbookEntry,
  onDeleteScrapbookEntry,
  onUpdateMapPresentation,
  onUpdateDayStory,
  highlights,
  onUpdateHighlights,
  onFocusLocation,
  onLocationChange,
  onUseTypedLocation,
  onChoosePlace,
}: MemoryLaneProps) {
  const [memoryView, setMemoryView] = useState<"highlights" | "days" | "map">("highlights");
  const [selectedDayId, setSelectedDayId] = useState(days[0]?.id ?? "");
  const [expandedMap, setExpandedMap] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<SharedPhoto | null>(null);
  const [mapGalleryStopId, setMapGalleryStopId] = useState("");
  const [mapPhotoPickerStopId, setMapPhotoPickerStopId] = useState("");
  const [mapPhotoDraftIds, setMapPhotoDraftIds] = useState<string[]>([]);
  const [editingMemoryStopId, setEditingMemoryStopId] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [scrapbookStopId, setScrapbookStopId] = useState("");
  const [scrapbookKind, setScrapbookKind] = useState<"note" | "photo">("note");
  const [scrapbookText, setScrapbookText] = useState("");
  const [scrapbookPhotoId, setScrapbookPhotoId] = useState("");
  const [scrapbookEmoji, setScrapbookEmoji] = useState("✨");
  const [scrapbookSticker, setScrapbookSticker] = useState<(typeof scrapbookStickers)[number]>("tape");
  const [scrapbookFrame, setScrapbookFrame] = useState<TripScrapbookEntry["frame"]>("polaroid");
  const [scrapbookFilter, setScrapbookFilter] = useState<TripScrapbookEntry["filter"]>("warm");
  const [highlightStep, setHighlightStep] = useState<HighlightStep>("scope");
  const [orientation, setOrientation] = useState<HighlightOrientation>("portrait");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [secondsPerPhoto, setSecondsPerPhoto] = useState(3);
  const [highlightTheme, setHighlightTheme] = useState<HighlightTheme>("postcard");
  const [highlightTitle, setHighlightTitle] = useState("");
  const [highlightClosing, setHighlightClosing] = useState("What a day to remember ✨");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [renderProgress, setRenderProgress] = useState({ completed: 0, total: 1, label: "" });
  const [renderError, setRenderError] = useState("");
  const [videoResult, setVideoResult] = useState<{ url: string; file: File } | null>(null);
  const hasChosenInitialDayRef = useRef(false);
  const renderCancelledRef = useRef(false);

  const selectedDay = days.find((day) => day.id === selectedDayId) ?? days[0];
  const dayPhotos = useMemo(
    () => selectedDay ? sharedPhotos.filter((photo) => photo.dayId === selectedDay.id) : [],
    [selectedDay, sharedPhotos],
  );
  const availableDayPhotos = useMemo(
    () => dayPhotos.filter((photo) => Boolean(sharedPhotoUrls[photo.fileId])),
    [dayPhotos, sharedPhotoUrls],
  );
  const selectedHighlightPhotos = useMemo(
    () => selectedPhotoIds
      .map((fileId) => availableDayPhotos.find((photo) => photo.fileId === fileId))
      .filter((photo): photo is SharedPhoto => Boolean(photo)),
    [availableDayPhotos, selectedPhotoIds],
  );
  const previewPhoto = selectedHighlightPhotos[previewIndex] ?? selectedHighlightPhotos[0];
  const selectedCoverPhoto = dayPhotos.find((photo) => photo.fileId === selectedDay?.coverPhotoId)
    ?? availableDayPhotos[0];
  const selectedCoverUrl = selectedCoverPhoto ? sharedPhotoUrls[selectedCoverPhoto.fileId] : "";
  const tripStatistics = useMemo(() => {
    const allStops = days.flatMap((day) => day.stops);
    const contributors = new Set([
      ...sharedPhotos.map((photo) => photo.memberId || photo.memberName),
      ...allStops.map((stop) => stop.memory?.updatedByMemberId).filter(Boolean),
    ]);
    const distance = days.reduce((tripTotal, day) => tripTotal + day.stops.reduce((dayTotal, stop, index) => (
      index === 0 ? dayTotal : dayTotal + distanceInKm(day.stops[index - 1], stop)
    ), 0), 0);
    return {
      stops: allStops.length,
      photos: sharedPhotos.length,
      contributors: contributors.size,
      memories: allStops.reduce((total, stop) => total + (stop.memory?.comment ? 1 : 0) + (stop.memory?.entries?.length ?? 0), 0),
      distance,
    };
  }, [days, sharedPhotos]);
  useEffect(() => {
    if (hasChosenInitialDayRef.current || sharedPhotos.length === 0) return;
    const latestDayWithPhotos = [...days].reverse().find((day) => sharedPhotos.some((photo) => photo.dayId === day.id));
    hasChosenInitialDayRef.current = true;
    if (!latestDayWithPhotos) return;
    const timer = window.setTimeout(() => setSelectedDayId(latestDayWithPhotos.id), 0);
    return () => window.clearTimeout(timer);
  }, [days, sharedPhotos]);

  useEffect(() => {
    if (highlightStep !== "preview" || selectedHighlightPhotos.length === 0) return;
    const timer = window.setInterval(() => {
      setPreviewIndex((current) => (current + 1) % selectedHighlightPhotos.length);
    }, secondsPerPhoto * 1000);
    return () => window.clearInterval(timer);
  }, [highlightStep, secondsPerPhoto, selectedHighlightPhotos.length]);

  useEffect(() => () => {
    if (videoResult) URL.revokeObjectURL(videoResult.url);
  }, [videoResult]);

  function selectDay(dayId: string) {
    hasChosenInitialDayRef.current = true;
    setSelectedDayId(dayId);
    setEditingMemoryStopId("");
  }

  function startEditingMemory(stop: TripStop) {
    setMemoryDraft(stop.memory?.comment ?? "");
    setEditingMemoryStopId(stop.id);
  }

  function saveMemory(stop: TripStop) {
    if (!selectedDay || !currentMember) return;
    onSaveMemory(selectedDay.id, stop.id, memoryDraft.trim());
    setEditingMemoryStopId("");
  }

  function openScrapbookComposer(stop: TripStop, photoId = "") {
    setScrapbookStopId(stop.id);
    setScrapbookKind(photoId ? "photo" : "note");
    setScrapbookPhotoId(photoId || stopPhotos(dayPhotos, selectedDay.id, stop.id)[0]?.fileId || "");
    setScrapbookText("");
    setScrapbookEmoji("✨");
    setScrapbookSticker(photoId ? "tape" : "postmark");
    setScrapbookFrame("polaroid");
    setScrapbookFilter("warm");
  }

  function saveScrapbookEntry() {
    if (!selectedDay || !scrapbookStopId || !currentMember) return;
    const photoId = scrapbookKind === "photo" ? scrapbookPhotoId : undefined;
    if (!scrapbookText.trim() && !photoId) return;
    onAddScrapbookEntry(selectedDay.id, scrapbookStopId, {
      kind: scrapbookKind,
      text: scrapbookText.trim(),
      photoId,
      emoji: scrapbookEmoji,
      sticker: scrapbookSticker,
      frame: scrapbookFrame,
      filter: scrapbookFilter,
    });
    setScrapbookStopId("");
  }

  function openMapPhotoPicker(stop: TripStop) {
    setMapPhotoPickerStopId(stop.id);
    const hiddenIds = new Set(stop.memory?.mapHiddenPhotoIds ?? []);
    setMapPhotoDraftIds(stopPhotos(dayPhotos, selectedDay.id, stop.id).filter((photo) => sharedPhotoUrls[photo.fileId] && !hiddenIds.has(photo.fileId)).map((photo) => photo.fileId));
  }

  function toggleMapPhoto(photoId: string) {
    setMapPhotoDraftIds((current) => current.includes(photoId)
      ? current.filter((id) => id !== photoId)
      : [...current, photoId]);
  }

  function saveMapPhotos() {
    if (!mapPhotoPickerStopId) return;
    const allPhotoIds = stopPhotos(dayPhotos, selectedDay.id, mapPhotoPickerStopId).map((photo) => photo.fileId);
    onUpdateMapPresentation(selectedDay.id, mapPhotoPickerStopId, { hiddenPhotoIds: allPhotoIds.filter((id) => !mapPhotoDraftIds.includes(id)) });
    setMapPhotoPickerStopId("");
  }

  function openHighlight() {
    if (!selectedDay) return;
    const defaults = availableDayPhotos.slice(0, 8).map((photo) => photo.fileId);
    setSelectedPhotoIds(defaults);
    setCaptionDrafts(Object.fromEntries(selectedDay.stops.map((stop) => [stop.id, stop.memory?.comment ?? ""])));
    setOrientation("portrait");
    setHighlightTheme("postcard");
    setHighlightTitle(selectedDay.storyTitle || selectedDay.label);
    setHighlightClosing("What a day to remember ✨");
    setSecondsPerPhoto(3);
    setPreviewIndex(0);
    setRenderError("");
    setHighlightStep("scope");
    setShowHighlight(true);
  }

  function closeHighlight() {
    if (highlightStep === "rendering") return;
    setShowHighlight(false);
    setHighlightStep("scope");
  }

  function toggleHighlightPhoto(photoId: string) {
    setSelectedPhotoIds((current) => current.includes(photoId)
      ? current.filter((id) => id !== photoId)
      : current.length < 20 ? [...current, photoId] : current);
  }

  function moveHighlightPhoto(index: number, direction: -1 | 1) {
    setSelectedPhotoIds((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  async function renderHighlight() {
    if (!selectedDay || selectedHighlightPhotos.length === 0) return;
    renderCancelledRef.current = false;
    setRenderError("");
    setRenderProgress({ completed: 0, total: 1, label: "Preparing your photos" });
    setHighlightStep("rendering");
    try {
      const result = await createHighlightVideo({
        tripName,
        day: selectedDay,
        selectedPhotos: selectedHighlightPhotos,
        photoUrls: sharedPhotoUrls,
        captions: captionDrafts,
        orientation,
        secondsPerPhoto,
        theme: highlightTheme,
        openingTitle: highlightTitle,
        closingMessage: highlightClosing,
        onProgress: (completed, total, label) => setRenderProgress({ completed, total, label }),
        isCancelled: () => renderCancelledRef.current,
      });
      if (videoResult) URL.revokeObjectURL(videoResult.url);
      const safeDayName = selectedDay.label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "trip-day";
      const file = new File([result.blob], `${safeDayName}-highlight.${result.extension}`, { type: result.blob.type });
      setVideoResult({ file, url: URL.createObjectURL(result.blob) });
      setHighlightStep("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setHighlightStep("arrange");
        return;
      }
      setRenderError(error instanceof Error ? error.message : "The highlight could not be created.");
      setHighlightStep("arrange");
    }
  }

  async function shareVideo() {
    if (!videoResult) return;
    try {
      if (navigator.share && navigator.canShare?.({ files: [videoResult.file] })) {
        await navigator.share({
          title: `${selectedDay?.label ?? "Trip"} highlight`,
          text: `A group trip highlight from ${tripName}`,
          files: [videoResult.file],
        });
        return;
      }
      const link = document.createElement("a");
      link.href = videoResult.url;
      link.download = videoResult.file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setRenderError("The video is still safe here, but the Share Sheet could not be opened.");
      }
    }
  }

  if (!selectedDay) {
    return <section className="memory-lane-page"><p className="gallery-alert">Add a day to begin Memory Lane.</p></section>;
  }

  return (
    <section className="memory-lane-page" aria-labelledby="memory-lane-title">
      <header className="memory-lane-heading">
        <div>
          <p className="eyebrow">Made together, remembered forever</p>
          <h1 id="memory-lane-title">Memory Lane</h1>
          <p>Make highlights, keep each day&apos;s scrapbook and revisit every place on the map.</p>
        </div>
      </header>

      <div className="memory-view-switch" role="group" aria-label="Memory Lane view">
        <button className={memoryView === "highlights" ? "active" : ""} onClick={() => setMemoryView("highlights")}><span>✦</span>Highlights</button>
        <button className={memoryView === "days" ? "active" : ""} onClick={() => setMemoryView("days")}><span>📖</span>Days</button>
        <button className={memoryView === "map" ? "active" : ""} onClick={() => setMemoryView("map")}><span>📍</span>Map</button>
      </div>

      {memoryView !== "highlights" && <nav className="memory-day-strip" aria-label="Memory Lane days">
        {days.map((day, index) => {
          const count = sharedPhotos.filter((photo) => photo.dayId === day.id).length;
          return (
            <button
              key={day.id}
              className={day.id === selectedDay.id ? "active" : ""}
              onClick={() => selectDay(day.id)}
            >
              <strong>Day {index + 1}</strong>
              <small>{count} photo{count === 1 ? "" : "s"}</small>
            </button>
          );
        })}
      </nav>}

      {galleryError && <p className="gallery-alert" role="alert">{galleryError}</p>}
      {galleryState === "offline" && (
        <p className="gallery-alert">Memory Lane needs an internet connection to open shared photos. Saved itinerary details remain available.</p>
      )}

      {memoryView === "highlights" && <><StoryBuilder
        days={days}
        currentMember={currentMember}
        photos={sharedPhotos}
        photoUrls={sharedPhotoUrls}
        highlights={highlights}
        onChange={onUpdateHighlights}
      /><section className="memory-clips-coming"><span>▶</span><div><strong>Short clips are next</strong><small>Soon you&apos;ll be able to turn selected moments into a music-backed clip here.</small></div></section></>}

      {memoryView === "days" && <div className="memory-lane-layout days-focus">
        <div className="memory-recap-column">
          <header className={`memory-day-heading ${selectedCoverUrl ? "has-cover" : ""}`}>
            {selectedCoverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedCoverUrl} alt="" className="memory-day-cover" />
            )}
            <div className="memory-day-heading-copy">
              <p>Day {days.findIndex((day) => day.id === selectedDay.id) + 1}</p>
              <h2>{selectedDay.label}</h2>
              {selectedDay.storyTitle && <strong>{selectedDay.storyTitle}</strong>}
              <time dateTime={selectedDay.date}>{memoryDate(selectedDay.date)}</time>
              <button className="memory-cover-button" onClick={() => setShowCoverPicker(true)} disabled={!currentMember || availableDayPhotos.length === 0}>
                {selectedDay.coverPhotoId ? "Change cover photo" : "Choose a cover photo"}
              </button>
            </div>
          </header>

          {selectedDay.stops.length === 0 && (
            <div className="memory-empty-day">
              <strong>No stops yet</strong>
              <p>Add itinerary stops to build this day&apos;s story.</p>
            </div>
          )}

          {selectedDay.stops.map((stop, index) => {
            const photos = stopPhotos(dayPhotos, selectedDay.id, stop.id);
            const isLocationTarget = selectedLocationStopId === stop.id;
            const hasCoordinates = Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude);
            const editing = editingMemoryStopId === stop.id;
            return (
              <article
                className="memory-stop-card"
                key={stop.id}
                tabIndex={-1}
              >
                <header className="memory-stop-heading">
                  <span>{index + 1}</span>
                  <div>
                    <p>Stop {index + 1}</p>
                    <h3>{stop.title}</h3>
                  </div>
                  <time>{stop.time}</time>
                </header>

                {hasCoordinates ? (
                  <a
                    className="memory-location-link"
                    href={stop.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.place)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span aria-hidden="true">●</span>{stop.place || "Saved map location"} ↗
                  </a>
                ) : (
                  <div className="memory-missing-location">
                    <strong>This stop needs a map location</strong>
                    <input
                      type="search"
                      value={isLocationTarget && locationDraftValue !== null ? locationDraftValue : stop.place}
                      onFocus={() => onFocusLocation(selectedDay.id, stop.id)}
                      onChange={(event) => onLocationChange(selectedDay.id, stop.id, event.target.value)}
                      placeholder="Search Mapbox location"
                      aria-label={`Mapbox location for ${stop.title}`}
                      autoComplete="off"
                      readOnly={!currentMember}
                    />
                    {isLocationTarget && placeSearchState === "searching" && <small>Searching Mapbox…</small>}
                    {isLocationTarget && placeSuggestions.length > 0 && (
                      <div className="memory-place-suggestions">
                        {placeSuggestions.map((suggestion) => (
                          <button
                            key={suggestion.placeId}
                            onClick={() => onChoosePlace(suggestion)}
                            disabled={placeSearchState === "choosing"}
                          >
                            <strong>{suggestion.text}</strong>
                            {suggestion.secondaryText && suggestion.secondaryText !== suggestion.text && <small>{suggestion.secondaryText}</small>}
                          </button>
                        ))}
                        <small>Powered by Mapbox</small>
                      </div>
                    )}
                    {isLocationTarget && locationDraftValue !== null && locationDraftValue.trim() !== stop.place.trim() && (
                      <button className="location-confirm-button" type="button" onClick={() => onUseTypedLocation(selectedDay.id, stop.id)}>
                        {locationDraftValue.trim() ? "Use typed location" : "Clear saved location"}
                      </button>
                    )}
                    {isLocationTarget && placeSearchError && <small className="error">{placeSearchError}</small>}
                  </div>
                )}

                {photos.length > 0 ? (
                  <div className="memory-photo-row" aria-label={`Photos from ${stop.title}`}>
                    {photos.map((photo) => {
                      const url = sharedPhotoUrls[photo.fileId];
                      return (
                        <button key={photo.fileId} onClick={() => url && setLightboxPhoto(photo)} disabled={!url}>
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={`${photo.memberName}'s memory at ${stop.title}`} loading="lazy" />
                          ) : (
                            <span>Loading…</span>
                          )}
                          <small>{photo.memberName}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="memory-no-photos">No snapshots yet. This part of the story is still waiting.</p>
                )}

                <section className="scrapbook-stop" aria-label={`Scrapbook memories for ${stop.title}`}>
                  <header>
                    <div><span aria-hidden="true">✦</span><strong>Our scrapbook</strong></div>
                    <button onClick={() => openScrapbookComposer(stop)} disabled={!currentMember}>+ Add a memory</button>
                  </header>
                  {(stop.memory?.entries?.length ?? 0) > 0 ? (
                    <div className="scrapbook-card-grid">
                      {stop.memory!.entries!.map((entry, entryIndex) => {
                        const photoUrl = entry.photoId ? sharedPhotoUrls[entry.photoId] : "";
                        return (
                          <article className={`scrapbook-card ${entry.kind} ${entry.frame || "polaroid"} tilt-${entryIndex % 3}`} key={entry.id}>
                            {entry.sticker && entry.sticker !== "none" && <span className={`scrapbook-sticker ${entry.sticker}`} aria-hidden="true">{entry.sticker === "heart" ? "♡" : entry.sticker === "sparkles" ? "✦" : entry.sticker === "postmark" ? "VIENNA" : entry.sticker === "ticket" ? "ADMIT ONE" : ""}</span>}
                            {photoUrl && (
                              <button className="scrapbook-photo" onClick={() => setLightboxPhoto(sharedPhotos.find((photo) => photo.fileId === entry.photoId) ?? null)}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img className={`filter-${entry.filter || "none"}`} src={photoUrl} alt={`${entry.memberName}'s scrapbook memory`} loading="lazy" />
                              </button>
                            )}
                            <div className="scrapbook-card-copy">
                              {entry.emoji && <b aria-label="Decoration">{entry.emoji}</b>}
                              {entry.text && <p>{entry.text}</p>}
                              <small>— {entry.memberName}</small>
                            </div>
                            {entry.memberId === currentMember?.id && <button className="scrapbook-delete" onClick={() => onDeleteScrapbookEntry(selectedDay.id, stop.id, entry.id)} aria-label="Delete this scrapbook memory">×</button>}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <button className="scrapbook-blank-page" onClick={() => openScrapbookComposer(stop)} disabled={!currentMember}>
                      <span>📖</span><strong>Start this page</strong><small>Add a thought, quote, emoji or decorated photo.</small>
                    </button>
                  )}
                </section>

                {editing ? (
                  <div className="memory-comment-editor">
                    <label htmlFor={`memory-${stop.id}`}>Shared group memory</label>
                    <textarea
                      id={`memory-${stop.id}`}
                      value={memoryDraft}
                      onChange={(event) => setMemoryDraft(event.target.value)}
                      maxLength={1000}
                      placeholder="What should the group remember about this stop?"
                      autoFocus
                    />
                    <div>
                      <button className="secondary-button" onClick={() => setEditingMemoryStopId("")}>Cancel</button>
                      <button className="primary-button" onClick={() => saveMemory(stop)}>Save memory</button>
                    </div>
                  </div>
                ) : stop.memory?.comment ? (
                  <div className="memory-comment">
                    <p>“{stop.memory.comment}”</p>
                    <small>Last edited by {stop.memory.updatedByMemberName}</small>
                    <button className="text-button" onClick={() => startEditingMemory(stop)} disabled={!currentMember}>Edit memory</button>
                  </div>
                ) : (
                  <button className="memory-add-comment" onClick={() => startEditingMemory(stop)} disabled={!currentMember}>+ Add memory</button>
                )}
              </article>
            );
          })}

          <p className="memory-day-closing">And that was Day {days.findIndex((day) => day.id === selectedDay.id) + 1}.</p>
          <button className="memory-create-bottom" onClick={openHighlight} disabled={availableDayPhotos.length === 0}>
            Create Day {days.findIndex((day) => day.id === selectedDay.id) + 1} Video
          </button>
          {galleryState !== "loading" && (
            <button className="text-button memory-refresh" onClick={onRefreshPhotos}>Refresh shared photos</button>
          )}
        </div>
      </div>}

      {memoryView === "map" && (
        <div className="memory-map-page">
        <section className="memory-map-overview" aria-label="Photo memory map">
          <MemoryMap day={selectedDay} photos={dayPhotos} photoUrls={sharedPhotoUrls} onPin={setMapGalleryStopId} />
          <div className="memory-map-footer"><span>Photos are added to their stop automatically. Tap a pin to browse them.</span><button className="text-button" onClick={() => setExpandedMap(true)}>Expand map</button></div>
        </section>
        <section className="trip-statistics" aria-labelledby="trip-statistics-title">
          <header><p className="eyebrow">Our adventure by numbers</p><h2 id="trip-statistics-title">Trip Statistics</h2></header>
          <div><article><strong>{days.length}</strong><span>Days</span></article><article><strong>{tripStatistics.stops}</strong><span>Stops</span></article><article><strong>{tripStatistics.photos}</strong><span>Snapshots</span></article><article><strong>{tripStatistics.memories}</strong><span>Stories</span></article><article><strong>{tripStatistics.contributors}</strong><span>Storytellers</span></article><article><strong>{tripStatistics.distance < 1 ? "—" : `${Math.round(tripStatistics.distance)} km`}</strong><span>Between pins</span></article></div>
          <small>Distance is a straight-line estimate between consecutive mapped stops.</small>
        </section>
        <section className="memory-map-curator" aria-labelledby="memory-map-curator-title">
          <header><div><p className="eyebrow">Make it yours</p><h2 id="memory-map-curator-title">Photo pins</h2></div><small>Hide a photo or place without deleting it</small></header>
          <div>
            {selectedDay.stops.filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)).map((stop, index) => {
              const available = stopPhotos(dayPhotos, selectedDay.id, stop.id).filter((photo) => sharedPhotoUrls[photo.fileId]);
              const hiddenIds = new Set(stop.memory?.mapHiddenPhotoIds ?? []);
              const selected = available.filter((photo) => !hiddenIds.has(photo.fileId)).map((photo) => photo.fileId);
              const pinHidden = Boolean(stop.memory?.mapHidden);
              return <article className={pinHidden ? "hidden-pin" : ""} key={stop.id}>
                <span>{index + 1}</span>
                <div><strong>{stop.title}</strong><small>{pinHidden ? "Hidden from Memory Map" : selected.length ? `${selected.length} photo${selected.length === 1 ? "" : "s"} shown automatically` : available.length ? "All photos hidden" : "Waiting for photos"}</small></div>
                <div className="memory-map-mini-photos">{selected.slice(0, 3).map((fileId) => <img key={fileId} src={sharedPhotoUrls[fileId]} alt="" />)}</div>
                <div className="memory-map-row-actions"><button onClick={() => openMapPhotoPicker(stop)} disabled={!currentMember || available.length === 0}>Edit photos</button><button onClick={() => onUpdateMapPresentation(selectedDay.id, stop.id, { hidden: !pinHidden })} disabled={!currentMember}>{pinHidden ? "Restore pin" : "Hide pin"}</button></div>
              </article>;
            })}
          </div>
        </section>
        </div>
      )}

      {mapGalleryStopId && (() => {
        const stop = selectedDay.stops.find((item) => item.id === mapGalleryStopId);
        if (!stop) return null;
        const available = stopPhotos(dayPhotos, selectedDay.id, stop.id).filter((photo) => sharedPhotoUrls[photo.fileId]);
        const hiddenIds = new Set(stop.memory?.mapHiddenPhotoIds ?? []);
        const highlights = available.filter((photo) => !hiddenIds.has(photo.fileId));
        return <div className="modal-backdrop memory-map-gallery-backdrop" role="presentation" onMouseDown={() => setMapGalleryStopId("")}>
          <section className="modal memory-map-gallery" role="dialog" aria-modal="true" aria-labelledby="memory-map-gallery-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="highlight-close" onClick={() => setMapGalleryStopId("")} aria-label="Close location memories">×</button>
            <p className="eyebrow">{stop.place || `Stop ${selectedDay.stops.indexOf(stop) + 1}`}</p>
            <h2 id="memory-map-gallery-title">{stop.title}</h2>
            {highlights.length > 0 ? <div className="memory-map-gallery-grid">{highlights.map((photo, index) => <button key={photo.fileId} onClick={() => setLightboxPhoto(photo)}>
              <img src={sharedPhotoUrls[photo.fileId]} alt={`${photo.memberName}'s photo at ${stop.title}`} />
              <span>{index + 1}</span><small>{photo.memberName}</small>
            </button>)}</div> : <div className="memory-map-gallery-empty"><span>📍</span><strong>No photos shown here</strong><small>Restore any hidden photos, or upload snapshots to this stop.</small></div>}
            <div className="modal-actions"><button className="secondary-button" onClick={() => setMapGalleryStopId("")}>Done</button><button className="primary-button" onClick={() => { setMapGalleryStopId(""); openMapPhotoPicker(stop); }} disabled={!currentMember || available.length === 0}>Choose shown photos</button></div>
          </section>
        </div>;
      })()}

      {mapPhotoPickerStopId && (() => {
        const stop = selectedDay.stops.find((item) => item.id === mapPhotoPickerStopId);
        if (!stop) return null;
        const available = stopPhotos(dayPhotos, selectedDay.id, stop.id).filter((photo) => sharedPhotoUrls[photo.fileId]);
        return <div className="modal-backdrop memory-map-gallery-backdrop" role="presentation" onMouseDown={() => setMapPhotoPickerStopId("")}>
          <section className="modal memory-map-picker" role="dialog" aria-modal="true" aria-labelledby="memory-map-picker-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="highlight-close" onClick={() => setMapPhotoPickerStopId("")} aria-label="Close photo picker">×</button>
            <p className="eyebrow">Photo pin · {stop.title}</p>
            <h2 id="memory-map-picker-title">Photos shown at this pin</h2>
            <p className="modal-copy">All stop photos appear automatically. Deselect any you do not want shown on this map.</p>
            <div className="memory-map-picker-grid">{available.map((photo) => {
              const selectedIndex = mapPhotoDraftIds.indexOf(photo.fileId);
              return <button className={selectedIndex >= 0 ? "selected" : ""} key={photo.fileId} onClick={() => toggleMapPhoto(photo.fileId)}>
                <img src={sharedPhotoUrls[photo.fileId]} alt={`Select ${photo.memberName}'s photo`} />
                {selectedIndex >= 0 && <span>{selectedIndex + 1}</span>}
                <small>{photo.memberName}</small>
              </button>;
            })}</div>
            <div className="memory-map-picker-count"><strong>{mapPhotoDraftIds.length} shown on the map</strong><small>This does not delete or privatise any photo.</small></div>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setMapPhotoPickerStopId("")}>Cancel</button><button className="primary-button" onClick={saveMapPhotos}>Save photo pin</button></div>
          </section>
        </div>;
      })()}

      {expandedMap && (
        <div className="memory-expanded-map" role="dialog" aria-modal="true" aria-label={`Expanded map for ${selectedDay.label}`}>
          <button className="memory-map-close" onClick={() => setExpandedMap(false)} aria-label="Close expanded map">×</button>
          <MemoryMap day={selectedDay} photos={dayPhotos} photoUrls={sharedPhotoUrls} expanded onPin={(stopId) => { setExpandedMap(false); setMapGalleryStopId(stopId); }} />
        </div>
      )}

      {lightboxPhoto && sharedPhotoUrls[lightboxPhoto.fileId] && (
        <div className="memory-lightbox" role="dialog" aria-modal="true" aria-label="Photo preview" onClick={() => setLightboxPhoto(null)}>
          <button aria-label="Close photo">×</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sharedPhotoUrls[lightboxPhoto.fileId]} alt={`${lightboxPhoto.memberName}'s trip memory`} onClick={(event) => event.stopPropagation()} />
          <small>{lightboxPhoto.memberName}&apos;s snapshot</small>
        </div>
      )}

      {scrapbookStopId && (() => {
        const scrapbookStop = selectedDay.stops.find((stop) => stop.id === scrapbookStopId);
        const scrapbookPhotos = scrapbookStop ? stopPhotos(dayPhotos, selectedDay.id, scrapbookStop.id).filter((photo) => sharedPhotoUrls[photo.fileId]) : [];
        if (!scrapbookStop) return null;
        return (
          <div className="modal-backdrop scrapbook-backdrop" role="presentation" onMouseDown={() => setScrapbookStopId("")}>
            <section className="modal scrapbook-composer" role="dialog" aria-modal="true" aria-labelledby="scrapbook-composer-title" onMouseDown={(event) => event.stopPropagation()}>
              <button className="highlight-close" onClick={() => setScrapbookStopId("")} aria-label="Close scrapbook editor">×</button>
              <p className="eyebrow">{scrapbookStop.title}</p>
              <h2 id="scrapbook-composer-title">Make a memory</h2>
              <div className="scrapbook-kind-picker">
                <button className={scrapbookKind === "note" ? "active" : ""} onClick={() => setScrapbookKind("note")}>✍️ Thought or quote</button>
                <button className={scrapbookKind === "photo" ? "active" : ""} onClick={() => setScrapbookKind("photo")} disabled={scrapbookPhotos.length === 0}>📷 Decorated photo</button>
              </div>
              {scrapbookKind === "photo" && (
                <div className="scrapbook-photo-picker">
                  {scrapbookPhotos.map((photo) => <button className={scrapbookPhotoId === photo.fileId ? "selected" : ""} key={photo.fileId} onClick={() => setScrapbookPhotoId(photo.fileId)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sharedPhotoUrls[photo.fileId]} alt={`Choose ${photo.memberName}'s photo`} />
                    {scrapbookPhotoId === photo.fileId && <span>✓</span>}
                  </button>)}
                </div>
              )}
              <label>Your words
                <textarea value={scrapbookText} onChange={(event) => setScrapbookText(event.target.value)} maxLength={400} placeholder="A funny quote, a tiny detail, or what this moment felt like…" />
              </label>
              <fieldset className="scrapbook-options"><legend>Pick an emoji</legend><div className="scrapbook-emoji-row">{scrapbookEmojis.map((emoji) => <button className={scrapbookEmoji === emoji ? "active" : ""} key={emoji} onClick={() => setScrapbookEmoji(emoji)}>{emoji}</button>)}</div></fieldset>
              <div className="scrapbook-style-row">
                <label>Frame<select value={scrapbookFrame} onChange={(event) => setScrapbookFrame(event.target.value as TripScrapbookEntry["frame"])}>{scrapbookFrames.map((frame) => <option key={frame} value={frame}>{frame[0].toUpperCase() + frame.slice(1)}</option>)}</select></label>
                <label>Photo look<select value={scrapbookFilter} onChange={(event) => setScrapbookFilter(event.target.value as TripScrapbookEntry["filter"])}>{scrapbookFilters.map((filter) => <option key={filter} value={filter}>{filter[0].toUpperCase() + filter.slice(1)}</option>)}</select></label>
                <label>Decoration<select value={scrapbookSticker} onChange={(event) => setScrapbookSticker(event.target.value as (typeof scrapbookStickers)[number])}>{scrapbookStickers.map((sticker) => <option key={sticker} value={sticker}>{sticker[0].toUpperCase() + sticker.slice(1)}</option>)}</select></label>
              </div>
              <div className="scrapbook-live-preview">
                {scrapbookKind === "photo" && scrapbookPhotoId && <img className={`filter-${scrapbookFilter}`} src={sharedPhotoUrls[scrapbookPhotoId]} alt="Scrapbook preview" />}
                <div><b>{scrapbookEmoji}</b><p>{scrapbookText || "Your memory will appear here…"}</p><small>— {currentMember?.name}</small></div>
              </div>
              <div className="modal-actions"><button className="secondary-button" onClick={() => setScrapbookStopId("")}>Cancel</button><button className="primary-button" onClick={saveScrapbookEntry} disabled={!scrapbookText.trim() && !(scrapbookKind === "photo" && scrapbookPhotoId)}>Add to scrapbook</button></div>
            </section>
          </div>
        );
      })()}

      {showCoverPicker && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCoverPicker(false)}>
          <section className="modal memory-cover-modal" role="dialog" aria-modal="true" aria-labelledby="cover-picker-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Set the scene</p>
            <h2 id="cover-picker-title">Choose this day&apos;s cover</h2>
            <p className="modal-copy">Pick the photo that brings the whole day rushing back.</p>
            <div className="memory-cover-grid">
              {availableDayPhotos.map((photo) => {
                const url = sharedPhotoUrls[photo.fileId];
                const selected = selectedDay.coverPhotoId === photo.fileId;
                return (
                  <button
                    className={selected ? "selected" : ""}
                    key={photo.fileId}
                    onClick={() => {
                      onUpdateDayStory(selectedDay.id, { coverPhotoId: photo.fileId });
                      setShowCoverPicker(false);
                    }}
                    aria-pressed={selected}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`${photo.memberName}'s snapshot`} />
                    <small>{selected ? "Current cover" : `By ${photo.memberName}`}</small>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              {selectedDay.coverPhotoId && (
                <button className="text-button" onClick={() => { onUpdateDayStory(selectedDay.id, { coverPhotoId: "" }); setShowCoverPicker(false); }}>Use first photo automatically</button>
              )}
              <button className="secondary-button" onClick={() => setShowCoverPicker(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}

      {showHighlight && (
        <div className="modal-backdrop highlight-backdrop" role="presentation" onMouseDown={closeHighlight}>
          <section className="modal highlight-modal" role="dialog" aria-modal="true" aria-labelledby="highlight-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="highlight-close" onClick={closeHighlight} disabled={highlightStep === "rendering"} aria-label="Close highlight maker">×</button>

            {highlightStep === "scope" && (
              <>
                <p className="eyebrow">Create a highlight</p>
                <h2 id="highlight-title">Choose your format</h2>
                <div className="highlight-scope-card">
                  <span>Day {days.findIndex((day) => day.id === selectedDay.id) + 1}</span>
                  <strong>{selectedDay.label}</strong>
                  <small>{availableDayPhotos.length} ready photo{availableDayPhotos.length === 1 ? "" : "s"}</small>
                </div>
                <label className="highlight-title-field">Opening title<input value={highlightTitle} onChange={(event) => setHighlightTitle(event.target.value)} maxLength={70} placeholder="Our unforgettable day" /></label>
                <fieldset className="highlight-theme-picker">
                  <legend>Movie style</legend>
                  {(["postcard", "adventure", "polaroid", "cinematic"] as HighlightTheme[]).map((theme) => (
                    <button type="button" className={`${theme} ${highlightTheme === theme ? "active" : ""}`} key={theme} onClick={() => setHighlightTheme(theme)}>
                      <span aria-hidden="true">{theme === "postcard" ? "💌" : theme === "adventure" ? "✈️" : theme === "polaroid" ? "📸" : "🎬"}</span>
                      <strong>{theme[0].toUpperCase() + theme.slice(1)}</strong>
                    </button>
                  ))}
                </fieldset>
                <fieldset className="highlight-orientation">
                  <legend>Format</legend>
                  <label className={orientation === "portrait" ? "active" : ""}>
                    <input type="radio" checked={orientation === "portrait"} onChange={() => setOrientation("portrait")} />
                    <span>Portrait<small>Best for iPhone</small></span>
                  </label>
                  <label className={orientation === "landscape" ? "active" : ""}>
                    <input type="radio" checked={orientation === "landscape"} onChange={() => setOrientation("landscape")} />
                    <span>Landscape<small>Best for TV or laptop</small></span>
                  </label>
                </fieldset>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={closeHighlight}>Cancel</button>
                  <button className="primary-button" onClick={() => setHighlightStep("photos")} disabled={availableDayPhotos.length === 0}>Choose photos →</button>
                </div>
              </>
            )}

            {highlightStep === "photos" && (
              <>
                <p className="eyebrow">Choose photos</p>
                <h2 id="highlight-title">{selectedPhotoIds.length} of 20 selected</h2>
                <p className="modal-copy">Pick favourite moments and adjust the caption for each stop.</p>
                <div className="highlight-photo-groups">
                  {selectedDay.stops.map((stop, index) => {
                    const photos = availableDayPhotos.filter((photo) => photo.stopId === stop.id);
                    if (photos.length === 0) return null;
                    return (
                      <section key={stop.id}>
                        <h3><span>{index + 1}</span>{stop.title}</h3>
                        <div className="highlight-photo-picker">
                          {photos.map((photo) => {
                            const selected = selectedPhotoIds.includes(photo.fileId);
                            return (
                              <button className={selected ? "selected" : ""} key={photo.fileId} onClick={() => toggleHighlightPhoto(photo.fileId)} aria-pressed={selected}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={sharedPhotoUrls[photo.fileId]} alt={`Select ${photo.memberName}'s photo`} />
                                <span>{selected ? "✓" : "+"}</span>
                              </button>
                            );
                          })}
                        </div>
                        <label>
                          Caption
                          <textarea
                            value={captionDrafts[stop.id] ?? ""}
                            onChange={(event) => setCaptionDrafts((current) => ({ ...current, [stop.id]: event.target.value }))}
                            maxLength={180}
                            placeholder="Add a short memory for the video"
                          />
                        </label>
                      </section>
                    );
                  })}
                </div>
                <p className="highlight-length">Estimated length: about {4 + selectedPhotoIds.length * secondsPerPhoto} seconds</p>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setHighlightStep("scope")}>Back</button>
                  <button className="primary-button" onClick={() => setHighlightStep("arrange")} disabled={selectedPhotoIds.length === 0}>Arrange Highlight →</button>
                </div>
              </>
            )}

            {highlightStep === "arrange" && (
              <>
                <p className="eyebrow">Arrange highlight</p>
                <h2 id="highlight-title">Your sequence</h2>
                <p className="modal-copy">Use the arrows to change the order. The video uses a gentle fade and subtle movement.</p>
                <div className="highlight-sequence">
                  {selectedHighlightPhotos.map((photo, index) => (
                    <div key={photo.fileId}>
                      <span>{index + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sharedPhotoUrls[photo.fileId]} alt="" />
                      <strong>{selectedDay.stops.find((stop) => stop.id === photo.stopId)?.title}</strong>
                      <button onClick={() => moveHighlightPhoto(index, -1)} disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`}>↑</button>
                      <button onClick={() => moveHighlightPhoto(index, 1)} disabled={index === selectedHighlightPhotos.length - 1} aria-label={`Move photo ${index + 1} later`}>↓</button>
                      <button onClick={() => toggleHighlightPhoto(photo.fileId)} aria-label={`Remove photo ${index + 1}`}>×</button>
                    </div>
                  ))}
                </div>
                <label className="highlight-duration">
                  Photo duration
                  <select value={secondsPerPhoto} onChange={(event) => setSecondsPerPhoto(Number(event.target.value))}>
                    <option value={2}>2 seconds</option>
                    <option value={3}>3 seconds</option>
                    <option value={4}>4 seconds</option>
                  </select>
                </label>
                <label className="highlight-closing">Closing message<input value={highlightClosing} onChange={(event) => setHighlightClosing(event.target.value)} maxLength={90} placeholder="What a day to remember ✨" /></label>
                <p className="highlight-length">About {4 + selectedPhotoIds.length * secondsPerPhoto} seconds · 720p · no music</p>
                {renderError && <p className="gallery-alert" role="alert">{renderError}</p>}
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setHighlightStep("photos")}>Back</button>
                  <button className="secondary-button" onClick={() => { setPreviewIndex(0); setHighlightStep("preview"); }}>Preview</button>
                  <button className="primary-button" onClick={() => void renderHighlight()}>Create Video</button>
                </div>
              </>
            )}

            {highlightStep === "preview" && previewPhoto && (
              <>
                <p className="eyebrow">Preview</p>
                <h2 id="highlight-title">Your day in motion</h2>
                <div className={`highlight-preview ${orientation}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sharedPhotoUrls[previewPhoto.fileId]} alt="Highlight preview" />
                  <div>
                    <strong>{selectedDay.stops.find((stop) => stop.id === previewPhoto.stopId)?.title}</strong>
                    <span>{captionDrafts[previewPhoto.stopId]}</span>
                  </div>
                </div>
                <div className="highlight-preview-dots">
                  {selectedHighlightPhotos.map((photo, index) => (
                    <button key={photo.fileId} className={index === previewIndex ? "active" : ""} onClick={() => setPreviewIndex(index)} aria-label={`Preview photo ${index + 1}`} />
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setHighlightStep("arrange")}>Edit</button>
                  <button className="primary-button" onClick={() => void renderHighlight()}>Create Video</button>
                </div>
              </>
            )}

            {highlightStep === "rendering" && (
              <>
                <p className="eyebrow">Creating your highlight</p>
                <h2 id="highlight-title">{Math.round((renderProgress.completed / renderProgress.total) * 100)}%</h2>
                <progress className="highlight-progress" max={renderProgress.total} value={renderProgress.completed} aria-label="Video creation progress" />
                <p className="highlight-render-label">{renderProgress.label}</p>
                <p className="modal-copy">Keep this app open until your video is ready. Your original photos remain unchanged.</p>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => { renderCancelledRef.current = true; }}>Cancel</button>
                </div>
              </>
            )}

            {highlightStep === "done" && videoResult && (
              <>
                <p className="eyebrow">Your highlight is ready</p>
                <h2 id="highlight-title">{selectedDay.label}</h2>
                <video className="highlight-video" src={videoResult.url} controls playsInline />
                {renderError && <p className="gallery-alert" role="alert">{renderError}</p>}
                <p className="modal-copy">On iPhone, tap Share and choose <strong>Save Video</strong> to place it in Apple Photos. The generated video stays on your device unless you choose to share it.</p>
                <div className="modal-actions">
                  <button className="secondary-button" onClick={() => setHighlightStep("scope")}>Create Another</button>
                  <button className="primary-button" onClick={() => void shareVideo()}>Save or Share Video</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

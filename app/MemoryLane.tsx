"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PlaceSuggestion,
  SharedPhoto,
  TripDay,
  TripMember,
  TripStop,
} from "../lib/googleDrive";

type MemoryLaneProps = {
  tripName: string;
  days: TripDay[];
  currentMember?: TripMember;
  sharedPhotos: SharedPhoto[];
  sharedPhotoUrls: Record<string, string>;
  galleryState: "idle" | "loading" | "ready" | "offline" | "error";
  galleryError: string | null;
  selectedLocationStopId: string;
  placeSuggestions: PlaceSuggestion[];
  placeSearchState: "idle" | "searching" | "choosing";
  placeSearchError: string | null;
  onRefreshPhotos: () => void;
  onSaveMemory: (dayId: string, stopId: string, comment: string) => void;
  onFocusLocation: (dayId: string, stopId: string) => void;
  onLocationChange: (dayId: string, stopId: string, value: string) => void;
  onChoosePlace: (suggestion: PlaceSuggestion) => void;
};

type LeafletMap = {
  remove: () => void;
  fitBounds: (bounds: [number, number][], options?: Record<string, unknown>) => void;
  invalidateSize: () => void;
};
type LeafletLayer = {
  addTo: (map: LeafletMap) => LeafletLayer;
  bindPopup: (content: string) => LeafletLayer;
  on: (event: string, handler: () => void) => LeafletLayer;
};
type LeafletApi = {
  map: (element: HTMLElement) => LeafletMap & { setView: (center: [number, number], zoom: number) => LeafletMap };
  tileLayer: (url: string, options: Record<string, unknown>) => LeafletLayer;
  marker: (position: [number, number], options: Record<string, unknown>) => LeafletLayer;
  polyline: (positions: [number, number][], options: Record<string, unknown>) => LeafletLayer;
  divIcon: (options: Record<string, unknown>) => unknown;
};

type HighlightOrientation = "portrait" | "landscape";
type HighlightStep = "scope" | "photos" | "arrange" | "preview" | "rendering" | "done";

let memoryLeafletLoader: Promise<LeafletApi> | null = null;

function loadLeaflet(): Promise<LeafletApi> {
  if (memoryLeafletLoader) return memoryLeafletLoader;
  memoryLeafletLoader = new Promise((resolve, reject) => {
    const leafletWindow = window as Window & { L?: LeafletApi };
    if (leafletWindow.L) {
      resolve(leafletWindow.L);
      return;
    }
    if (!document.querySelector('link[data-family-leaflet="true"]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      stylesheet.dataset.familyLeaflet = "true";
      document.head.appendChild(stylesheet);
    }
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-family-leaflet="true"]');
    const script = existingScript ?? document.createElement("script");
    const finish = () => leafletWindow.L
      ? resolve(leafletWindow.L)
      : reject(new Error("The map could not be opened."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("The map could not be downloaded.")), { once: true });
    if (!existingScript) {
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.dataset.familyLeaflet = "true";
      document.head.appendChild(script);
    }
  });
  return memoryLeafletLoader;
}

function escapeMapText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

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

function MemoryMap({
  day,
  photos,
  expanded,
  onPin,
}: {
  day: TripDay;
  photos: SharedPhoto[];
  expanded?: boolean;
  onPin: (stopId: string) => void;
}) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState("");
  const locatedStops = day.stops.filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));

  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | null = null;
    void loadLeaflet()
      .then((leaflet) => {
        if (disposed || !mapElementRef.current) return;
        map = leaflet.map(mapElementRef.current).setView([48.2082, 16.3738], 12);
        leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);

        const bounds: [number, number][] = [];
        day.stops.forEach((stop, index) => {
          if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return;
          const position: [number, number] = [stop.latitude!, stop.longitude!];
          const photoCount = stopPhotos(photos, day.id, stop.id).length;
          bounds.push(position);
          const icon = leaflet.divIcon({
            className: "memory-map-marker-wrap",
            html: `<span class="memory-map-marker"><b>${index + 1}</b>${photoCount > 0 ? `<small>${photoCount}</small>` : ""}</span>`,
            iconSize: [42, 48],
            iconAnchor: [21, 48],
          });
          leaflet.marker(position, { icon })
            .addTo(map!)
            .bindPopup(`<strong>Stop ${index + 1}: ${escapeMapText(stop.title)}</strong><br>${photoCount} photo${photoCount === 1 ? "" : "s"}`)
            .on("click", () => onPin(stop.id));
        });
        if (bounds.length > 1) {
          leaflet.polyline(bounds, {
            color: "#d8795e",
            weight: 4,
            opacity: 0.82,
            dashArray: "8 8",
          }).addTo(map);
        }
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [42, 42], maxZoom: 15 });
        window.setTimeout(() => map?.invalidateSize(), 50);
      })
      .catch((error: unknown) => {
        if (!disposed) setMapError(error instanceof Error ? error.message : "The map could not be opened.");
      });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [day, expanded, onPin, photos]);

  return (
    <div className={`memory-map-wrap ${expanded ? "expanded" : ""}`}>
      <div ref={mapElementRef} className="memory-map-canvas" aria-label={`Memory map for ${day.label}`} />
      {locatedStops.length === 0 && !mapError && (
        <p className="memory-map-message">Add a Google location to a stop to place its photo pin.</p>
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

  const drawTitleCard = (heading: string, subheading: string) => {
    const { width, height } = canvas;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#214d3c");
    gradient.addColorStop(1, "#102c22");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#eabf67";
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
      drawTitleCard(day.label, memoryDate(day.date));
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
      drawTitleCard(tripName, "Made together in Memory Lane");
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
  placeSuggestions,
  placeSearchState,
  placeSearchError,
  onRefreshPhotos,
  onSaveMemory,
  onFocusLocation,
  onLocationChange,
  onChoosePlace,
}: MemoryLaneProps) {
  const [selectedDayId, setSelectedDayId] = useState(days[0]?.id ?? "");
  const [expandedMap, setExpandedMap] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<SharedPhoto | null>(null);
  const [editingMemoryStopId, setEditingMemoryStopId] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [showHighlight, setShowHighlight] = useState(false);
  const [highlightStep, setHighlightStep] = useState<HighlightStep>("scope");
  const [orientation, setOrientation] = useState<HighlightOrientation>("portrait");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [secondsPerPhoto, setSecondsPerPhoto] = useState(3);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [renderProgress, setRenderProgress] = useState({ completed: 0, total: 1, label: "" });
  const [renderError, setRenderError] = useState("");
  const [videoResult, setVideoResult] = useState<{ url: string; file: File } | null>(null);
  const hasChosenInitialDayRef = useRef(false);
  const stopCardRefs = useRef(new Map<string, HTMLElement>());
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

  const scrollToStop = useCallback((stopId: string) => {
    setExpandedMap(false);
    window.setTimeout(() => {
      stopCardRefs.current.get(stopId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      stopCardRefs.current.get(stopId)?.focus({ preventScroll: true });
    }, expandedMap ? 180 : 0);
  }, [expandedMap]);

  function startEditingMemory(stop: TripStop) {
    setMemoryDraft(stop.memory?.comment ?? "");
    setEditingMemoryStopId(stop.id);
  }

  function saveMemory(stop: TripStop) {
    if (!selectedDay || !currentMember) return;
    onSaveMemory(selectedDay.id, stop.id, memoryDraft.trim());
    setEditingMemoryStopId("");
  }

  function openHighlight() {
    if (!selectedDay) return;
    const defaults = availableDayPhotos.slice(0, 8).map((photo) => photo.fileId);
    setSelectedPhotoIds(defaults);
    setCaptionDrafts(Object.fromEntries(selectedDay.stops.map((stop) => [stop.id, stop.memory?.comment ?? ""])));
    setOrientation("portrait");
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
          text: `A family trip highlight from ${tripName}`,
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
          <p className="eyebrow">Your shared story</p>
          <h1 id="memory-lane-title">Memory Lane</h1>
          <p>Relive the trip, one day at a time.</p>
        </div>
        <button className="primary-button" onClick={openHighlight} disabled={availableDayPhotos.length === 0}>
          Create Highlight
        </button>
      </header>

      <nav className="memory-day-strip" aria-label="Memory Lane days">
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
      </nav>

      {galleryError && <p className="gallery-alert" role="alert">{galleryError}</p>}
      {galleryState === "offline" && (
        <p className="gallery-alert">Memory Lane needs an internet connection to open shared Drive photos. Saved itinerary details remain available.</p>
      )}

      <div className="memory-lane-layout">
        <aside className="memory-map-column">
          <MemoryMap day={selectedDay} photos={dayPhotos} onPin={scrollToStop} />
          <div className="memory-map-footer">
            <span>Numbered pins follow your itinerary. The dotted line is free and does not calculate a road route.</span>
            <button className="text-button" onClick={() => setExpandedMap(true)}>Expand map</button>
          </div>
        </aside>

        <div className="memory-recap-column">
          <header className="memory-day-heading">
            <p>Day {days.findIndex((day) => day.id === selectedDay.id) + 1}</p>
            <h2>{selectedDay.label}</h2>
            <time dateTime={selectedDay.date}>{memoryDate(selectedDay.date)}</time>
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
                ref={(element) => {
                  if (element) stopCardRefs.current.set(stop.id, element);
                  else stopCardRefs.current.delete(stop.id);
                }}
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
                      value={stop.place}
                      onFocus={() => onFocusLocation(selectedDay.id, stop.id)}
                      onChange={(event) => onLocationChange(selectedDay.id, stop.id, event.target.value)}
                      placeholder="Search Google location"
                      aria-label={`Google location for ${stop.title}`}
                      autoComplete="off"
                      readOnly={!currentMember}
                    />
                    {isLocationTarget && placeSearchState === "searching" && <small>Searching Google Maps…</small>}
                    {isLocationTarget && placeSuggestions.length > 0 && (
                      <div className="memory-place-suggestions">
                        {placeSuggestions.map((suggestion) => (
                          <button
                            key={suggestion.placeId}
                            onClick={() => onChoosePlace(suggestion)}
                            disabled={placeSearchState === "choosing"}
                          >
                            {suggestion.text}
                          </button>
                        ))}
                        <small>Powered by Google</small>
                      </div>
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
                  <p className="memory-no-photos">No photos yet</p>
                )}

                {editing ? (
                  <div className="memory-comment-editor">
                    <label htmlFor={`memory-${stop.id}`}>Shared family memory</label>
                    <textarea
                      id={`memory-${stop.id}`}
                      value={memoryDraft}
                      onChange={(event) => setMemoryDraft(event.target.value)}
                      maxLength={1000}
                      placeholder="What should the family remember about this stop?"
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

          <button className="memory-create-bottom" onClick={openHighlight} disabled={availableDayPhotos.length === 0}>
            Create Day Highlight
          </button>
          {galleryState !== "loading" && (
            <button className="text-button memory-refresh" onClick={onRefreshPhotos}>Refresh shared photos</button>
          )}
        </div>
      </div>

      {expandedMap && (
        <div className="memory-expanded-map" role="dialog" aria-modal="true" aria-label={`Expanded map for ${selectedDay.label}`}>
          <button className="memory-map-close" onClick={() => setExpandedMap(false)} aria-label="Close expanded map">×</button>
          <MemoryMap day={selectedDay} photos={dayPhotos} expanded onPin={scrollToStop} />
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
                <p className="modal-copy">On iPhone, tap Share and choose <strong>Save Video</strong> to place it in Apple Photos. The app does not upload this video to Drive.</p>
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TripDay } from "../lib/googleDrive";
import type { TripMedia } from "../lib/firebaseMedia";
import { canSaveDirectlyToPhotos, saveUrlToPhotos } from "../lib/nativePhotos";
import MediaSwipeStage from "./MediaSwipeStage";

type GalleryProps = {
  tripId: string;
  days: TripDay[];
  media: TripMedia[];
  currentUid: string;
  isAdmin: boolean;
  state: "idle" | "loading" | "ready" | "offline" | "error";
  error: string | null;
  onUpdate: (media: TripMedia, changes: Partial<Pick<TripMedia, "caption" | "favoriteBy" | "hiddenBy">>) => Promise<void>;
  onDelete: (media: TripMedia) => Promise<void>;
};

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function mediaUrl(item: TripMedia, original = false) {
  return original ? item.downloadUrl : item.thumbnailUrl || item.downloadUrl;
}

export default function Gallery({ tripId, days, media, currentUid, isAdmin, state, error, onUpdate, onDelete }: GalleryProps) {
  const [dayFilter, setDayFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "photo" | "video" | "favorite">("");
  const [viewerId, setViewerId] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [captionDraft, setCaptionDraft] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "sharing" | "saving" | "deleting">("idle");
  const [shareProgress, setShareProgress] = useState({ completed: 0, total: 0 });
  const [actionError, setActionError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [lastVisit, setLastVisit] = useState("");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const visitKey = `family-trip-gallery-last-visit-v1:${tripId}`;

  useEffect(() => {
    const previous = window.localStorage.getItem(visitKey) || "";
    setLastVisit(previous);
    const timer = window.setTimeout(() => window.localStorage.setItem(visitKey, new Date().toISOString()), 1500);
    return () => window.clearTimeout(timer);
  }, [visitKey]);

  const people = useMemo(() => Array.from(new Map(media.map((item) => [item.memberId, item.memberName])).entries()), [media]);
  const visible = useMemo(() => media.filter((item) =>
    !item.hiddenBy.includes(currentUid)
    && (!dayFilter || item.dayId === dayFilter)
    && (!personFilter || item.memberId === personFilter)
    && (!typeFilter || (typeFilter === "favorite" ? item.favoriteBy.includes(currentUid) : item.mediaType === typeFilter)),
  ), [currentUid, dayFilter, media, personFilter, typeFilter]);
  const newItems = useMemo(() => lastVisit ? media.filter((item) => item.uploadedAt > lastVisit).length : 0, [lastVisit, media]);
  const allShared = useMemo(() => media.filter((item) => !item.hiddenBy.includes(currentUid)), [currentUid, media]);
  const viewerIndex = visible.findIndex((item) => item.fileId === viewerId);
  const viewer = viewerIndex >= 0 ? visible[viewerIndex] : null;
  const viewerItems = useMemo(() => visible.map((item) => ({
    id: item.fileId,
    mediaType: item.mediaType,
    thumbnailUrl: mediaUrl(item),
    originalUrl: mediaUrl(item, true),
    alt: item.caption || item.name,
  })), [visible]);

  useEffect(() => {
    if (!viewer) return;
    setCaptionDraft(viewer.caption);
    setShowDetails(false);
  }, [viewer, viewerIndex, visible]);

  function open(item: TripMedia) {
    if (selectionMode) {
      setSelectedIds((current) => current.includes(item.fileId) ? current.filter((id) => id !== item.fileId) : [...current, item.fileId]);
      return;
    }
    setViewerId(item.fileId);
  }

  function stepViewer(direction: -1 | 1) {
    if (!visible.length || viewerIndex < 0) return;
    setViewerId(visible[(viewerIndex + direction + visible.length) % visible.length].fileId);
  }

  async function shareItems(items: TripMedia[]) {
    if (!items.length) return;
    setShareState("sharing"); setShareProgress({ completed: 0, total: items.length }); setActionError("");
    try {
      const files: File[] = [];
      for (const item of items) {
        const response = await fetch(item.downloadUrl);
        if (!response.ok) throw new Error(`Could not prepare ${item.name}.`);
        files.push(new File([await response.blob()], item.name, { type: item.mimeType }));
        setShareProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
      if (navigator.share && navigator.canShare?.({ files })) await navigator.share({ files, title: "Trip memories" });
      else items.forEach((item) => { const link = document.createElement("a"); link.href = item.downloadUrl; link.download = item.name; link.click(); });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setActionError(cause instanceof Error ? cause.message : "These memories could not be shared.");
    } finally { setShareState("idle"); setShareProgress({ completed: 0, total: 0 }); }
  }

  async function saveItemsToPhotos(items: TripMedia[]) {
    if (!items.length) return;
    if (!canSaveDirectlyToPhotos()) {
      await shareItems(items);
      return;
    }
    setShareState("saving"); setShareProgress({ completed: 0, total: items.length }); setActionError("");
    try {
      for (const item of items) {
        await saveUrlToPhotos(item.downloadUrl, item.mimeType);
        setShareProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
      setSaveMessage(`${items.length} ${items.length === 1 ? "memory" : "memories"} saved to Photos`);
      window.setTimeout(() => setSaveMessage(""), 2200);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "These memories could not be saved.");
    } finally {
      setShareState("idle"); setShareProgress({ completed: 0, total: 0 });
    }
  }

  async function saveCaption() {
    if (!viewer) return;
    await onUpdate(viewer, { caption: captionDraft.trim() });
  }

  async function saveViewerToPhotos() {
    if (!viewer) return;
    if (!canSaveDirectlyToPhotos()) {
      await shareItems([viewer]);
      return;
    }
    setActionError("");
    try {
      await saveUrlToPhotos(viewer.downloadUrl, viewer.mimeType);
      setSaveMessage("Saved to Photos");
      window.setTimeout(() => setSaveMessage(""), 1800);
    } catch (cause) {
      setSaveMessage(cause instanceof Error ? cause.message : "This memory could not be saved.");
    }
  }

  async function toggleFavorite(item: TripMedia) {
    const next = item.favoriteBy.includes(currentUid) ? item.favoriteBy.filter((id) => id !== currentUid) : [...item.favoriteBy, currentUid];
    await onUpdate(item, { favoriteBy: next });
  }

  async function hideForMe(item: TripMedia) {
    await onUpdate(item, { hiddenBy: Array.from(new Set([...item.hiddenBy, currentUid])) });
    setViewerId("");
  }

  const selected = visible.filter((item) => selectedIds.includes(item.fileId));
  const deletableSelected = selected.filter((item) => isAdmin || item.memberId === currentUid);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedIds.includes(item.fileId));

  function toggleSelectAll() {
    const visibleIds = new Set(visible.map((item) => item.fileId));
    setSelectedIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.has(id))
      : Array.from(new Set([...current, ...visibleIds])));
  }

  async function deleteSelected() {
    if (!deletableSelected.length) return;
    const count = deletableSelected.length;
    if (!window.confirm(`Delete ${count} selected ${count === 1 ? "memory" : "memories"} for everyone? Originals in Apple Photos are not affected.`)) return;
    setShareState("deleting"); setShareProgress({ completed: 0, total: count }); setActionError("");
    try {
      for (const item of deletableSelected) {
        await onDelete(item);
        setShareProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
      const deletedIds = new Set(deletableSelected.map((item) => item.fileId));
      setSelectedIds((current) => current.filter((id) => !deletedIds.has(id)));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The selected memories could not all be deleted.");
    } finally {
      setShareState("idle"); setShareProgress({ completed: 0, total: 0 });
    }
  }

  return <section className="gallery-page gallery-v2" aria-labelledby="gallery-title">
    <header className="gallery-page-heading"><div><p className="eyebrow">Seen through all of our eyes</p><h1 id="gallery-title">Our Snapshots</h1><p>Photos and videos from every stop, ready as soon as the family shares them.</p></div></header>
    {error && <p className="gallery-alert" role="alert">{error}</p>}
    {actionError && <p className="gallery-alert" role="alert">{actionError}</p>}
    {state === "offline" && <p className="gallery-alert">Previously opened thumbnails remain available. New family uploads will appear when you reconnect.</p>}
    {newItems > 0 && <button className="gallery-new-banner" onClick={() => { setDayFilter(""); setPersonFilter(""); setTypeFilter(""); }}>{newItems} new {newItems === 1 ? "memory" : "memories"} since your last visit</button>}

    <div className="gallery-day-tabs"><button className={!dayFilter ? "active" : ""} onClick={() => setDayFilter("")}>All days</button>{days.map((day, index) => <button className={dayFilter === day.id ? "active" : ""} onClick={() => setDayFilter(day.id)} key={day.id}><b>Day {index + 1}</b><small>{prettyDate(day.date)}</small></button>)}</div>
    <div className="gallery-filter-bar"><label><span>Person</span><select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}><option value="">Everyone</option>{people.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><div className="gallery-type-filter"><button className={!typeFilter ? "active" : ""} onClick={() => setTypeFilter("")}>All</button><button className={typeFilter === "photo" ? "active" : ""} onClick={() => setTypeFilter("photo")}>Photos</button><button className={typeFilter === "video" ? "active" : ""} onClick={() => setTypeFilter("video")}>Videos</button><button className={typeFilter === "favorite" ? "active" : ""} onClick={() => setTypeFilter("favorite")}>♥ Favourites</button></div></div>
    <div className="gallery-heading-actions gallery-bulk-actions"><button className="primary-button" disabled={!allShared.length || shareState !== "idle"} onClick={() => void saveItemsToPhotos(allShared)}>{shareState === "saving" ? `Saving ${shareProgress.completed}/${shareProgress.total}` : `Save All Shared (${allShared.length})`}</button><button className={`secondary-button ${selectionMode ? "active" : ""}`} onClick={() => { setSelectionMode((value) => !value); setSelectedIds([]); }}>{selectionMode ? "Done selecting" : "Select"}</button></div>

    {selectionMode && <div className="gallery-selection-bar"><strong>{selected.length} selected</strong><div className="gallery-selection-actions"><button className="secondary-button" disabled={!visible.length || shareState !== "idle"} onClick={toggleSelectAll}>{allVisibleSelected ? "Deselect All" : `Select All (${visible.length})`}</button><button className="primary-button" disabled={!selected.length || shareState !== "idle"} onClick={() => void saveItemsToPhotos(selected)}>{shareState === "saving" ? `Saving ${shareProgress.completed}/${shareProgress.total}` : "Save Selected to Photos"}</button><button className="secondary-button danger-button" disabled={!deletableSelected.length || shareState !== "idle"} onClick={() => void deleteSelected()}>{shareState === "deleting" ? `Deleting ${shareProgress.completed}/${shareProgress.total}` : `Delete Selected (${deletableSelected.length})`}</button></div></div>}

    {state === "loading" && !media.length ? <div className="gallery-v2-empty">Opening the family gallery…</div> : visible.length === 0 ? <div className="gallery-v2-empty"><strong>No matching memories yet</strong><p>Add photos or videos from an itinerary stop.</p></div> : <div className="gallery-v2-days">{days.filter((day) => !dayFilter || day.id === dayFilter).map((day, dayIndex) => {
      const dayItems = visible.filter((item) => item.dayId === day.id);
      if (!dayItems.length) return null;
      return <section className="gallery-v2-day" key={day.id}><header><div><p>Day {days.indexOf(day) + 1}</p><h2>{day.label}</h2><time>{prettyDate(day.date)}</time></div><span>{dayItems.length} memories</span></header>{day.stops.map((stop, stopIndex) => { const items = dayItems.filter((item) => item.stopId === stop.id); if (!items.length) return null; return <article className="gallery-v2-stop" key={stop.id}><div className="gallery-v2-stop-title"><div><small>Stop {stopIndex + 1}</small><h3>{stop.title}</h3></div>{stop.time && <time>{stop.time}</time>}</div><div className="gallery-v2-grid">{items.map((item) => <button className={`gallery-v2-tile ${selectedIds.includes(item.fileId) ? "selected" : ""}`} onClick={() => open(item)} key={item.fileId}>{item.mediaType === "video" ? <video src={mediaUrl(item)} muted preload="metadata" playsInline /> : <img src={mediaUrl(item)} alt={item.caption || `${item.memberName}'s photo at ${stop.title}`} loading="lazy" />}<span className="gallery-tile-overlay"><b className="member-avatar">{item.memberName.slice(0, 1).toUpperCase()}</b>{item.mediaType === "video" && <i>▶ Video</i>}{item.favoriteBy.length > 0 && <i>♥ {item.favoriteBy.length}</i>}</span>{selectionMode && <span className="gallery-select-mark">{selectedIds.includes(item.fileId) ? "✓" : ""}</span>}</button>)}</div></article>; })}</section>;
    })}</div>}

    {viewer && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={viewer.name} onTouchStart={(event) => { touchStart.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 }; }} onTouchEnd={(event) => { const start = touchStart.current; if (!start) return; const x = event.changedTouches[0]?.clientX ?? start.x; const y = event.changedTouches[0]?.clientY ?? start.y; const dx = x - start.x; const dy = y - start.y; touchStart.current = null; if (Math.abs(dy) > 105 && Math.abs(dy) > Math.abs(dx) * 1.25) setViewerId(""); }}><header><button className="lightbox-circle-button" onClick={() => setViewerId("")} aria-label="Close">×</button><div><strong>{viewerIndex + 1} of {visible.length}</strong><small>{viewer.memberName}</small></div><span /></header><div className="gallery-lightbox-stage"><MediaSwipeStage items={viewerItems} currentId={viewer.fileId} onChange={setViewerId} />{visible.length > 1 && <><button className="gallery-lightbox-prev" onClick={() => stepViewer(-1)} aria-label="Previous memory">‹</button><button className="gallery-lightbox-next" onClick={() => stepViewer(1)} aria-label="Next memory">›</button></>}</div><footer><div className="gallery-native-toolbar"><button onClick={() => void saveViewerToPhotos()} aria-label="Save to Photos"><span>↓</span><small>Save</small></button><button disabled={shareState === "sharing"} onClick={() => void shareItems([viewer])} aria-label="Share"><span>↥</span><small>Share</small></button><button className={viewer.favoriteBy.includes(currentUid) ? "active" : ""} onClick={() => void toggleFavorite(viewer)} aria-label="Favourite"><span>♥</span><small>Favourite</small></button><button onClick={() => setShowDetails((value) => !value)} aria-label="More options"><span>•••</span><small>More</small></button>{viewer.memberId === currentUid && <button className="danger" onClick={() => { if (window.confirm("Delete this memory for everyone? Your original remains in Apple Photos.")) { void onDelete(viewer); setViewerId(""); } }} aria-label="Delete"><span>⌫</span><small>Delete</small></button>}</div>{showDetails && <div className="gallery-media-details"><label><span>Caption</span><div><input value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} placeholder="What was happening here?" /><button onClick={() => void saveCaption()} disabled={captionDraft.trim() === viewer.caption}>Save</button></div></label><button className="hide-memory-button" onClick={() => void hideForMe(viewer)}>Hide this memory for me</button></div>}</footer>{saveMessage && <div className="media-action-toast" role="status">{saveMessage}</div>}</div>}
  </section>;
}

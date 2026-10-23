"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { FamilyAccount } from "../lib/firebaseAccounts";
import { observeSavedPlaces, updateSavedPlaces, type SavedPlace, type SavedPlaceVote } from "../lib/firebaseSavedPlaces";
import { type PlaceSuggestion, type TripDay, type TripMember } from "../lib/googleDrive";
import { createFamilyMap, getMapboxPlace, searchMapboxPlaces } from "../lib/mapbox";

const categories = ["Sights", "Food & Drink", "Shopping", "Activities", "Nature", "Other"];
type SimplePlaceStatus = "shortlisted" | "scheduled";

function simpleStatus(place: SavedPlace): SimplePlaceStatus {
  return place.status === "scheduled" || place.status === "visited" ? "scheduled" : "shortlisted";
}

type StopsBankProps = {
  account: FamilyAccount;
  tripId: string;
  days: TripDay[];
  currentMember?: TripMember;
  onSchedule: (place: SavedPlace, dayId: string, time: string) => void;
};

function PlacesMap({ places, onSelect }: { places: SavedPlace[]; onSelect: (id: string) => void }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState("");
  const located = useMemo(() => places.filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)), [places]);

  useEffect(() => {
    let disposed = false;
    let map: ReturnType<typeof createFamilyMap> | null = null;
    try {
      if (!elementRef.current) return;
      map = createFamilyMap(elementRef.current, located.map((place, index) => ({
        id: place.id,
        latitude: place.latitude!,
        longitude: place.longitude!,
        number: index + 1,
        title: place.name,
        subtitle: place.location,
        tone: place.status,
      })), { onPin: onSelect });
    } catch (cause) {
      if (!disposed) setMapError(cause instanceof Error ? cause.message : "The map could not be opened.");
    }
    return () => { disposed = true; map?.remove(); };
  }, [located, onSelect]);

  return <div className="saved-map-wrap"><div ref={elementRef} className="saved-map-canvas" />{!located.length && !mapError && <p className="saved-map-message">Save a Mapbox location to see it on the map.</p>}{mapError && <p className="saved-map-message error">{mapError}</p>}</div>;
}

export default function StopsBank({ account, tripId, days, currentMember, onSchedule }: StopsBankProps) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [syncState, setSyncState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [showForm, setShowForm] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [detailPlaceId, setDetailPlaceId] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [note, setNote] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [googlePlace, setGooglePlace] = useState<{ placeId: string; latitude?: number; longitude?: number; googleMapsUrl?: string } | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "searching" | "choosing">("idle");
  const searchTimer = useRef<number | null>(null);
  const searchRequest = useRef(0);
  const sessionToken = useRef(crypto.randomUUID());
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [scheduleDayId, setScheduleDayId] = useState(days[0]?.id ?? "");
  const [scheduleTime, setScheduleTime] = useState("12:00");

  useEffect(() => observeSavedPlaces(tripId, (next, pending) => {
    setPlaces(next); setSyncState(pending ? "saving" : "ready"); setError("");
  }, (cause) => { setSyncState("error"); setError(cause.message); }), [tripId]);

  useEffect(() => () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); }, []);

  const visiblePlaces = useMemo(() => places
    .filter((place) => (!filter || place.category === filter) && (!statusFilter || simpleStatus(place) === statusFilter))
    .sort((a, b) => a.name.localeCompare(b.name)), [filter, places, statusFilter]);
  const selectedPlace = places.find((place) => place.id === selectedPlaceId);
  const detailPlace = places.find((place) => place.id === detailPlaceId);

  async function mutate(updater: (current: SavedPlace[]) => SavedPlace[]) {
    if (!currentMember) return;
    setSyncState("saving"); setError("");
    try { await updateSavedPlaces(account, tripId, updater); }
    catch (cause) { setSyncState("error"); setError(cause instanceof Error ? cause.message : "The shared places could not be saved."); }
  }

  function searchLocation(value: string) {
    setLocation(value); setGooglePlace(null); setSuggestions([]);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const requestId = ++searchRequest.current;
    if (value.trim().length < 3) { setSearchState("idle"); return; }
    searchTimer.current = window.setTimeout(() => {
      setSearchState("searching");
      void searchMapboxPlaces(value.trim(), sessionToken.current).then((suggestions) => {
        if (requestId !== searchRequest.current) return;
        setSuggestions(suggestions); setSearchState("idle");
      }).catch((cause) => { if (requestId === searchRequest.current) { setSearchState("idle"); setError(cause instanceof Error ? cause.message : "Mapbox search failed."); } });
    }, 350);
  }

  async function chooseSuggestion(suggestion: PlaceSuggestion) {
    setSearchState("choosing"); setSuggestions([]);
    try {
      const place = await getMapboxPlace(suggestion.placeId, sessionToken.current);
      setName((current) => current || place.name);
      setLocation(place.name || suggestion.text || place.address);
      setGooglePlace({ placeId: place.placeId, ...(place.latitude !== null ? { latitude: place.latitude } : {}), ...(place.longitude !== null ? { longitude: place.longitude } : {}), googleMapsUrl: place.mapUrl });
      sessionToken.current = crypto.randomUUID();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That Mapbox place could not be selected."); }
    finally { setSearchState("idle"); }
  }

  async function addPlace(event: FormEvent) {
    event.preventDefault();
    if (!currentMember || !name.trim()) return;
    const place: SavedPlace = { id: crypto.randomUUID(), name: name.trim(), location: location.trim(), category, note: note.trim(), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}), ...(googlePlace || {}), status: "shortlisted", createdByUid: currentMember.id, createdByName: currentMember.name, createdAt: new Date().toISOString(), votes: {} };
    await mutate((current) => [...current, place]);
    setName(""); setLocation(""); setNote(""); setSourceUrl(""); setGooglePlace(null); setShowForm(false); setView("list");
  }

  function vote(placeId: string, value: SavedPlaceVote) {
    if (!currentMember) return;
    void mutate((current) => current.map((place) => {
      if (place.id !== placeId) return place;
      const votes = { ...place.votes };
      if (votes[currentMember.id]?.value === value) delete votes[currentMember.id];
      else votes[currentMember.id] = { value, memberName: currentMember.name };
      return { ...place, votes };
    }));
  }

  function schedule(place: SavedPlace) {
    if (!scheduleDayId) return;
    onSchedule(place, scheduleDayId, scheduleTime);
    void mutate((current) => current.map((item) => item.id === place.id ? { ...item, status: "scheduled" } : item));
    setScheduleId("");
  }

  function deletePlace(place: SavedPlace) {
    if (!currentMember || place.createdByUid !== currentMember.id) return;
    const scheduledNote = simpleStatus(place) === "scheduled" ? " Its itinerary stop will remain in place." : "";
    if (!window.confirm(`Delete ${place.name} from Saved Places?${scheduledNote}`)) return;
    setDetailPlaceId("");
    setSelectedPlaceId("");
    setScheduleId("");
    void mutate((current) => current.filter((item) => item.id !== place.id || item.createdByUid !== currentMember.id));
  }

  function renderPlaceCard(place: SavedPlace, compact = false) {
    const status = simpleStatus(place);
    const totalVotes = Object.keys(place.votes).length;
    const voteChoices: Array<{ value: SavedPlaceVote; label: string; icon: string }> = [
      { value: "love", label: "Love it", icon: "♥" },
      { value: "open", label: "Open to it", icon: "○" },
      { value: "not_for_me", label: "Not for me", icon: "×" },
    ];
    return <article className={`saved-place-card ${compact ? "compact" : ""}`} key={place.id}>
      <button className="saved-place-card-main" onClick={() => setDetailPlaceId(place.id)}>
        <div className="saved-place-card-copy"><div><span className={`place-status ${status}`}>{status === "scheduled" ? "Scheduled" : "Shortlisted"}</span><small>{place.category}</small></div><h2>{place.name}</h2>{place.location && <p>📍 {place.location}</p>}<small>Saved by {place.createdByName}</small></div>
      </button>
      {!compact && <>{place.note && <p className="saved-place-reason">“{place.note}”</p>}{place.sourceUrl && <a className="saved-place-source" href={place.sourceUrl} target="_blank" rel="noopener noreferrer">See what inspired this ↗</a>}<div className="place-votes" aria-label={`Group votes for ${place.name}`}>{voteChoices.map((choice) => { const isChoice = (value?: SavedPlaceVote) => value === choice.value || (choice.value === "open" && value === "maybe"); const voters = Object.values(place.votes).filter((item) => isChoice(item.value)); const active = Boolean(currentMember && isChoice(place.votes[currentMember.id]?.value)); const share = totalVotes ? Math.round((voters.length / totalVotes) * 100) : 0; return <button className={`${active ? "active " : ""}${choice.value}`} onClick={() => vote(place.id, choice.value)} title={`Vote ${choice.label}`} key={choice.value}><span className="vote-fill" style={{ width: `${share}%` }} /><span className="vote-copy"><span><span aria-hidden="true">{choice.icon}</span> {choice.label}</span><b>{voters.length}</b></span><small>{voters.length ? voters.map((item) => item.memberName).join(", ") : "No votes yet"}</small></button>; })}</div>{scheduleId === place.id ? <div className="place-scheduler"><label><span>Day</span><select value={scheduleDayId} onChange={(event) => setScheduleDayId(event.target.value)}>{days.map((day, index) => <option key={day.id} value={day.id}>Day {index + 1}: {day.label}</option>)}</select></label><label><span>Time</span><input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label><div className="place-scheduler-actions"><button className="text-button" onClick={() => setScheduleId("")}>Cancel</button><button className="primary-button" onClick={() => schedule(place)} disabled={!scheduleDayId}>Add to Itinerary</button></div></div> : <button className="schedule-place-button" onClick={() => { setScheduleId(place.id); setScheduleDayId(days[0]?.id ?? ""); }}>+ Add to Itinerary</button>}{currentMember?.id === place.createdByUid && <button className="delete-saved-place-button" onClick={() => deletePlace(place)}>Delete saved place</button>}</>}
    </article>;
  }

  return <section className="stops-bank-page" aria-labelledby="stops-bank-title">
    <header className="stops-bank-heading"><div><p className="eyebrow">Plan it together</p><h1 id="stops-bank-title">Saved Places</h1><p>Keep ideas in your shortlist, then add them straight to a day and time.</p></div><button className="primary-button" onClick={() => setShowForm(true)} disabled={!currentMember}>+ Save a Place</button></header>
    <div className="saved-places-controls"><div className="saved-view-toggle"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>☷ List</button><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>⌖ Map</button></div><div className="saved-filter-row"><button className={!filter ? "active" : ""} onClick={() => setFilter("")}>All</button>{categories.map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><select aria-label="Filter place status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All saved</option><option value="shortlisted">Shortlisted</option><option value="scheduled">Scheduled</option></select></div>
    <p className="saved-sync-line">{syncState === "loading" ? "Opening your shared places…" : syncState === "saving" ? "Saving for everyone…" : `${visiblePlaces.length} place${visiblePlaces.length === 1 ? "" : "s"} to explore`}</p>
    {error && <p className="gallery-alert" role="alert">{error}</p>}
    {view === "map" ? <div className="saved-map-layout"><PlacesMap places={visiblePlaces} onSelect={setSelectedPlaceId} />{selectedPlace ? renderPlaceCard(selectedPlace, true) : <aside className="saved-map-empty-card"><span>📍</span><strong>Choose a pin</strong><p>Tap any saved place to see its story.</p></aside>}</div> : <div className="saved-place-grid">{visiblePlaces.length ? visiblePlaces.map((place) => renderPlaceCard(place)) : <div className="saved-place-empty"><span>📍</span><strong>No matching places yet</strong><p>Save the first possibility for this adventure.</p></div>}</div>}

    {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowForm(false)}><section className="modal save-place-modal" role="dialog" aria-modal="true" aria-labelledby="save-place-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">A new possibility</p><h2 id="save-place-title">Save a Place</h2><form className="saved-place-form" onSubmit={addPlace}><label className="wide google-place-search"><span>Search Mapbox</span><input value={location} onChange={(event) => searchLocation(event.target.value)} placeholder="Restaurant, landmark or address" autoFocus autoComplete="off" />{searchState !== "idle" && <small>{searchState === "choosing" ? "Opening that place…" : "Searching Mapbox…"}</small>}{suggestions.length > 0 && <div className="saved-place-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion.placeId} onClick={() => void chooseSuggestion(suggestion)}><strong>{suggestion.text}</strong>{suggestion.secondaryText && suggestion.secondaryText !== suggestion.text && <small>{suggestion.secondaryText}</small>}</button>)}</div>}</label><label><span>Place name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Café Central" required /></label><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label className="wide"><span>Why did you save it?</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="The famous cake, sunset views, Mama’s recommendation…" /></label><label className="wide"><span>Original link (optional)</span><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></label><div className="wide form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button">Save for the group</button></div></form></section></div>}

    {detailPlace && <div className="modal-backdrop place-detail-backdrop" role="presentation" onMouseDown={() => setDetailPlaceId("")}><section className="modal place-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="place-detail-title" onMouseDown={(event) => event.stopPropagation()}><button className="overview-close" onClick={() => setDetailPlaceId("")} aria-label="Close place details">×</button><div className={`place-detail-hero ${detailPlace.category.toLowerCase().replace(/[^a-z]+/g, "-")}`}><span>{simpleStatus(detailPlace) === "scheduled" ? "✓" : "⌖"}</span></div><p className="eyebrow">{detailPlace.category} · {simpleStatus(detailPlace) === "scheduled" ? "Scheduled" : "Shortlisted"}</p><h2 id="place-detail-title">{detailPlace.name}</h2>{detailPlace.location && <p className="place-detail-location">📍 {detailPlace.location}</p>}{detailPlace.note && <blockquote>{detailPlace.note}</blockquote>}<div className="place-detail-actions">{detailPlace.location ? <a className="secondary-button" href={`https://maps.apple.com/?q=${encodeURIComponent(detailPlace.location)}`} target="_blank" rel="noopener noreferrer">Open in Maps ↗</a> : null}{detailPlace.sourceUrl && <a className="secondary-button" href={detailPlace.sourceUrl} target="_blank" rel="noopener noreferrer">Original inspiration ↗</a>}<button className="primary-button" onClick={() => { setView("list"); setScheduleId(detailPlace.id); setDetailPlaceId(""); }}>Add to Itinerary</button>{currentMember?.id === detailPlace.createdByUid && <button className="delete-saved-place-button detail" onClick={() => deletePlace(detailPlace)}>Delete saved place</button>}</div></section></div>}
  </section>;
}

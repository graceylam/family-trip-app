"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { FamilyAccount } from "../lib/firebaseAccounts";
import { observeSavedPlaces, updateSavedPlaces, type SavedPlace, type SavedPlaceVote } from "../lib/firebaseSavedPlaces";
import type { TripDay, TripMember } from "../lib/googleDrive";

const categories = ["Sights", "Food & Drink", "Shopping", "Nature", "Transport", "Hotel", "Other"];

type StopsBankProps = {
  account: FamilyAccount;
  tripId: string;
  days: TripDay[];
  currentMember?: TripMember;
  onSchedule: (place: SavedPlace, dayId: string, time: string) => void;
};

export default function StopsBank({ account, tripId, days, currentMember, onSchedule }: StopsBankProps) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [syncState, setSyncState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [scheduleDayId, setScheduleDayId] = useState(days[0]?.id ?? "");
  const [scheduleTime, setScheduleTime] = useState("12:00");

  useEffect(() => observeSavedPlaces(tripId, (next, pending) => {
    setPlaces(next);
    setSyncState(pending ? "saving" : "ready");
    setError("");
  }, (cause) => {
    setSyncState("error");
    setError(cause.message);
  }), [tripId]);

  const visiblePlaces = useMemo(() => {
    const filtered = filter ? places.filter((place) => place.category === filter) : places;
    return [...filtered].sort((a, b) => {
      const loveDifference = Object.values(b.votes).filter((vote) => vote.value === "love").length
        - Object.values(a.votes).filter((vote) => vote.value === "love").length;
      return loveDifference || a.name.localeCompare(b.name);
    });
  }, [filter, places]);

  async function mutate(updater: (current: SavedPlace[]) => SavedPlace[]) {
    if (!currentMember) return;
    setSyncState("saving");
    setError("");
    try {
      await updateSavedPlaces(account, tripId, updater);
    } catch (cause) {
      setSyncState("error");
      setError(cause instanceof Error ? cause.message : "The shared places could not be saved.");
    }
  }

  async function addPlace(event: FormEvent) {
    event.preventDefault();
    if (!currentMember || !name.trim()) return;
    const place: SavedPlace = {
      id: crypto.randomUUID(),
      name: name.trim(),
      location: location.trim(),
      category,
      note: note.trim(),
      createdByUid: currentMember.id,
      createdByName: currentMember.name,
      createdAt: new Date().toISOString(),
      votes: {},
    };
    await mutate((current) => [...current, place]);
    setName("");
    setLocation("");
    setNote("");
    setShowForm(false);
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
    setScheduleId("");
  }

  return (
    <section className="stops-bank-page" aria-labelledby="stops-bank-title">
      <header className="stops-bank-heading">
        <div>
          <p className="eyebrow">Dream it together</p>
          <h1 id="stops-bank-title">Saved Places</h1>
          <p>Collect possibilities first. Vote as a family, then add the favourites to a day.</p>
        </div>
        <button className="primary-button" onClick={() => setShowForm((open) => !open)} disabled={!currentMember}>+ Save a place</button>
      </header>

      <div className="stops-bank-toolbar">
        <label><span>Category</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All ideas</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <small>{syncState === "loading" ? "Opening the idea bank…" : syncState === "saving" ? "Saving for everyone…" : `${places.length} shared idea${places.length === 1 ? "" : "s"}`}</small>
      </div>
      {error && <p className="gallery-alert" role="alert">{error}</p>}

      {showForm && (
        <form className="saved-place-form" onSubmit={addPlace}>
          <label><span>Place name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Café Central" required /></label>
          <label><span>Location or address</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Searchable address or area" /></label>
          <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="wide"><span>Why should we go?</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="The famous cake, sunset views, Mama's recommendation…" /></label>
          <div className="wide form-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button">Share idea</button></div>
        </form>
      )}

      <div className="saved-place-grid">
        {visiblePlaces.length === 0 ? <div className="saved-place-empty"><span>📍</span><strong>No saved places yet</strong><p>Add the first possibility for this adventure.</p></div> : visiblePlaces.map((place) => {
          const loveVotes = Object.values(place.votes).filter((vote) => vote.value === "love");
          const maybeVotes = Object.values(place.votes).filter((vote) => vote.value === "maybe");
          const ownVote = currentMember ? place.votes[currentMember.id]?.value : undefined;
          return (
            <article className="saved-place-card" key={place.id}>
              <header><span>{place.category}</span><small>Suggested by {place.createdByName}</small></header>
              <h2>{place.name}</h2>
              {place.location && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.location)}`} target="_blank" rel="noopener noreferrer">📍 {place.location} ↗</a>}
              {place.note && <p>{place.note}</p>}
              <div className="place-votes" aria-label={`Votes for ${place.name}`}>
                <button className={ownVote === "love" ? "active" : ""} onClick={() => vote(place.id, "love")} title={loveVotes.map((vote) => vote.memberName).join(", ")}>❤️ Must do <b>{loveVotes.length}</b></button>
                <button className={ownVote === "maybe" ? "active" : ""} onClick={() => vote(place.id, "maybe")} title={maybeVotes.map((vote) => vote.memberName).join(", ")}>🤔 Maybe <b>{maybeVotes.length}</b></button>
              </div>
              {scheduleId === place.id ? (
                <div className="place-scheduler">
                  <select value={scheduleDayId} onChange={(event) => setScheduleDayId(event.target.value)}>{days.map((day, index) => <option key={day.id} value={day.id}>Day {index + 1}: {day.label}</option>)}</select>
                  <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} />
                  <button className="primary-button" onClick={() => schedule(place)}>Add</button>
                  <button className="text-button" onClick={() => setScheduleId("")}>Cancel</button>
                </div>
              ) : <button className="schedule-place-button" onClick={() => { setScheduleId(place.id); setScheduleDayId(days[0]?.id ?? ""); }}>+ Add to itinerary</button>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

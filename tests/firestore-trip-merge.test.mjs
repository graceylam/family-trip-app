import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/tripMerge.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { mergeTripState } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const base = {
  tripId: "trip",
  tripName: "Vienna",
  coverPhotoId: "",
  revision: 1,
  updatedAt: "2026-08-23T00:00:00.000Z",
  members: [{ id: "grace", name: "Grace" }, { id: "mama", name: "Mama" }],
  days: [{
    id: "day-1",
    date: "2026-10-31",
    label: "Arrival",
    stops: [{ id: "palace", time: "09:00", title: "Palace", place: "", note: "Meet outside" }],
  }],
};

test("merges a location selection with another person's note edit without duplicating the stop", () => {
  const current = structuredClone(base);
  current.revision = 2;
  current.days[0].stops[0].note = "Meet by the fountain";
  const submitted = structuredClone(base);
  Object.assign(submitted.days[0].stops[0], {
    place: "Schönbrunn Palace, Vienna",
    placeId: "google-place-1",
    latitude: 48.1845,
    longitude: 16.3122,
    googleMapsUrl: "https://maps.google.com/example",
  });

  const merged = mergeTripState(current, submitted, base, "Grace", true);

  assert.equal(merged.days[0].stops.length, 1);
  assert.equal(merged.days[0].stops[0].note, "Meet by the fountain");
  assert.equal(merged.days[0].stops[0].placeId, "google-place-1");
});

test("treats a selected Google place as the next edit after a typed-location save", () => {
  const typedDraft = structuredClone(base);
  typedDraft.revision = 2;
  typedDraft.days[0].stops[0].place = "Schonbrunn";
  const selectedDraft = structuredClone(typedDraft);
  Object.assign(selectedDraft.days[0].stops[0], {
    place: "Schönbrunn Palace, Vienna",
    placeId: "google-place-1",
    latitude: 48.1845,
    longitude: 16.3122,
  });

  const merged = mergeTripState(typedDraft, selectedDraft, typedDraft, "Grace", true);

  assert.equal(merged.days[0].stops.length, 1);
  assert.equal(merged.days[0].stops[0].place, "Schönbrunn Palace, Vienna");
});

test("still preserves both versions when two people change the same stop field", () => {
  const current = structuredClone(base);
  current.revision = 2;
  current.days[0].stops[0].time = "09:30";
  const submitted = structuredClone(base);
  submitted.days[0].stops[0].time = "10:00";

  const merged = mergeTripState(current, submitted, base, "Mama", false);

  assert.equal(merged.days[0].stops.length, 2);
  assert.equal(merged.days[0].stops[1].title, "Palace (Mama's version)");
});

test("preserves trip-wide highlights created concurrently by different members", () => {
  const current = structuredClone(base);
  current.revision = 2;
  current.highlights = [{
    id: "grace-highlight", title: "Vienna favourites", memberId: "grace", memberName: "Grace",
    status: "finished", slides: [], createdAt: "2026-10-25T01:00:00.000Z", updatedAt: "2026-10-25T01:00:00.000Z",
  }];
  const submitted = structuredClone(base);
  submitted.highlights = [{
    id: "mama-highlight", title: "Our funniest moments", memberId: "mama", memberName: "Mama",
    status: "draft", slides: [], createdAt: "2026-10-25T01:01:00.000Z", updatedAt: "2026-10-25T01:01:00.000Z",
  }];

  const merged = mergeTripState(current, submitted, base, "Mama", false);

  assert.deepEqual(merged.highlights.map((highlight) => highlight.id), ["grace-highlight", "mama-highlight"]);
});

test("preserves scrapbook pages created concurrently by different members", () => {
  const current = structuredClone(base); current.revision = 2;
  current.scrapbookPages = [{ id: "day-one", title: "Day one", pageType: "day-recap", background: "#fff", freeText: "", favouriteThings: [], weather: "", steps: "", distance: "", favouriteMemory: "", elements: [], memberId: "grace", memberName: "Grace", createdAt: "2026-10-25T01:00:00.000Z", updatedAt: "2026-10-25T01:00:00.000Z" }];
  const submitted = structuredClone(base);
  submitted.scrapbookPages = [{ id: "food", title: "Best meals", pageType: "freeform", background: "#eef", freeText: "", favouriteThings: [], weather: "", steps: "", distance: "", favouriteMemory: "", elements: [], memberId: "mama", memberName: "Mama", createdAt: "2026-10-25T01:01:00.000Z", updatedAt: "2026-10-25T01:01:00.000Z" }];
  const merged = mergeTripState(current, submitted, base, "Mama", false);
  assert.deepEqual(merged.scrapbookPages.map((page) => page.id), ["day-one", "food"]);
});

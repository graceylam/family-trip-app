import assert from "node:assert/strict";
import test from "node:test";

import {
  compareItineraryDates,
  compareItineraryTimes,
  sortItineraryChronologically,
} from "../lib/chronology.ts";

test("sorts trip days by date and each day's stops by time", () => {
  const sorted = sortItineraryChronologically([
    {
      id: "november-2",
      date: "2026-11-02",
      stops: [
        { id: "evening", time: "18:00" },
        { id: "morning", time: "8:45" },
        { id: "lunch", time: "12:15" },
      ],
    },
    { id: "october-31", date: "2026-10-31", stops: [{ id: "flight", time: "09:30" }] },
    { id: "november-1", date: "2026-11-01", stops: [] },
  ]);

  assert.deepEqual(sorted.map((day) => day.id), ["october-31", "november-1", "november-2"]);
  assert.deepEqual(sorted[2].stops.map((stop) => stop.id), ["morning", "lunch", "evening"]);
});

test("keeps equal dates and times stable and places invalid values last", () => {
  const sorted = sortItineraryChronologically([
    {
      id: "same-date-first",
      date: "2026-11-01",
      stops: [
        { id: "same-time-first", time: "10:00" },
        { id: "same-time-second", time: "10:00" },
        { id: "missing-time", time: "" },
      ],
    },
    { id: "same-date-second", date: "2026-11-01", stops: [] },
    { id: "missing-date", date: "", stops: [] },
  ]);

  assert.deepEqual(sorted.map((day) => day.id), ["same-date-first", "same-date-second", "missing-date"]);
  assert.deepEqual(sorted[0].stops.map((stop) => stop.id), ["same-time-first", "same-time-second", "missing-time"]);
  assert.equal(compareItineraryDates("2026-10-31", "2026-11-01"), -1);
  assert.ok(compareItineraryTimes("8:45", "12:00") < 0);
});

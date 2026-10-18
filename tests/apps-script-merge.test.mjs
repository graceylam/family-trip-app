import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
let uuidCounter = 0;
const context = vm.createContext({
  Utilities: { getUuid: () => `test-${++uuidCounter}` },
});
vm.runInContext(`${source}\nglobalThis.mergeTripStateForTest = mergeTripState_;\nglobalThis.restrictTripNamesForTest = restrictTripNames_;`, context);

const base = {
  tripId: "trip",
  tripName: "Vienna",
  revision: 1,
  updatedAt: "2026-07-19T00:00:00.000Z",
  members: [{ id: "grace", name: "Grace" }, { id: "sam", name: "Sam" }],
  days: [{
    id: "day-1",
    date: "2026-07-19",
    label: "Palaces",
    stops: [{ id: "palace", time: "09:00", title: "Palace", place: "Vienna", note: "Meet outside" }],
  }],
};

test("keeps both versions when two family members edit the same stop", () => {
  const current = structuredClone(base);
  current.revision = 2;
  current.days[0].stops[0].time = "09:30";
  const submitted = structuredClone(base);
  submitted.days[0].stops[0].time = "10:00";

  const merged = context.mergeTripStateForTest(current, submitted, base, "Sam", false);

  assert.equal(merged.days[0].stops.length, 2);
  assert.equal(merged.days[0].stops[0].time, "09:30");
  assert.equal(merged.days[0].stops[1].time, "10:00");
  assert.equal(merged.days[0].stops[1].title, "Palace (Sam's version)");
});

test("merges a non-conflicting new stop into the latest JSON", () => {
  const current = structuredClone(base);
  current.revision = 2;
  current.days[0].stops[0].note = "Meet by the fountain";
  const submitted = structuredClone(base);
  submitted.days[0].stops.push({ id: "lunch", time: "12:00", title: "Lunch", place: "Cafe", note: "" });

  const merged = context.mergeTripStateForTest(current, submitted, base, "Sam", false);

  assert.equal(merged.days[0].stops.length, 2);
  assert.equal(merged.days[0].stops[0].note, "Meet by the fountain");
  assert.equal(merged.days[0].stops[1].title, "Lunch");
  assert.deepEqual(JSON.parse(JSON.stringify(merged.members)), base.members);
});

test("applies non-conflicting stop deletion and reordering", () => {
  const baseWithStops = structuredClone(base);
  baseWithStops.days[0].stops.push({ id: "lunch", time: "12:00", title: "Lunch", place: "Cafe", note: "" });
  baseWithStops.days[0].stops.push({ id: "museum", time: "14:00", title: "Museum", place: "Vienna", note: "" });
  const current = structuredClone(baseWithStops);
  current.revision = 2;
  current.tripName = "Vienna 2026";
  const submitted = structuredClone(baseWithStops);
  submitted.days[0].stops = [submitted.days[0].stops[2], submitted.days[0].stops[0]];

  const merged = context.mergeTripStateForTest(current, submitted, baseWithStops, "Sam", false);

  assert.deepEqual(JSON.parse(JSON.stringify(merged.days[0].stops.map((stop) => stop.id))), ["museum", "palace"]);
  assert.equal(merged.tripName, "Vienna 2026");
});

test("keeps trip and existing day names admin-only", () => {
  const current = structuredClone(base);
  current.revision = 2;
  const submitted = structuredClone(base);
  submitted.tripName = "Sam's Trip";
  submitted.days[0].label = "Sam's Day";
  submitted.days[0].date = "2026-07-20";

  const contributorMerge = context.mergeTripStateForTest(current, submitted, base, "Sam", false);
  assert.equal(contributorMerge.tripName, "Vienna");
  assert.equal(contributorMerge.days[0].label, "Palaces");
  assert.equal(contributorMerge.days[0].date, "2026-07-20");

  const adminMerge = context.mergeTripStateForTest(current, submitted, base, "Grace", true);
  assert.equal(adminMerge.tripName, "Sam's Trip");
  assert.equal(adminMerge.days[0].label, "Sam's Day");

  const currentRevisionSubmission = structuredClone(current);
  currentRevisionSubmission.tripName = "Another contributor name";
  currentRevisionSubmission.days[0].label = "Another contributor day";
  const restricted = context.restrictTripNamesForTest(currentRevisionSubmission, current, false);
  assert.equal(restricted.tripName, "Vienna");
  assert.equal(restricted.days[0].label, "Palaces");
});

test("merges concurrent expenses on the same stop without duplicating the stop", () => {
  const expenseBase = structuredClone(base);
  expenseBase.days[0].stops[0].expenses = [];
  const current = structuredClone(expenseBase);
  current.revision = 2;
  current.days[0].stops[0].expenses.push({
    id: "grace-coffee", item: "Coffee", category: "Food & Drink", memberId: "grace", memberName: "Grace",
    localAmount: 4.5, localCurrency: "EUR", homeAmount: null, homeCurrency: "AUD", createdAt: "2026-07-20T01:00:00.000Z",
  });
  const submitted = structuredClone(expenseBase);
  submitted.days[0].stops[0].expenses.push({
    id: "sam-train", item: "Train", category: "Transport", memberId: "sam", memberName: "Sam",
    localAmount: 12, localCurrency: "EUR", homeAmount: 21, homeCurrency: "AUD", createdAt: "2026-07-20T01:01:00.000Z",
  });

  const merged = context.mergeTripStateForTest(current, submitted, expenseBase, "Sam", false);

  assert.equal(merged.days[0].stops.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.days[0].stops[0].expenses.map((expense) => expense.id))), ["grace-coffee", "sam-train"]);
});

test("keeps the latest shared stop memory without duplicating the stop", () => {
  const memoryBase = structuredClone(base);
  const current = structuredClone(memoryBase);
  current.revision = 2;
  current.days[0].stops[0].memory = {
    comment: "Grace's memory",
    updatedByMemberId: "grace",
    updatedByMemberName: "Grace",
    updatedAt: "2026-07-20T01:00:00.000Z",
  };
  const submitted = structuredClone(memoryBase);
  submitted.days[0].stops[0].memory = {
    comment: "Sam's later memory",
    updatedByMemberId: "sam",
    updatedByMemberName: "Sam",
    updatedAt: "2026-07-20T01:01:00.000Z",
  };

  const merged = context.mergeTripStateForTest(current, submitted, memoryBase, "Sam", false);

  assert.equal(merged.days[0].stops.length, 1);
  assert.equal(merged.days[0].stops[0].memory.comment, "Sam's later memory");
  assert.equal(merged.days[0].stops[0].memory.updatedByMemberName, "Sam");
});

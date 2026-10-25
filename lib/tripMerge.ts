import type { SharedTripState, TripDay, TripDocument, TripExpense, TripMember, TripScrapbookEntry, TripStory, TripStop, TripStopMemory } from "./googleDrive";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function mergeValue<T>(current: T, submitted: T, base: T): T {
  if (submitted === base) return current;
  if (current === base || current === submitted) return submitted;
  return current;
}

function versionName(name: string, contributorName: string): string {
  return `${name} (${contributorName}'s version)`;
}

function versionExpense(expense: TripExpense, contributorName: string): TripExpense {
  return { ...clone(expense), id: `${expense.id}-version-${crypto.randomUUID().slice(0, 8)}`, item: versionName(expense.item, contributorName) };
}

function versionStop(stop: TripStop, contributorName: string): TripStop {
  return { ...clone(stop), id: `${stop.id}-version-${crypto.randomUUID().slice(0, 8)}`, title: versionName(stop.title, contributorName) };
}

function versionDay(day: TripDay, contributorName: string): TripDay {
  return {
    ...clone(day),
    id: `${day.id}-version-${crypto.randomUUID().slice(0, 8)}`,
    label: versionName(day.label, contributorName),
    stops: day.stops.map((stop) => ({ ...clone(stop), id: `${stop.id}-version-${crypto.randomUUID().slice(0, 8)}` })),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function mergeMemory(current?: TripStopMemory, submitted?: TripStopMemory, base?: TripStopMemory): TripStopMemory | undefined {
  if (json(submitted) === json(base)) return current ? clone(current) : undefined;
  if (json(current) === json(base) || json(current) === json(submitted)) return submitted ? clone(submitted) : undefined;
  const currentTime = Date.parse(current?.updatedAt ?? "") || 0;
  const submittedTime = Date.parse(submitted?.updatedAt ?? "") || 0;
  const latest = submittedTime >= currentTime ? submitted : current;
  if (!latest) return undefined;
  const currentEntries = current?.entries ?? [];
  const submittedEntries = submitted?.entries ?? [];
  const baseEntries = base?.entries ?? [];
  const mergedEntries = mergeScrapbookEntries(currentEntries, submittedEntries, baseEntries);
  return { ...clone(latest), entries: mergedEntries };
}

function mergeScrapbookEntries(current: TripScrapbookEntry[], submitted: TripScrapbookEntry[], base: TripScrapbookEntry[]): TripScrapbookEntry[] {
  const result = current.map(clone);
  const baseItems = byId(base);
  submitted.forEach((entry) => {
    const index = result.findIndex((item) => item.id === entry.id);
    if (index < 0) result.push(clone(entry));
    else if (json(result[index]) === json(baseItems.get(entry.id)) || json(result[index]) === json(entry)) result[index] = clone(entry);
    else if ((Date.parse(entry.updatedAt) || 0) >= (Date.parse(result[index].updatedAt) || 0)) result[index] = clone(entry);
  });
  const submittedIds = new Set(submitted.map((entry) => entry.id));
  return result.filter((entry) => submittedIds.has(entry.id) || !baseItems.has(entry.id));
}

function mergeStories(current: TripStory[], submitted: TripStory[], base: TripStory[]): TripStory[] {
  const result = current.map(clone);
  const baseItems = byId(base);
  submitted.forEach((story) => {
    const index = result.findIndex((item) => item.id === story.id);
    if (index < 0) result.push(clone(story));
    else if (json(result[index]) === json(baseItems.get(story.id)) || json(result[index]) === json(story)) result[index] = clone(story);
    else if ((Date.parse(story.updatedAt) || 0) >= (Date.parse(result[index].updatedAt) || 0)) result[index] = clone(story);
  });
  const submittedIds = new Set(submitted.map((story) => story.id));
  return result.filter((story) => submittedIds.has(story.id) || !baseItems.has(story.id));
}

function mergeExpenses(current: TripExpense[], submitted: TripExpense[], base: TripExpense[], contributorName: string): TripExpense[] {
  const result = current.map(clone);
  const baseItems = byId(base);
  submitted.forEach((submittedExpense) => {
    const currentIndex = result.findIndex((expense) => expense.id === submittedExpense.id);
    const baseExpense = baseItems.get(submittedExpense.id);
    if (currentIndex < 0) {
      result.push(clone(submittedExpense));
      return;
    }
    const currentExpense = result[currentIndex];
    if (!baseExpense) {
      if (json(currentExpense) !== json(submittedExpense)) result.push(versionExpense(submittedExpense, contributorName));
      return;
    }
    if (json(submittedExpense) === json(baseExpense)) return;
    if (json(currentExpense) === json(baseExpense) || json(currentExpense) === json(submittedExpense)) {
      result[currentIndex] = clone(submittedExpense);
      return;
    }
    result.push(versionExpense(submittedExpense, contributorName));
  });
  const submittedIds = new Set(submitted.map((expense) => expense.id));
  const removable = new Set(base.filter((baseExpense) => {
    if (submittedIds.has(baseExpense.id)) return false;
    return json(current.find((expense) => expense.id === baseExpense.id)) === json(baseExpense);
  }).map((expense) => expense.id));
  return result.filter((expense) => !removable.has(expense.id));
}

function mergeDocuments(current: TripDocument[], submitted: TripDocument[], base: TripDocument[]): TripDocument[] {
  const result = current.map(clone);
  const baseItems = byId(base);
  submitted.forEach((document) => {
    const index = result.findIndex((item) => item.id === document.id);
    if (index < 0) result.push(clone(document));
    else if (json(result[index]) === json(baseItems.get(document.id)) || json(result[index]) === json(document)) result[index] = clone(document);
  });
  const submittedIds = new Set(submitted.map((document) => document.id));
  return result.filter((document) => submittedIds.has(document.id) || !baseItems.has(document.id));
}

function valuesConflict<T>(current: T, submitted: T, base: T): boolean {
  return json(submitted) !== json(base)
    && json(current) !== json(base)
    && json(submitted) !== json(current);
}

function mergeStructuredValue<T>(current: T, submitted: T, base: T): T {
  if (json(submitted) === json(base)) return current;
  if (json(current) === json(base) || json(current) === json(submitted)) return submitted;
  return current;
}

function stopLocation(stop: TripStop) {
  return {
    place: stop.place,
    placeId: stop.placeId,
    latitude: stop.latitude,
    longitude: stop.longitude,
    googleMapsUrl: stop.googleMapsUrl,
  };
}

function mergeStops(current: TripStop[], submitted: TripStop[], base: TripStop[], contributorName: string): TripStop[] {
  const result = current.map(clone);
  const baseItems = byId(base);
  submitted.forEach((submittedStop) => {
    const currentIndex = result.findIndex((stop) => stop.id === submittedStop.id);
    const baseStop = baseItems.get(submittedStop.id);
    if (currentIndex < 0) {
      result.push(clone(submittedStop));
      return;
    }
    const currentStop = result[currentIndex];
    if (!baseStop) {
      if (json(currentStop) !== json(submittedStop)) result.push(versionStop(submittedStop, contributorName));
      return;
    }
    const submittedLocation = stopLocation(submittedStop);
    const currentLocation = stopLocation(currentStop);
    const baseLocation = stopLocation(baseStop);
    const hasSameFieldConflict = valuesConflict(currentStop.time, submittedStop.time, baseStop.time)
      || valuesConflict(currentStop.title, submittedStop.title, baseStop.title)
      || valuesConflict(currentStop.note, submittedStop.note, baseStop.note)
      || valuesConflict(currentLocation, submittedLocation, baseLocation);
    if (hasSameFieldConflict) {
      result.push(versionStop(submittedStop, contributorName));
      return;
    }
    const mergedLocation = mergeStructuredValue(currentLocation, submittedLocation, baseLocation);
    result[currentIndex] = {
      id: currentStop.id,
      time: mergeValue(currentStop.time, submittedStop.time, baseStop.time),
      title: mergeValue(currentStop.title, submittedStop.title, baseStop.title),
      place: mergedLocation.place,
      note: mergeValue(currentStop.note, submittedStop.note, baseStop.note),
      placeId: mergedLocation.placeId,
      latitude: mergedLocation.latitude,
      longitude: mergedLocation.longitude,
      googleMapsUrl: mergedLocation.googleMapsUrl,
      expenses: mergeExpenses(currentStop.expenses ?? [], submittedStop.expenses ?? [], baseStop.expenses ?? [], contributorName),
      documents: mergeDocuments(currentStop.documents ?? [], submittedStop.documents ?? [], baseStop.documents ?? []),
      memory: mergeMemory(currentStop.memory, submittedStop.memory, baseStop.memory),
    };
  });
  const submittedIds = new Set(submitted.map((stop) => stop.id));
  const removable = new Set(base.filter((baseStop) => {
    if (submittedIds.has(baseStop.id)) return false;
    return json(current.find((stop) => stop.id === baseStop.id)) === json(baseStop);
  }).map((stop) => stop.id));
  return result.filter((stop) => !removable.has(stop.id));
}

function mergeDays(current: TripDay[], submitted: TripDay[], base: TripDay[], contributorName: string, isAdmin: boolean): TripDay[] {
  const result = current.map(clone);
  const baseItems = byId(base);
  submitted.forEach((submittedDay) => {
    const currentIndex = result.findIndex((day) => day.id === submittedDay.id);
    const baseDay = baseItems.get(submittedDay.id);
    if (currentIndex < 0) {
      result.push(clone(submittedDay));
      return;
    }
    const currentDay = result[currentIndex];
    if (!baseDay) {
      if (json(currentDay) !== json(submittedDay)) result.push(versionDay(submittedDay, contributorName));
      return;
    }
    const submittedMetadata = isAdmin
      ? { date: submittedDay.date, label: submittedDay.label, storyTitle: submittedDay.storyTitle, coverPhotoId: submittedDay.coverPhotoId }
      : { date: submittedDay.date, storyTitle: submittedDay.storyTitle, coverPhotoId: submittedDay.coverPhotoId };
    const currentMetadata = isAdmin
      ? { date: currentDay.date, label: currentDay.label, storyTitle: currentDay.storyTitle, coverPhotoId: currentDay.coverPhotoId }
      : { date: currentDay.date, storyTitle: currentDay.storyTitle, coverPhotoId: currentDay.coverPhotoId };
    const baseMetadata = isAdmin
      ? { date: baseDay.date, label: baseDay.label, storyTitle: baseDay.storyTitle, coverPhotoId: baseDay.coverPhotoId }
      : { date: baseDay.date, storyTitle: baseDay.storyTitle, coverPhotoId: baseDay.coverPhotoId };
    if (json(submittedMetadata) !== json(baseMetadata) && json(currentMetadata) !== json(baseMetadata) && json(submittedMetadata) !== json(currentMetadata)) {
      result.push(versionDay(submittedDay, contributorName));
      return;
    }
    currentDay.date = mergeValue(currentDay.date, submittedDay.date, baseDay.date);
    if (isAdmin) currentDay.label = mergeValue(currentDay.label, submittedDay.label, baseDay.label);
    currentDay.storyTitle = mergeValue(currentDay.storyTitle, submittedDay.storyTitle, baseDay.storyTitle);
    currentDay.coverPhotoId = mergeValue(currentDay.coverPhotoId, submittedDay.coverPhotoId, baseDay.coverPhotoId);
    currentDay.stories = mergeStories(currentDay.stories ?? [], submittedDay.stories ?? [], baseDay.stories ?? []);
    currentDay.stops = mergeStops(currentDay.stops, submittedDay.stops, baseDay.stops, contributorName);
  });
  const submittedIds = new Set(submitted.map((day) => day.id));
  const removable = new Set(base.filter((baseDay) => {
    if (submittedIds.has(baseDay.id)) return false;
    return json(current.find((day) => day.id === baseDay.id)) === json(baseDay);
  }).map((day) => day.id));
  return result.filter((day) => !removable.has(day.id));
}

function mergeMembers(current: TripMember[], submitted: TripMember[], base: TripMember[]): TripMember[] {
  const result = current.map(clone);
  submitted.forEach((member) => {
    const index = result.findIndex((currentMember) => currentMember.id === member.id);
    if (index < 0) result.push(clone(member));
    else result[index] = clone(member);
  });
  const submittedIds = new Set(submitted.map((member) => member.id));
  const removable = new Set(base.filter((baseMember) => {
    if (submittedIds.has(baseMember.id)) return false;
    return json(current.find((member) => member.id === baseMember.id)) === json(baseMember);
  }).map((member) => member.id));
  return result.filter((member) => !removable.has(member.id));
}

function restrictContributorChanges(submitted: SharedTripState, current: SharedTripState): SharedTripState {
  const currentDays = byId(current.days);
  return {
    ...submitted,
    tripName: current.tripName,
    coverPhotoId: current.coverPhotoId,
    members: current.members,
    days: submitted.days.map((day) => {
      const existing = currentDays.get(day.id);
      return existing ? { ...day, label: existing.label } : day;
    }),
  };
}

export function mergeTripState(
  current: SharedTripState,
  submitted: SharedTripState,
  base: SharedTripState,
  contributorName: string,
  isAdmin: boolean,
): SharedTripState {
  const authorized = isAdmin ? submitted : restrictContributorChanges(submitted, current);
  if (authorized.revision === current.revision) {
    return { ...clone(authorized), members: isAdmin ? mergeMembers(current.members, authorized.members, base.members) : current.members };
  }
  return {
    tripId: current.tripId,
    tripName: isAdmin ? mergeValue(current.tripName, authorized.tripName, base.tripName) : current.tripName,
    coverPhotoId: isAdmin ? mergeValue(current.coverPhotoId, authorized.coverPhotoId, base.coverPhotoId) : current.coverPhotoId,
    days: mergeDays(current.days, authorized.days, base.days, contributorName, isAdmin),
    members: isAdmin ? mergeMembers(current.members, authorized.members, base.members) : current.members,
    highlights: mergeStories(current.highlights ?? [], authorized.highlights ?? [], base.highlights ?? []),
    revision: current.revision,
    updatedAt: current.updatedAt,
  };
}

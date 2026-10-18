const CONFIG = Object.freeze({
  sharedSecret: "42d677be8042387c7b5bf6015c7fad0378115551993f4bcf91a59cd53d059f40",
  adminSecret: "9f497a8c11a1d9ff94fee7d94b75d1c1d8735b8069323dce14786bdc4d14d587",
  stateFileName: "Trip itinerary.json",
  maximumPhotoBytes: 15 * 1024 * 1024,
  placesSafeLimit: 8000,
  placesGoogleFreeAllowance: 10000,
  firebaseProjectId: "family-trip-app-4d00e",
});

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: "family-trip-drive",
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  let requestId = "unknown";

  try {
    const payload = JSON.parse(event.parameter.payload || "{}");
    requestId = String(payload.requestId || requestId);
    payload.authContext = authorizeRequest_(payload);
    if (payload.authContext.source === "firebase") {
      payload.memberId = payload.authContext.userId;
      payload.memberName = payload.authContext.displayName;
    }

    let result;
    if (payload.action === "ping") {
      result = { ok: true };
    } else if (payload.action === "getTrip") {
      result = getTrip_(payload);
    } else if (payload.action === "saveTrip") {
      result = saveTrip_(payload);
    } else if (payload.action === "upload") {
      result = uploadPhoto_(payload);
    } else if (payload.action === "uploadCover") {
      result = uploadCoverPhoto_(payload);
    } else if (payload.action === "listPhotos") {
      result = listPhotos_(payload);
    } else if (payload.action === "getPhoto") {
      result = getPhoto_(payload);
    } else if (payload.action === "organize") {
      result = organizePhoto_(payload);
    } else if (payload.action === "delete") {
      result = deletePhoto_(payload);
    } else if (payload.action === "placesUsage") {
      result = { ok: true, usage: placesUsage_() };
    } else if (payload.action === "placesAutocomplete") {
      result = autocompletePlaces_(payload);
    } else if (payload.action === "placeDetails") {
      result = placeDetails_(payload);
    } else {
      throw new Error("Unknown request.");
    }

    return iframeResponse_({ ...result, requestId });
  } catch (error) {
    const message = error && error.message ? error.message : "The Drive request failed.";
    return iframeResponse_({
      ok: false,
      requestId,
      message,
      retryable: isRetryable_(message),
    });
  }
}

function autocompletePlaces_(payload) {
  const input = plainText_(payload.input || "", 160, true);
  if (input.length < 3) return { ok: true, suggestions: [], usage: placesUsage_() };
  const apiKey = googlePlacesApiKey_();
  reservePlacesRequest_("autocomplete");
  const response = UrlFetchApp.fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "post",
    contentType: "application/json",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    },
    payload: JSON.stringify({
      input: input,
      sessionToken: safeSessionToken_(payload.sessionToken),
      languageCode: "en",
    }),
    muteHttpExceptions: true,
  });
  const body = parseGoogleResponse_(response, "Google Places search");
  const suggestions = (body.suggestions || []).map(function(suggestion) {
    const prediction = suggestion.placePrediction || {};
    return {
      placeId: plainText_(prediction.placeId || "", 300, true),
      text: plainText_((prediction.text && prediction.text.text) || "", 240, true),
    };
  }).filter(function(suggestion) { return suggestion.placeId && suggestion.text; }).slice(0, 5);
  return { ok: true, suggestions: suggestions, usage: placesUsage_() };
}

function placeDetails_(payload) {
  const placeId = requireText_(payload.placeId, "Google place ID").slice(0, 300);
  const apiKey = googlePlacesApiKey_();
  reservePlacesRequest_("details");
  const sessionToken = safeSessionToken_(payload.sessionToken);
  const url = "https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId) +
    "?sessionToken=" + encodeURIComponent(sessionToken);
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location,googleMapsUri",
    },
    muteHttpExceptions: true,
  });
  const body = parseGoogleResponse_(response, "Google place details");
  const location = body.location || {};
  return {
    ok: true,
    place: {
      placeId: plainText_(body.id || placeId, 300),
      name: plainText_((body.displayName && body.displayName.text) || body.formattedAddress || "Saved location", 180),
      address: plainText_(body.formattedAddress || "", 240, true),
      latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
      longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null,
      googleMapsUrl: plainText_(body.googleMapsUri || "", 500, true),
    },
    usage: placesUsage_(),
  };
}

function googlePlacesApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty("GOOGLE_PLACES_API_KEY");
  if (!key) throw new Error("Google Places setup is not finished yet. You can still type a location manually.");
  return key;
}

function safeSessionToken_(value) {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_-]{16,120}$/.test(token) ? token : Utilities.getUuid();
}

function parseGoogleResponse_(response, label) {
  const status = response.getResponseCode();
  let body;
  try {
    body = JSON.parse(response.getContentText() || "{}");
  } catch (error) {
    body = {};
  }
  if (status < 200 || status >= 300) {
    const message = body.error && body.error.message ? body.error.message : label + " failed.";
    throw new Error(message);
  }
  return body;
}

function placesUsage_() {
  const properties = PropertiesService.getScriptProperties();
  const month = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM");
  const autocompleteUsed = Math.max(0, Number(properties.getProperty(placesUsageKey_(month, "autocomplete"))) || 0);
  const detailsUsed = Math.max(0, Number(properties.getProperty(placesUsageKey_(month, "details"))) || 0);
  const monthParts = month.split("-").map(Number);
  const resetDate = Utilities.formatDate(new Date(Date.UTC(monthParts[0], monthParts[1], 1)), "UTC", "d MMMM yyyy") + " (Pacific time)";
  return {
    enabled: Boolean(properties.getProperty("GOOGLE_PLACES_API_KEY")),
    month: month,
    resetDate: resetDate,
    safeLimit: CONFIG.placesSafeLimit,
    googleFreeAllowance: CONFIG.placesGoogleFreeAllowance,
    autocompleteUsed: autocompleteUsed,
    autocompleteRemaining: Math.max(0, CONFIG.placesSafeLimit - autocompleteUsed),
    detailsUsed: detailsUsed,
    detailsRemaining: Math.max(0, CONFIG.placesSafeLimit - detailsUsed),
  };
}

function placesUsageKey_(month, kind) {
  return "places-usage:" + month + ":" + kind;
}

function reservePlacesRequest_(kind) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const month = Utilities.formatDate(new Date(), "America/Los_Angeles", "yyyy-MM");
    const key = placesUsageKey_(month, kind);
    const used = Math.max(0, Number(properties.getProperty(key)) || 0);
    if (used >= CONFIG.placesSafeLimit) {
      throw new Error("The monthly Google Places safety cap has been reached. Type the location manually until " + placesUsage_().resetDate + ".");
    }
    properties.setProperty(key, String(used + 1));
  } finally {
    lock.releaseLock();
  }
}

function getTrip_(payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const seed = sanitizeTripState_({
    tripId,
    tripName: payload.seed && payload.seed.tripName,
    coverPhotoId: payload.seed && payload.seed.coverPhotoId,
    days: payload.seed && payload.seed.days,
    members: payload.seed && payload.seed.members,
    revision: 1,
    updatedAt: new Date().toISOString(),
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const stored = loadOrCreateTripState_(tripId, seed);
    const member = ensureAuthorizedMember_(stored.trip, payload.authContext);
    if (member.changed) stored.file.setContent(JSON.stringify(stored.trip, null, 2));
    return { ok: true, trip: stored.trip };
  } finally {
    lock.releaseLock();
  }
}

function saveTrip_(payload) {
  const submitted = sanitizeTripState_(payload.trip || {});
  const baseTrip = sanitizeTripState_(payload.baseTrip || payload.trip || {});
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const stored = loadOrCreateTripState_(submitted.tripId, submitted);
    const isAdmin = isAuthorizedAdmin_(payload);
    const authorizedMember = ensureAuthorizedMember_(stored.trip, payload.authContext);
    const memberId = payload.authContext && payload.authContext.source === "firebase"
      ? authorizedMember.member.id
      : String(payload.memberId || "").trim();
    const member = stored.trip.members.find(function(item) { return item.id === memberId; });
    if (!member && !isAdmin) throw new Error("Choose a current family profile before editing the trip.");
    const contributorName = plainText_((member && member.name) || payload.memberName || "Admin", 80);
    const authorizedSubmitted = restrictTripNames_(submitted, stored.trip, isAdmin);
    const isCurrentRevision = Number(authorizedSubmitted.revision) === Number(stored.trip.revision);
    const merged = isCurrentRevision
      ? {
          ...authorizedSubmitted,
          members: isAdmin ? mergeMembers_(stored.trip.members, authorizedSubmitted.members) : stored.trip.members,
        }
      : mergeTripState_(stored.trip, authorizedSubmitted, baseTrip, contributorName, isAdmin);
    const trip = {
      ...merged,
      revision: Math.max(1, Number(stored.trip.revision) || 1) + 1,
      updatedAt: new Date().toISOString(),
    };
    stored.file.setContent(JSON.stringify(trip, null, 2));
    stored.file.moveTo(getTripFolder_(trip.tripId, trip.tripName));
    return { ok: true, trip };
  } finally {
    lock.releaseLock();
  }
}

function restrictTripNames_(submitted, current, isAdmin) {
  if (isAdmin) return submitted;
  const currentDaysById = indexById_(current.days);
  return {
    ...submitted,
    tripName: current.tripName,
    coverPhotoId: current.coverPhotoId,
    days: submitted.days.map(function(day) {
      const currentDay = currentDaysById[day.id];
      return currentDay ? { ...day, label: currentDay.label } : day;
    }),
    members: current.members,
  };
}

function mergeTripState_(current, submitted, base, contributorName, isAdmin) {
  return {
    tripId: current.tripId,
    tripName: isAdmin ? mergeSimpleValue_(current.tripName, submitted.tripName, base.tripName) : current.tripName,
    coverPhotoId: isAdmin ? mergeSimpleValue_(current.coverPhotoId, submitted.coverPhotoId, base.coverPhotoId) : current.coverPhotoId,
    days: mergeDays_(current.days, submitted.days, base.days, contributorName, isAdmin),
    members: isAdmin ? mergeMembers_(current.members, submitted.members) : current.members,
    revision: current.revision,
    updatedAt: current.updatedAt,
  };
}

function mergeSimpleValue_(current, submitted, base) {
  if (submitted === base) return current;
  if (current === base || current === submitted) return submitted;
  return current;
}

function mergeDays_(currentDays, submittedDays, baseDays, contributorName, isAdmin) {
  const result = currentDays.map(function(day) { return cloneJson_(day); });
  const baseById = indexById_(baseDays);

  submittedDays.forEach(function(submittedDay) {
    const currentIndex = result.findIndex(function(day) { return day.id === submittedDay.id; });
    const baseDay = baseById[submittedDay.id];
    if (currentIndex < 0) {
      result.push(cloneJson_(submittedDay));
      return;
    }

    const currentDay = result[currentIndex];
    if (!baseDay) {
      if (JSON.stringify(currentDay) !== JSON.stringify(submittedDay)) {
        result.push(versionDay_(submittedDay, contributorName));
      }
      return;
    }

    const submittedMeta = JSON.stringify(isAdmin
      ? { date: submittedDay.date, label: submittedDay.label, storyTitle: submittedDay.storyTitle, coverPhotoId: submittedDay.coverPhotoId }
      : { date: submittedDay.date, storyTitle: submittedDay.storyTitle, coverPhotoId: submittedDay.coverPhotoId });
    const currentMeta = JSON.stringify(isAdmin
      ? { date: currentDay.date, label: currentDay.label, storyTitle: currentDay.storyTitle, coverPhotoId: currentDay.coverPhotoId }
      : { date: currentDay.date, storyTitle: currentDay.storyTitle, coverPhotoId: currentDay.coverPhotoId });
    const baseMeta = JSON.stringify(isAdmin
      ? { date: baseDay.date, label: baseDay.label, storyTitle: baseDay.storyTitle, coverPhotoId: baseDay.coverPhotoId }
      : { date: baseDay.date, storyTitle: baseDay.storyTitle, coverPhotoId: baseDay.coverPhotoId });
    if (submittedMeta !== baseMeta && currentMeta !== baseMeta && submittedMeta !== currentMeta) {
      result.push(versionDay_(submittedDay, contributorName));
      return;
    }

    currentDay.date = mergeSimpleValue_(currentDay.date, submittedDay.date, baseDay.date);
    if (isAdmin) currentDay.label = mergeSimpleValue_(currentDay.label, submittedDay.label, baseDay.label);
    currentDay.storyTitle = mergeSimpleValue_(currentDay.storyTitle, submittedDay.storyTitle, baseDay.storyTitle);
    currentDay.coverPhotoId = mergeSimpleValue_(currentDay.coverPhotoId, submittedDay.coverPhotoId, baseDay.coverPhotoId);
    currentDay.stops = mergeStops_(currentDay.stops, submittedDay.stops, baseDay.stops, contributorName);
  });

  const submittedById = indexById_(submittedDays);
  const removableIds = baseDays.filter(function(baseDay) {
    if (submittedById[baseDay.id]) return false;
    const currentDay = currentDays.find(function(day) { return day.id === baseDay.id; });
    return currentDay && JSON.stringify(currentDay) === JSON.stringify(baseDay);
  }).map(function(day) { return day.id; });

  return mergeOrder_(
    result.filter(function(day) { return removableIds.indexOf(day.id) < 0; }),
    currentDays,
    submittedDays,
    baseDays,
  );
}

function mergeStops_(currentStops, submittedStops, baseStops, contributorName) {
  const result = currentStops.map(function(stop) { return cloneJson_(stop); });
  const baseById = indexById_(baseStops);

  submittedStops.forEach(function(submittedStop) {
    const currentIndex = result.findIndex(function(stop) { return stop.id === submittedStop.id; });
    const baseStop = baseById[submittedStop.id];
    if (currentIndex < 0) {
      result.push(cloneJson_(submittedStop));
      return;
    }

    const currentStop = result[currentIndex];
    const submittedJson = JSON.stringify(submittedStop);
    const currentJson = JSON.stringify(currentStop);
    if (!baseStop) {
      if (submittedJson !== currentJson) result.push(versionStop_(submittedStop, contributorName));
      return;
    }

    const submittedMeta = stopWithoutExpenses_(submittedStop);
    const currentMeta = stopWithoutExpenses_(currentStop);
    const baseMeta = stopWithoutExpenses_(baseStop);
    const submittedMetaJson = JSON.stringify(submittedMeta);
    const currentMetaJson = JSON.stringify(currentMeta);
    const baseMetaJson = JSON.stringify(baseMeta);
    if (submittedMetaJson !== baseMetaJson && currentMetaJson !== baseMetaJson && submittedMetaJson !== currentMetaJson) {
      result.push(versionStop_(submittedStop, contributorName));
      return;
    }

    const mergedMeta = submittedMetaJson === baseMetaJson
      ? currentMeta
      : currentMetaJson === baseMetaJson || currentMetaJson === submittedMetaJson
        ? submittedMeta
        : currentMeta;
    result[currentIndex] = {
      ...cloneJson_(mergedMeta),
      expenses: mergeExpenses_(currentStop.expenses || [], submittedStop.expenses || [], baseStop.expenses || [], contributorName),
      memory: mergeStopMemory_(currentStop.memory, submittedStop.memory, baseStop.memory),
    };
  });

  const submittedById = indexById_(submittedStops);
  const removableIds = baseStops.filter(function(baseStop) {
    if (submittedById[baseStop.id]) return false;
    const currentStop = currentStops.find(function(stop) { return stop.id === baseStop.id; });
    return currentStop && JSON.stringify(currentStop) === JSON.stringify(baseStop);
  }).map(function(stop) { return stop.id; });

  return mergeOrder_(
    result.filter(function(stop) { return removableIds.indexOf(stop.id) < 0; }),
    currentStops,
    submittedStops,
    baseStops,
  );
}

function stopWithoutExpenses_(stop) {
  const copy = cloneJson_(stop);
  delete copy.expenses;
  delete copy.memory;
  return copy;
}

function mergeStopMemory_(currentMemory, submittedMemory, baseMemory) {
  const currentJson = JSON.stringify(currentMemory || null);
  const submittedJson = JSON.stringify(submittedMemory || null);
  const baseJson = JSON.stringify(baseMemory || null);
  if (submittedJson === baseJson) return currentMemory ? cloneJson_(currentMemory) : undefined;
  if (currentJson === baseJson || currentJson === submittedJson) return submittedMemory ? cloneJson_(submittedMemory) : undefined;

  const currentTime = Date.parse((currentMemory && currentMemory.updatedAt) || "") || 0;
  const submittedTime = Date.parse((submittedMemory && submittedMemory.updatedAt) || "") || 0;
  const latest = submittedTime >= currentTime ? submittedMemory : currentMemory;
  return latest ? cloneJson_(latest) : undefined;
}

function mergeExpenses_(currentExpenses, submittedExpenses, baseExpenses, contributorName) {
  const result = currentExpenses.map(function(expense) { return cloneJson_(expense); });
  const baseById = indexById_(baseExpenses);

  submittedExpenses.forEach(function(submittedExpense) {
    const currentIndex = result.findIndex(function(expense) { return expense.id === submittedExpense.id; });
    const baseExpense = baseById[submittedExpense.id];
    if (currentIndex < 0) {
      result.push(cloneJson_(submittedExpense));
      return;
    }
    const currentExpense = result[currentIndex];
    if (!baseExpense) {
      if (JSON.stringify(currentExpense) !== JSON.stringify(submittedExpense)) {
        result.push(versionExpense_(submittedExpense, contributorName));
      }
      return;
    }
    const submittedJson = JSON.stringify(submittedExpense);
    const currentJson = JSON.stringify(currentExpense);
    const baseJson = JSON.stringify(baseExpense);
    if (submittedJson === baseJson) return;
    if (currentJson === baseJson || currentJson === submittedJson) {
      result[currentIndex] = cloneJson_(submittedExpense);
      return;
    }
    result.push(versionExpense_(submittedExpense, contributorName));
  });

  const submittedById = indexById_(submittedExpenses);
  const removableIds = baseExpenses.filter(function(baseExpense) {
    if (submittedById[baseExpense.id]) return false;
    const currentExpense = currentExpenses.find(function(expense) { return expense.id === baseExpense.id; });
    return currentExpense && JSON.stringify(currentExpense) === JSON.stringify(baseExpense);
  }).map(function(expense) { return expense.id; });

  return result.filter(function(expense) { return removableIds.indexOf(expense.id) < 0; });
}

function mergeOrder_(result, currentItems, submittedItems, baseItems) {
  const baseIds = baseItems.map(function(item) { return item.id; });
  const submittedIds = submittedItems.filter(function(item) {
    return baseIds.indexOf(item.id) >= 0;
  }).map(function(item) { return item.id; });
  const currentIds = currentItems.filter(function(item) {
    return baseIds.indexOf(item.id) >= 0;
  }).map(function(item) { return item.id; });
  const baseComparableToSubmitted = baseIds.filter(function(id) { return submittedIds.indexOf(id) >= 0; });
  const baseComparableToCurrent = baseIds.filter(function(id) { return currentIds.indexOf(id) >= 0; });
  const submittedReordered = JSON.stringify(submittedIds) !== JSON.stringify(baseComparableToSubmitted);
  const currentReordered = JSON.stringify(currentIds) !== JSON.stringify(baseComparableToCurrent);
  if (!submittedReordered || currentReordered) return result;

  const submittedPosition = submittedItems.reduce(function(positions, item, index) {
    positions[item.id] = index;
    return positions;
  }, {});
  return result.map(function(item, index) {
    return { item: item, originalIndex: index };
  }).sort(function(left, right) {
    const leftPosition = submittedPosition[left.item.id];
    const rightPosition = submittedPosition[right.item.id];
    if (leftPosition === undefined && rightPosition === undefined) return left.originalIndex - right.originalIndex;
    if (leftPosition === undefined) return 1;
    if (rightPosition === undefined) return -1;
    return leftPosition - rightPosition;
  }).map(function(entry) { return entry.item; });
}

function versionStop_(stop, contributorName) {
  const copy = cloneJson_(stop);
  copy.id = stop.id + "-version-" + Utilities.getUuid().slice(0, 8);
  copy.title = versionName_(stop.title, contributorName);
  return copy;
}

function versionExpense_(expense, contributorName) {
  const copy = cloneJson_(expense);
  copy.id = expense.id + "-version-" + Utilities.getUuid().slice(0, 8);
  copy.item = versionName_(expense.item, contributorName);
  return copy;
}

function versionDay_(day, contributorName) {
  const copy = cloneJson_(day);
  copy.id = day.id + "-version-" + Utilities.getUuid().slice(0, 8);
  copy.label = versionName_(day.label, contributorName);
  copy.stops = copy.stops.map(function(stop) {
    return { ...stop, id: stop.id + "-version-" + Utilities.getUuid().slice(0, 8) };
  });
  return copy;
}

function versionName_(name, contributorName) {
  return plainText_(name, 120) + " (" + plainText_(contributorName, 80) + "'s version)";
}

function mergeMembers_(currentMembers, submittedMembers) {
  const result = currentMembers.map(function(member) { return cloneJson_(member); });
  submittedMembers.forEach(function(member) {
    const index = result.findIndex(function(current) { return current.id === member.id; });
    if (index < 0) result.push(cloneJson_(member));
    else result[index] = cloneJson_(member);
  });
  return result;
}

function indexById_(items) {
  return (items || []).reduce(function(result, item) {
    result[item.id] = item;
    return result;
  }, {});
}

function cloneJson_(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadOrCreateTripState_(tripId, seed) {
  const properties = PropertiesService.getScriptProperties();
  const propertyKey = "trip-state-file:" + tripId;
  const savedId = properties.getProperty(propertyKey);
  let file;

  if (savedId) {
    try {
      file = DriveApp.getFileById(savedId);
      if (file.isTrashed()) file = undefined;
    } catch (error) {
      file = undefined;
    }
    if (!file) properties.deleteProperty(propertyKey);
  }

  const folder = getTripFolder_(tripId, seed.tripName);
  if (!file) {
    const matches = folder.getFilesByName(CONFIG.stateFileName);
    file = matches.hasNext() ? matches.next() : undefined;
  }

  if (!file) {
    file = folder.createFile(Utilities.newBlob(
      JSON.stringify(seed, null, 2),
      "application/json",
      CONFIG.stateFileName,
    ));
    file.setDescription(JSON.stringify({ familyTripApp: 1, tripId, kind: "itinerary" }));
  }

  properties.setProperty(propertyKey, file.getId());
  let trip;
  try {
    trip = sanitizeTripState_(JSON.parse(file.getBlob().getDataAsString("UTF-8")));
  } catch (error) {
    trip = seed;
    file.setContent(JSON.stringify(seed, null, 2));
  }

  return { file, trip };
}

function sanitizeTripState_(value) {
  const tripId = requireText_(value.tripId, "Trip ID").slice(0, 100);
  const tripName = plainText_(value.tripName || "2026 Vienna Trip", 80);
  const coverPhotoId = plainText_(value.coverPhotoId || "", 200, true);
  const sourceDays = Array.isArray(value.days) ? value.days.slice(0, 30) : [];
  if (sourceDays.length === 0) throw new Error("The itinerary needs at least one day.");
  const sourceMembers = Array.isArray(value.members) && value.members.length > 0
    ? value.members.slice(0, 30)
    : [{ id: "grace", name: "Grace" }];

  const days = sourceDays.map(function(day, dayIndex) {
    const sourceStops = Array.isArray(day.stops) ? day.stops.slice(0, 50) : [];
    return {
      id: plainText_(day.id || "day-" + (dayIndex + 1), 100),
      date: plainText_(day.date || "", 20),
      label: plainText_(day.label || "Trip day " + (dayIndex + 1), 80),
      storyTitle: plainText_(day.storyTitle || "", 120, true),
      coverPhotoId: plainText_(day.coverPhotoId || "", 200, true),
      stops: sourceStops.map(function(stop, stopIndex) {
        return {
          id: plainText_(stop.id || "stop-" + (stopIndex + 1), 100),
          time: plainText_(stop.time || "", 20),
          title: plainText_(stop.title || "Unplanned stop", 120),
          place: plainText_(stop.place || "", 180, true),
          note: plainText_(stop.note || "", 500, true),
          placeId: plainText_(stop.placeId || "", 300, true),
          latitude: Number.isFinite(Number(stop.latitude)) ? Number(stop.latitude) : undefined,
          longitude: Number.isFinite(Number(stop.longitude)) ? Number(stop.longitude) : undefined,
          googleMapsUrl: plainText_(stop.googleMapsUrl || "", 500, true),
          memory: stop.memory && plainText_(stop.memory.comment || "", 1000, true)
            ? {
                comment: plainText_(stop.memory.comment || "", 1000, true),
                updatedByMemberId: plainText_(stop.memory.updatedByMemberId || "", 100),
                updatedByMemberName: plainText_(stop.memory.updatedByMemberName || "Family member", 80),
                updatedAt: plainText_(stop.memory.updatedAt || new Date().toISOString(), 40),
              }
            : undefined,
          expenses: (Array.isArray(stop.expenses) ? stop.expenses : []).slice(0, 200).map(function(expense, expenseIndex) {
            const localAmount = Number(expense.localAmount);
            const homeAmount = expense.homeAmount === null || expense.homeAmount === "" || expense.homeAmount === undefined
              ? null
              : Number(expense.homeAmount);
            return {
              id: plainText_(expense.id || "expense-" + (expenseIndex + 1), 100),
              item: plainText_(expense.item || "Expense", 120),
              category: plainText_(expense.category || "Other", 80),
              memberId: plainText_(expense.memberId || "", 100),
              memberName: plainText_(expense.memberName || "Family member", 80),
              localAmount: Number.isFinite(localAmount) && localAmount >= 0 ? localAmount : 0,
              localCurrency: plainText_(expense.localCurrency || "EUR", 3).toUpperCase(),
              homeAmount: Number.isFinite(homeAmount) && homeAmount >= 0 ? homeAmount : null,
              homeCurrency: plainText_(expense.homeCurrency || "AUD", 3).toUpperCase(),
              exchangeRate: Number.isFinite(Number(expense.exchangeRate)) && Number(expense.exchangeRate) > 0 ? Number(expense.exchangeRate) : undefined,
              exchangeRateDate: plainText_(expense.exchangeRateDate || "", 20),
              createdAt: plainText_(expense.createdAt || new Date().toISOString(), 40),
            };
          }),
        };
      }),
    };
  });

  return {
    tripId,
    tripName,
    coverPhotoId,
    days,
    members: sourceMembers.map(function(member, memberIndex) {
      return {
        id: plainText_(member.id || "member-" + (memberIndex + 1), 100),
        name: plainText_(member.name || "Family member", 80),
      };
    }),
    updatedAt: plainText_(value.updatedAt || new Date().toISOString(), 40),
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
  };
}

function uploadPhoto_(payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const photoId = requireText_(payload.photoId, "Photo ID");
  const mimeType = requireText_(payload.mimeType, "Photo type");
  const encoded = requireText_(payload.data, "Photo data");
  const bytes = Utilities.base64Decode(encoded);

  if (bytes.length === 0 || bytes.length > CONFIG.maximumPhotoBytes) {
    throw new Error("This shared copy is too large. Choose a photo under 15 MB.");
  }

  const folder = getPhotoFolder_(payload);
  const fileName = photoId + "-" + safeFileName_(payload.name || "Trip photo.jpg");
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    return { ok: true, fileId: existing.next().getId(), alreadyUploaded: true };
  }

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setDescription(JSON.stringify(photoMetadata_(payload, photoId)));

  return { ok: true, fileId: file.getId(), alreadyUploaded: false };
}

function uploadCoverPhoto_(payload) {
  if (!isAuthorizedAdmin_(payload)) throw new Error("Only the trip admin can change the cover photo.");
  const tripId = requireText_(payload.tripId, "Trip ID");
  const mimeType = requireText_(payload.mimeType, "Photo type");
  if (mimeType.indexOf("image/") !== 0) throw new Error("Choose an image for the trip cover.");
  const bytes = Utilities.base64Decode(requireText_(payload.data, "Photo data"));
  if (bytes.length === 0 || bytes.length > CONFIG.maximumPhotoBytes) {
    throw new Error("The cover is too large. Choose a photo under 15 MB.");
  }

  const folder = getTripFolder_(tripId, payload.tripName || "Family Trip");
  const fileName = "Trip cover-" + Utilities.getUuid().slice(0, 8) + "-" + safeFileName_(payload.name || "cover.jpg");
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  file.setDescription(JSON.stringify({
    familyTripApp: 1,
    tripId: tripId,
    kind: "cover",
    originalName: plainText_(payload.name || "Trip cover", 180),
    createdAt: new Date().toISOString(),
  }));

  const previousFileId = String(payload.previousFileId || "").trim();
  if (previousFileId && previousFileId !== file.getId()) {
    try {
      const previous = DriveApp.getFileById(previousFileId);
      const metadata = readMetadata_(previous);
      if (metadata.familyTripApp === 1 && metadata.tripId === tripId && metadata.kind === "cover") previous.setTrashed(true);
    } catch (error) {
      // A missing old cover must never block the new one.
    }
  }
  return { ok: true, fileId: file.getId() };
}

function listPhotos_(payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const tripFolder = getTripFolder_(tripId, payload.tripName || "Family Trip");
  const photos = [];
  collectPhotoFiles_(tripFolder, tripId, photos);
  photos.sort(function(left, right) {
    return String(left.createdAt).localeCompare(String(right.createdAt));
  });
  return { ok: true, photos: photos };
}

function collectPhotoFiles_(folder, tripId, photos) {
  const files = folder.getFiles();
  while (files.hasNext() && photos.length < 500) {
    const file = files.next();
    const metadata = readMetadata_(file);
    if (metadata.familyTripApp !== 1 || metadata.tripId !== tripId || metadata.kind === "itinerary" || metadata.kind === "cover") continue;
    const mimeType = file.getMimeType();
    if (mimeType.indexOf("image/") !== 0) continue;
    photos.push({
      fileId: file.getId(),
      photoId: plainText_(metadata.photoId || file.getId(), 160),
      name: plainText_(metadata.originalName || file.getName(), 180),
      mimeType: plainText_(mimeType, 100),
      size: Math.max(0, Number(file.getSize()) || 0),
      createdAt: plainText_(metadata.createdAt || file.getDateCreated().toISOString(), 40),
      dayId: plainText_(metadata.dayId || "", 100, true),
      stopId: plainText_(metadata.stopId || "", 100, true),
      memberId: plainText_(metadata.memberId || "", 100, true),
      memberName: plainText_(metadata.memberName || "Family member", 80),
    });
  }

  const folders = folder.getFolders();
  while (folders.hasNext() && photos.length < 500) {
    collectPhotoFiles_(folders.next(), tripId, photos);
  }
}

function getPhoto_(payload) {
  const fileId = requireText_(payload.fileId, "Drive file ID");
  const file = DriveApp.getFileById(fileId);
  const metadata = readMetadata_(file);
  if (!isOwnedTripFile_(metadata, payload) || file.isTrashed()) {
    throw new Error("That photo is not available in this trip.");
  }
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length === 0 || bytes.length > CONFIG.maximumPhotoBytes) {
    throw new Error("That shared photo is too large to open in the gallery.");
  }
  return {
    ok: true,
    photoData: Utilities.base64Encode(bytes),
    mimeType: file.getMimeType(),
    fileName: plainText_(metadata.originalName || file.getName(), 180),
  };
}

function organizePhoto_(payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const fileId = requireText_(payload.fileId, "Drive file ID");
  const file = DriveApp.getFileById(fileId);
  const metadata = readMetadata_(file);

  if (!isOwnedTripFile_(metadata, payload)) {
    throw new Error("That file is not owned by this trip.");
  }

  file.moveTo(getPhotoFolder_(payload));
  file.setDescription(JSON.stringify(photoMetadata_(payload, metadata.photoId, metadata)));
  return { ok: true, fileId };
}

function deletePhoto_(payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const fileId = requireText_(payload.fileId, "Drive file ID");
  let file;

  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    return { ok: true, alreadyDeleted: true };
  }

  const metadata = readMetadata_(file);

  if (!isOwnedTripFile_(metadata, payload)) {
    throw new Error("That file is not owned by this trip.");
  }

  file.setTrashed(true);
  return { ok: true, alreadyDeleted: false };
}

function getTripFolder_(tripId, tripName) {
  return getManagedFolder_(
    "trip-folder:" + tripId,
    DriveApp.getRootFolder(),
    safeFolderName_(tripName || "Family Trip"),
  );
}

function getPhotoFolder_(payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const dayId = requireText_(payload.dayId, "Day ID");
  const stopId = requireText_(payload.stopId, "Stop ID");
  const dayNumber = Math.max(1, Math.floor(Number(payload.dayNumber) || 1));
  const dayName = safeFolderName_(payload.dayName || "Trip day");
  const stopName = safeFolderName_(payload.stopName || "Unplanned stop");
  const tripFolder = getTripFolder_(tripId, payload.tripName);
  const dayFolder = getManagedFolder_(
    "day-folder:" + tripId + ":" + dayId,
    tripFolder,
    "Day " + dayNumber + " - " + dayName,
  );

  return getManagedFolder_(
    "stop-folder:" + tripId + ":" + stopId,
    dayFolder,
    stopName,
  );
}

function getManagedFolder_(propertyKey, parentFolder, folderName) {
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty(propertyKey);
  let folder;

  if (savedId) {
    try {
      folder = DriveApp.getFolderById(savedId);
      if (folder.isTrashed()) folder = undefined;
    } catch (error) {
      folder = undefined;
    }
    if (!folder) properties.deleteProperty(propertyKey);
  }

  if (!folder) {
    const matches = parentFolder.getFoldersByName(folderName);
    folder = matches.hasNext() ? matches.next() : parentFolder.createFolder(folderName);
    properties.setProperty(propertyKey, folder.getId());
  }

  if (folder.getName() !== folderName) folder.setName(folderName);
  folder.moveTo(parentFolder);
  return folder;
}

function isOwnedTripFile_(metadata, payload) {
  const tripId = requireText_(payload.tripId, "Trip ID");
  const previousTripId = String(payload.previousTripId || "").trim();
  return metadata.familyTripApp === 1 &&
    (metadata.tripId === tripId || (previousTripId && metadata.tripId === previousTripId));
}

function photoMetadata_(payload, photoId, existingMetadata) {
  const existing = existingMetadata || {};
  return {
    familyTripApp: 1,
    tripId: requireText_(payload.tripId, "Trip ID"),
    photoId: requireText_(photoId, "Photo ID"),
    dayId: requireText_(payload.dayId, "Day ID"),
    dayNumber: Math.max(1, Math.floor(Number(payload.dayNumber) || 1)),
    dayName: requireText_(payload.dayName, "Day name"),
    stopId: requireText_(payload.stopId, "Stop ID"),
    stopName: requireText_(payload.stopName, "Stop name"),
    memberId: requireText_(payload.memberId, "Family profile ID"),
    memberName: requireText_(payload.memberName, "Family profile name"),
    originalName: plainText_(payload.name || existing.originalName || "Trip photo", 180),
    createdAt: plainText_(payload.createdAt || existing.createdAt || new Date().toISOString(), 40),
  };
}

function readMetadata_(file) {
  try {
    return JSON.parse(file.getDescription() || "{}");
  } catch (error) {
    return {};
  }
}

function iframeResponse_(result) {
  const serialized = JSON.stringify({ source: "family-trip-drive", ...result })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return HtmlService.createHtmlOutput(
    "<!doctype html><meta charset=\"utf-8\"><script>" +
      "window.top.postMessage(" + serialized + ", '*');" +
      "</script>",
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function authorizeRequest_(payload) {
  if (String(payload.secret || "") === CONFIG.sharedSecret) {
    return {
      source: "legacy",
      role: isAdminSecret_(payload.adminSecret) ? "admin" : "contributor",
      userId: String(payload.memberId || "").trim(),
      displayName: String(payload.memberName || "Family member").trim(),
    };
  }

  const token = String(payload.firebaseToken || "").trim();
  const tripId = String(payload.firebaseTripId || "").trim();
  if (!token || !tripId) throw new Error("Sign in to your family account before opening this trip.");

  const claims = decodeFirebaseClaims_(token);
  if (String(claims.aud || "") !== CONFIG.firebaseProjectId || !claims.sub) {
    throw new Error("This family account token is not valid for the trip app.");
  }
  if (payload.tripId && String(payload.tripId) !== tripId) {
    throw new Error("This account does not belong to that trip.");
  }

  const memberUrl = "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(CONFIG.firebaseProjectId) +
    "/databases/(default)/documents/trips/" + encodeURIComponent(tripId) +
    "/members/" + encodeURIComponent(String(claims.sub));
  const response = UrlFetchApp.fetch(memberUrl, {
    method: "get",
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("This family account is not a member of the selected trip.");
  }

  const document = JSON.parse(response.getContentText() || "{}");
  const fields = document.fields || {};
  return {
    source: "firebase",
    role: firestoreString_(fields.role) === "admin" ? "admin" : "contributor",
    userId: String(claims.sub),
    displayName: firestoreString_(fields.displayName) || String(claims.name || claims.email || "Family member"),
  };
}

function decodeFirebaseClaims_(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("The family account token is malformed.");
  try {
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString("UTF-8"));
  } catch (error) {
    throw new Error("The family account token could not be read.");
  }
}

function firestoreString_(field) {
  return field && field.stringValue ? String(field.stringValue) : "";
}

function ensureAuthorizedMember_(trip, authContext) {
  if (!authContext || authContext.source !== "firebase") {
    return { changed: false, member: { id: String(authContext && authContext.userId || ""), name: String(authContext && authContext.displayName || "Family member") } };
  }
  let member = trip.members.find(function(item) { return item.id === authContext.userId; });
  if (!member) {
    const normalizedName = String(authContext.displayName || "").trim().toLowerCase();
    member = trip.members.find(function(item) { return String(item.name || "").trim().toLowerCase() === normalizedName; });
  }
  if (member) return { changed: false, member: member };
  member = { id: authContext.userId, name: plainText_(authContext.displayName || "Family member", 80) };
  trip.members.push(member);
  return { changed: true, member: member };
}

function isAuthorizedAdmin_(payload) {
  return Boolean(payload.authContext && payload.authContext.role === "admin") || isAdminSecret_(payload.adminSecret);
}

function requireAdmin_(secret) {
  if (!isAdminSecret_(secret)) {
    throw new Error("This device does not have admin editing access.");
  }
}

function isAdminSecret_(secret) {
  return String(secret || "") === CONFIG.adminSecret;
}

function requireText_(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is missing.");
  return text;
}

function plainText_(value, maximumLength, allowEmpty) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text && !allowEmpty) throw new Error("Shared itinerary text is missing.");
  return text.slice(0, maximumLength);
}

function safeFileName_(name) {
  return String(name).replace(/[\\/:*?\"<>|\r\n]+/g, "-").slice(0, 120) || "Trip photo.jpg";
}

function safeFolderName_(name) {
  return String(name).replace(/[\\/:*?\"<>|\r\n]+/g, "-").trim().slice(0, 80) || "Family Trip";
}

function isRetryable_(message) {
  return /timed out|temporar|try again|service invoked too many times|rate|quota/i.test(message);
}

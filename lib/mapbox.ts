import mapboxgl from "mapbox-gl";

export const MAPBOX_ACCESS_TOKEN = ((import.meta as ImportMeta & { env?: { VITE_MAPBOX_ACCESS_TOKEN?: string } }).env?.VITE_MAPBOX_ACCESS_TOKEN ?? "").trim();

mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

function requireMapboxToken(): string {
  if (!MAPBOX_ACCESS_TOKEN) throw new Error("Mapbox is not connected in this app build. Please ask the trip admin to refresh the app.");
  return MAPBOX_ACCESS_TOKEN;
}

export type MapboxSuggestion = {
  placeId: string;
  text: string;
  secondaryText?: string;
};

export type MapboxPlace = {
  placeId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string;
};

type SuggestResponse = {
  suggestions?: Array<{
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
  }>;
};

type RetrieveResponse = {
  features?: Array<{
    properties?: {
      mapbox_id?: string;
      name?: string;
      full_address?: string;
      place_formatted?: string;
      coordinates?: { latitude?: number; longitude?: number };
    };
    geometry?: { coordinates?: [number, number] };
  }>;
};

export async function searchMapboxPlaces(input: string, sessionToken: string): Promise<MapboxSuggestion[]> {
  const parameters = new URLSearchParams({
    q: input,
    access_token: requireMapboxToken(),
    session_token: sessionToken,
    language: "en",
    limit: "6",
  });
  const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${parameters}`);
  if (!response.ok) throw new Error("Mapbox location search is temporarily unavailable.");
  const result = await response.json() as SuggestResponse;
  return (result.suggestions ?? []).flatMap((item) => item.mapbox_id ? [{
    placeId: item.mapbox_id,
    text: item.name || item.full_address || item.place_formatted || "Mapbox place",
    secondaryText: item.full_address || item.place_formatted || undefined,
  }] : []);
}

export async function getMapboxPlace(placeId: string, sessionToken: string): Promise<MapboxPlace> {
  const parameters = new URLSearchParams({ access_token: requireMapboxToken(), session_token: sessionToken });
  const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(placeId)}?${parameters}`);
  if (!response.ok) throw new Error("That Mapbox location could not be opened.");
  const result = await response.json() as RetrieveResponse;
  const feature = result.features?.[0];
  if (!feature) throw new Error("Mapbox did not return that location.");
  const coordinates = feature.properties?.coordinates;
  const longitude = coordinates?.longitude ?? feature.geometry?.coordinates?.[0] ?? null;
  const latitude = coordinates?.latitude ?? feature.geometry?.coordinates?.[1] ?? null;
  const name = feature.properties?.name || "Saved location";
  const address = feature.properties?.full_address || [name, feature.properties?.place_formatted].filter(Boolean).join(", ");
  return {
    placeId: feature.properties?.mapbox_id || placeId,
    name,
    address,
    latitude,
    longitude,
    mapUrl: latitude !== null && longitude !== null
      ? `https://www.mapbox.com/maps/?center=${longitude},${latitude}&zoom=15`
      : "https://www.mapbox.com/maps/",
  };
}

export type FamilyMapPin = {
  id: string;
  latitude: number;
  longitude: number;
  number: number;
  title: string;
  subtitle?: string;
  badge?: number;
  photoUrl?: string;
  tone?: string;
  category?: FamilyMapPinCategory;
};

export type FamilyMapPinCategory = "sight" | "food" | "hotel" | "transport" | "shopping" | "nature" | "activity" | "place";
export type FamilyMapTravelMode = "walking" | "driving" | "cycling" | "direct";
export type FamilyMapRouteSegment = {
  id: string;
  from: [number, number];
  to: [number, number];
  mode: FamilyMapTravelMode;
};

type RouteResult = { coordinates: [number, number][]; duration: number; distance: number };
const routeCache = new Map<string, Promise<RouteResult>>();

export function inferMapPinCategory(title: string): FamilyMapPinCategory {
  const value = title.toLowerCase();
  if (/restaurant|cafe|café|lunch|dinner|breakfast|bar|bakery|market|food/.test(value)) return "food";
  if (/hotel|hostel|apartment|check.?in|accommodation/.test(value)) return "hotel";
  if (/flight|airport|train|station|tram|bus|ferry|metro|subway/.test(value)) return "transport";
  if (/shop|shopping|store|boutique|mall/.test(value)) return "shopping";
  if (/park|garden|beach|lake|mountain|forest|nature/.test(value)) return "nature";
  if (/museum|palace|castle|church|cathedral|landmark|monument|gallery/.test(value)) return "sight";
  if (/tour|walk|class|show|concert|activity/.test(value)) return "activity";
  return "place";
}

function pinIcon(category: FamilyMapPinCategory): string {
  return ({ sight: "✦", food: "♨", hotel: "⌂", transport: "↗", shopping: "◇", nature: "✿", activity: "★", place: "•" })[category];
}

async function getRoute(segment: FamilyMapRouteSegment): Promise<RouteResult> {
  if (segment.mode === "direct") return { coordinates: [segment.from, segment.to], duration: 0, distance: 0 };
  const key = `${segment.mode}:${segment.from.join(",")}:${segment.to.join(",")}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  const request = (async () => {
    const coordinates = `${segment.from.join(",")};${segment.to.join(",")}`;
    const parameters = new URLSearchParams({ access_token: requireMapboxToken(), geometries: "geojson", overview: "full" });
    const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/${segment.mode}/${coordinates}?${parameters}`);
    if (!response.ok) throw new Error("Mapbox could not calculate this route.");
    const result = await response.json() as { routes?: Array<{ geometry?: { coordinates?: [number, number][] }; duration?: number; distance?: number }> };
    const route = result.routes?.[0];
    if (!route?.geometry?.coordinates) throw new Error("No route was found between these stops.");
    return { coordinates: route.geometry.coordinates, duration: route.duration ?? 0, distance: route.distance ?? 0 };
  })();
  routeCache.set(key, request);
  request.catch(() => routeCache.delete(key));
  return request;
}

export function createFamilyMap(
  container: HTMLElement,
  pins: FamilyMapPin[],
  options: { connectPins?: boolean; routeSegments?: FamilyMapRouteSegment[]; onPin?: (id: string) => void; onRouteError?: (message: string) => void } = {},
): mapboxgl.Map {
  requireMapboxToken();
  const map = new mapboxgl.Map({
    container,
    style: "mapbox://styles/mapbox/standard",
    center: pins.length ? [pins[0].longitude, pins[0].latitude] : [16.3738, 48.2082],
    zoom: pins.length ? 12 : 11,
    pitch: 28,
    bearing: -8,
    attributionControl: false,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

  const bounds = new mapboxgl.LngLatBounds();
  pins.forEach((pin) => {
    bounds.extend([pin.longitude, pin.latitude]);
    const element = document.createElement("button");
    element.type = "button";
    const category = pin.category || inferMapPinCategory(pin.title);
    element.className = `family-map-pin ${pin.photoUrl ? "family-map-photo-pin" : ""} ${pin.tone || ""} category-${category}`;
    element.setAttribute("aria-label", `${pin.number}. ${pin.title}`);
    element.innerHTML = pin.photoUrl
      ? `<img src="${escapeHtml(pin.photoUrl)}" alt=""><b>${pin.number}</b>${pin.badge ? `<small>${pin.badge}</small>` : ""}`
      : `<span class="family-map-pin-icon" aria-hidden="true">${pinIcon(category)}</span><b>${pin.number}</b>${pin.badge ? `<small>${pin.badge}</small>` : ""}`;
    element.addEventListener("click", () => options.onPin?.(pin.id));
    new mapboxgl.Marker({ element, anchor: "bottom" })
      .setLngLat([pin.longitude, pin.latitude])
      .setPopup(new mapboxgl.Popup({ offset: 28, closeButton: false }).setHTML(`<strong>${escapeHtml(pin.title)}</strong>${pin.subtitle ? `<small>${escapeHtml(pin.subtitle)}</small>` : ""}`))
      .addTo(map);
  });

  map.on("load", () => {
    if (options.connectPins && pins.length > 1) {
      map.addSource("family-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pins.map((pin) => [pin.longitude, pin.latitude]) } } });
      map.addLayer({ id: "family-route", type: "line", source: "family-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d8795e", "line-width": 4, "line-opacity": .8, "line-dasharray": [1.4, 1.4] } });
    }
    if (options.routeSegments?.length) {
      void Promise.all(options.routeSegments.map(async (segment, index) => {
        try {
          const route = await getRoute(segment);
          if (!map.getStyle()) return;
          const sourceId = `family-route-${index}`;
          map.addSource(sourceId, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.coordinates } } });
          map.addLayer({ id: sourceId, type: "line", source: sourceId, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": segment.mode === "direct" ? "#778b92" : "#d8795e", "line-width": 5, "line-opacity": .9, ...(segment.mode === "direct" ? { "line-dasharray": [1.2, 1.6] } : {}) } });
          if (route.duration > 0) {
            const midpoint = route.coordinates[Math.floor(route.coordinates.length / 2)];
            const label = document.createElement("span");
            label.className = "family-route-label";
            label.textContent = `${Math.max(1, Math.round(route.duration / 60))} min · ${route.distance < 1000 ? `${Math.round(route.distance)} m` : `${(route.distance / 1000).toFixed(1)} km`}`;
            new mapboxgl.Marker({ element: label }).setLngLat(midpoint).addTo(map);
          }
        } catch (error) {
          options.onRouteError?.(error instanceof Error ? error.message : "A route could not be calculated.");
        }
      }));
    }
    if (pins.length === 1) map.flyTo({ center: [pins[0].longitude, pins[0].latitude], zoom: 14.5, duration: 0 });
    else if (pins.length > 1) map.fitBounds(bounds, { padding: 58, maxZoom: 15, duration: 0 });
  });
  return map;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

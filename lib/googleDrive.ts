import type { StoredQueuedPhoto } from "./photoQueue";

const gatewayUrl = "https://script.google.com/macros/s/AKfycbyJPxWveYz8usViasYVNS5DddxuvzfZ5ETvm2yAxmxdiUMYejsk0gFcMDbeQrcpSJXi/exec";
let sharedSecret = "";
const requestTimeoutMs = 150_000;

export function configureGoogleDriveGateway(secret: string): void {
  sharedSecret = secret.trim();
}

type GatewayResponse = {
  source: "family-trip-drive";
  requestId: string;
  ok: boolean;
  message?: string;
  retryable?: boolean;
  fileId?: string;
  trip?: SharedTripState;
  suggestions?: PlaceSuggestion[];
  place?: PlaceDetails;
  usage?: PlacesUsage;
  photos?: SharedPhoto[];
  photoData?: string;
  mimeType?: string;
  fileName?: string;
};

type GatewayPayload = Record<string, unknown> & {
  action: "ping" | "getTrip" | "saveTrip" | "upload" | "listPhotos" | "getPhoto" | "organize" | "delete" | "placesUsage" | "placesAutocomplete" | "placeDetails";
};

export type TripStop = {
  id: string;
  time: string;
  title: string;
  place: string;
  note: string;
  placeId?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUrl?: string;
};

export type PlaceSuggestion = {
  placeId: string;
  text: string;
};

export type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string;
};

export type PlacesUsage = {
  enabled: boolean;
  month: string;
  resetDate: string;
  safeLimit: number;
  googleFreeAllowance: number;
  autocompleteUsed: number;
  autocompleteRemaining: number;
  detailsUsed: number;
  detailsRemaining: number;
};

export type TripDay = {
  id: string;
  date: string;
  label: string;
  stops: TripStop[];
};

export type TripMember = {
  id: string;
  name: string;
};

export type SharedTripState = {
  tripId: string;
  tripName: string;
  days: TripDay[];
  members: TripMember[];
  updatedAt: string;
  revision: number;
};

export type DrivePhotoLocation = {
  tripId: string;
  tripName: string;
  dayId: string;
  dayNumber: number;
  dayName: string;
  stopId: string;
  stopName: string;
  memberId: string;
  memberName: string;
  previousTripId?: string;
};

export type SharedPhoto = {
  fileId: string;
  photoId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  dayId: string;
  stopId: string;
  memberId: string;
  memberName: string;
};

export class GoogleDriveError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "GoogleDriveError";
  }
}

function isGoogleGatewayOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "script.google.com" || hostname.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

function gatewayRequest(payload: GatewayPayload): Promise<GatewayResponse> {
  if (typeof document === "undefined") {
    return Promise.reject(new GoogleDriveError("The Drive service is only available in the app."));
  }
  if (!sharedSecret) {
    return Promise.reject(new GoogleDriveError("Open the private family invitation link to connect this device.", false));
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const frameName = `family-trip-drive-${requestId}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    const input = document.createElement("input");

    iframe.name = frameName;
    iframe.title = "Google Drive upload response";
    iframe.hidden = true;

    form.method = "POST";
    form.action = gatewayUrl;
    form.target = frameName;
    form.hidden = true;

    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify({
      ...payload,
      requestId,
      secret: sharedSecret,
    });
    form.appendChild(input);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
      form.remove();
      iframe.remove();
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isGoogleGatewayOrigin(event.origin)) return;
      if (!event.data || typeof event.data !== "object") return;

      const response = event.data as Partial<GatewayResponse>;
      if (response.source !== "family-trip-drive" || response.requestId !== requestId) return;

      cleanup();
      if (!response.ok) {
        reject(new GoogleDriveError(response.message || "Google Drive could not complete the request.", response.retryable ?? true));
        return;
      }
      resolve(response as GatewayResponse);
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new GoogleDriveError("Google Drive did not respond in time."));
    }, requestTimeoutMs);

    window.addEventListener("message", handleMessage);
    document.body.append(iframe, form);
    form.submit();
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new GoogleDriveError("The temporary photo copy could not be prepared."));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new GoogleDriveError("The temporary photo copy could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function checkGoogleDriveGateway(): Promise<void> {
  await gatewayRequest({ action: "ping" });
}

export async function getSharedTrip(
  tripId: string,
  seed: Pick<SharedTripState, "tripName" | "days" | "members">,
): Promise<SharedTripState> {
  const response = await gatewayRequest({ action: "getTrip", tripId, seed });
  if (!response.trip) {
    throw new GoogleDriveError("Google Drive did not return the shared itinerary.", false);
  }
  return response.trip;
}

export async function saveSharedTrip(
  trip: SharedTripState,
  member: TripMember,
  baseTrip: SharedTripState,
  adminSecret?: string,
): Promise<SharedTripState> {
  const response = await gatewayRequest({
    action: "saveTrip",
    trip,
    baseTrip,
    memberId: member.id,
    memberName: member.name,
    adminSecret,
  });
  if (!response.trip) {
    throw new GoogleDriveError("Google Drive did not confirm the itinerary update.", false);
  }
  return response.trip;
}

export async function uploadPhotoToDrive(
  location: DrivePhotoLocation,
  photo: StoredQueuedPhoto,
): Promise<string> {
  const response = await gatewayRequest({
    action: "upload",
    ...location,
    photoId: photo.id,
    name: photo.name,
    mimeType: photo.mimeType,
    createdAt: photo.createdAt,
    data: await blobToBase64(photo.blob),
  });

  if (!response.fileId) {
    throw new GoogleDriveError("Google Drive did not return the uploaded file ID.", false);
  }
  return response.fileId;
}

export async function getSharedPhotos(tripId: string, tripName: string): Promise<SharedPhoto[]> {
  const response = await gatewayRequest({ action: "listPhotos", tripId, tripName });
  if (!response.photos) {
    throw new GoogleDriveError("Google Drive did not return the shared photo gallery.", false);
  }
  return response.photos;
}

export async function getSharedPhotoBlob(tripId: string, fileId: string): Promise<{ blob: Blob; name: string }> {
  const response = await gatewayRequest({ action: "getPhoto", tripId, fileId });
  if (!response.photoData || !response.mimeType) {
    throw new GoogleDriveError("Google Drive did not return that shared photo.", false);
  }
  const binary = window.atob(response.photoData);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return {
    blob: new Blob([bytes], { type: response.mimeType }),
    name: response.fileName || "Trip photo",
  };
}

export async function organizeDriveFile(
  location: DrivePhotoLocation,
  fileId: string,
): Promise<void> {
  await gatewayRequest({
    action: "organize",
    ...location,
    fileId,
  });
}

export async function deleteDriveFile(
  tripId: string,
  fileId: string,
  previousTripId?: string,
): Promise<void> {
  await gatewayRequest({
    action: "delete",
    tripId,
    fileId,
    previousTripId,
  });
}

export async function getPlacesUsage(): Promise<PlacesUsage> {
  const response = await gatewayRequest({ action: "placesUsage" });
  if (!response.usage) throw new GoogleDriveError("Google Places usage was unavailable.", false);
  return response.usage;
}

export async function searchPlaces(input: string, sessionToken: string): Promise<{ suggestions: PlaceSuggestion[]; usage: PlacesUsage }> {
  const response = await gatewayRequest({ action: "placesAutocomplete", input, sessionToken });
  if (!response.suggestions || !response.usage) {
    throw new GoogleDriveError("Google Places did not return search suggestions.", false);
  }
  return { suggestions: response.suggestions, usage: response.usage };
}

export async function getPlaceDetails(placeId: string, sessionToken: string): Promise<{ place: PlaceDetails; usage: PlacesUsage }> {
  const response = await gatewayRequest({ action: "placeDetails", placeId, sessionToken });
  if (!response.place || !response.usage) {
    throw new GoogleDriveError("Google Places did not return that location.", false);
  }
  return { place: response.place, usage: response.usage };
}

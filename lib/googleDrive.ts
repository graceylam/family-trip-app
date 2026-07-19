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
};

type GatewayPayload = Record<string, unknown> & {
  action: "ping" | "getTrip" | "saveTrip" | "upload" | "organize" | "delete";
};

export type TripStop = {
  id: string;
  time: string;
  title: string;
  place: string;
  note: string;
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
    data: await blobToBase64(photo.blob),
  });

  if (!response.fileId) {
    throw new GoogleDriveError("Google Drive did not return the uploaded file ID.", false);
  }
  return response.fileId;
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

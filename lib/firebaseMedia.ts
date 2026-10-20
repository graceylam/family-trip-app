import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from "firebase/firestore";
import { getFamilyFirestore, getFamilyIdToken, type FamilyAccount } from "./firebaseAccounts";
import type { StoredQueuedPhoto } from "./photoQueue";

type MediaEnvironment = Partial<Record<"VITE_R2_MEDIA_API_URL", string>>;
const environment = ((import.meta as ImportMeta & { env?: MediaEnvironment }).env ?? {});
const mediaApiUrl = String(
  environment.VITE_R2_MEDIA_API_URL || "https://family-trip-media-api.grace-family-trip.workers.dev",
).replace(/\/$/, "");

export type TripMedia = {
  fileId: string;
  photoId: string;
  name: string;
  mimeType: string;
  mediaType: "photo" | "video";
  size: number;
  createdAt: string;
  uploadedAt: string;
  dayId: string;
  stopId: string;
  memberId: string;
  memberName: string;
  caption: string;
  favoriteBy: string[];
  hiddenBy: string[];
  storagePath: string;
  thumbnailPath?: string;
  downloadUrl: string;
  thumbnailUrl?: string;
  storageProvider: "r2" | "firebase";
};

export type MediaLocation = { dayId: string; stopId: string };

function mediaCollection(tripId: string) {
  return collection(getFamilyFirestore(), "trips", tripId, "media");
}

function cleanMedia(id: string, value: Partial<TripMedia>): TripMedia {
  const mimeType = String(value.mimeType || "image/jpeg");
  return {
    fileId: id,
    photoId: id,
    name: String(value.name || "Trip memory"),
    mimeType,
    mediaType: value.mediaType === "video" || mimeType.startsWith("video/") ? "video" : "photo",
    size: Number(value.size || 0),
    createdAt: String(value.createdAt || value.uploadedAt || new Date().toISOString()),
    uploadedAt: String(value.uploadedAt || value.createdAt || new Date().toISOString()),
    dayId: String(value.dayId || ""),
    stopId: String(value.stopId || ""),
    memberId: String(value.memberId || ""),
    memberName: String(value.memberName || "Family member"),
    caption: String(value.caption || ""),
    favoriteBy: Array.isArray(value.favoriteBy) ? value.favoriteBy.map(String) : [],
    hiddenBy: Array.isArray(value.hiddenBy) ? value.hiddenBy.map(String) : [],
    storagePath: String(value.storagePath || ""),
    ...(value.thumbnailPath ? { thumbnailPath: String(value.thumbnailPath) } : {}),
    downloadUrl: String(value.downloadUrl || ""),
    ...(value.thumbnailUrl ? { thumbnailUrl: String(value.thumbnailUrl) } : {}),
    storageProvider: value.storageProvider === "firebase" ? "firebase" : "r2",
  };
}

export function observeTripMedia(tripId: string, listener: (media: TripMedia[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(mediaCollection(tripId), (snapshot) => {
    listener(snapshot.docs.map((item) => cleanMedia(item.id, item.data())).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }, (error) => onError(error));
}

function loadImage(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Thumbnail creation failed.")); };
    image.src = url;
  });
}

async function imageThumbnail(blob: Blob): Promise<Blob | null> {
  if (!blob.type.startsWith("image/")) return null;
  try {
    const image = await loadImage(blob);
    const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .78));
  } catch { return null; }
}

function requireMediaApi(): string {
  if (!mediaApiUrl) throw new Error("Shared photo storage is still being connected. Your memory remains safely queued on this device.");
  return mediaApiUrl;
}

async function uploadBlob(path: string, blob: Blob, fileName: string, accessKey: string, onProgress?: (progress: number) => void): Promise<void> {
  const token = await getFamilyIdToken();
  const base = requireMediaApi();
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", `${base}${path}`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    request.setRequestHeader("X-File-Name", fileName);
    request.setRequestHeader("X-Media-Access-Key", accessKey);
    request.upload.onprogress = (event) => onProgress?.(event.lengthComputable ? event.loaded / event.total : 0);
    request.onerror = () => reject(new Error("The media service could not be reached. Your memory remains safely queued."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { onProgress?.(1); resolve(); return; }
      try { reject(new Error(String((JSON.parse(request.responseText) as { error?: string }).error || "Upload failed."))); }
      catch { reject(new Error("Upload failed. Your memory remains safely queued.")); }
    };
    request.send(blob);
  });
}

function objectUrl(path: string, accessKey: string): string {
  return `${requireMediaApi()}${path}?access=${encodeURIComponent(accessKey)}`;
}

export async function uploadTripMedia(account: FamilyAccount, tripId: string, record: StoredQueuedPhoto, location: MediaLocation, onProgress?: (progress: number) => void): Promise<TripMedia> {
  if (record.size > 95_000_000) throw new Error("Videos and photos must be smaller than 95 MB for now.");
  const id = record.id;
  const accessKey = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const originalPath = `/v1/media/${encodeURIComponent(tripId)}/${encodeURIComponent(id)}/original`;
  const thumbnail = await imageThumbnail(record.blob);
  const thumbnailPath = thumbnail ? `/v1/media/${encodeURIComponent(tripId)}/${encodeURIComponent(id)}/thumbnail` : undefined;
  await uploadBlob(originalPath, record.blob, record.name, accessKey, (progress) => onProgress?.(progress * (thumbnail ? .9 : 1)));
  if (thumbnail && thumbnailPath) await uploadBlob(thumbnailPath, thumbnail, "thumbnail.jpg", accessKey, (progress) => onProgress?.(.9 + progress * .1));
  const media: TripMedia = {
    fileId: id, photoId: id, name: record.name, mimeType: record.mimeType,
    mediaType: record.mimeType.startsWith("video/") ? "video" : "photo",
    size: record.size, createdAt: record.createdAt, uploadedAt: new Date().toISOString(),
    dayId: location.dayId, stopId: location.stopId,
    memberId: account.uid, memberName: account.displayName,
    caption: "", favoriteBy: [], hiddenBy: [],
    storagePath: originalPath,
    ...(thumbnailPath ? { thumbnailPath } : {}),
    downloadUrl: objectUrl(originalPath, accessKey),
    ...(thumbnailPath ? { thumbnailUrl: objectUrl(thumbnailPath, accessKey) } : {}),
    storageProvider: "r2",
  };
  try {
    await setDoc(doc(getFamilyFirestore(), "trips", tripId, "media", id), { ...media, uploadedAtServer: serverTimestamp() });
  } catch (error) {
    await Promise.allSettled([removeObject(originalPath), thumbnailPath ? removeObject(thumbnailPath) : Promise.resolve()]);
    throw error;
  }
  return media;
}

async function removeObject(path: string): Promise<void> {
  const token = await getFamilyIdToken();
  const response = await fetch(`${requireMediaApi()}${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "The private cloud copy could not be removed.");
  }
}

export async function updateTripMedia(tripId: string, mediaId: string, changes: Partial<Pick<TripMedia, "caption" | "favoriteBy" | "hiddenBy">>): Promise<void> {
  await updateDoc(doc(getFamilyFirestore(), "trips", tripId, "media", mediaId), changes);
}

export async function deleteTripMedia(tripId: string, media: TripMedia): Promise<void> {
  if (media.storageProvider !== "r2") throw new Error("This older memory is preserved in the previous storage provider.");
  // Keep the Firestore record when object removal fails so the media is still
  // visible and the user can retry instead of silently orphaning paid storage.
  await Promise.all([
    media.storagePath ? removeObject(media.storagePath) : Promise.resolve(),
    media.thumbnailPath ? removeObject(media.thumbnailPath) : Promise.resolve(),
  ]);
  await deleteDoc(doc(getFamilyFirestore(), "trips", tripId, "media", media.fileId));
}

export async function getTripMediaBlob(media: TripMedia): Promise<Blob> {
  if (!media.downloadUrl) throw new Error("This memory has no shared storage location.");
  const response = await fetch(media.downloadUrl);
  if (!response.ok) throw new Error("This memory could not be downloaded.");
  return response.blob();
}

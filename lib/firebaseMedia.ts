import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from "firebase/firestore";
import { deleteObject, getBlob, getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { getFamilyFirestore, getFamilyStorage, type FamilyAccount } from "./firebaseAccounts";
import type { StoredQueuedPhoto } from "./photoQueue";

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
};

export type MediaLocation = {
  dayId: string;
  stopId: string;
};

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

function uploadBlob(path: string, blob: Blob, memberId: string, onProgress?: (progress: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(getFamilyStorage(), path), blob, {
      contentType: blob.type || "application/octet-stream",
      customMetadata: { memberId },
    });
    task.on("state_changed", (snapshot) => onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0), reject, () => resolve());
  });
}

export async function uploadTripMedia(
  account: FamilyAccount,
  tripId: string,
  record: StoredQueuedPhoto,
  location: MediaLocation,
  onProgress?: (progress: number) => void,
): Promise<TripMedia> {
  const id = record.id;
  const safeName = record.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "memory";
  const storagePath = `trips/${tripId}/media/${id}/original-${safeName}`;
  const thumbnail = await imageThumbnail(record.blob);
  const thumbnailPath = thumbnail ? `trips/${tripId}/media/${id}/thumbnail.jpg` : undefined;
  await uploadBlob(storagePath, record.blob, account.uid, onProgress);
  if (thumbnail && thumbnailPath) await uploadBlob(thumbnailPath, thumbnail, account.uid);
  const [downloadUrl, thumbnailUrl] = await Promise.all([
    getDownloadURL(ref(getFamilyStorage(), storagePath)),
    thumbnailPath ? getDownloadURL(ref(getFamilyStorage(), thumbnailPath)) : Promise.resolve(undefined),
  ]);
  const media: TripMedia = {
    fileId: id, photoId: id, name: record.name, mimeType: record.mimeType,
    mediaType: record.mimeType.startsWith("video/") ? "video" : "photo",
    size: record.size, createdAt: record.createdAt, uploadedAt: new Date().toISOString(),
    dayId: location.dayId, stopId: location.stopId,
    memberId: account.uid, memberName: account.displayName,
    caption: "", favoriteBy: [], hiddenBy: [], storagePath,
    ...(thumbnailPath ? { thumbnailPath } : {}), downloadUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
  await setDoc(doc(getFamilyFirestore(), "trips", tripId, "media", id), { ...media, uploadedAtServer: serverTimestamp() });
  return media;
}

export async function updateTripMedia(tripId: string, mediaId: string, changes: Partial<Pick<TripMedia, "caption" | "favoriteBy" | "hiddenBy">>): Promise<void> {
  await updateDoc(doc(getFamilyFirestore(), "trips", tripId, "media", mediaId), changes);
}

export async function deleteTripMedia(tripId: string, media: TripMedia): Promise<void> {
  await Promise.allSettled([
    media.storagePath ? deleteObject(ref(getFamilyStorage(), media.storagePath)) : Promise.resolve(),
    media.thumbnailPath ? deleteObject(ref(getFamilyStorage(), media.thumbnailPath)) : Promise.resolve(),
  ]);
  await deleteDoc(doc(getFamilyFirestore(), "trips", tripId, "media", media.fileId));
}

export async function getTripMediaBlob(media: TripMedia): Promise<Blob> {
  if (!media.storagePath) throw new Error("This memory has no Firebase Storage path.");
  return getBlob(ref(getFamilyStorage(), media.storagePath));
}

import { Capacitor, registerPlugin } from "@capacitor/core";

type NativePhotosPlugin = {
  saveFromUrl(options: { url: string; mimeType: string }): Promise<{ saved: boolean }>;
  saveBase64(options: { data: string; mimeType: string }): Promise<{ saved: boolean }>;
  beginChunkedSave(options: { mimeType: string }): Promise<{ id: string }>;
  appendChunk(options: { id: string; data: string }): Promise<{ appended: boolean }>;
  finishChunkedSave(options: { id: string }): Promise<{ saved: boolean }>;
};

const NativePhotos = registerPlugin<NativePhotosPlugin>("NativePhotos");

export function canSaveDirectlyToPhotos(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function saveUrlToPhotos(url: string, mimeType: string): Promise<void> {
  await NativePhotos.saveFromUrl({ url, mimeType });
}

export async function saveBlobToNativePhotos(blob: Blob, mimeType: string): Promise<void> {
  if (mimeType.startsWith("video/") || blob.size > 4 * 1024 * 1024) {
    const { id } = await NativePhotos.beginChunkedSave({ mimeType });
    const chunkSize = 512 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(reader.error ?? new Error("Part of the video could not be read."));
        reader.readAsDataURL(blob.slice(offset, Math.min(offset + chunkSize, blob.size)));
      });
      await NativePhotos.appendChunk({ id, data });
    }
    await NativePhotos.finishChunkedSave({ id });
    return;
  }
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error ?? new Error("The memory could not be read."));
    reader.readAsDataURL(blob);
  });
  await NativePhotos.saveBase64({ data, mimeType });
}

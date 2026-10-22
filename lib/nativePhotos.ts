import { Capacitor, registerPlugin } from "@capacitor/core";

type NativePhotosPlugin = {
  saveFromUrl(options: { url: string; mimeType: string }): Promise<{ saved: boolean }>;
  saveBase64(options: { data: string; mimeType: string }): Promise<{ saved: boolean }>;
};

const NativePhotos = registerPlugin<NativePhotosPlugin>("NativePhotos");

export function canSaveDirectlyToPhotos(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function saveUrlToPhotos(url: string, mimeType: string): Promise<void> {
  await NativePhotos.saveFromUrl({ url, mimeType });
}

export async function saveBlobToNativePhotos(blob: Blob, mimeType: string): Promise<void> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error ?? new Error("The memory could not be read."));
    reader.readAsDataURL(blob);
  });
  await NativePhotos.saveBase64({ data, mimeType });
}

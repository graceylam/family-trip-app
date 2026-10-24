import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeDocumentsPlugin = {
  previewBase64(options: { data: string; name: string; mimeType: string }): Promise<{ opened: boolean }>;
};

const NativeDocuments = registerPlugin<NativeDocumentsPlugin>("NativeDocuments");

export function canPreviewDocumentsNatively(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function previewBlobNatively(blob: Blob, name: string, mimeType: string): Promise<void> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error ?? new Error("The document could not be read."));
    reader.readAsDataURL(blob);
  });
  await NativeDocuments.previewBase64({ data, name, mimeType });
}

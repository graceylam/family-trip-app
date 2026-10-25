import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeSharePlugin = {
  shareBase64(options: { data: string; name: string; mimeType: string }): Promise<{ shared: boolean }>;
};

const NativeShare = registerPlugin<NativeSharePlugin>("NativeShare");

export function canUseNativeShare(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export async function shareBlobNatively(blob: Blob, name: string, mimeType: string): Promise<void> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(blob);
  });
  await NativeShare.shareBase64({ data, name, mimeType });
}

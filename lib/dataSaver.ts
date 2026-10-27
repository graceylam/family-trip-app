import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

export type DataPreferences = {
  wifiOnlyUploads: boolean;
  wifiOnlyDownloads: boolean;
  wifiOnlyVideos: boolean;
  wifiOnlySharedMedia: boolean;
};

export const defaultDataPreferences: DataPreferences = {
  wifiOnlyUploads: false,
  wifiOnlyDownloads: false,
  wifiOnlyVideos: false,
  wifiOnlySharedMedia: false,
};

export type DataAction = "upload" | "download" | "video" | "shared-media";

export async function isWifiConnection(): Promise<boolean | null> {
  try {
    const status = await Network.getStatus();
    if (!status.connected || status.connectionType === "none") return false;
    if (status.connectionType === "wifi") return true;
    if (status.connectionType === "cellular") return false;
    // Desktop browsers generally cannot distinguish Wi-Fi from Ethernet.
    // Treat that as unknown instead of blocking an ordinary laptop session.
    return Capacitor.isNativePlatform() ? false : null;
  } catch {
    return Capacitor.isNativePlatform() ? false : null;
  }
}

export function preferenceForAction(preferences: DataPreferences, action: DataAction): boolean {
  if (action === "upload") return preferences.wifiOnlyUploads;
  if (action === "download") return preferences.wifiOnlyDownloads;
  if (action === "video") return preferences.wifiOnlyVideos;
  return preferences.wifiOnlySharedMedia;
}

export async function canUseData(preferences: DataPreferences, action: DataAction): Promise<boolean> {
  if (!preferenceForAction(preferences, action)) return true;
  const wifi = await isWifiConnection();
  return wifi !== false;
}

export function wifiOnlyMessage(action: DataAction): string {
  if (action === "upload") return "Uploads are paused until this device is connected to Wi-Fi.";
  if (action === "download") return "Saving and downloading are paused until this device is connected to Wi-Fi.";
  if (action === "video") return "New videos are paused until this device is connected to Wi-Fi.";
  return "New shared photos and scrapbook media are paused until this device is connected to Wi-Fi.";
}

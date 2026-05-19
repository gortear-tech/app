import Constants from "expo-constants";
import { Linking } from "react-native";
import { getMobileConfig } from "./config";

export type AppUpdateInfo = {
  versionName: string;
  versionCode?: number;
  apkUrl: string;
  mandatory?: boolean;
  notes?: string;
  publishedAt?: string;
};

type UpdateManifest = AppUpdateInfo & {
  platform: "android";
};

const parseVersion = (version: string) =>
  version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));

const isNewerVersion = (candidate: string, current: string) => {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
};

export const currentAppVersion = () => Constants.expoConfig?.version ?? "0.0.0";

export const checkForAppUpdate = async (): Promise<AppUpdateInfo | null> => {
  const { updateManifestUrl } = getMobileConfig();
  const response = await fetch(`${updateManifestUrl}?t=${Date.now()}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) return null;

  const manifest = (await response.json()) as UpdateManifest;
  if (manifest.platform !== "android" || !manifest.apkUrl || !manifest.versionName) return null;
  if (!isNewerVersion(manifest.versionName, currentAppVersion())) return null;

  return {
    versionName: manifest.versionName,
    ...(manifest.versionCode === undefined ? {} : { versionCode: manifest.versionCode }),
    apkUrl: manifest.apkUrl,
    ...(manifest.mandatory === undefined ? {} : { mandatory: manifest.mandatory }),
    ...(manifest.notes ? { notes: manifest.notes } : {}),
    ...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {})
  };
};

export const openAppUpdate = async (update: AppUpdateInfo) => {
  await Linking.openURL(update.apkUrl);
};

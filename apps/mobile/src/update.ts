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

const numberValue = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const parseManifest = (raw: string): UpdateManifest | null => {
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "").trim()) as Partial<UpdateManifest>;
    if (parsed.platform !== "android" || !parsed.apkUrl || !parsed.versionName) return null;
    return parsed as UpdateManifest;
  } catch {
    return null;
  }
};

export const currentAppVersion = () =>
  Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "0.0.0";

export const currentAppVersionCode = () => numberValue(Constants.nativeBuildVersion);

export const checkForAppUpdate = async (): Promise<AppUpdateInfo | null> => {
  const { updateManifestUrl } = getMobileConfig();
  const response = await fetch(`${updateManifestUrl}?t=${Date.now()}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) return null;

  const manifest = parseManifest(await response.text());
  if (!manifest) return null;
  const manifestCode = numberValue(manifest.versionCode);
  const currentCode = currentAppVersionCode();
  const newerByCode = manifestCode !== null && currentCode !== null && manifestCode > currentCode;
  if (!newerByCode && !isNewerVersion(manifest.versionName, currentAppVersion())) return null;

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

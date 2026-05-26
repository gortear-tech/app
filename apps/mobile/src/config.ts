export type MobileConfig = {
  appEnv: "development" | "staging" | "production";
  apiUrl: string;
  updateManifestUrl: string;
  sentryDsn?: string;
  powerSyncUrl?: string;
};

const localhostPattern = /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i;
const temporaryTunnelPattern = /trycloudflare\.com|ngrok(?:-free)?\.(?:app|io)|loca\.lt/i;
const productionApiUrl = "https://fbmaniaco-api.onrender.com";
const productionUpdateManifestUrl =
  "https://guzohwqptoiagulxsard.supabase.co/storage/v1/object/public/app-downloads/fbmaniaco-android-update.json";

declare const __DEV__: boolean | undefined;

export const getMobileConfig = (): MobileConfig => {
  const isDevelopmentBundle = typeof __DEV__ !== "undefined" ? __DEV__ : false;
  const configuredAppEnv = process.env.EXPO_PUBLIC_APP_ENV as MobileConfig["appEnv"] | undefined;
  const appEnv = (isDevelopmentBundle ? configuredAppEnv ?? "development" : "production") as MobileConfig["appEnv"];
  const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const isUnsafeProductionApiUrl = (url: string) =>
    localhostPattern.test(url) || temporaryTunnelPattern.test(url) || !url.startsWith("https://");
  const apiUrl =
    appEnv === "development"
      ? configuredApiUrl ?? "http://localhost:4000"
      : configuredApiUrl && !isUnsafeProductionApiUrl(configuredApiUrl)
        ? configuredApiUrl
        : productionApiUrl;
  const updateManifestUrl = process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL ?? productionUpdateManifestUrl;
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN_MOBILE;
  const powerSyncUrl = process.env.EXPO_PUBLIC_POWERSYNC_URL;

  if (appEnv !== "development" && isUnsafeProductionApiUrl(apiUrl)) {
    throw new Error("Staging and production mobile builds must use a public HTTPS API URL.");
  }

  return { appEnv, apiUrl, updateManifestUrl, ...(sentryDsn ? { sentryDsn } : {}), ...(powerSyncUrl ? { powerSyncUrl } : {}) };
};

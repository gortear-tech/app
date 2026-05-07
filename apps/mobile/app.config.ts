import type { ConfigContext, ExpoConfig } from "expo/config";

const configuredApiUrl = process.env.API_URL ?? process.env.EXPO_PUBLIC_API_URL;
const TEST_API_URL = configuredApiUrl ?? "http://localhost:4101";
const TEST_META_BOOTSTRAP_TOKEN = process.env.EXPO_PUBLIC_META_BOOTSTRAP_TOKEN ?? "";

function readBuildVariant(): string {
  return process.env.APP_VARIANT ?? process.env.EAS_BUILD_PROFILE ?? (process.env.NODE_ENV === "production" ? "production" : "development");
}

function isPrivateHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function assertProductionApiUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Production API_URL must be a valid public HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || isPrivateHost(parsed.hostname)) {
    throw new Error("Production API_URL must be a public HTTPS URL, not localhost or a LAN IP.");
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const buildVariant = readBuildVariant();
  const runtimeChannel = buildVariant === "production" ? "production" : "test";
  if (runtimeChannel === "production" && !configuredApiUrl?.trim()) {
    throw new Error("Production mobile builds require API_URL or EXPO_PUBLIC_API_URL with the public API URL.");
  }
  if (runtimeChannel === "production") {
    assertProductionApiUrl(configuredApiUrl!.trim());
  }
  const apiUrl = runtimeChannel === "production" ? configuredApiUrl!.trim() : TEST_API_URL;

  return {
    ...config,
    name: "FBmaniaco",
    slug: "fbmaniaco",
    android: {
      ...(config.android ?? {}),
      package: "com.gabriel.fbmaniaco",
      versionCode: 2,
    },
    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier: "com.gabriel.fbmaniaco",
    },
    scheme: "fbmaniaco",
    version: "0.1.1",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    platforms: ["ios", "android", "web"],
    owner: "tremender",
    plugins: config.plugins ?? [
      [
        "expo-build-properties",
        {
          android: {
            kotlinVersion: "1.9.25",
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
    extra: {
      ...(config.extra ?? {}),
      eas: {
        projectId: "9b10cbee-5ec9-4565-ac13-a27d70c4cc50",
      },
      buildVariant,
      runtimeChannel,
      apiUrl,
      bootstrapToken: runtimeChannel === "production" ? "" : TEST_META_BOOTSTRAP_TOKEN,
      allowTestBootstrap: runtimeChannel !== "production",
      storageNamespace: `fbmaniaco.${runtimeChannel}`,
    },
  };
};

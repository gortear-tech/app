export type MobileConfig = {
  appEnv: "development" | "staging" | "production";
  apiUrl: string;
};

const localhostPattern = /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i;
const productionApiUrl = "https://fbmaniaco-api.onrender.com";

declare const __DEV__: boolean | undefined;

export const getMobileConfig = (): MobileConfig => {
  const isDevelopmentBundle = typeof __DEV__ !== "undefined" ? __DEV__ : false;
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? (isDevelopmentBundle ? "development" : "production")) as MobileConfig["appEnv"];
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? (appEnv === "development" ? "http://localhost:4000" : productionApiUrl);

  if (appEnv !== "development" && (localhostPattern.test(apiUrl) || !apiUrl.startsWith("https://"))) {
    throw new Error("Staging and production mobile builds must use a public HTTPS API URL.");
  }

  return { appEnv, apiUrl };
};

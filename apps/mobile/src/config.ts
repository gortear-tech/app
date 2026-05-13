export type MobileConfig = {
  appEnv: "development" | "staging" | "production";
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const localhostPattern = /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i;

export const getMobileConfig = (): MobileConfig => {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development") as MobileConfig["appEnv"];
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (appEnv !== "development" && (localhostPattern.test(apiUrl) || !apiUrl.startsWith("https://"))) {
    throw new Error("Staging and production mobile builds must use a public HTTPS API URL.");
  }
  if (appEnv !== "development" && (!supabaseUrl.startsWith("https://") || !supabaseAnonKey)) {
    throw new Error("Staging and production mobile builds must include Supabase public auth config.");
  }

  return { appEnv, apiUrl, supabaseUrl, supabaseAnonKey };
};

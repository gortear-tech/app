export type WebConfig = {
  apiUrl: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  powerSyncUrl?: string;
  sentryDsn?: string;
};

const productionApiUrl = "https://fbmaniaco-api.onrender.com";

export const getWebConfig = (): WebConfig => {
  const apiUrl = import.meta.env.VITE_API_URL ?? productionApiUrl;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const powerSyncUrl = import.meta.env.VITE_POWERSYNC_URL;
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN_WEB;
  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    ...(supabaseUrl ? { supabaseUrl } : {}),
    ...(supabaseAnonKey ? { supabaseAnonKey } : {}),
    ...(powerSyncUrl ? { powerSyncUrl } : {}),
    ...(sentryDsn ? { sentryDsn } : {})
  };
};

import { createClient, type Session } from "@supabase/supabase-js";
import type { MobileAuthSessionResponse } from "@fbmaniaco/shared";
import { createAnonymousSession, refreshApiSession } from "../api/client";
import { getWebConfig } from "../config";

const STORAGE_KEY = "maniaco.web.session.v1";

export type WebSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  email?: string;
  userId?: string;
  source: "api_anonymous" | "supabase";
};

const toWebSession = (response: MobileAuthSessionResponse, source: WebSession["source"]): WebSession => ({
  accessToken: response.accessToken,
  source,
  ...(response.refreshToken ? { refreshToken: response.refreshToken } : {}),
  ...(response.expiresAt ? { expiresAt: response.expiresAt } : {}),
  ...(response.tokenType ? { tokenType: response.tokenType } : {}),
  ...(response.user?.email ? { email: response.user.email } : {}),
  ...(response.user?.id ? { userId: response.user.id } : {})
});

const fromSupabaseSession = (session: Session): WebSession => ({
  accessToken: session.access_token,
  refreshToken: session.refresh_token,
  tokenType: session.token_type,
  userId: session.user.id,
  source: "supabase",
  ...(session.expires_at ? { expiresAt: session.expires_at } : {}),
  ...(session.user.email ? { email: session.user.email } : {})
});

export const getSupabaseClient = () => {
  const config = getWebConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

export const saveWebSession = (session: WebSession) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

export const readWebSession = (): WebSession | null => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WebSession;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const clearWebSession = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const needsRefresh = (session: WebSession) => {
  if (!session.expiresAt) return false;
  const now = Math.floor(Date.now() / 1000);
  return session.expiresAt - now <= 90;
};

export const ensureFreshWebSession = async (session: WebSession): Promise<WebSession> => {
  if (!needsRefresh(session) || !session.refreshToken) return session;
  const refreshed = await refreshApiSession(session.refreshToken);
  const next = toWebSession(refreshed, session.source);
  saveWebSession(next);
  return next;
};

export const startAnonymousWebSession = async () => {
  const session = toWebSession(await createAnonymousSession(), "api_anonymous");
  saveWebSession(session);
  return session;
};

export const signInWithPassword = async (email: string, password: string) => {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase web no esta configurado.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "No pudimos iniciar sesion.");
  const session = fromSupabaseSession(data.session);
  saveWebSession(session);
  return session;
};

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const envDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(envDir, '../.env') });
config();

export type ServerEnv = {
  appBaseUrl: string;
  mobileDeepLinkBaseUrl: string;
  nodeEnv: string;
  port: number;
  supabaseUrl?: string;
  supabaseServiceRole?: string;
  databaseUrl?: string;
  metaAppId?: string;
  metaAppSecret?: string;
  metaClientToken?: string;
  metaLoginConfigId?: string;
  metaOAuthRedirectUri: string;
  metaGraphVersion: string;
  openAiApiKey?: string;
};

export function readEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? 4000);

  return {
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:8081',
    mobileDeepLinkBaseUrl: process.env.MOBILE_DEEP_LINK_BASE_URL ?? 'cadencia:///',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
    supabaseUrl: emptyToUndefined(process.env.SUPABASE_URL),
    supabaseServiceRole: emptyToUndefined(process.env.SUPABASE_SERVICE_ROLE),
    databaseUrl: emptyToUndefined(process.env.DATABASE_URL),
    metaAppId: emptyToUndefined(process.env.META_APP_ID),
    metaAppSecret: emptyToUndefined(process.env.META_APP_SECRET),
    metaClientToken: emptyToUndefined(process.env.META_CLIENT_TOKEN),
    metaLoginConfigId: emptyToUndefined(process.env.META_LOGIN_CONFIG_ID),
    metaOAuthRedirectUri:
      process.env.META_OAUTH_REDIRECT_URI ?? `http://localhost:${port}/auth/meta/callback`,
    metaGraphVersion: process.env.META_GRAPH_VERSION ?? 'v24.0',
    openAiApiKey: emptyToUndefined(process.env.OPENAI_API_KEY),
  };
}

export function secretStatus(env: ServerEnv): Record<string, boolean> {
  return {
    supabaseUrl: Boolean(env.supabaseUrl),
    supabaseServiceRole: Boolean(env.supabaseServiceRole),
    databaseUrl: Boolean(env.databaseUrl),
    metaAppId: Boolean(env.metaAppId),
    metaAppSecret: Boolean(env.metaAppSecret),
    metaClientToken: Boolean(env.metaClientToken),
    metaLoginConfigId: Boolean(env.metaLoginConfigId),
    metaOAuthRedirectUri: Boolean(env.metaOAuthRedirectUri),
    metaGraphVersion: Boolean(env.metaGraphVersion),
    mobileDeepLinkBaseUrl: Boolean(env.mobileDeepLinkBaseUrl),
    openAiApiKey: Boolean(env.openAiApiKey),
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

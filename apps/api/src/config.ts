import { AppError } from "@fbmaniaco/shared";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AppEnvironment = "development" | "staging" | "production";

export type ApiConfig = {
  appEnv: AppEnvironment;
  release: string;
  dataStoreMode: "local" | "supabase";
  allowLocalDataStore: boolean;
  host: string;
  port: number;
  corsOrigin: string;
  localAuthEnabled: boolean;
  localDbPath: string;
  supabaseUrl: string | undefined;
  supabaseServiceRole: string | undefined;
  supabaseMediaBucket: string;
  databaseUrl: string | undefined;
  publicApiUrl: string | undefined;
  metaAppId: string | undefined;
  metaAppSecret: string | undefined;
  metaRedirectUri: string | undefined;
  metaGraphApiVersion: string;
  metaRequiredScopes: string[];
  metaTestUserAccessToken: string | undefined;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiVisionModel: string;
  openaiVisionTimeoutMs: number;
  workerHeartbeatMaxAgeMs: number;
  requireWorkerHeartbeat: boolean;
  billingWebhookSecret: string | undefined;
  featureFlags: {
    metaPublishing: boolean;
    openaiVision: boolean;
    openaiImageGeneration: boolean;
    remoteSchedule: boolean;
    autonomy: boolean;
  };
};

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return ["1", "true", "yes"].includes(value.toLowerCase());
};

const loadLocalEnvFiles = () => {
  const roots = Array.from(new Set([process.cwd(), resolve(process.cwd(), ".."), resolve(process.cwd(), "..", "..")]));
  const files = roots.flatMap((root) => [join(root, ".env.local"), join(root, ".env")]);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
};

const findWorkspaceRoot = () => {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
};

const defaultLocalDbPath = () => resolve(findWorkspaceRoot(), "apps", "api", "data", "local-db.json");

export const loadConfig = (): ApiConfig => {
  loadLocalEnvFiles();
  const appEnv = (process.env.APP_ENV ?? "development") as AppEnvironment;
  const port = Number(process.env.PORT ?? "4000");
  const localAuthEnabled = toBool(process.env.LOCAL_AUTH_ENABLED, appEnv === "development");
  const dataStoreMode = (process.env.DATA_STORE_MODE ?? (appEnv === "development" ? "local" : "supabase")) as
    | "local"
    | "supabase";
  const allowLocalDataStore = toBool(process.env.ALLOW_LOCAL_DATASTORE, appEnv === "development");
  const databaseUrl = process.env.DATABASE_URL || undefined;
  const supabaseUrl = process.env.SUPABASE_URL || undefined;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE || undefined;
  const publicApiUrl = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || undefined;
  const metaAppId = process.env.META_APP_ID || undefined;
  const metaAppSecret = process.env.META_APP_SECRET || undefined;
  const metaRedirectUri = process.env.META_REDIRECT_URI || undefined;
  const openaiApiKey = process.env.OPENAI_API_KEY || undefined;
  const productionTestTokens = [
    "META_TEST_USER_ACCESS_TOKEN",
    "META_BOOTSTRAP_TOKEN",
    "META_USER_ACCESS_TOKEN",
    "META_ACCESS_TOKEN"
  ].filter((key) => Boolean(process.env[key]));

  if (appEnv === "production" && localAuthEnabled) {
    throw new AppError({
      code: "invalid_config",
      statusCode: 500,
      message: "LOCAL_AUTH_ENABLED cannot be true in production",
      userMessage: "La configuracion del servidor no esta lista.",
      retryable: false,
      action: "contact_support"
    });
  }
  if (appEnv === "production") {
    const missing = [
      dataStoreMode !== "supabase" ? "DATA_STORE_MODE=supabase" : null,
      allowLocalDataStore ? "ALLOW_LOCAL_DATASTORE=false" : null,
      databaseUrl ? null : "DATABASE_URL",
      supabaseUrl ? null : "SUPABASE_URL",
      supabaseServiceRole ? null : "SUPABASE_SERVICE_ROLE",
      publicApiUrl?.startsWith("https://") ? null : "PUBLIC_API_URL=https://...",
      metaAppId ? null : "META_APP_ID",
      metaAppSecret ? null : "META_APP_SECRET",
      metaRedirectUri ? null : "META_REDIRECT_URI",
      openaiApiKey ? null : "OPENAI_API_KEY",
      productionTestTokens.length === 0 ? null : `remove:${productionTestTokens.join(",")}`
    ].filter((item): item is string => Boolean(item));

    if (missing.length > 0) {
      throw new AppError({
        code: "invalid_config",
        statusCode: 500,
        message: `Production config is incomplete: ${missing.join(", ")}`,
        userMessage: "El servidor no esta listo para operar con servicios reales.",
        retryable: false,
        action: "contact_support",
        details: { missing }
      });
    }
  }

  return {
    appEnv,
    release: process.env.APP_RELEASE ?? process.env.RENDER_GIT_COMMIT ?? "local-dev",
    dataStoreMode,
    allowLocalDataStore,
    host: process.env.HOST ?? "0.0.0.0",
    port,
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    localAuthEnabled,
    localDbPath: process.env.LOCAL_DB_PATH ?? defaultLocalDbPath(),
    supabaseUrl,
    supabaseServiceRole,
    supabaseMediaBucket: process.env.SUPABASE_MEDIA_BUCKET ?? "business-media",
    databaseUrl,
    publicApiUrl,
    metaAppId,
    metaAppSecret,
    metaRedirectUri,
    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0",
    metaRequiredScopes: (process.env.META_REQUIRED_SCOPES ?? "pages_show_list,pages_read_engagement,pages_manage_posts")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    metaTestUserAccessToken:
      process.env.META_TEST_USER_ACCESS_TOKEN ||
      process.env.META_BOOTSTRAP_TOKEN ||
      process.env.META_USER_ACCESS_TOKEN ||
      process.env.META_ACCESS_TOKEN ||
      undefined,
    openaiApiKey,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
    openaiVisionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-5.5",
    openaiVisionTimeoutMs: Number(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? process.env.OPENAI_VISION_TIMEOUT_MS ?? "30000"),
    workerHeartbeatMaxAgeMs: Number(process.env.WORKER_HEARTBEAT_MAX_AGE_MS ?? "120000"),
    requireWorkerHeartbeat: toBool(process.env.REQUIRE_WORKER_HEARTBEAT, appEnv !== "development"),
    billingWebhookSecret: process.env.BILLING_WEBHOOK_SECRET || undefined,
    featureFlags: {
      metaPublishing: toBool(process.env.FEATURE_META_PUBLISHING, true),
      openaiVision: toBool(process.env.FEATURE_OPENAI_VISION, true),
      openaiImageGeneration: toBool(process.env.FEATURE_OPENAI_IMAGE_GENERATION, true),
      remoteSchedule: toBool(process.env.FEATURE_REMOTE_SCHEDULE, false),
      autonomy: toBool(process.env.FEATURE_AUTONOMY, false)
    }
  };
};

export const readinessFromConfig = (config: ApiConfig) => {
  const hasSupabasePair = Boolean(config.supabaseUrl && config.supabaseServiceRole);
  const canUseLocal = config.dataStoreMode === "local" && config.allowLocalDataStore && config.localAuthEnabled;
  const canUseSupabase = config.dataStoreMode === "supabase" && Boolean(config.databaseUrl && hasSupabasePair);
  return {
    config: canUseLocal || canUseSupabase,
    db: config.dataStoreMode === "supabase" ? Boolean(config.databaseUrl) : canUseLocal,
    queue: config.dataStoreMode === "supabase" ? Boolean(config.databaseUrl) : canUseLocal
  };
};

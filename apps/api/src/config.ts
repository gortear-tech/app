import "./env";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const readNumber = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readList = (name: string, fallback: string[]): string[] => {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const findWorkspaceRoot = (startDir: string): string => {
  let currentDir = startDir;

  while (true) {
    if (existsSync(resolve(currentDir, "pnpm-workspace.yaml")) || existsSync(resolve(currentDir, ".git"))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
};

const resolveWorkspacePath = (value: string): string => {
  if (isAbsolute(value)) {
    return value;
  }

  return resolve(findWorkspaceRoot(process.cwd()), value);
};

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: readNumber("PORT", 4101),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  openaiVisionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
  visionAnalysisTimeoutMs: readNumber("VISION_ANALYSIS_TIMEOUT_MS", 30000),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRole: process.env.SUPABASE_SERVICE_ROLE ?? "",
  supabaseStateBucket: process.env.SUPABASE_STATE_BUCKET ?? "fbmaniaco-runtime",
  supabaseStateObject: process.env.SUPABASE_STATE_OBJECT ?? "runtime-state.json",
  supabaseMediaBucket: process.env.SUPABASE_MEDIA_BUCKET ?? "fbmaniaco-media",
  metaAppId: process.env.META_APP_ID ?? "",
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  metaBootstrapToken: process.env.META_BOOTSTRAP_TOKEN ?? process.env.META_USER_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? "",
  metaRedirectUri: process.env.META_REDIRECT_URI ?? "",
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0",
  metaDeviceLoginScopes: readList("META_DEVICE_LOGIN_SCOPES", ["pages_show_list", "pages_read_engagement", "pages_manage_posts"]),
  maxUploadBodyMb: readNumber("MAX_UPLOAD_BODY_MB", 75),
  imageVariantBatchSize: Math.max(1, Math.min(2, readNumber("OPENAI_IMAGE_VARIANT_BATCH_SIZE", 2))),
  stateFilePath: resolveWorkspacePath(process.env.STATE_FILE_PATH ?? "apps/api/data/fbmaniaco-state.json"),
};

export type AppConfig = typeof config;

export const getBootValidationError = (): string | null => {
  return null;
};

import "./env";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const readNumber = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

const redisUrl = process.env.REDIS_URL ?? "";

export const workerConfig = {
  redisUrl,
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRole: process.env.SUPABASE_SERVICE_ROLE ?? "",
  mode: process.env.WORKER_MODE ?? (redisUrl ? "bullmq" : "poll"),
  publishBatchSize: readNumber("PUBLISH_BATCH_SIZE", 20),
  abandonedBatchSize: readNumber("ABANDONED_BATCH_SIZE", 50),
  stateFilePath: resolveWorkspacePath(process.env.STATE_FILE_PATH ?? "apps/api/data/fbmaniaco-state.json"),
};

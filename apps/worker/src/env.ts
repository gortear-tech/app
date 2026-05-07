import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const parseEnvFile = (contents: string): Record<string, string> => {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const line = trimmedLine.startsWith("export ") ? trimmedLine.slice(7).trim() : trimmedLine;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s+#/);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    parsed[key] = value;
  }

  return parsed;
};

const loadEnvFile = (filePath: string): boolean => {
  if (!existsSync(filePath)) {
    return false;
  }

  const parsed = parseEnvFile(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
  return true;
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

const loadWorkspaceEnv = (): void => {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  let currentDir = process.cwd();
  const visited = new Set<string>();

  while (true) {
    const candidate = resolve(currentDir, ".env");
    if (loadEnvFile(candidate)) {
      return;
    }

    if (currentDir === workspaceRoot) {
      return;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir || visited.has(parentDir)) {
      return;
    }

    visited.add(currentDir);
    currentDir = parentDir;
  }
};

loadWorkspaceEnv();

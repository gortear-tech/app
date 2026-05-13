import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const fallback = ".tools/pnpm/bin/pnpm.cjs";
const pnpmPath = process.env.npm_execpath && existsSync(process.env.npm_execpath) ? process.env.npm_execpath : fallback;

const result = spawnSync(process.execPath, [pnpmPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false
});

process.exit(result.status ?? 1);

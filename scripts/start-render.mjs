import { spawn } from "node:child_process";

const processes = [
  ["api", ["pnpm", "--filter", "@fbmaniaco/api", "start"]],
  ["worker", ["pnpm", "--filter", "@fbmaniaco/worker", "start"]]
];

const children = new Map();
let shuttingDown = false;

const stopAll = (signal = "SIGTERM") => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }
};

for (const [name, command] of processes) {
  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });

  children.set(name, child);

  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    console.error(`${name} exited`, { code, signal });
    stopAll();
    process.exit(code ?? 1);
  });
}

process.on("SIGTERM", () => stopAll("SIGTERM"));
process.on("SIGINT", () => stopAll("SIGINT"));

import { randomUUID } from "node:crypto";
import { loadConfig } from "@fbmaniaco/api/dist/config.js";
import { createDataStore } from "@fbmaniaco/api/dist/db/index.js";
import { captureException, initSentry } from "@fbmaniaco/api/dist/sentry.js";
import { processOneJob } from "./processor.js";

const config = loadConfig();
initSentry({ dsn: process.env.SENTRY_DSN, environment: config.appEnv, release: config.release, service: "worker" });
const store = createDataStore(config);
const workerId = `worker-${randomUUID()}`;
const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "5000");
let stopRequested = false;
let sleepTimer: NodeJS.Timeout | null = null;

console.log(JSON.stringify({ service: "worker", event: "started", workerId, environment: config.appEnv }));

const run = async () => {
  const result = await processOneJob({ store, workerId });
  if (result.processed) {
    console.log(
      JSON.stringify({
        service: "worker",
        event: "job_processed",
        workerId,
        jobId: result.job?.id,
        status: result.job?.status
      })
    );
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      resolve();
    }, ms);
  });

const loop = async () => {
  while (!stopRequested) {
    try {
      await run();
    } catch (error) {
      console.error(JSON.stringify({ service: "worker", event: "loop_error", message: String(error) }));
      captureException(error, { workerId, event: "loop_error" });
    }
    if (!stopRequested) await sleep(intervalMs);
  }
};

void loop().catch((error) => {
    console.error(JSON.stringify({ service: "worker", event: "loop_error", message: String(error) }));
    captureException(error, { workerId, event: "loop_crash" });
});

process.once("SIGTERM", () => {
  stopRequested = true;
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
});

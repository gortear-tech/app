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
const heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? "30000");
let stopRequested = false;
let sleepTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
type WorkerHeartbeatStatus = "starting" | "idle" | "processing" | "stopping" | "error";
let currentHeartbeatStatus: WorkerHeartbeatStatus = "starting";
let currentHeartbeatMetadata: Record<string, unknown> = {};

console.log(JSON.stringify({ service: "worker", event: "started", workerId, environment: config.appEnv }));

const heartbeat = async (status: WorkerHeartbeatStatus, metadata: Record<string, unknown> = {}) => {
  try {
    await store.recordWorkerHeartbeat({
      workerId,
      service: "worker",
      environment: config.appEnv,
      release: config.release,
      status,
      metadata
    });
  } catch (error) {
    console.error(JSON.stringify({ service: "worker", event: "heartbeat_error", message: String(error) }));
    captureException(error, { workerId, event: "heartbeat_error" });
  }
};

const setHeartbeat = async (status: WorkerHeartbeatStatus, metadata: Record<string, unknown> = {}) => {
  currentHeartbeatStatus = status;
  currentHeartbeatMetadata = metadata;
  await heartbeat(status, metadata);
};

const startHeartbeatTimer = () => {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    void heartbeat(currentHeartbeatStatus, currentHeartbeatMetadata);
  }, heartbeatIntervalMs);
};

const run = async () => {
  await setHeartbeat("processing");
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
  await setHeartbeat("idle", { lastProcessedJobId: result.job?.id ?? null, processed: result.processed });
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      resolve();
    }, ms);
  });

const loop = async () => {
  startHeartbeatTimer();
  await setHeartbeat("starting");
  while (!stopRequested) {
    try {
      await run();
    } catch (error) {
      console.error(JSON.stringify({ service: "worker", event: "loop_error", message: String(error) }));
      captureException(error, { workerId, event: "loop_error" });
      await setHeartbeat("error", { message: String(error) });
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
  currentHeartbeatStatus = "stopping";
  currentHeartbeatMetadata = {};
  void heartbeat("stopping");
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
});

import { randomUUID } from "node:crypto";
import { loadConfig } from "@fbmaniaco/api/dist/config.js";
import { createDataStore } from "@fbmaniaco/api/dist/db/index.js";
import { processOneJob } from "./processor.js";

const config = loadConfig();
const store = createDataStore(config);
const workerId = `worker-${randomUUID()}`;
const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? "5000");

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

await run();
setInterval(() => {
  void run().catch((error) => {
    console.error(JSON.stringify({ service: "worker", event: "loop_error", message: String(error) }));
  });
}, intervalMs);

process.once("SIGTERM", () => {
  process.exit(0);
});

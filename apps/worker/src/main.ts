import { Queue, Worker } from "bullmq";
import { SupabasePlannerMirror } from "@fbmaniaco/providers";
import { workerConfig } from "./config";
import { QUEUE_NAMES } from "./queues";
import {
  createStateStore,
  processScheduledPostById,
  type ScheduledPublishingJobData,
  type WorkerStateFile,
  type WorkerStateScheduledPost,
} from "./jobs/publishing";

const supabaseMirror = new SupabasePlannerMirror({
  supabaseUrl: workerConfig.supabaseUrl,
  serviceRole: workerConfig.supabaseServiceRole,
});

const stateStore = createStateStore(workerConfig.stateFilePath, (state) => supabaseMirror.syncState(state));
const jobName = "publish-scheduled-post";
const jobIdFor = (scheduledPostId: string) => `fbmaniaco-scheduled-post-${scheduledPostId}`;
const inProcessRecoveryMs = 20 * 60 * 1000;

const readActiveScheduledPosts = (state: WorkerStateFile): WorkerStateScheduledPost[] =>
  (state.scheduledPosts ?? []).filter((post) => post.status === "programada");

const recoverStaleInProcessPosts = (state: WorkerStateFile): boolean => {
  let changed = false;
  const now = Date.now();
  for (const post of state.scheduledPosts ?? []) {
    if (post.status !== "publicacion_en_proceso" || !post.updatedAt) {
      continue;
    }
    const updatedAt = Date.parse(post.updatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt < inProcessRecoveryMs) {
      continue;
    }
    post.status = "programada";
    post.retryCount += 1;
    post.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) {
    stateStore.write(state);
  }
  return changed;
};

const syncBullMqQueue = async (queue: Queue<ScheduledPublishingJobData>): Promise<number> => {
  const state = stateStore.read();
  recoverStaleInProcessPosts(state);
  const activePosts = readActiveScheduledPosts(state);
  const activeIds = new Set(activePosts.map((post) => post.id));
  let reconciled = 0;

  for (const post of activePosts) {
    const jobId = jobIdFor(post.id);
    const payload: ScheduledPublishingJobData = {
      scheduledPostId: post.id,
      negocioId: post.businessId,
      batchId: post.batchId,
      trigger: "schedule",
      requestedAt: new Date().toISOString(),
      scheduledFor: post.scheduledFor,
    };
    const existing = await queue.getJob(jobId);
    const desiredDelay = Math.max(0, Date.parse(post.scheduledFor) - Date.now());

    if (existing) {
      const existingData = existing.data as Partial<ScheduledPublishingJobData>;
      const needsReplace =
        existingData.scheduledFor !== payload.scheduledFor ||
        existingData.batchId !== payload.batchId ||
        existingData.negocioId !== payload.negocioId ||
        existingData.trigger !== payload.trigger;
      if (!needsReplace) {
        continue;
      }

      try {
        await existing.remove();
      } catch (error) {
        console.warn(`[worker] unable to replace job ${jobId}`, error);
        continue;
      }
    }

    await queue.add(jobName, payload, {
      delay: desiredDelay,
      jobId,
      removeOnComplete: true,
      removeOnFail: true,
    });
    reconciled += 1;
  }

  const jobs = await queue.getJobs(["delayed", "wait", "paused", "active"]);
  for (const job of jobs) {
    const data = job.data as Partial<ScheduledPublishingJobData>;
    if (!data.scheduledPostId || activeIds.has(data.scheduledPostId)) {
      continue;
    }
    try {
      await job.remove();
    } catch (error) {
      console.warn(`[worker] unable to remove stale job ${job.id}`, error);
    }
  }

  return reconciled;
};

const runPollLoop = async (): Promise<void> => {
  const tick = async () => {
    try {
      const state = stateStore.read();
      recoverStaleInProcessPosts(state);
      const duePosts = readActiveScheduledPosts(state).filter((post) => Date.parse(post.scheduledFor) <= Date.now());
      const limit = Math.max(1, workerConfig.publishBatchSize);
      let processed = 0;

      for (const post of duePosts) {
        if (processed >= limit) {
          break;
        }
        processed += 1;
        await processScheduledPostById(stateStore, post.id, post.scheduledFor, new Date().toISOString());
      }

      if (processed > 0) {
        console.log(`[worker] processed ${processed} scheduled post(s) in poll mode`);
      }
    } catch (error) {
      console.error("[worker] publication tick failed", error);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, 30_000);

  console.log("[worker] polling", workerConfig.stateFilePath);
};

const runBullMqLoop = async (): Promise<void> => {
  const connection = { url: workerConfig.redisUrl };
  const queue = new Queue<ScheduledPublishingJobData>(QUEUE_NAMES.publishing, {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  const worker = new Worker<ScheduledPublishingJobData>(
    QUEUE_NAMES.publishing,
    async (job) => {
      const result = await processScheduledPostById(stateStore, job.data.scheduledPostId, job.data.scheduledFor, job.data.requestedAt);
      return result;
    },
    {
      connection,
      concurrency: 2,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  );

  worker.on("completed", (job, result) => {
    if (result && typeof result === "object" && "skipped" in result) {
      console.log(`[worker] skipped ${job.data.scheduledPostId}`);
      return;
    }
    console.log(`[worker] published ${job.data.scheduledPostId}`);
  });

  worker.on("failed", (job, error) => {
    if (!job) {
      console.error("[worker] publishing job failed without job context", error);
      return;
    }
    console.error(`[worker] publish failed for ${job.data.scheduledPostId}`, error);
  });

  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  console.log("[worker] bullmq queue ready", workerConfig.redisUrl);

  const reconcile = async () => {
    try {
      const reconciled = await syncBullMqQueue(queue);
      if (reconciled > 0) {
        console.log(`[worker] enqueued ${reconciled} scheduled post job(s)`);
      }
    } catch (error) {
      console.error("[worker] queue reconciliation failed", error);
    }
  };

  await reconcile();
  const timer = setInterval(() => {
    void reconcile();
  }, 15_000);

  const shutdown = async () => {
    clearInterval(timer);
    await worker.close();
    await queue.close();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
};

const main = async () => {
  void supabaseMirror.syncState(stateStore.read()).catch((error) => {
    console.warn("[worker] failed to sync Supabase planner mirror on startup", error);
  });

  if (workerConfig.mode === "idle") {
    console.log("[worker] idle mode. Nothing scheduled.");
    return;
  }

  if (workerConfig.redisUrl && workerConfig.mode !== "poll") {
    try {
      await runBullMqLoop();
      return;
    } catch (error) {
      console.error("[worker] bullmq mode failed, falling back to polling", error);
    }
  }

  await runPollLoop();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

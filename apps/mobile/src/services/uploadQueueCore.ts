export type OfflineUploadStatus = "waiting" | "uploading" | "done" | "failed";

export type OfflineUploadFile = {
  uri: string;
  name: string;
  contentType: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export type OfflineUploadJob = OfflineUploadFile & {
  id: string;
  workspaceId: string;
  businessId: string;
  sha256?: string;
  status: OfflineUploadStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type UploadQueueStorage = {
  list: () => Promise<OfflineUploadJob[]>;
  save: (jobs: OfflineUploadJob[]) => Promise<void>;
};

export type UploadQueueNetwork = {
  isOnline: () => Promise<boolean>;
  hash: (file: OfflineUploadFile) => Promise<string>;
  upload: (file: OfflineUploadFile, sha256: string) => Promise<void>;
};

export type UploadQueue = ReturnType<typeof createUploadQueue>;

const now = () => new Date().toISOString();

export const createUploadQueue = (storage: UploadQueueStorage, network: UploadQueueNetwork, maxAttempts = 5) => ({
  enqueue: async (input: { workspaceId: string; businessId: string; files: OfflineUploadFile[] }) => {
    const current = await storage.list();
    const timestamp = now();
    const jobs = input.files.map((file, index): OfflineUploadJob => ({
      ...file,
      id: `${timestamp}-${index}-${Math.random().toString(16).slice(2)}`,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      status: "waiting",
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    await storage.save([...current, ...jobs]);
    return jobs;
  },

  drain: async () => {
    const online = await network.isOnline();
    let jobs = await storage.list();
    if (!online) return { processed: 0, failed: 0, remaining: jobs.filter((job) => job.status !== "done").length };

    let processed = 0;
    let failed = 0;
    for (const job of jobs.filter((item) => item.status !== "done")) {
      const started = now();
      job.status = "uploading";
      job.attempts += 1;
      job.updatedAt = started;
      await storage.save(jobs);
      try {
        const sha256 = job.sha256 ?? (await network.hash(job));
        await network.upload(job, sha256);
        job.sha256 = sha256;
        job.status = "done";
        delete job.lastError;
        processed += 1;
      } catch (error) {
        job.status = job.attempts >= maxAttempts ? "failed" : "waiting";
        job.lastError = error instanceof Error ? error.message : "upload_failed";
        if (job.status === "failed") failed += 1;
      } finally {
        job.updatedAt = now();
        await storage.save(jobs);
      }
    }

    jobs = await storage.list();
    const active = jobs.filter((job) => job.status !== "done");
    await storage.save(active);
    return {
      processed,
      failed,
      remaining: active.length
    };
  }
});

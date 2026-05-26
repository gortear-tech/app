import { describe, expect, it } from "vitest";
import { createUploadQueue, OfflineUploadJob, UploadQueueStorage } from "./uploadQueueCore";

const memoryStorage = (): UploadQueueStorage & { snapshot: () => OfflineUploadJob[] } => {
  let jobs: OfflineUploadJob[] = [];
  return {
    list: async () => jobs.map((job) => ({ ...job })),
    save: async (next) => {
      jobs = next.map((job) => ({ ...job }));
    },
    snapshot: () => jobs
  };
};

describe("gallery upload queue", () => {
  it("keeps uploads waiting offline and drains them FIFO when online", async () => {
    const storage = memoryStorage();
    let online = false;
    const uploaded: string[] = [];
    const queue = createUploadQueue(storage, {
      isOnline: async () => online,
      hash: async (file) => `hash-${file.name}`,
      upload: async (file) => {
        uploaded.push(file.name);
      }
    });

    await queue.enqueue({
      workspaceId: "workspace-1",
      businessId: "business-1",
      files: [
        { uri: "file://a.jpg", name: "a.jpg", contentType: "image/jpeg" },
        { uri: "file://b.jpg", name: "b.jpg", contentType: "image/jpeg" }
      ]
    });

    expect(await queue.drain()).toMatchObject({ processed: 0, remaining: 2 });
    expect(storage.snapshot().map((job) => job.status)).toEqual(["waiting", "waiting"]);

    online = true;
    expect(await queue.drain()).toMatchObject({ processed: 2, remaining: 0 });
    expect(uploaded).toEqual(["a.jpg", "b.jpg"]);
    expect(storage.snapshot()).toHaveLength(0);
  });

  it("retries transient failures before marking failed", async () => {
    const storage = memoryStorage();
    let attempts = 0;
    const queue = createUploadQueue(storage, {
      isOnline: async () => true,
      hash: async () => "hash",
      upload: async () => {
        attempts += 1;
        throw new Error("temporarily_down");
      }
    }, 2);

    await queue.enqueue({
      workspaceId: "workspace-1",
      businessId: "business-1",
      files: [{ uri: "file://a.jpg", name: "a.jpg", contentType: "image/jpeg" }]
    });

    expect(await queue.drain()).toMatchObject({ failed: 0, remaining: 1 });
    expect(await queue.drain()).toMatchObject({ failed: 1, remaining: 1 });
    expect(attempts).toBe(2);
    expect(storage.snapshot()[0]?.status).toBe("failed");
  });
});

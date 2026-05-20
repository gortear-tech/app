import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { LocalDataStore } from "@fbmaniaco/api/dist/db/local-store.js";
import { ImageEditProvider } from "@fbmaniaco/providers";
import { processOneJob } from "./processor.js";

const path = join(tmpdir(), `fbmaniaco-worker-${Date.now()}.json`);
const store = new LocalDataStore(path);
const previousPublicApiUrl = process.env.PUBLIC_API_URL;
process.env.PUBLIC_API_URL = "https://api.example.test";
const imageEditProvider: ImageEditProvider = {
  mode: "mock",
  edit: async (input) => ({
    imageBytes: Buffer.from(`dummy-edited-image:${input.prompt}:${input.operationKey}`),
    mimeType: "image/jpeg",
    responseId: null,
    model: "mock-image-edit",
    usage: null,
    latencyMs: 1
  })
};
await store.upsertLocalUser({ userId: "worker-smoke", email: "worker@example.com" });
const { workspace } = await store.ensureDefaultWorkspace("worker-smoke");

await store.upsertMockMetaAuthorization({ workspaceId: workspace.id, actorId: "worker-smoke" });
const page = (await store.listMetaPages(workspace.id)).find((item) => item.canPublish);
if (!page) throw new Error("worker smoke missing selectable page");
const business = await store.selectMetaPage({
  workspaceId: workspace.id,
  actorId: "worker-smoke",
  pageId: page.id,
  requestId: "worker-smoke"
});
const batch = await store.createBatch({
  workspaceId: workspace.id,
  businessId: business.id,
  actorId: "worker-smoke",
  requestId: "worker-smoke"
});
const intent = await store.createUploadIntent({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  originalFileName: "smoke.jpg",
  contentType: "image/jpeg",
  fileSize: 1024
});
const upload = await store.completeUpload({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  storageKey: intent.storageKey,
  originalFileName: "smoke.jpg",
  contentType: "image/jpeg",
  fileSize: 1024,
  actorId: "worker-smoke",
  requestId: "worker-smoke"
});
const detail = await store.getBatchDetail({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
if (upload.job !== null || detail?.photos[0]?.status !== "validada") {
  throw new Error(`worker upload smoke failed: ${JSON.stringify({ upload, detail })}`);
}

await store.requestGenerateBatch({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  variantsPerPhoto: 1,
  actorId: "worker-smoke",
  requestId: "worker-smoke-generate"
});
await processOneJob({ store, workerId: "worker-smoke" });
const variantResult = await processOneJob({ store, workerId: "worker-smoke", imageEditProvider });
const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
if (!variantResult.processed || variants[0]?.status !== "generada" || !variants[0].caption) {
  throw new Error(`worker variant smoke failed: ${JSON.stringify({ variantResult, variants })}`);
}
if (!variants[0].generatedAssetId || variants[0].generatedAssetId === detail?.photos[0]?.originalAssetId) {
  throw new Error(`worker variant reused original asset: ${JSON.stringify({ variant: variants[0], photo: detail?.photos[0] })}`);
}
await store.approveVariant({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  variantId: variants[0].id,
  actorId: "worker-smoke",
  requestId: "worker-smoke-approve"
});
const calendar = await store.confirmCalendar({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  periodDays: 7,
  actorId: "worker-smoke",
  requestId: "worker-smoke-calendar"
});
await processOneJob({ store, workerId: "worker-smoke" });
await store.publishScheduledPostNow({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  scheduledPostId: calendar.scheduledPosts[0]!.id,
  actorId: "worker-smoke",
  requestId: "worker-smoke-publish"
});
const publishResult = await processOneJob({ store, workerId: "worker-smoke" });
const published = await store.getScheduledPost({
  workspaceId: workspace.id,
  businessId: business.id,
  scheduledPostId: calendar.scheduledPosts[0]!.id
});
if (!publishResult.processed || published?.status !== "publicada" || !published.facebookPostId) {
  throw new Error(`worker publish smoke failed: ${JSON.stringify({ publishResult, published })}`);
}

console.log("worker smoke ok");
if (previousPublicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
else process.env.PUBLIC_API_URL = previousPublicApiUrl;
await rm(path, { force: true });

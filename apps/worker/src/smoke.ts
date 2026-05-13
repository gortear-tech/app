import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { LocalDataStore } from "@fbmaniaco/api/dist/db/local-store.js";
import { processOneJob } from "./processor.js";

const path = join(tmpdir(), `fbmaniaco-worker-${Date.now()}.json`);
const store = new LocalDataStore(path);
await store.upsertLocalUser({ userId: "worker-smoke", email: "worker@example.com" });
const { workspace } = await store.ensureDefaultWorkspace("worker-smoke");
await store.recordWorkerHeartbeat({
  workerId: "worker-smoke",
  environment: "development",
  release: "smoke",
  metadata: { smoke: true }
});
const heartbeat = await store.getLatestWorkerHeartbeat();
if (!heartbeat || heartbeat.workerId !== "worker-smoke") {
  throw new Error(`worker heartbeat smoke failed: ${JSON.stringify(heartbeat)}`);
}
const job = await store.createJob({
  type: "mock_job",
  workspaceId: workspace.id,
  dedupeKey: "worker-smoke",
  payload: { smoke: true }
});

const result = await processOneJob({ store, workerId: "worker-smoke" });
if (!result.processed || result.job?.id !== job.id || result.job.status !== "succeeded") {
  throw new Error(`worker smoke failed: ${JSON.stringify(result)}`);
}

const attempts = await store.listAttempts(job.id);
if (attempts.length !== 1 || attempts[0]?.status !== "succeeded") {
  throw new Error(`worker attempt ledger failed: ${JSON.stringify(attempts)}`);
}

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
const photoResult = await processOneJob({ store, workerId: "worker-smoke" });
const detail = await store.getBatchDetail({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
if (!photoResult.processed || photoResult.job?.id !== upload.job.id || detail?.photos[0]?.status !== "validada") {
  throw new Error(`worker analyze smoke failed: ${JSON.stringify({ photoResult, detail })}`);
}

const estimate = await store.estimateBatchCost({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  variantsPerPhoto: 1
});
await store.confirmBatchCost({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  variantsPerPhoto: 1,
  priceVersion: estimate.priceVersion,
  actorId: "worker-smoke",
  requestId: "worker-smoke-confirm"
});
await store.requestGenerateBatch({
  workspaceId: workspace.id,
  businessId: business.id,
  batchId: batch.id,
  variantsPerPhoto: 1,
  actorId: "worker-smoke",
  requestId: "worker-smoke-generate"
});
await processOneJob({ store, workerId: "worker-smoke" });
const variantResult = await processOneJob({ store, workerId: "worker-smoke" });
const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
if (!variantResult.processed || variants[0]?.status !== "generada" || !variants[0].caption) {
  throw new Error(`worker variant smoke failed: ${JSON.stringify({ variantResult, variants })}`);
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

const metricsRequest = await store.requestCollectMetrics({
  workspaceId: workspace.id,
  businessId: business.id,
  window: "7d",
  actorId: "worker-smoke",
  requestId: "worker-smoke-metrics"
});
const metricsResult = await processOneJob({ store, workerId: "worker-smoke" });
if (!metricsResult.processed || metricsResult.job?.id !== metricsRequest.job.id || metricsResult.job.status !== "succeeded") {
  throw new Error(`worker metrics smoke failed: ${JSON.stringify(metricsResult)}`);
}
const summaries = await store.listPerformanceSummaries({ workspaceId: workspace.id, businessId: business.id });
if (!summaries.length || summaries[0]?.confidence !== "exploratoria") {
  throw new Error(`worker performance smoke failed: ${JSON.stringify(summaries)}`);
}

const reportRequest = await store.requestWeeklyReport({
  workspaceId: workspace.id,
  businessId: business.id,
  actorId: "worker-smoke",
  requestId: "worker-smoke-report"
});
const reportResult = await processOneJob({ store, workerId: "worker-smoke" });
const report = await store.getLatestWeeklyReport({ workspaceId: workspace.id, businessId: business.id });
if (!reportResult.processed || reportResult.job?.id !== reportRequest.job.id || report?.confidence !== "exploratoria") {
  throw new Error(`worker weekly report smoke failed: ${JSON.stringify({ reportResult, report })}`);
}

const evalRequest = await store.requestBatchCaptionEval({
  workspaceId: workspace.id,
  businessId: business.id,
  actorId: "worker-smoke",
  requestId: "worker-smoke-eval",
  candidateCaptionEditRate: 0.18
});
const evalResult = await processOneJob({ store, workerId: "worker-smoke" });
const evaluations = await store.listAiEvaluations({ workspaceId: workspace.id, businessId: business.id });
if (!evalResult.processed || evalResult.job?.id !== evalRequest.job.id || evaluations[0]?.rolloutRecommendation !== "retain_baseline") {
  throw new Error(`worker caption eval smoke failed: ${JSON.stringify({ evalResult, evaluations })}`);
}

console.log("worker smoke ok");
await rm(path, { force: true });

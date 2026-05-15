import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { LocalDataStore } from "@fbmaniaco/api/dist/db/local-store.js";
import { VisionAnalysisProvider } from "@fbmaniaco/providers";
import { processOneJob } from "./processor.js";

describe("worker processor", () => {
  it("claims, attempts and completes a mock job", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-test-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    await store.upsertLocalUser({ userId: "u1", email: "u1@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("u1");
    const job = await store.createJob({ type: "mock_job", workspaceId: workspace.id, dedupeKey: "one" });

    const result = await processOneJob({ store, workerId: "test-worker" });

    expect(result.processed).toBe(true);
    expect(result.job?.id).toBe(job.id);
    expect(result.job?.status).toBe("succeeded");
    expect(await store.listAttempts(job.id)).toHaveLength(1);
    await rm(path, { force: true });
  });

  it("validates an uploaded photo through an analyze_photo job", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-photo-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    const previousPublicApiUrl = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://api.example.test";
    const visionProvider: VisionAnalysisProvider = {
      mode: "responses",
      analyze: async (input) => ({
        analysis: {
          schemaVersion: "vision_analysis.v1",
          promptVersion: input.promptVersion,
          subject: { type: "food", description: "Plato fotografiado" },
          composition: { framing: "centered", angle: "front", background: "simple", lighting: "natural" },
          palette: { dominantColors: ["red"], temperature: "warm", saturation: "medium", contrast: "medium" },
          sensitiveElements: {
            personVisible: false,
            priceVisible: false,
            logoVisible: false,
            promotionVisible: false,
            textVisible: false,
            notes: []
          },
          quality: { sharpness: "ok", exposure: "ok", noise: "low" },
          mood: { temperature: "warm", keywords: ["antojo"], description: "Apetitoso" },
          summary: "Foto lista para revision."
        },
        responseId: "resp_test",
        model: "test-vision",
        usage: null,
        latencyMs: 1
      })
    };
    await store.upsertLocalUser({ userId: "u2", email: "u2@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("u2");
    await store.upsertMockMetaAuthorization({ workspaceId: workspace.id, actorId: "u2" });
    const page = (await store.listMetaPages(workspace.id)).find((item) => item.canPublish);
    if (!page) throw new Error("Missing selectable mock page");
    const business = await store.selectMetaPage({
      workspaceId: workspace.id,
      actorId: "u2",
      pageId: page.id,
      requestId: "test"
    });
    const batch = await store.createBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "u2",
      requestId: "test"
    });
    const intent = await store.createUploadIntent({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      originalFileName: "foto.jpg",
      contentType: "image/jpeg",
      fileSize: 2048
    });
    const completed = await store.completeUpload({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      storageKey: intent.storageKey,
      originalFileName: "foto.jpg",
      contentType: "image/jpeg",
      fileSize: 2048,
      actorId: "u2",
      requestId: "test"
    });

    const result = await processOneJob({ store, workerId: "photo-worker", visionProvider });
    const detail = await store.getBatchDetail({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });

    expect(result.processed).toBe(true);
    expect(result.job?.id).toBe(completed.job.id);
    expect(result.job?.status).toBe("succeeded");
    expect(detail?.photos[0]?.status).toBe("validada");
    expect(detail?.photos[0]?.thumbnailAssetId).toBeTruthy();
    expect(detail?.photos[0]?.visionInputAssetId).toBeTruthy();
    expect(detail?.batch.status).toBe("pendiente_confirmacion");
    const aiRuns = await store.listAiRuns({ workspaceId: workspace.id, jobId: completed.job.id });
    expect(aiRuns).toHaveLength(1);
    expect(aiRuns[0]?.promptTemplateId).toBe("photo-vision-analysis");
    expect(aiRuns[0]?.schemaVersion).toBe("vision_analysis.v1");

    const estimate = await store.estimateBatchCost({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 2
    });
    await store.confirmBatchCost({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 2,
      priceVersion: estimate.priceVersion,
      actorId: "u2",
      requestId: "test-confirm"
    });
    const generation = await store.requestGenerateBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 2,
      actorId: "u2",
      requestId: "test-generate"
    });
    expect(generation.created).toBe(2);

    const batchJob = await processOneJob({ store, workerId: "variant-worker" });
    const firstVariantJob = await processOneJob({ store, workerId: "variant-worker" });
    const secondVariantJob = await processOneJob({ store, workerId: "variant-worker" });
    const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });

    expect(batchJob.job?.type).toBe("generate_batch");
    expect(firstVariantJob.job?.type).toBe("generate_variant");
    expect(secondVariantJob.job?.type).toBe("generate_variant");
    expect(variants).toHaveLength(2);
    expect(variants.every((variant) => variant.status === "generada" && Boolean(variant.caption))).toBe(true);
    expect(variants.every((variant) => variant.caption?.includes("FBmaniaco Demo"))).toBe(true);
    expect(variants.every((variant) => !variant.caption?.includes("Pagina sin permiso completo"))).toBe(true);
    expect(new Set(variants.map((variant) => variant.styleId)).size).toBe(2);

    await store.approveVariant({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantId: variants[0]!.id,
      actorId: "u2",
      requestId: "test-approve"
    });
    const calendar = await store.confirmCalendar({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      periodDays: 7,
      actorId: "u2",
      requestId: "test-calendar"
    });
    const scheduleJob = await processOneJob({ store, workerId: "calendar-worker" });
    const publishRequest = await store.publishScheduledPostNow({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      scheduledPostId: calendar.scheduledPosts[0]!.id,
      actorId: "u2",
      requestId: "test-publish-now"
    });
    const publishResult = await processOneJob({ store, workerId: "calendar-worker" });
    const published = await store.getScheduledPost({
      workspaceId: workspace.id,
      businessId: business.id,
      scheduledPostId: publishRequest.scheduledPost.id
    });

    expect(scheduleJob.job?.type).toBe("schedule_posts");
    expect(publishResult.job?.type).toBe("publish_post");
    expect(published?.status).toBe("publicada");
    expect(published?.remoteStatus).toBe("confirmado_meta");
    expect(published?.facebookPostId).toBeTruthy();

    const metricsRequest = await store.requestCollectMetrics({
      workspaceId: workspace.id,
      businessId: business.id,
      window: "7d",
      actorId: "u2",
      requestId: "test-metrics"
    });
    const metricsResult = await processOneJob({ store, workerId: "metrics-worker" });
    expect(metricsResult.job?.id).toBe(metricsRequest.job.id);
    expect(metricsResult.job?.status).toBe("succeeded");
    expect(metricsResult.job?.result.snapshotsCount).toBe(1);
    const summaries = await store.listPerformanceSummaries({ workspaceId: workspace.id, businessId: business.id });
    expect(summaries[0]?.confidence).toBe("exploratoria");
    expect(summaries[0]?.reasonCodes).toContain("sample_size_low");

    const reportRequest = await store.requestWeeklyReport({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "u2",
      requestId: "test-report"
    });
    const reportResult = await processOneJob({ store, workerId: "report-worker" });
    const report = await store.getLatestWeeklyReport({ workspaceId: workspace.id, businessId: business.id });
    expect(reportResult.job?.id).toBe(reportRequest.job.id);
    expect(report?.confidence).toBe("exploratoria");
    expect(report?.sections.metaHealth[0]).toContain("Insights de Meta");

    const evalRequest = await store.requestBatchCaptionEval({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "u2",
      requestId: "test-eval",
      candidateCaptionEditRate: 0.18
    });
    const evalResult = await processOneJob({ store, workerId: "eval-worker" });
    const evaluations = await store.listAiEvaluations({ workspaceId: workspace.id, businessId: business.id });
    expect(evalResult.job?.id).toBe(evalRequest.job.id);
    expect(evaluations[0]?.status).toBe("failed");
    expect(evaluations[0]?.rolloutRecommendation).toBe("retain_baseline");
    if (previousPublicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousPublicApiUrl;
    await rm(path, { force: true });
  });
});

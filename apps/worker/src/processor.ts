import { createHash } from "node:crypto";
import { DataStore, StoredJob } from "@fbmaniaco/api/dist/db/index.js";
import { createVisionAnalysisProvider, VisionAnalysisProvider } from "@fbmaniaco/providers";
import { createClient } from "@supabase/supabase-js";

export type WorkerResult = {
  processed: boolean;
  job?: StoredJob;
};

const envFlag = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes"].includes(value.toLowerCase());
};

const freshSignedMediaUrl = async (input: { store: DataStore; workspaceId: string; assetId: string | null | undefined }) => {
  if (!input.assetId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) return null;
  const asset = await input.store.getMediaAsset({ assetId: input.assetId });
  if (!asset || asset.workspaceId !== input.workspaceId) return null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.storage.from(asset.bucket).createSignedUrl(asset.storageKey, 60 * 30);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create fresh signed media URL: ${error?.message ?? "unknown storage error"}`);
  }
  return data.signedUrl;
};

export const processOneJob = async (input: {
  store: DataStore;
  workerId: string;
  visionProvider?: VisionAnalysisProvider;
}): Promise<WorkerResult> => {
  const providerConfig: Parameters<typeof createVisionAnalysisProvider>[0] = {
    timeoutMs: Number(process.env.OPENAI_VISION_TIMEOUT_MS ?? "30000")
  };
  if (process.env.OPENAI_API_KEY) providerConfig.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) providerConfig.baseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_VISION_MODEL) providerConfig.visionModel = process.env.OPENAI_VISION_MODEL;
  const visionProvider = input.visionProvider ?? createVisionAnalysisProvider(providerConfig);
  const job = await input.store.claimDueJob(input.workerId);
  if (!job) return { processed: false };

  try {
    if (job.type === "analyze_photo") {
      if (!envFlag("FEATURE_OPENAI_VISION", true)) {
        throw new Error("OpenAI vision is disabled by feature flag");
      }
      if (!job.photoId) throw new Error("analyze_photo job is missing photoId");
      if (visionProvider.mode !== "responses") {
        throw new Error("OpenAI vision provider is not configured");
      }
      const operationKey = job.operationKey ?? `openai_vision:${job.id}`;
      await input.store.upsertExternalOperation({
        operationKey,
        workspaceId: job.workspaceId,
        jobId: job.id,
        provider: "openai",
        operation: "analyze_photo",
        status: "started"
      });
      const sourcePhoto = await input.store.getPhoto({ workspaceId: job.workspaceId, photoId: job.photoId });
      if (!sourcePhoto) throw new Error(`Photo not found: ${job.photoId}`);
      const imageUrl =
        (await freshSignedMediaUrl({ store: input.store, workspaceId: job.workspaceId, assetId: sourcePhoto.originalAssetId })) ??
        (typeof job.payload.imageUrl === "string" && /^https?:\/\//.test(job.payload.imageUrl) ? job.payload.imageUrl : null);
      if (!imageUrl) throw new Error("analyze_photo job is missing real imageUrl");
      const promptVersion = "vision-analysis-v1";
      const vision = await visionProvider.analyze({
        imageUrl,
        mimeType: sourcePhoto.mimeType ?? "image/jpeg",
        requestId: typeof job.payload.requestId === "string" ? job.payload.requestId : job.id,
        operationKey,
        promptVersion
      });
      const inputHash = createHash("sha256")
        .update(JSON.stringify({ photoId: sourcePhoto.id, storageKey: sourcePhoto.storageKey, promptVersion }))
        .digest("hex");
      const outputHash = createHash("sha256").update(JSON.stringify(vision.analysis)).digest("hex");
      const aiRunInput: Parameters<DataStore["recordAiRun"]>[0] = {
        workspaceId: job.workspaceId,
        jobId: job.id,
        operationKey,
        provider: "openai",
        model: vision.model,
        modelProfileId: "vision-default-v1",
        promptTemplateId: "photo-vision-analysis",
        promptVersion,
        schemaVersion: vision.analysis.schemaVersion,
        inputHash,
        outputHash,
        latencyMs: vision.latencyMs,
        status: "succeeded"
      };
      if (job.businessId !== undefined) aiRunInput.businessId = job.businessId;
      if (vision.responseId !== null) aiRunInput.responseId = vision.responseId;
      if (vision.usage !== null) aiRunInput.usage = vision.usage;
      if (typeof job.payload.requestId === "string") aiRunInput.requestId = job.payload.requestId;
      const aiRun = await input.store.recordAiRun(aiRunInput);
      const photo = await input.store.completeAnalyzePhoto({
        photoId: job.photoId,
        jobId: job.id,
        analysis: vision.analysis,
        aiRunId: aiRun.id
      });
      const completed = await input.store.completeJob({
        jobId: job.id,
        result: {
          ok: true,
          photoId: photo.id,
          status: photo.status,
          aiRunId: aiRun.id,
          processedBy: input.workerId,
          processedAt: new Date().toISOString()
        }
      });
      await input.store.upsertExternalOperation({
        operationKey,
        workspaceId: job.workspaceId,
        jobId: job.id,
        provider: "openai",
        operation: "analyze_photo",
        status: "succeeded"
      });
      return { processed: true, job: completed };
    }

    if (job.type !== "mock_job") {
      if (job.type === "generate_batch") {
        if (!job.batchId) throw new Error("generate_batch job is missing batchId");
        const completedBatch = await input.store.completeGenerateBatch({ jobId: job.id, batchId: job.batchId });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            batchId: completedBatch.batch.id,
            variantsCount: completedBatch.variants.length,
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      }

      if (job.type === "generate_variant") {
        if (!job.variantId) throw new Error("generate_variant job is missing variantId");
        const operationKey = job.operationKey ?? `source_photo_variant:${job.variantId}`;
        await input.store.upsertExternalOperation({
          operationKey,
          workspaceId: job.workspaceId,
          jobId: job.id,
          provider: "internal",
          operation: "generate_variant",
          status: "started"
        });
        const variant = await input.store.completeGenerateVariant({ jobId: job.id, variantId: job.variantId });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            variantId: variant.id,
            status: variant.status,
            generatedAssetId: variant.generatedAssetId ?? null,
            captionReady: Boolean(variant.caption),
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        await input.store.upsertExternalOperation({
          operationKey,
          workspaceId: job.workspaceId,
          jobId: job.id,
          provider: "internal",
          operation: "generate_variant",
          status: "succeeded"
        });
        return { processed: true, job: completed };
      }

      if (job.type === "schedule_posts") {
        if (!job.batchId) throw new Error("schedule_posts job is missing batchId");
        const scheduled = await input.store.completeSchedulePosts({ jobId: job.id, batchId: job.batchId });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            scheduledPostIds: scheduled.scheduledPosts.map((post) => post.id),
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      }

      if (job.type === "publish_post" || job.type === "retry_post") {
        if (!envFlag("FEATURE_META_PUBLISHING", true)) {
          throw new Error("Meta publishing is disabled by feature flag");
        }
        const scheduledPostId = typeof job.payload.scheduledPostId === "string" ? job.payload.scheduledPostId : undefined;
        if (!scheduledPostId) throw new Error(`${job.type} job is missing scheduledPostId`);
        const published = await input.store.publishScheduledPost({
          jobId: job.id,
          scheduledPostId,
          publishNow: job.payload.deliveryMode === "publish_now"
        });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            scheduledPostId: published.id,
            facebookPostId: published.facebookPostId ?? null,
            remoteStatus: published.remoteStatus,
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      }

      if (job.type === "collect_metrics") {
        const metrics = await input.store.completeCollectMetrics({ jobId: job.id });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            snapshotsCount: metrics.snapshots.length,
            summariesCount: metrics.summaries.length,
            unavailableMetricIds: metrics.unavailableMetrics.map((metric) => metric.id),
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      }

      if (job.type === "weekly_report") {
        const report = await input.store.completeWeeklyReport({ jobId: job.id });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            reportId: report.id,
            confidence: report.confidence,
            sampleSize: report.sampleSize,
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      }

      if (job.type === "batch_caption_eval") {
        const evaluation = await input.store.completeBatchCaptionEval({ jobId: job.id });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            evaluationId: evaluation.id,
            status: evaluation.status,
            rolloutRecommendation: evaluation.rolloutRecommendation,
            failedCriteria: evaluation.failedCriteria,
            usedBatchMode: evaluation.usedBatchMode,
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      }

      throw new Error(`Unsupported job type in this phase: ${job.type}`);
    }

    if (process.env.APP_ENV === "production") {
      throw new Error("mock_job is disabled in production");
    }
    const operationKey = job.operationKey ?? `development:mock:${job.id}`;
    await input.store.upsertExternalOperation({
      operationKey,
      workspaceId: job.workspaceId,
      jobId: job.id,
      provider: "local",
      operation: "mock_job",
      status: "started"
    });

    const completed = await input.store.completeJob({
      jobId: job.id,
      result: {
        ok: true,
        processedBy: input.workerId,
        processedAt: new Date().toISOString()
      }
    });
    await input.store.upsertExternalOperation({
      operationKey,
      workspaceId: job.workspaceId,
      jobId: job.id,
      provider: "local",
      operation: "mock_job",
      status: "succeeded"
    });
    return { processed: true, job: completed };
  } catch (error) {
    const failed = await input.store.failJob({
      jobId: job.id,
      error: error instanceof Error ? error.message : "Unknown worker error"
    });
    return { processed: true, job: failed };
  }
};

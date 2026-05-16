import { createHash } from "node:crypto";
import { DataStore, StoredJob } from "@fbmaniaco/api/dist/db/index.js";
import {
  CaptionGenerationProvider,
  createCaptionGenerationProvider,
  createImageEditProvider,
  createVisionAnalysisProvider,
  ImageEditProvider,
  VisionAnalysisProvider
} from "@fbmaniaco/providers";
import { createClient } from "@supabase/supabase-js";
import type { AssignedStyle } from "@fbmaniaco/shared";

export type WorkerResult = {
  processed: boolean;
  job?: StoredJob;
};

const envFlag = (name: string, fallback: boolean) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes"].includes(value.toLowerCase());
};

const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET ?? "business-media";
const backgroundPalette = ["Atardecer", "Marmol", "Madera", "Jardin", "Playa", "Estudio", "Nocturno", "Bambu"];
const backgroundPromptForVariant = (variantIndex: number, style?: AssignedStyle) => {
  const background = style?.manualOverride && style.styleName.trim().length > 0
    ? style.styleName.trim()
    : backgroundPalette[(variantIndex - 1) % backgroundPalette.length];
  return `Corrige la iluminacion y los colores. Cambia el fondo. ${background}.`;
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

const generatedVariantStorageKey = (input: { workspaceId: string; businessId: string; batchId: string; variantId: string }) =>
  `${input.workspaceId}/${input.businessId}/${input.batchId}/generated/${input.variantId}.jpg`;

const storeGeneratedVariantImage = async (input: {
  workspaceId: string;
  businessId: string;
  batchId: string;
  variantId: string;
  imageBytes: Uint8Array;
  mimeType: string;
  requiresStorage: boolean;
}) => {
  const storageKey = generatedVariantStorageKey(input);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    if (input.requiresStorage) {
      throw new Error("Generated image upload requires Supabase Storage");
    }
    return {
      bucket: MEDIA_BUCKET,
      storageKey,
      mimeType: input.mimeType,
      fileSize: input.imageBytes.byteLength
    };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storageKey, Buffer.from(input.imageBytes), { contentType: input.mimeType, upsert: true });
  if (error) {
    throw new Error(`Could not upload generated image asset: ${error.message}`);
  }
  return {
    bucket: MEDIA_BUCKET,
    storageKey,
    mimeType: input.mimeType,
    fileSize: input.imageBytes.byteLength
  };
};

export const processOneJob = async (input: {
  store: DataStore;
  workerId: string;
  visionProvider?: VisionAnalysisProvider;
  captionProvider?: CaptionGenerationProvider;
  imageEditProvider?: ImageEditProvider;
}): Promise<WorkerResult> => {
  const providerConfig: Parameters<typeof createVisionAnalysisProvider>[0] = {
    timeoutMs: Number(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? process.env.OPENAI_VISION_TIMEOUT_MS ?? "30000")
  };
  if (process.env.OPENAI_API_KEY) providerConfig.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_BASE_URL) providerConfig.baseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_VISION_MODEL) providerConfig.visionModel = process.env.OPENAI_VISION_MODEL;
  if (process.env.OPENAI_CAPTION_MODEL) providerConfig.captionModel = process.env.OPENAI_CAPTION_MODEL;
  if (process.env.OPENAI_IMAGE_MODEL) providerConfig.imageEditModel = process.env.OPENAI_IMAGE_MODEL;
  const visionProvider = input.visionProvider ?? createVisionAnalysisProvider(providerConfig);
  const captionProvider = input.captionProvider ?? createCaptionGenerationProvider(providerConfig);
  const imageEditProvider = input.imageEditProvider ?? createImageEditProvider(providerConfig);
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
        if (!envFlag("FEATURE_OPENAI_IMAGE_GENERATION", true)) {
          throw new Error("OpenAI image generation is disabled by feature flag");
        }
        if (!input.imageEditProvider && imageEditProvider.mode !== "images") {
          throw new Error("OpenAI image edit provider is not configured");
        }
        if (!job.variantId) throw new Error("generate_variant job is missing variantId");
        const operationKey = job.operationKey ?? `openai_image_edit:${job.variantId}`;
        await input.store.upsertExternalOperation({
          operationKey,
          workspaceId: job.workspaceId,
          jobId: job.id,
          provider: imageEditProvider.mode === "images" ? "openai" : "mock",
          operation: "generate_variant",
          status: "started"
        });
        let captionAiRunId: string | undefined;
        const context = job.businessId && job.batchId
          ? await input.store.getVariantCaptionContext({
              workspaceId: job.workspaceId,
              businessId: job.businessId,
              batchId: job.batchId,
              variantId: job.variantId
            })
          : null;
        const captionOperationKey = `openai_caption:${job.variantId}`;
        const caption = context?.photo.visionAnalysis
          ? await (async () => {
              await input.store.upsertExternalOperation({
                operationKey: captionOperationKey,
                workspaceId: job.workspaceId,
                jobId: job.id,
                provider: captionProvider.mode === "responses" ? "openai" : "mock",
                operation: "generate_caption",
                status: "started"
              });
              try {
                return await captionProvider.generate({
                  pageName: context.page?.pageName ?? context.business.name,
                  businessName: context.business.name,
                  category: context.page?.category ?? String(context.business.metadata.category ?? "Facebook Page"),
                  styleName: context.style.styleName,
                  variantIndex: context.variant.variantIndex,
                  fileName: context.photo.fileName ?? null,
                  visionAnalysis: context.photo.visionAnalysis,
                  requestId: typeof job.payload.requestId === "string" ? job.payload.requestId : job.id,
                  operationKey: captionOperationKey,
                  promptVersion: context.promptVersion
                });
              } catch (error) {
                await input.store.upsertExternalOperation({
                  operationKey: captionOperationKey,
                  workspaceId: job.workspaceId,
                  jobId: job.id,
                  provider: captionProvider.mode === "responses" ? "openai" : "mock",
                  operation: "generate_caption",
                  status: "failed"
                });
                throw error;
              }
            })()
          : null;
        if (caption && context) {
          const inputHash = createHash("sha256")
            .update(
              JSON.stringify({
                businessId: context.business.id,
                pageId: context.page?.id ?? null,
                photoId: context.photo.id,
                variantId: context.variant.id,
                promptVersion: context.promptVersion
              })
            )
            .digest("hex");
          const outputHash = createHash("sha256").update(JSON.stringify(caption.result)).digest("hex");
          const aiRunInput: Parameters<DataStore["recordAiRun"]>[0] = {
            workspaceId: job.workspaceId,
            businessId: context.business.id,
            jobId: job.id,
            operationKey: captionOperationKey,
            provider: captionProvider.mode === "responses" ? "openai" : "mock",
            model: caption.model,
            modelProfileId: "caption-default-v1",
            promptTemplateId: "page-caption-generation",
            promptVersion: caption.result.promptVersion,
            schemaVersion: caption.result.schemaVersion,
            inputHash,
            outputHash,
            latencyMs: caption.latencyMs,
            status: "succeeded"
          };
          if (caption.responseId !== null) aiRunInput.responseId = caption.responseId;
          if (caption.usage !== null) aiRunInput.usage = caption.usage;
          if (typeof job.payload.requestId === "string") aiRunInput.requestId = job.payload.requestId;
          const aiRun = await input.store.recordAiRun(aiRunInput);
          captionAiRunId = aiRun.id;
          await input.store.upsertExternalOperation({
            operationKey: captionOperationKey,
            workspaceId: job.workspaceId,
            jobId: job.id,
            provider: captionProvider.mode === "responses" ? "openai" : "mock",
            operation: "generate_caption",
            status: "succeeded"
          });
        }
        if (!context) throw new Error("generate_variant job is missing variant context");
        const sourceImageUrl =
          (await freshSignedMediaUrl({ store: input.store, workspaceId: job.workspaceId, assetId: context.photo.originalAssetId })) ??
          (imageEditProvider.mode === "mock" ? `mock://media/${context.photo.originalAssetId ?? context.photo.id}` : null);
        if (!sourceImageUrl) {
          throw new Error("generate_variant job is missing real source imageUrl");
        }
        let generatedAsset: Parameters<DataStore["completeGenerateVariant"]>[0]["generatedAsset"];
        try {
          const imageEdit = await imageEditProvider.edit({
            imageUrl: sourceImageUrl,
            mimeType: context.photo.mimeType ?? "image/jpeg",
            prompt: backgroundPromptForVariant(context.variant.variantIndex, context.style),
            requestId: typeof job.payload.requestId === "string" ? job.payload.requestId : job.id,
            operationKey,
            size: "1024x1024"
          });
          generatedAsset = await storeGeneratedVariantImage({
            workspaceId: job.workspaceId,
            businessId: context.business.id,
            batchId: context.variant.batchId,
            variantId: context.variant.id,
            imageBytes: imageEdit.imageBytes,
            mimeType: imageEdit.mimeType,
            requiresStorage: imageEditProvider.mode === "images"
          });
        } catch (error) {
          await input.store.upsertExternalOperation({
            operationKey,
            workspaceId: job.workspaceId,
            jobId: job.id,
            provider: imageEditProvider.mode === "images" ? "openai" : "mock",
            operation: "generate_variant",
            status: "failed"
          });
          throw error;
        }
        const completeInput: Parameters<DataStore["completeGenerateVariant"]>[0] = {
          jobId: job.id,
          variantId: job.variantId,
          generatedAsset
        };
        if (caption) completeInput.captionResult = caption.result;
        if (captionAiRunId) completeInput.captionAiRunId = captionAiRunId;
        const variant = await input.store.completeGenerateVariant(completeInput);
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
          provider: imageEditProvider.mode === "images" ? "openai" : "mock",
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

      if (job.type === "publish_post") {
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

    throw new Error(`Unsupported job type in this phase: ${job.type}`);

  } catch (error) {
    const failed = await input.store.failJob({
      jobId: job.id,
      error: error instanceof Error ? error.message : "Unknown worker error"
    });
    return { processed: true, job: failed };
  }
};

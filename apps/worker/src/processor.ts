import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DataStore, StoredJob } from "@fbmaniaco/api/dist/db/index.js";
import {
  CaptionGenerationProvider,
  createCaptionGenerationProvider,
  createImageEditProvider,
  createMenuParseProvider,
  createVisionAnalysisProvider,
  ImageEditProvider,
  MenuParseProvider,
  VisionAnalysisProvider
} from "@fbmaniaco/providers";
import { createClient } from "@supabase/supabase-js";
import { variantEditPromptForStyle, variantStylePresetForIndex, type AssignedStyle, type VisionAnalysis } from "@fbmaniaco/shared";
import { computeDHash64FromBuffer } from "./phash.js";

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
const loadSharp = async () => (await import("sharp")).default;
const mediaAssetPaths = (input: { workspaceId: string; assetId: string }) => ({
  thumbPath: `${input.workspaceId}/assets/${input.assetId}/thumb.webp`,
  previewPath: `${input.workspaceId}/assets/${input.assetId}/preview.webp`,
  fullPath: `${input.workspaceId}/assets/${input.assetId}/full.jpg`
});
const backgroundPromptForVariant = (variantIndex: number, style?: AssignedStyle) => {
  const background = style?.styleName.trim() || variantStylePresetForIndex(variantIndex).styleName;
  return variantEditPromptForStyle(background);
};
type ImageEditorRuntime = {
  providerName: string;
  config: Parameters<typeof createImageEditProvider>[0];
  size: string;
  quality: "auto" | "low" | "medium" | "high";
};

const decodeStoredSecret = (value: unknown) => {
  if (typeof value !== "string") return null;
  const prefix = value.startsWith("server:") ? "server:" : value.startsWith("local-dev:") ? "local-dev:" : null;
  if (!prefix) return null;
  return Buffer.from(value.slice(prefix.length), "base64url").toString("utf8");
};

const stringSetting = (record: Record<string, unknown>, key: string, fallback = "") => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const textSetting = (record: Record<string, unknown>, key: string) => stringSetting(record, key, "");

const listSetting = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
};

const numberSetting = (record: Record<string, unknown>, key: string, fallback: number, min: number, max: number) => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
};

const imageEditorRuntimeFromBusiness = (
  metadata: Record<string, unknown>,
  fallback: Parameters<typeof createImageEditProvider>[0]
): ImageEditorRuntime => {
  const editors = Array.isArray(metadata.imageEditors) ? metadata.imageEditors : [];
  const active = editors.find(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item) && item.enabled === true
  );
  if (!active) {
    return {
      providerName: "openai",
      config: fallback,
      size: "1024x1024",
      quality: "medium"
    };
  }
  const provider = stringSetting(active, "provider", "openai_compatible");
  const apiKey = decodeStoredSecret(active.apiKeySecret) ?? fallback.apiKey;
  const baseUrl = provider === "openai" ? fallback.baseUrl : stringSetting(active, "baseUrl", fallback.baseUrl);
  const model = stringSetting(active, "model", fallback.imageEditModel ?? "gpt-image-2");
  const size = stringSetting(active, "size", "1024x1024");
  const qualitySetting = stringSetting(active, "quality", "medium");
  const quality = qualitySetting === "auto" || qualitySetting === "low" || qualitySetting === "high" ? qualitySetting : "medium";
  const config: Parameters<typeof createImageEditProvider>[0] = {
    ...fallback,
    timeoutMs: numberSetting(active, "timeoutMs", fallback.timeoutMs ?? 30000, 5000, 120000)
  };
  if (apiKey) config.apiKey = apiKey;
  if (baseUrl) config.baseUrl = baseUrl;
  if (model) config.imageEditModel = model;
  return {
    providerName: provider === "openai" ? "openai" : "openai_compatible",
    config,
    size,
    quality
  };
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

const freshSignedStorageUrl = async (input: { bucket: string; storageKey: string }) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) return null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.storage.from(input.bucket).createSignedUrl(input.storageKey, 60 * 30);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create fresh signed generated media URL: ${error?.message ?? "unknown storage error"}`);
  }
  return data.signedUrl;
};

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

const processGalleryMediaAsset = async (input: { store: DataStore; assetId: string }) => {
  const asset = await input.store.getMediaAsset({ assetId: input.assetId });
  if (!asset) throw new Error(`Media asset not found: ${input.assetId}`);
  if (asset.status === "ready" && asset.fullPath) {
    return {
      id: asset.id,
      status: "ready",
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      bytes: asset.bytes ?? asset.fileSize,
      thumbPath: asset.thumbPath ?? mediaAssetPaths({ workspaceId: asset.workspaceId, assetId: asset.id }).thumbPath,
      previewPath: asset.previewPath ?? mediaAssetPaths({ workspaceId: asset.workspaceId, assetId: asset.id }).previewPath,
      fullPath: asset.fullPath
    };
  }
  const hasSupabaseStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);
  const supabase = hasSupabaseStorage
    ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE!, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
    : null;
  const raw = supabase
    ? await (async () => {
        const { data, error } = await supabase.storage.from(asset.bucket).download(asset.storageKey);
        if (error || !data) {
          throw new Error(`Could not download raw media asset: ${error?.message ?? "unknown storage error"}`);
        }
        return Buffer.from(await data.arrayBuffer());
      })()
    : asset.storageKey.startsWith("file://")
      ? await readFile(new URL(asset.storageKey))
      : null;
  const paths = mediaAssetPaths({ workspaceId: asset.workspaceId, assetId: asset.id });
  if (!raw) {
    return input.store.completeMediaAssetProcessing({
      assetId: asset.id,
      width: asset.width ?? 1,
      height: asset.height ?? 1,
      bytes: asset.bytes ?? asset.fileSize,
      thumbPath: paths.thumbPath,
      previewPath: paths.previewPath,
      fullPath: paths.fullPath
    });
  }
  if (asset.sha256) {
    const actualHash = createHash("sha256").update(raw).digest("hex");
    if (actualHash !== asset.sha256) {
      await input.store.failMediaAssetProcessing({ assetId: asset.id, errorReason: "HASH_MISMATCH" });
      throw new Error("HASH_MISMATCH");
    }
  }
  const sharp = await loadSharp();
  const image = sharp(raw, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? asset.width ?? 0;
  const height = metadata.height ?? asset.height ?? 0;
  const phash = await computeDHash64FromBuffer(raw);
  const thumb = await sharp(raw, { failOn: "none" })
    .rotate()
    .resize({ width: 256, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  const preview = await sharp(raw, { failOn: "none" })
    .rotate()
    .resize({ width: 1024, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const full = await sharp(raw, { failOn: "none" })
    .rotate()
    .resize({ width: 1800, withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const uploads = [
    { path: paths.thumbPath, bytes: thumb, contentType: "image/webp" },
    { path: paths.previewPath, bytes: preview, contentType: "image/webp" },
    { path: paths.fullPath, bytes: full, contentType: "image/jpeg" }
  ];
  if (!supabase) {
    return input.store.completeMediaAssetProcessing({
      assetId: asset.id,
      width,
      height,
      bytes: full.byteLength,
      thumbPath: paths.thumbPath,
      previewPath: paths.previewPath,
      fullPath: paths.fullPath,
      phash
    });
  }
  for (const upload of uploads) {
    const uploaded = await supabase.storage.from(asset.bucket).upload(upload.path, upload.bytes, {
      contentType: upload.contentType,
      upsert: true
    });
    if (uploaded.error) throw new Error(`Could not upload processed media asset: ${uploaded.error.message}`);
  }
  await supabase.storage.from(asset.bucket).remove([asset.storageKey]).catch(() => undefined);
  return input.store.completeMediaAssetProcessing({
    assetId: asset.id,
    width,
    height,
    bytes: full.byteLength,
    thumbPath: paths.thumbPath,
    previewPath: paths.previewPath,
    fullPath: paths.fullPath,
    phash
  });
};

export const processOneJob = async (input: {
  store: DataStore;
  workerId: string;
  visionProvider?: VisionAnalysisProvider;
  captionProvider?: CaptionGenerationProvider;
  imageEditProvider?: ImageEditProvider;
  menuParseProvider?: MenuParseProvider;
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
  const menuParseProvider = input.menuParseProvider ?? createMenuParseProvider(providerConfig);
  const job = await input.store.claimDueJob(input.workerId);
  if (!job) return { processed: false };

  try {
    if (job.type === "media:process") {
      const assetId = typeof job.payload.assetId === "string" ? job.payload.assetId : undefined;
      if (!assetId) throw new Error("media:process job is missing assetId");
      try {
        const asset = await processGalleryMediaAsset({ store: input.store, assetId });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            assetId: asset.id,
            status: asset.status,
            thumbPath: asset.thumbPath,
            previewPath: asset.previewPath,
            fullPath: asset.fullPath,
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        return { processed: true, job: completed };
      } catch (error) {
        await input.store.failMediaAssetProcessing({
          assetId,
          errorReason: error instanceof Error ? error.message : "media_process_failed"
        });
        throw error;
      }
    }

    if (job.type === "menu:parse") {
      const sourceType = job.payload.sourceType === "text" || job.payload.sourceType === "pdf" || job.payload.sourceType === "image"
        ? job.payload.sourceType
        : null;
      if (!sourceType) throw new Error("menu:parse job is missing sourceType");
      const operationKey = job.operationKey ?? `menu_parse:${job.id}`;
      await input.store.upsertExternalOperation({
        operationKey,
        workspaceId: job.workspaceId,
        jobId: job.id,
        provider: menuParseProvider.mode === "responses" ? "openai" : "mock",
        operation: "menu_parse",
        status: "started"
      });
      try {
        const parseInput: Parameters<MenuParseProvider["parse"]>[0] = {
          sourceType,
          requestId: typeof job.payload.requestId === "string" ? job.payload.requestId : job.id,
          operationKey
        };
        if (typeof job.payload.text === "string") parseInput.text = job.payload.text;
        if (typeof job.payload.fileName === "string") parseInput.fileName = job.payload.fileName;
        if (typeof job.payload.mime === "string") parseInput.mime = job.payload.mime;
        if (typeof job.payload.dataBase64 === "string") parseInput.dataBase64 = job.payload.dataBase64;
        const parsed = await menuParseProvider.parse(parseInput);
        const saved = await input.store.completeMenuIngest({
          jobId: job.id,
          workspaceId: job.workspaceId,
          result: parsed.result
        });
        const completed = await input.store.completeJob({
          jobId: job.id,
          result: {
            ok: true,
            itemsCount: saved.items.length,
            categoriesCount: saved.categories.length,
            categorizedAssetsCount: saved.categorizedAssets.length,
            model: parsed.model,
            processedBy: input.workerId,
            processedAt: new Date().toISOString()
          }
        });
        await input.store.upsertExternalOperation({
          operationKey,
          workspaceId: job.workspaceId,
          jobId: job.id,
          provider: menuParseProvider.mode === "responses" ? "openai" : "mock",
          operation: "menu_parse",
          status: "succeeded"
        });
        return { processed: true, job: completed };
      } catch (error) {
        await input.store.upsertExternalOperation({
          operationKey,
          workspaceId: job.workspaceId,
          jobId: job.id,
          provider: menuParseProvider.mode === "responses" ? "openai" : "mock",
          operation: "menu_parse",
          status: "failed"
        });
        throw error;
      }
    }

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
        if (!job.variantId) throw new Error("generate_variant job is missing variantId");
        const operationKey = job.operationKey ?? `openai_image_edit:${job.variantId}`;
        const context = job.businessId && job.batchId
          ? await input.store.getVariantCaptionContext({
              workspaceId: job.workspaceId,
              businessId: job.businessId,
              batchId: job.batchId,
              variantId: job.variantId
            })
          : null;
        if (!context) throw new Error("generate_variant job is missing variant context");
        const editorRuntime = imageEditorRuntimeFromBusiness(context.business.metadata, providerConfig);
        const imageEditProvider = input.imageEditProvider ?? createImageEditProvider(editorRuntime.config);
        if (!input.imageEditProvider && imageEditProvider.mode !== "images") {
          throw new Error("Image edit provider is not configured");
        }
        const imageOperationProvider = imageEditProvider.mode === "images" ? editorRuntime.providerName : "mock";
        await input.store.upsertExternalOperation({
          operationKey,
          workspaceId: job.workspaceId,
          jobId: job.id,
          provider: imageOperationProvider,
          operation: "generate_variant",
          status: "started"
        });
        let captionAiRunId: string | undefined;
        const captionOperationKey = `openai_caption:${job.variantId}`;
        let caption: Awaited<ReturnType<CaptionGenerationProvider["generate"]>> | null = null;
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
            size: editorRuntime.size,
            quality: editorRuntime.quality
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
          const generatedImageUrl =
            (await freshSignedStorageUrl({ bucket: generatedAsset.bucket, storageKey: generatedAsset.storageKey })) ??
            (imageEditProvider.mode === "mock" ? `mock://generated/${context.variant.id}` : null);

          await input.store.upsertExternalOperation({
            operationKey: captionOperationKey,
            workspaceId: job.workspaceId,
            jobId: job.id,
            provider: captionProvider.mode === "responses" ? "openai" : "mock",
            operation: "generate_caption",
            status: "started"
          });
          try {
            caption = await captionProvider.generate({
              pageName: context.page?.pageName ?? context.business.name,
              businessName: context.business.name,
              category: context.page?.category ?? String(context.business.metadata.category ?? "Facebook Page"),
              imageUrl: generatedImageUrl ?? sourceImageUrl,
              styleName: context.style.styleName,
              variantIndex: context.variant.variantIndex,
              fileName: context.photo.fileName ?? null,
              visionAnalysis: context.photo.visionAnalysis as VisionAnalysis | null,
              seoKeywords: listSetting(context.business.metadata, "facebookSeoKeywords"),
              contentTypes: listSetting(context.business.metadata, "contentTypes"),
              pageContext: textSetting(context.business.metadata, "facebookSeoContext"),
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
          const inputHash = createHash("sha256")
            .update(
              JSON.stringify({
                businessId: context.business.id,
                pageId: context.page?.id ?? null,
                photoId: context.photo.id,
                variantId: context.variant.id,
                generatedImageKey: generatedAsset.storageKey,
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
        } catch (error) {
          await input.store.upsertExternalOperation({
            operationKey,
            workspaceId: job.workspaceId,
            jobId: job.id,
            provider: imageOperationProvider,
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
          provider: imageOperationProvider,
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

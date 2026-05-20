import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { LocalDataStore } from "@fbmaniaco/api/dist/db/local-store.js";
import { ImageEditProvider } from "@fbmaniaco/providers";
import { variantEditPromptForStyle } from "@fbmaniaco/shared";
import { processOneJob } from "./processor.js";

describe("worker processor", () => {
  it("claims image variant jobs one at a time", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-claim-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    await store.upsertLocalUser({ userId: "claim-user", email: "claim@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("claim-user");
    const first = await store.createJob({
      type: "generate_variant",
      workspaceId: workspace.id,
      dedupeKey: "generate_variant:first",
      payload: {}
    });
    const second = await store.createJob({
      type: "generate_variant",
      workspaceId: workspace.id,
      dedupeKey: "generate_variant:second",
      payload: {}
    });

    const claimedFirst = await store.claimDueJob("claim-worker-1");
    const claimedSecond = await store.claimDueJob("claim-worker-2");
    expect(claimedFirst?.id).toBe(first.id);
    expect(claimedSecond).toBeNull();

    await store.completeJob({ jobId: first.id, result: { ok: true } });
    const claimedAfterComplete = await store.claimDueJob("claim-worker-2");
    expect(claimedAfterComplete?.id).toBe(second.id);
    await rm(path, { force: true });
  });

  it("uploads a photo as ready and generates edited variants one at a time", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-photo-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    const previousPublicApiUrl = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://api.example.test";
    const imagePrompts: string[] = [];
    const imageEditProvider: ImageEditProvider = {
      mode: "mock",
      edit: async (input) => {
        imagePrompts.push(input.prompt);
        return {
          imageBytes: Buffer.from(`edited:${input.prompt}:${input.operationKey}`),
          mimeType: "image/jpeg",
          responseId: null,
          model: "mock-image-edit",
          usage: null,
          latencyMs: 1
        };
      }
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
    const detail = await store.getBatchDetail({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });

    expect(completed.job).toBeNull();
    expect(detail?.photos[0]?.status).toBe("validada");
    expect(detail?.photos[0]?.thumbnailAssetId).toBeTruthy();
    expect(detail?.photos[0]?.visionInputAssetId).toBeTruthy();
    expect(detail?.batch.status).toBe("pendiente_confirmacion");

    const generation = await store.requestGenerateBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 3,
      styleOverrides: [{ photoId: detail?.photos[0]?.id ?? "", styleId: "playa", styleName: "Playa", intensity: 90 }],
      actorId: "u2",
      requestId: "test-generate"
    });
    expect(generation.created).toBe(3);

    const batchJob = await processOneJob({ store, workerId: "variant-worker" });
    const firstVariantJob = await processOneJob({ store, workerId: "variant-worker", imageEditProvider });
    const secondVariantJob = await processOneJob({ store, workerId: "variant-worker", imageEditProvider });
    const thirdVariantJob = await processOneJob({ store, workerId: "variant-worker", imageEditProvider });
    const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });

    expect(batchJob.job?.type).toBe("generate_batch");
    expect(firstVariantJob.job?.type).toBe("generate_variant");
    expect(secondVariantJob.job?.type).toBe("generate_variant");
    expect(thirdVariantJob.job?.type).toBe("generate_variant");
    expect(variants).toHaveLength(3);
    expect(variants.every((variant) => variant.status === "generada" && Boolean(variant.caption))).toBe(true);
    expect(variants.every((variant) => variant.caption?.includes("Maniaco Demo"))).toBe(true);
    expect(variants.every((variant) => !variant.caption?.includes("Pagina sin permiso completo"))).toBe(true);
    expect(variants.map((variant) => variant.assignedStyle?.styleName)).toEqual(["Playa", "Estudio", "Nocturno"]);
    expect(new Set(variants.map((variant) => variant.styleId)).size).toBe(3);
    expect(imagePrompts).toEqual([
      variantEditPromptForStyle("Playa", "fuerte"),
      variantEditPromptForStyle("Estudio", "fuerte"),
      variantEditPromptForStyle("Nocturno", "fuerte")
    ]);
    expect(variants.every((variant) => variant.generatedAssetId && variant.generatedAssetId !== detail?.photos[0]?.originalAssetId)).toBe(
      true
    );

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
    expect(publishRequest.scheduledPost.status).toBe("publicacion_en_proceso");
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
    if (previousPublicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousPublicApiUrl;
    await rm(path, { force: true });
  });
});

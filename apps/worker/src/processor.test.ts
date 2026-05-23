import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDataStore } from "@fbmaniaco/api/dist/db/local-store.js";
import { CaptionGenerationProvider, ImageEditProvider } from "@fbmaniaco/providers";
import { variantEditPromptForStyle } from "@fbmaniaco/shared";
import { processOneJob } from "./processor.js";

const localScheduleTimeKey = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));

const localScheduleDayKey = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    const captionInputs: Array<Parameters<CaptionGenerationProvider["generate"]>[0]> = [];
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
    const captionProvider: CaptionGenerationProvider = {
      mode: "mock",
      generate: async (input) => {
        captionInputs.push(input);
        return {
          result: {
            schemaVersion: "caption.v1",
            promptVersion: input.promptVersion,
            caption: `${input.pageName}: texto SEO personalizado para ${input.styleName}.`,
            seoTermsUsed: [input.pageName, input.styleName, ...(input.seoKeywords ?? [])],
            warnings: ["caption_generado_con_prompt_separado"]
          },
          responseId: null,
          model: "mock-caption",
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
    const pendingVariants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
    const pendingVariantJobs = (await store.listJobs(workspace.id)).filter((job) => job.type === "generate_variant");
    const firstPendingJob = pendingVariantJobs.find((job) => job.variantId === pendingVariants[0]!.id);
    expect(firstPendingJob).toBeTruthy();
    await expect(
      store.completeGenerateVariant({
        jobId: firstPendingJob!.id,
        variantId: pendingVariants[1]!.id,
        generatedAsset: {
          bucket: "business-media",
          storageKey: `${workspace.id}/${business.id}/${batch.id}/generated/mismatched.jpg`,
          mimeType: "image/jpeg",
          fileSize: 16
        }
      })
    ).rejects.toMatchObject({ code: "variant_job_mismatch" });

    const batchJob = await processOneJob({ store, workerId: "variant-worker" });
    const firstVariantJob = await processOneJob({ store, workerId: "variant-worker", imageEditProvider, captionProvider });
    const secondVariantJob = await processOneJob({ store, workerId: "variant-worker", imageEditProvider, captionProvider });
    const thirdVariantJob = await processOneJob({ store, workerId: "variant-worker", imageEditProvider, captionProvider });
    const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });

    expect(batchJob.job?.type).toBe("generate_batch");
    expect(firstVariantJob.job?.type).toBe("generate_variant");
    expect(secondVariantJob.job?.type).toBe("generate_variant");
    expect(thirdVariantJob.job?.type).toBe("generate_variant");
    expect(variants).toHaveLength(3);
    expect(variants.every((variant) => variant.status === "generada" && Boolean(variant.caption))).toBe(true);
    expect(variants.every((variant) => variant.caption?.includes("Maniaco Demo"))).toBe(true);
    expect(captionInputs).toHaveLength(3);
    expect(captionInputs.every((input) => input.imageUrl?.startsWith("mock://generated/"))).toBe(true);
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

  it("assigns styles across the whole batch instead of restarting per photo", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-styles-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    await store.upsertLocalUser({ userId: "style-user", email: "style@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("style-user");
    await store.upsertMockMetaAuthorization({ workspaceId: workspace.id, actorId: "style-user" });
    const page = (await store.listMetaPages(workspace.id)).find((item) => item.canPublish);
    if (!page) throw new Error("Missing selectable mock page");
    const business = await store.selectMetaPage({
      workspaceId: workspace.id,
      actorId: "style-user",
      pageId: page.id,
      requestId: "style-select"
    });
    const batch = await store.createBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "style-user",
      requestId: "style-batch"
    });
    for (const name of ["foto-1.jpg", "foto-2.jpg"]) {
      const intent = await store.createUploadIntent({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: batch.id,
        originalFileName: name,
        contentType: "image/jpeg",
        fileSize: 2048
      });
      await store.completeUpload({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: batch.id,
        storageKey: intent.storageKey,
        originalFileName: name,
        contentType: "image/jpeg",
        fileSize: 2048,
        actorId: "style-user",
        requestId: `style-upload-${name}`
      });
    }

    await store.requestGenerateBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 2,
      actorId: "style-user",
      requestId: "style-generate"
    });
    const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
    const styleIds = variants.map((variant) => variant.styleId);
    const firstPhotoStyles = variants.filter((variant) => variant.photoId === variants[0]!.photoId).map((variant) => variant.styleId);
    const secondPhotoStyles = variants.filter((variant) => variant.photoId !== variants[0]!.photoId).map((variant) => variant.styleId);

    expect(variants).toHaveLength(4);
    expect(new Set(styleIds).size).toBe(4);
    expect(secondPhotoStyles).not.toEqual(firstPhotoStyles);
    await rm(path, { force: true });
  });

  it("schedules 30 approved variants over 7 days without duplicate local times", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-large-schedule-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    await store.upsertLocalUser({ userId: "large-user", email: "large@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("large-user");
    await store.upsertMockMetaAuthorization({ workspaceId: workspace.id, actorId: "large-user" });
    const page = (await store.listMetaPages(workspace.id)).find((item) => item.canPublish);
    if (!page) throw new Error("Missing selectable mock page");
    const business = await store.selectMetaPage({
      workspaceId: workspace.id,
      actorId: "large-user",
      pageId: page.id,
      requestId: "large-select"
    });
    const batch = await store.createBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "large-user",
      requestId: "large-batch"
    });

    for (let index = 1; index <= 6; index += 1) {
      const intent = await store.createUploadIntent({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: batch.id,
        originalFileName: `foto-${index}.jpg`,
        contentType: "image/jpeg",
        fileSize: 2048
      });
      await store.completeUpload({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: batch.id,
        storageKey: intent.storageKey,
        originalFileName: `foto-${index}.jpg`,
        contentType: "image/jpeg",
        fileSize: 2048,
        actorId: "large-user",
        requestId: `large-upload-${index}`
      });
    }

    await store.requestGenerateBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 5,
      actorId: "large-user",
      requestId: "large-generate"
    });
    const variants = await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
    const variantJobs = (await store.listJobs(workspace.id)).filter((job) => job.type === "generate_variant");
    for (const variant of variants) {
      const job = variantJobs.find((item) => item.variantId === variant.id);
      if (!job) throw new Error(`Missing variant job for ${variant.id}`);
      await store.completeGenerateVariant({
        jobId: job.id,
        variantId: variant.id,
        generatedAsset: {
          bucket: "business-media",
          storageKey: `${workspace.id}/${business.id}/${batch.id}/generated/${variant.id}.jpg`,
          mimeType: "image/jpeg",
          fileSize: 32
        },
        captionResult: {
          schemaVersion: "caption.v1",
          promptVersion: "caption-page-context-v1",
          caption: `Caption ${variant.variantIndex}`,
          seoTermsUsed: [],
          warnings: []
        }
      });
      await store.approveVariant({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: batch.id,
        variantId: variant.id,
        actorId: "large-user",
        requestId: `large-approve-${variant.id}`
      });
    }

    const calendar = await store.confirmCalendar({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      periodDays: 7,
      actorId: "large-user",
      requestId: "large-calendar"
    });
    const exactSlots = calendar.scheduledPosts.map((post) => post.scheduledFor.slice(0, 16));
    const localTimes = calendar.scheduledPosts.map((post) => localScheduleTimeKey(post.scheduledFor));
    const localDays = calendar.scheduledPosts.map((post) => localScheduleDayKey(post.scheduledFor));
    const styleCounts = variants.reduce<Record<string, number>>((acc, variant) => {
      const key = variant.styleId ?? "missing";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const counts = Object.values(styleCounts);

    expect(variants).toHaveLength(30);
    expect(calendar.scheduledPosts).toHaveLength(30);
    expect(new Set(exactSlots).size).toBe(30);
    expect(new Set(localTimes).size).toBe(30);
    expect(new Set(localDays).size).toBeLessThanOrEqual(7);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    await rm(path, { force: true });
  });

  it("sends scheduled posts to Facebook during the schedule job when a real page token exists", async () => {
    const path = join(tmpdir(), `fbmaniaco-worker-remote-schedule-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    const previousPublicApiUrl = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://api.example.test";
    let facebookRequestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: URL | string, init?: RequestInit) => {
        facebookRequestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ id: "remote-photo-id", post_id: "page_456" }), { status: 200 });
      })
    );
    const imageEditProvider: ImageEditProvider = {
      mode: "mock",
      edit: async (input) => ({
        imageBytes: Buffer.from(`edited:${input.prompt}:${input.operationKey}`),
        mimeType: "image/jpeg",
        responseId: null,
        model: "mock-image-edit",
        usage: null,
        latencyMs: 1
      })
    };
    const captionProvider: CaptionGenerationProvider = {
      mode: "mock",
      generate: async (input) => ({
        result: {
          schemaVersion: "caption.v1",
          promptVersion: input.promptVersion,
          caption: `${input.pageName}: texto listo para programar.`,
          seoTermsUsed: [input.pageName],
          warnings: []
        },
        responseId: null,
        model: "mock-caption",
        usage: null,
        latencyMs: 1
      })
    };
    await store.upsertLocalUser({ userId: "remote-user", email: "remote@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("remote-user");
    await store.upsertMetaAuthorization({
      workspaceId: workspace.id,
      actorId: "remote-user",
      authorization: {
        status: "valid",
        grantedScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
        declinedScopes: [],
        missingRequiredScopes: [],
        grantedPageIds: ["real-page-1"],
        appMode: "live",
        appReviewStatus: "approved",
        graphApiVersion: "v23.0",
        tokenStatus: "valido"
      },
      pages: [
        {
          metaPageId: "real-page-1",
          pageName: "Pagina Real",
          coverPhotoUrl: "https://cdn.example.com/cover.jpg",
          profilePhotoUrl: "https://cdn.example.com/profile.jpg",
          category: "Restaurant",
          tasks: ["CREATE_CONTENT"],
          isGranted: true,
          canPublish: true,
          pageAccessTokenStatus: "valido",
          grantedScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
          declinedScopes: [],
          pageAccessToken: "page-token"
        }
      ]
    });
    const page = (await store.listMetaPages(workspace.id))[0]!;
    const business = await store.selectMetaPage({
      workspaceId: workspace.id,
      actorId: "remote-user",
      pageId: page.id,
      requestId: "remote-select"
    });
    const batch = await store.createBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "remote-user",
      requestId: "remote-batch"
    });
    const intent = await store.createUploadIntent({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      originalFileName: "foto.jpg",
      contentType: "image/jpeg",
      fileSize: 2048
    });
    await store.completeUpload({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      storageKey: intent.storageKey,
      originalFileName: "foto.jpg",
      contentType: "image/jpeg",
      fileSize: 2048,
      actorId: "remote-user",
      requestId: "remote-upload"
    });
    await store.requestGenerateBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantsPerPhoto: 1,
      actorId: "remote-user",
      requestId: "remote-generate"
    });
    await processOneJob({ store, workerId: "remote-worker" });
    await processOneJob({ store, workerId: "remote-worker", imageEditProvider, captionProvider });
    const variant = (await store.listVariants({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id }))[0]!;
    await store.approveVariant({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      variantId: variant.id,
      actorId: "remote-user",
      requestId: "remote-approve"
    });
    const calendar = await store.confirmCalendar({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      periodDays: 7,
      actorId: "remote-user",
      requestId: "remote-calendar"
    });
    const beforeScheduleJob = await store.getBatchDetail({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
    const scheduleJob = await processOneJob({ store, workerId: "remote-worker" });
    const afterScheduleJob = await store.getBatchDetail({ workspaceId: workspace.id, businessId: business.id, batchId: batch.id });
    const scheduled = await store.getScheduledPost({
      workspaceId: workspace.id,
      businessId: business.id,
      scheduledPostId: calendar.scheduledPosts[0]!.id
    });
    const publishJobs = (await store.listJobs(workspace.id)).filter(
      (job) => job.type === "publish_post" && job.batchId === batch.id && job.status !== "cancelled"
    );

    expect(beforeScheduleJob?.batch.status).toBe("scheduled");
    expect(scheduleJob.job?.type).toBe("schedule_posts");
    expect(afterScheduleJob?.batch.status).toBe("completado");
    expect(scheduled?.status).toBe("programada");
    expect(scheduled?.remoteStatus).toBe("confirmado_meta");
    expect(scheduled?.deliveryMode).toBe("remote_schedule");
    expect(scheduled?.facebookPostId).toBe("page_456");
    expect(publishJobs).toHaveLength(0);
    expect(facebookRequestBody).toContain("published=false");
    expect(facebookRequestBody).toContain("scheduled_publish_time=");
    if (previousPublicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousPublicApiUrl;
    await rm(path, { force: true });
  });
});

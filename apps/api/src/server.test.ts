import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MetaProvider } from "@fbmaniaco/providers";
import { buildServer } from "./server.js";
import { LocalDataStore } from "./db/local-store.js";
import { ApiConfig } from "./config.js";

const makeConfig = (path: string): ApiConfig => ({
  appEnv: "development",
  dataStoreMode: "local",
  allowLocalDataStore: true,
  host: "127.0.0.1",
  port: 0,
  corsOrigin: "*",
  localAuthEnabled: true,
  localDbPath: path,
  supabaseUrl: undefined,
  supabaseServiceRole: undefined,
  supabaseMediaBucket: "business-media",
  databaseUrl: undefined,
  publicApiUrl: undefined,
  metaAppId: undefined,
  metaAppSecret: undefined,
  metaRedirectUri: undefined,
  metaLoginConfigurationId: undefined,
  metaGraphApiVersion: "v23.0",
  metaRequiredScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  metaTestUserAccessToken: undefined,
  openaiApiKey: undefined,
  openaiBaseUrl: undefined,
  openaiVisionModel: "gpt-5.5",
  openaiVisionTimeoutMs: 30000,
  release: "test",
  featureFlags: {
    metaPublishing: true,
    openaiVision: true,
    openaiImageGeneration: true
  }
});

describe("api bootstrap and tenancy", () => {
  it("bootstraps a local Supabase-shaped user and blocks cross-workspace jobs", async () => {
    const path = join(tmpdir(), `fbmaniaco-api-${Date.now()}.json`);
    const config = makeConfig(path);
    const store = new LocalDataStore(path);
    const app = await buildServer({ config, store });

    const first = await app.inject({
      method: "GET",
      url: "/auth/bootstrap-status",
      headers: { authorization: "Bearer dev:user-a:a@example.com" }
    });
    expect(first.statusCode).toBe(200);
    const workspaceId = first.json().workspace.id as string;

    const second = await app.inject({
      method: "GET",
      url: "/auth/bootstrap-status",
      headers: { authorization: "Bearer dev:user-b:b@example.com" }
    });
    expect(second.statusCode).toBe(200);

    const job = await store.createJob({
      type: "analyze_photo",
      workspaceId,
      dedupeKey: "cross-tenant",
      payload: { photoId: "photo-cross-tenant" }
    });

    const hidden = await app.inject({
      method: "GET",
      url: `/jobs/${job.id}`,
      headers: { authorization: "Bearer dev:user-b:b@example.com" }
    });
    expect(hidden.statusCode).toBe(404);

    await app.close();
    await rm(path, { force: true });
  });

  it("connects Meta with sanitized pages and protects page selection idempotency", async () => {
    const path = join(tmpdir(), `fbmaniaco-api-meta-${Date.now()}.json`);
    const config = makeConfig(path);
    const store = new LocalDataStore(path);
    const app = await buildServer({ config, store });
    const authorization = "Bearer dev:user-meta:meta@example.com";

    const connect = await app.inject({
      method: "POST",
      url: "/auth/meta/connect",
      headers: { authorization, "idempotency-key": "connect-meta-1" },
      payload: { flow: "oauth" }
    });
    expect(connect.statusCode).toBe(200);
    const serializedConnect = JSON.stringify(connect.json());
    expect(serializedConnect).not.toMatch(/pageAccessToken"\s*:/i);
    expect(serializedConnect).not.toMatch(/encrypted/i);
    const page = connect.json().pages.find((item: { canPublish: boolean }) => item.canPublish);

    const select = await app.inject({
      method: "POST",
      url: "/meta/pages/select",
      headers: { authorization, "idempotency-key": "select-page-1" },
      payload: { pageId: page.id }
    });
    expect(select.statusCode).toBe(200);
    expect(select.json().nextStep).toBe("home");

    const replay = await app.inject({
      method: "POST",
      url: "/meta/pages/select",
      headers: { authorization, "idempotency-key": "select-page-1" },
      payload: { pageId: page.id }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().business.id).toBe(select.json().business.id);

    const conflict = await app.inject({
      method: "POST",
      url: "/meta/pages/select",
      headers: { authorization, "idempotency-key": "select-page-1" },
      payload: { pageId: "different-page" }
    });
    expect(conflict.statusCode).toBe(409);

    await app.close();
    await rm(path, { force: true });
  });

  it("keeps real page import server-side and requires a configured test token", async () => {
    const path = join(tmpdir(), `fbmaniaco-api-real-page-${Date.now()}.json`);
    const config = makeConfig(path);
    const store = new LocalDataStore(path);
    const app = await buildServer({ config, store });

    const importPages = await app.inject({
      method: "POST",
      url: "/dev/meta/import-pages",
      headers: {
        authorization: "Bearer dev:user-real-page:real@example.com",
        "idempotency-key": "real-page-import-1"
      }
    });

    expect(importPages.statusCode).toBe(400);
    expect(importPages.json().code).toBe("meta_test_token_missing");
    expect(JSON.stringify(importPages.json())).not.toMatch(/access_token|META_TEST_USER_ACCESS_TOKEN/i);

    await app.close();
    await rm(path, { force: true });
  });

  it("completes OAuth callback through a graph-shaped provider", async () => {
    const path = join(tmpdir(), `fbmaniaco-api-callback-${Date.now()}.json`);
    const config = makeConfig(path);
    const store = new LocalDataStore(path);
    const fakeProvider: MetaProvider = {
      mode: "graph",
      buildAuthorizationUrl: ({ state }) => `https://facebook.example/oauth?state=${encodeURIComponent(state)}`,
      completeOAuth: async () => ({
        authorization: {
          status: "valid",
          grantedScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
          declinedScopes: [],
          missingRequiredScopes: [],
          grantedPageIds: ["real-page-1"],
          graphApiVersion: "v23.0",
          tokenStatus: "valido",
          appMode: "unknown",
          appReviewStatus: "unknown"
        },
        pages: [
          {
            metaPageId: "real-page-1",
            pageName: "Pagina Real Normalizada",
            coverPhotoUrl: null,
            category: "Restaurant",
            tasks: ["CREATE_CONTENT"],
            isGranted: true,
            canPublish: true,
            pageAccessTokenStatus: "valido",
            grantedScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
            declinedScopes: []
          }
        ]
      }),
      refreshAuthorization: async () => {
        throw new Error("not used");
      }
    };
    const app = await buildServer({ config, store, metaProvider: fakeProvider });
    const authorization = "Bearer dev:user-callback:callback@example.com";

    const connect = await app.inject({
      method: "POST",
      url: "/auth/meta/connect",
      headers: { authorization, "idempotency-key": "connect-real-1" },
      payload: { flow: "oauth" }
    });
    expect(connect.statusCode).toBe(200);
    const state = new URL(connect.json().authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "POST",
      url: "/auth/meta/callback",
      headers: { authorization, "idempotency-key": "callback-real-1" },
      payload: { code: "oauth-code", state }
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json().pages[0].pageName).toBe("Pagina Real Normalizada");
    expect(JSON.stringify(callback.json())).not.toMatch(/access_token|pageAccessToken"\s*:/i);

    await app.close();
    await rm(path, { force: true });
  });

  it("completes browser OAuth callback and redirects back to the mobile app", async () => {
    const path = join(tmpdir(), `fbmaniaco-api-browser-callback-${Date.now()}.json`);
    const config = makeConfig(path);
    const store = new LocalDataStore(path);
    const fakeProvider: MetaProvider = {
      mode: "graph",
      buildAuthorizationUrl: ({ state }) => {
        const url = new URL("https://www.facebook.com/dialog/oauth");
        url.searchParams.set("state", state);
        return url.toString();
      },
      completeOAuth: async () => ({
        authorization: {
          status: "valid",
          grantedScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
          declinedScopes: [],
          missingRequiredScopes: [],
          grantedPageIds: ["real-page-1"],
          graphApiVersion: "v23.0",
          tokenStatus: "valido",
          appMode: "unknown",
          appReviewStatus: "unknown"
        },
        pages: [
          {
            metaPageId: "real-page-1",
            pageName: "Pagina Real Normalizada",
            coverPhotoUrl: null,
            category: "Restaurant",
            tasks: ["CREATE_CONTENT"],
            isGranted: true,
            canPublish: true,
            pageAccessTokenStatus: "valido",
            grantedScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
            declinedScopes: []
          }
        ]
      }),
      refreshAuthorization: async () => {
        throw new Error("not used");
      }
    };
    const app = await buildServer({ config, store, metaProvider: fakeProvider });
    const authorization = "Bearer dev:user-browser-callback:callback@example.com";

    const connect = await app.inject({
      method: "POST",
      url: "/auth/meta/connect",
      headers: { authorization, "idempotency-key": "browser-callback-connect-1" },
      payload: { flow: "oauth" }
    });
    expect(connect.statusCode).toBe(200);
    const authorizationUrl = new URL(connect.json().authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "GET",
      url: `/auth/meta/callback?code=oauth-code&state=${encodeURIComponent(state ?? "")}`
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("fbmaniaco://meta-connected?status=success");
    expect((await store.listMetaPages(JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf8")).workspaceId))[0]?.pageName).toBe(
      "Pagina Real Normalizada"
    );

    await app.close();
    await rm(path, { force: true });
  });

  it("creates a batch while API upload requires real storage", async () => {
    const path = join(tmpdir(), `fbmaniaco-api-batch-${Date.now()}.json`);
    const config = makeConfig(path);
    const store = new LocalDataStore(path);
    const app = await buildServer({ config, store });
    const authorization = "Bearer dev:user-batch:batch@example.com";

    const connect = await app.inject({
      method: "POST",
      url: "/auth/meta/connect",
      headers: { authorization, "idempotency-key": "batch-connect-1" },
      payload: { flow: "oauth" }
    });
    const page = connect.json().pages.find((item: { canPublish: boolean }) => item.canPublish);
    const select = await app.inject({
      method: "POST",
      url: "/meta/pages/select",
      headers: { authorization, "idempotency-key": "batch-select-1" },
      payload: { pageId: page.id }
    });
    const businessId = select.json().business.id as string;

    const businessDetail = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}`,
      headers: { authorization }
    });
    expect(businessDetail.statusCode).toBe(200);
    expect(businessDetail.json().business.id).toBe(businessId);

    const createBatch = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches`,
      headers: { authorization, "idempotency-key": "create-batch-1" }
    });
    expect(createBatch.statusCode).toBe(200);
    const batchId = createBatch.json().batch.id as string;

    const uploadIntent = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/photos/upload-intent`,
      headers: { authorization, "idempotency-key": "upload-intent-1" },
      payload: { originalFileName: "plato.jpg", contentType: "image/jpeg", fileSize: 1234 }
    });
    expect(uploadIntent.statusCode).toBe(409);
    expect(uploadIntent.json().code).toBe("real_storage_required");
    const storeIntent = await store.createUploadIntent({
      workspaceId: (await store.listMemberships("user-batch"))[0]!.workspace.id,
      businessId,
      batchId,
      originalFileName: "plato.jpg",
      contentType: "image/jpeg",
      fileSize: 1234
    });

    const complete = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/photos/complete-upload`,
      headers: { authorization, "idempotency-key": "complete-upload-1" },
      payload: {
        storageKey: storeIntent.storageKey,
        originalFileName: "plato.jpg",
        contentType: "image/jpeg",
        fileSize: 1234,
        checksum: "sha256-test"
      }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().photo.status).toBe("analyzing");
    expect(complete.json().job.type).toBe("analyze_photo");
    expect(JSON.stringify(complete.json())).not.toMatch(/imageDataUrl|access_token|pageAccessToken/i);

    await store.completeAnalyzePhoto({
      photoId: complete.json().photo.id,
      jobId: complete.json().job.id,
      analysis: {
        schemaVersion: "vision_analysis.v1",
        promptVersion: "test",
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
      }
    });
    const detail = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}/batches/${batchId}`,
      headers: { authorization }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().photos[0].status).toBe("validada");
    expect(detail.json().photos[0].thumbnailUrl).toMatch(/\/media\/assets\/.+\/preview\?/);

    const preview = await app.inject({
      method: "GET",
      url: new URL(detail.json().photos[0].thumbnailUrl).pathname + new URL(detail.json().photos[0].thumbnailUrl).search
    });
    expect(preview.statusCode).toBe(409);
    expect(preview.json().code).toBe("real_media_required");

    const generate = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/generate`,
      headers: { authorization, "idempotency-key": "generate-batch-1" },
      payload: {
        variantsPerPhoto: 1,
        styleOverrides: [{ photoId: detail.json().photos[0].id, styleId: "playa", styleName: "Playa", intensity: 90 }]
      }
    });
    expect(generate.statusCode).toBe(200);
    expect(generate.json().created).toBe(1);
    expect(generate.json().job.type).toBe("generate_batch");
    const workspaceId = (await store.listMemberships("user-batch"))[0]?.workspace.id;
    if (!workspaceId) throw new Error("Missing test workspace");
    const variantJob = (await store.listJobs(workspaceId)).find((job) => job.type === "generate_variant");
    if (!variantJob?.variantId) throw new Error("Missing generate_variant job");
    await store.completeGenerateVariant({
      jobId: variantJob.id,
      variantId: variantJob.variantId,
      generatedAsset: {
        bucket: "business-media",
        storageKey: `${workspaceId}/${businessId}/${batchId}/generated/${variantJob.variantId}.jpg`,
        mimeType: "image/jpeg",
        fileSize: 16
      }
    });

    const variants = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}/batches/${batchId}/variants`,
      headers: { authorization }
    });
    expect(variants.statusCode).toBe(200);
    expect(variants.json().variants[0].status).toBe("generada");
    expect(variants.json().variants[0].assignedStyle.styleName).toBe("Playa");
    expect(variants.json().variants[0].assignedStyle.manualOverride).toBe(true);
    expect(variants.json().variants[0].imageUrl).toMatch(/\/media\/assets\/.+\/preview\?/);

    const caption = await app.inject({
      method: "PATCH",
      url: `/businesses/${businessId}/batches/${batchId}/variants/${variants.json().variants[0].id}/caption`,
      headers: { authorization, "idempotency-key": "caption-edit-1" },
      payload: { caption: "Caption revisado por el usuario." }
    });
    expect(caption.statusCode).toBe(200);
    expect(caption.json().variant.caption).toBe("Caption revisado por el usuario.");

    const approve = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/variants/${variants.json().variants[0].id}/approve`,
      headers: { authorization, "idempotency-key": "approve-variant-1" }
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().variant.status).toBe("aprobada");

    const calendar = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/calendar/confirm`,
      headers: { authorization, "idempotency-key": "calendar-confirm-1" },
      payload: { periodDays: 7 }
    });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json().scheduledPosts[0].status).toBe("programada");

    const scheduled = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}/scheduled-posts`,
      headers: { authorization }
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().scheduledPosts).toHaveLength(1);

    const publishNow = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduled.json().scheduledPosts[0].id}/publish`,
      headers: { authorization, "idempotency-key": "publish-now-1" }
    });
    expect(publishNow.statusCode).toBe(200);
    expect(publishNow.json().job.type).toBe("publish_post");
    await store.publishScheduledPost({
      jobId: publishNow.json().job.id,
      scheduledPostId: publishNow.json().scheduledPost.id,
      publishNow: true
    });

    const afterPublish = await app.inject({
      method: "GET",
      url: `/businesses/${businessId}/scheduled-posts`,
      headers: { authorization }
    });
    expect(afterPublish.json().scheduledPosts[0].status).toBe("publicada");
    expect(afterPublish.json().scheduledPosts[0].facebookPostId).toBeTruthy();

    const replay = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/photos/complete-upload`,
      headers: { authorization, "idempotency-key": "complete-upload-1" },
      payload: {
        storageKey: storeIntent.storageKey,
        originalFileName: "plato.jpg",
        contentType: "image/jpeg",
        fileSize: 1234,
        checksum: "sha256-test"
      }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().photo.id).toBe(complete.json().photo.id);

    const invalidMime = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/batches/${batchId}/photos/upload-intent`,
      headers: { authorization, "idempotency-key": "upload-intent-invalid-1" },
      payload: { originalFileName: "mismatch.png", contentType: "image/jpeg", fileSize: 1234 }
    });
    expect(invalidMime.statusCode).toBe(415);

    await app.close();
    await rm(path, { force: true });
  });
});

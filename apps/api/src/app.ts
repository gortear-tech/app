import fastify from "fastify";
import cors from "@fastify/cors";
import {
  AppError,
  type CompletePhotoUploadRequest,
  type CreateBusinessRequest,
  type CreateVisualStyleRequest,
  type PreparePhotoUploadRequest,
  type UpdateBusinessRequest,
  type UpdateScheduledPostRequest,
  type UpdateVisualStyleRequest,
} from "@fbmaniaco/shared";
import { config } from "./config";
import { createRuntime } from "./runtime";

export function buildApp() {
  const app = fastify({ logger: true, bodyLimit: Math.max(1, config.maxUploadBodyMb) * 1024 * 1024 });
  const runtime = createRuntime();

  app.register(cors, { origin: true });
  app.addHook("preHandler", async () => {
    await runtime.ready;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        userMessage: error.userMessage,
        details: error.details ?? null,
      });
      return;
    }
    const parserError = error as Error & { code?: string; statusCode?: number };
    if (parserError.code === "FST_ERR_CTP_BODY_TOO_LARGE" || parserError.statusCode === 413) {
      reply.status(413).send({
        code: "payload_too_large",
        message: parserError.message,
        userMessage: "La foto es demasiado pesada. Intenta con una imagen mas ligera o baja la calidad antes de subirla.",
      });
      return;
    }
    app.log.error(error);
    reply.status(500).send({
      code: "internal_error",
      message: error instanceof Error ? error.message : "Internal error",
      userMessage: "Ocurrio un error inesperado.",
    });
  });

  app.get("/health", async () => ({ ok: true as const }));

  app.get("/auth/bootstrap-status", async () => runtime.bootstrapStatus());

  app.post("/auth/meta-token", async (request) => runtime.connectMetaToken(request.body as { token: string; source: "auto" | "manual" | "refresh" }));

  app.post("/auth/meta-token/auto", async (request) => {
    void request.body;
    return runtime.autoConnectMeta();
  });

  app.post("/auth/logout", async () => {
    return { ok: true, message: "Signed out locally" };
  });

  app.get("/meta/pages", async () => runtime.listPages());

  app.post("/meta/pages/select", async (request) => {
    const { pageId } = request.body as { pageId: string };
    const business = await runtime.selectPage(pageId);
    return {
      business,
      status: runtime.bootstrapStatus(),
    };
  });

  app.get("/me", async () => {
    const session = runtime.getOwnerSession();
    return {
      user: {
        id: "owner",
        email: "owner@fbmaniaco.local",
        status: "activo",
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      },
      session,
    };
  });

  app.get("/styles", async () => runtime.listStyles());

  app.post("/styles", async (request) => runtime.createStyle(request.body as CreateVisualStyleRequest));

  app.patch("/styles/:styleId", async (request) => {
    const { styleId } = request.params as { styleId: string };
    return runtime.updateStyle(styleId, request.body as UpdateVisualStyleRequest);
  });

  app.delete("/styles/:styleId", async (request) => {
    const { styleId } = request.params as { styleId: string };
    return runtime.deleteStyle(styleId);
  });

  app.get("/businesses", async () => runtime.listBusinesses());

  app.post("/businesses", async (request) => {
    const body = request.body as CreateBusinessRequest & { pageId?: string };
    if (body.pageId) {
      return runtime.selectPage(body.pageId);
    }
    const selected = runtime.getSelectedBusiness();
    if (selected) {
      return selected;
    }
    throw new AppError({
      code: "page_selection_required",
      statusCode: 400,
      message: "Page selection required",
      userMessage: "Selecciona una pagina antes de crear el negocio.",
    });
  });

  app.get("/businesses/:businessId", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.getBusiness(businessId);
  });

  app.patch("/businesses/:businessId", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.updateBusiness(businessId, request.body as UpdateBusinessRequest);
  });

  app.get("/businesses/:businessId/dashboard", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.getDashboard(businessId);
  });

  app.post("/businesses/:businessId/batches", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.createBatch(businessId);
  });

  app.post("/businesses/:businessId/batches/:batchId/cancel", async (request) => {
    const { batchId } = request.params as { batchId: string };
    void request.body;
    return runtime.cancelBatch(batchId);
  });

  app.get("/businesses/:businessId/batches", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.listBatches(businessId);
  });

  app.get("/businesses/:businessId/batches/active", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.getActiveBatch(businessId);
  });

  app.get("/businesses/:businessId/batches/:batchId", async (request) => {
    const { batchId } = request.params as { batchId: string };
    return runtime.getBatchDetail(batchId);
  });

  app.post("/businesses/:businessId/batches/:batchId/photos/upload-intent", async (request) => {
    const { batchId } = request.params as { batchId: string };
    return runtime.createUploadIntent(batchId, request.body as PreparePhotoUploadRequest);
  });

  app.post("/businesses/:businessId/batches/:batchId/photos/complete-upload", async (request) => {
    const { batchId } = request.params as { batchId: string };
    return runtime.completeUpload(batchId, request.body as CompletePhotoUploadRequest);
  });

  app.post("/businesses/:businessId/batches/:batchId/estimate-cost", async (request) => {
    const { batchId } = request.params as { batchId: string };
    const { variantsPerPhoto } = request.body as { variantsPerPhoto: number };
    return runtime.estimateCost(batchId, variantsPerPhoto);
  });

  app.post("/businesses/:businessId/batches/:batchId/confirm-cost", async (request) => {
    const { batchId } = request.params as { batchId: string };
    return runtime.confirmCost(batchId);
  });

  app.post("/businesses/:businessId/batches/:batchId/generate", async (request) => {
    const { batchId } = request.params as { batchId: string };
    const { variantsPerPhoto } = request.body as { variantsPerPhoto: number };
    return runtime.generateVariants(batchId, variantsPerPhoto);
  });

  app.get("/businesses/:businessId/batches/:batchId/variants", async (request) => {
    const { batchId } = request.params as { batchId: string };
    return runtime.listVariants(batchId);
  });

  app.post("/businesses/:businessId/batches/:batchId/variants/reopen-approval", async (request) => {
    const { batchId } = request.params as { batchId: string };
    void request.body;
    return runtime.reopenVariantApproval(batchId);
  });

  app.patch("/businesses/:businessId/batches/:batchId/variants/:variantId/caption", async (request) => {
    const { batchId, variantId } = request.params as { batchId: string; variantId: string };
    return runtime.updateVariantCaption(batchId, variantId, request.body as { caption: string });
  });

  app.post("/businesses/:businessId/batches/:batchId/variants/:variantId/approve", async (request) => {
    const { batchId, variantId } = request.params as { batchId: string; variantId: string };
    return runtime.approveVariant(batchId, variantId);
  });

  app.post("/businesses/:businessId/batches/:batchId/variants/:variantId/reject", async (request) => {
    const { batchId, variantId } = request.params as { batchId: string; variantId: string };
    return runtime.rejectVariant(batchId, variantId);
  });

  app.post("/businesses/:businessId/batches/:batchId/calendar/confirm", async (request) => {
    const { batchId } = request.params as { batchId: string };
    const { periodDays } = request.body as { periodDays: 7 | 14 | 30 };
    return runtime.confirmCalendar(batchId, periodDays);
  });

  app.get("/businesses/:businessId/scheduled-posts", async (request) => {
    const { businessId } = request.params as { businessId: string };
    return runtime.listScheduledPostsByBusiness(businessId);
  });

  app.get("/businesses/:businessId/batches/:batchId/scheduled-posts", async (request) => {
    const { batchId } = request.params as { batchId: string };
    return runtime.listScheduledPosts(batchId);
  });

  app.patch("/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId", async (request) => {
    const { batchId, scheduledPostId } = request.params as { batchId: string; scheduledPostId: string };
    return runtime.updateScheduledPost(batchId, scheduledPostId, request.body as UpdateScheduledPostRequest);
  });

  app.post("/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/cancel", async (request) => {
    const { batchId, scheduledPostId } = request.params as { batchId: string; scheduledPostId: string };
    return runtime.cancelScheduledPost(batchId, scheduledPostId);
  });

  app.post("/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/publish", async (request) => {
    const { batchId, scheduledPostId } = request.params as { batchId: string; scheduledPostId: string };
    return runtime.publishScheduledPost(batchId, scheduledPostId);
  });

  app.post("/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/retry", async (request) => {
    const { batchId, scheduledPostId } = request.params as { batchId: string; scheduledPostId: string };
    return runtime.retryScheduledPost(batchId, scheduledPostId);
  });

  return app;
}

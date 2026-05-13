import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createBillingProvider, createMetaProvider, loadMetaPagesFromUserAccessToken, MetaProvider } from "@fbmaniaco/providers";
import {
  AppError,
  AppErrorResponseSchema,
  AiEvaluationsResponseSchema,
  BatchCaptionEvalBodySchema,
  BatchCaptionEvalResponseSchema,
  BillingWebhookBodySchema,
  BillingWebhookResponseSchema,
  BootstrapStatusSchema,
  BatchDetailSchema,
  BatchesResponseSchema,
  BusinessesResponseSchema,
  BusinessDetailResponseSchema,
  BusinessMutationResponseSchema,
  CompleteUploadBodySchema,
  CompleteUploadResponseSchema,
  CollectMetricsBodySchema,
  ConfirmCostBodySchema,
  ConfirmCostResponseSchema,
  ConfirmCalendarBodySchema,
  ConfirmCalendarResponseSchema,
  CreateBatchResponseSchema,
  EstimateCostBodySchema,
  EstimateCostResponseSchema,
  HealthSchema,
  JobSummarySchema,
  GenerateBatchBodySchema,
  GenerateBatchResponseSchema,
  GenerateWeeklyReportBodySchema,
  MetaConnectResponseSchema,
  MetaPagesResponseSchema,
  MetricsCollectResponseSchema,
  PLAN_ENTITLEMENTS,
  PerformanceResponseSchema,
  PlansResponseSchema,
  ReadySchema,
  SelectPageBodySchema,
  SelectPageResponseSchema,
  ScheduledPostMutationResponseSchema,
  ScheduledPostsResponseSchema,
  UpdateCaptionBodySchema,
  UpdateBusinessBodySchema,
  UpgradeIntentBodySchema,
  UpgradeIntentResponseSchema,
  UpdateScheduledPostBodySchema,
  UploadIntentBodySchema,
  UploadIntentResponseSchema,
  VariantMutationResponseSchema,
  VariantsResponseSchema,
  WeeklyReportGenerateResponseSchema,
  WeeklyReportResponseSchema,
  WorkspaceRole
} from "@fbmaniaco/shared";
import { ApiConfig, readinessFromConfig } from "./config.js";
import { authenticateBearer } from "./auth.js";
import { DataStore } from "./db/index.js";
import { getRequestId } from "./request-id.js";

export const buildServer = async (input: { config: ApiConfig; store: DataStore; metaProvider?: MetaProvider }): Promise<FastifyInstance> => {
  const metaProvider =
    input.metaProvider ??
    createMetaProvider({
      appId: input.config.metaAppId,
      appSecret: input.config.metaAppSecret,
      redirectUri: input.config.metaRedirectUri,
      graphApiVersion: input.config.metaGraphApiVersion,
      requiredScopes: input.config.metaRequiredScopes
    });
  const storageClient =
    input.config.supabaseUrl && input.config.supabaseServiceRole
      ? createClient(input.config.supabaseUrl, input.config.supabaseServiceRole, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : null;
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.apikey"]
    }
  });

  await app.register(cors, { origin: input.config.corsOrigin });
  await app.register(swagger, {
    openapi: {
      info: { title: "FBmaniaco API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" }
        }
      }
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestId = getRequestId(request.headers["x-request-id"]);
    request.headers["x-request-id"] = requestId;
    reply.header("x-request-id", requestId);
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.headers["x-request-id"]);
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        userMessage: error.userMessage,
        retryable: error.retryable,
        action: error.action,
        requestId,
        details: error.details
      });
    }
    const clientError = error as { statusCode?: unknown; message?: unknown };
    if (typeof clientError.statusCode === "number" && clientError.statusCode >= 400 && clientError.statusCode < 500) {
      return reply.status(clientError.statusCode).send({
        code: "bad_request",
        message: typeof clientError.message === "string" ? clientError.message : "Bad request",
        userMessage: "La solicitud no viene completa. Refresca e intenta de nuevo.",
        retryable: false,
        action: "refresh",
        requestId
      });
    }
    request.log.error({ err: error, requestId }, "Unhandled API error");
    return reply.status(500).send({
      code: "internal_error",
      message: "Internal server error",
      userMessage: "Algo fallo en el servidor. Intenta de nuevo.",
      retryable: true,
      action: "retry",
      requestId
    });
  });

  const buildBootstrap = async (actor: { userId: string }, user: Awaited<ReturnType<DataStore["upsertLocalUser"]>>, requestId: string) => {
    const { workspace, membership } = await input.store.ensureDefaultWorkspace(actor.userId);
    const context = await input.store.getBootstrapContext(actor.userId);
    const nextStep =
      context.metaAuthorizationStatus === "expired" || context.facebookTokenStatus === "expirado"
        ? "recover_meta"
        : context.metaAuthorizationStatus === "none"
          ? "connect_meta"
          : context.selectedBusinessId
            ? "home"
            : "select_page";
    return {
      schemaVersion: "bootstrap.v1" as const,
      authenticated: true,
      nextStep,
      user,
      workspace,
      membership,
      selectedBusinessId: context.selectedBusinessId,
      selectedPageId: context.selectedPageId,
      facebookTokenStatus: context.facebookTokenStatus,
      canStartMetaAuthorization: true,
      requiresManualToken: input.config.appEnv !== "production" && input.config.localAuthEnabled,
      grantedScopes: context.grantedScopes,
      declinedScopes: context.declinedScopes,
      missingRequiredScopes: context.missingRequiredScopes,
      metaAuthorizationStatus: context.metaAuthorizationStatus,
      appReviewStatus: input.config.appEnv === "production" ? ("unknown" as const) : ("development" as const),
      graphApiVersion: context.graphApiVersion,
      requestId
    };
  };

  const authenticateRequest = async (request: FastifyRequest) => {
    return authenticateBearer({
      authorization: request.headers.authorization,
      config: input.config,
      store: input.store
    });
  };

  const requestHash = (body: unknown) => createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
  const mediaToken = (assetId: string, expires: number) =>
    createHash("sha256").update(`${assetId}:${expires}:fbmaniaco-local-media-preview`).digest("hex");
  const requireStorageClient = () => {
    if (!storageClient) {
      throw new AppError({
        code: "storage_not_configured",
        statusCode: 500,
        message: "Supabase Storage is not configured",
        userMessage: "El servidor no tiene almacenamiento real configurado.",
        retryable: false,
        action: "contact_support"
      });
    }
    return storageClient;
  };
  const previewUrl = (request: FastifyRequest, assetId: string | null | undefined) => {
    if (!assetId) return null;
    const expires = Math.floor(Date.now() / 1000) + 15 * 60;
    const protocol = request.protocol;
    const host = request.headers.host ?? "localhost";
    return `${protocol}://${host}/media/assets/${assetId}/preview?expires=${expires}&token=${mediaToken(assetId, expires)}`;
  };
  const withPhotoUrls = (request: FastifyRequest, photos: NonNullable<Awaited<ReturnType<DataStore["getBatchDetail"]>>>["photos"]) =>
    photos.map((photo) => ({
      ...photo,
      mediaUrl: previewUrl(request, photo.originalAssetId ?? null),
      thumbnailUrl: previewUrl(request, photo.thumbnailAssetId ?? photo.originalAssetId ?? null)
    }));
  const withVariantUrls = (
    request: FastifyRequest,
    variants: NonNullable<Awaited<ReturnType<DataStore["getBatchDetail"]>>>["variants"]
  ) =>
    variants.map((variant) => ({
      ...variant,
      imageUrl: previewUrl(request, variant.publishableAssetId ?? variant.generatedAssetId ?? null)
    }));

  const runIdempotent = async <T>(params: {
    request: FastifyRequest;
    workspaceId: string;
    actorId: string;
    routeKey: string;
    handler: () => Promise<T>;
  }): Promise<T> => {
    const key = params.request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8) {
      throw new AppError({
        code: "missing_idempotency_key",
        statusCode: 400,
        message: "Mutation requires Idempotency-Key",
        userMessage: "Intenta de nuevo. La app necesita una clave de seguridad para no duplicar acciones.",
        retryable: false,
        action: "none"
      });
    }
    const hash = requestHash(params.request.body);
    const existing = await input.store.getIdempotencyRecord({
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      method: params.request.method,
      routeKey: params.routeKey,
      idempotencyKey: key
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new AppError({
          code: "idempotency_conflict",
          statusCode: 409,
          message: "Idempotency key reused with different body",
          userMessage: "Esa accion ya se intento con otros datos. Refresca y vuelve a intentar.",
          retryable: false,
          action: "none"
        });
      }
      return existing.response as T;
    }
    const response = await params.handler();
    await input.store.saveIdempotencyRecord({
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      method: params.request.method,
      routeKey: params.routeKey,
      idempotencyKey: key,
      requestHash: hash,
      response
    });
    return response;
  };

  const requireBusinessAccess = async (params: {
    actorId: string;
    businessId: string;
    allowedRoles: WorkspaceRole[];
  }) => {
    const memberships = await input.store.listMemberships(params.actorId);
    for (const { workspace } of memberships) {
      const business = await input.store.getBusiness({ workspaceId: workspace.id, businessId: params.businessId });
      if (!business) continue;
      await input.store.assertWorkspaceRole({
        userId: params.actorId,
        workspaceId: workspace.id,
        allowedRoles: params.allowedRoles
      });
      return { workspace, business };
    }
    throw new AppError({
      code: "business_not_found",
      statusCode: 404,
      message: "Business not found in actor workspaces",
      userMessage: "No encontramos ese negocio en tu workspace.",
      retryable: false,
      action: "refresh"
    });
  };

  const syncMetaTestPages = async (workspaceId: string, actorId: string) => {
    if (input.config.appEnv === "production" || !input.config.metaTestUserAccessToken) return;
    const result = await loadMetaPagesFromUserAccessToken(
      {
        appId: input.config.metaAppId,
        appSecret: input.config.metaAppSecret,
        redirectUri: input.config.metaRedirectUri,
        graphApiVersion: input.config.metaGraphApiVersion,
        requiredScopes: input.config.metaRequiredScopes
      },
      input.config.metaTestUserAccessToken
    );
    await input.store.upsertMetaAuthorization({
      workspaceId,
      actorId,
      authorization: result.authorization,
      pages: result.pages
    });
  };

  const jobSummary = (job: Awaited<ReturnType<DataStore["createJob"]>>) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    workspaceId: job.workspaceId,
    progress: job.status === "succeeded" ? 100 : job.status === "running" ? 50 : 0,
    userMessage:
      job.type === "analyze_photo"
        ? job.status === "succeeded"
          ? "Foto validada."
          : "Analizando foto."
        : job.type === "generate_batch"
          ? job.status === "succeeded"
            ? "Generacion coordinada."
            : "Preparando variantes."
          : job.type === "generate_variant"
            ? job.status === "succeeded"
              ? "Variante generada."
              : "Generando variante."
            : job.type === "schedule_posts"
              ? job.status === "succeeded"
                ? "Calendario listo."
                : "Programando publicaciones."
              : job.type === "publish_post"
                ? job.status === "succeeded"
              ? "Publicacion enviada."
              : "Publicando en Facebook."
              : job.type === "collect_metrics"
                ? job.status === "succeeded"
                  ? "Metricas recolectadas."
                  : "Recolectando metricas."
              : job.type === "weekly_report"
                  ? job.status === "succeeded"
                    ? "Reporte semanal listo."
                    : "Generando reporte semanal."
                  : job.type === "batch_caption_eval"
                    ? job.status === "succeeded"
                      ? "Evaluacion de captions lista."
                      : "Evaluando captions en segundo plano."
                  : job.status === "succeeded"
                    ? "Trabajo completado."
                    : "Trabajo en proceso.",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: HealthSchema
        }
      }
    },
    async () => ({ ok: true, service: "api", environment: input.config.appEnv, release: input.config.release })
  );

  app.get(
    "/ready",
    {
      schema: {
        response: {
          200: ReadySchema,
          503: ReadySchema
        }
      }
    },
    async (_request, reply) => {
      const configChecks = readinessFromConfig(input.config);
      const db = await input.store.ready();
      const heartbeat = await input.store.getLatestWorkerHeartbeat();
      const workerFresh =
        !input.config.requireWorkerHeartbeat ||
        Boolean(heartbeat && Date.now() - new Date(heartbeat.lastBeatAt).getTime() <= input.config.workerHeartbeatMaxAgeMs);
      const checks = { ...configChecks, db: configChecks.db && db.ok, queue: configChecks.queue, worker: workerFresh };
      const ok = Object.values(checks).every(Boolean);
      return reply.status(ok ? 200 : 503).send({ ok, checks });
    }
  );

  app.get("/openapi.json", async (_request, reply) => {
    return reply.send(app.swagger());
  });

  app.get(
    "/media/assets/:assetId/preview",
    {
      schema: {
        params: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string" } }
        },
        querystring: {
          type: "object",
          required: ["expires", "token"],
          properties: {
            expires: { type: "string" },
            token: { type: "string" }
          }
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { assetId: string };
      const query = request.query as { expires: string; token: string };
      const expires = Number(query.expires);
      if (
        !Number.isFinite(expires) ||
        expires < Math.floor(Date.now() / 1000) ||
        query.token !== mediaToken(params.assetId, expires)
      ) {
        throw new AppError({
          code: "media_url_expired",
          statusCode: 403,
          message: "Media preview URL is expired or invalid",
          userMessage: "La vista previa de la imagen expiro. Refresca el lote.",
          retryable: false,
          action: "refresh"
        });
      }
      const asset = await input.store.getMediaAsset({ assetId: params.assetId });
      if (!asset) {
        throw new AppError({
          code: "media_not_found",
          statusCode: 404,
          message: "Media preview not found",
          userMessage: "No encontramos la vista previa de esa imagen.",
          retryable: false,
          action: "refresh"
        });
      }
      if (input.config.dataStoreMode !== "supabase") {
        throw new AppError({
          code: "real_media_required",
          statusCode: 409,
          message: "Media preview requires Supabase Storage",
          userMessage: "La vista previa necesita almacenamiento real.",
          retryable: false,
          action: "contact_support"
        });
      }
      const { data, error } = await requireStorageClient()
        .storage
        .from(asset.bucket)
        .createSignedUrl(asset.storageKey, 60 * 15);
      if (error || !data?.signedUrl) {
        throw new AppError({
          code: "media_signed_url_failed",
          statusCode: 502,
          message: error?.message ?? "Could not create media signed URL",
          userMessage: "No pudimos abrir la imagen real. Refresca e intenta de nuevo.",
          retryable: true,
          action: "retry"
        });
      }
      return reply.redirect(data.signedUrl);
    }
  );

  app.get(
    "/auth/bootstrap-status",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: {
          200: BootstrapStatusSchema,
          401: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { actor, user } = await authenticateRequest(request);
      return buildBootstrap(actor, user, requestId);
    }
  );

  app.post(
    "/auth/meta/connect",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            flow: { type: "string", enum: ["oauth", "facebook_login", "device_login"] }
          },
          additionalProperties: false
        },
        response: {
          200: MetaConnectResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { actor, user } = await authenticateRequest(request);
      const { workspace } = await input.store.ensureDefaultWorkspace(actor.userId);
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/auth/meta/connect",
        handler: async () => {
          await input.store.assertWorkspaceRole({
            userId: actor.userId,
            workspaceId: workspace.id,
            allowedRoles: ["owner", "admin"]
          });
          const state = Buffer.from(
            JSON.stringify({ workspaceId: workspace.id, actorId: actor.userId, requestId }),
            "utf8"
          ).toString("base64url");
          const shouldCompleteServerSide =
            input.config.appEnv !== "production" && (Boolean(input.config.metaTestUserAccessToken) || metaProvider.mode === "mock");
          const authorizationUrl = shouldCompleteServerSide ? undefined : metaProvider.buildAuthorizationUrl({ state });
          if (input.config.appEnv !== "production" && input.config.metaTestUserAccessToken) {
            await syncMetaTestPages(workspace.id, actor.userId);
          } else if (metaProvider.mode === "mock") {
            const result = await metaProvider.completeOAuth({ code: "mock", state });
            await input.store.upsertMetaAuthorization({
              workspaceId: workspace.id,
              actorId: actor.userId,
              authorization: result.authorization,
              pages: result.pages
            });
          }
          const pages = await input.store.listMetaPages(workspace.id);
          const bootstrap = await buildBootstrap(actor, user, requestId);
          return {
            schemaVersion: "meta_connect.v1" as const,
            bootstrap,
            pages,
            authorizationUrl,
            requestId
          };
        }
      });
    }
  );

  app.get(
    "/auth/meta/callback",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["code", "state"],
          properties: {
            code: { type: "string" },
            state: { type: "string" }
          },
          additionalProperties: true
        },
        response: {
          400: AppErrorResponseSchema,
          403: AppErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const query = request.query as { code: string; state: string };
      const decodedState = JSON.parse(Buffer.from(query.state, "base64url").toString("utf8")) as {
        workspaceId: string;
        actorId: string;
      };
      await input.store.assertWorkspaceRole({
        userId: decodedState.actorId,
        workspaceId: decodedState.workspaceId,
        allowedRoles: ["owner", "admin"]
      });
      const result = await metaProvider.completeOAuth({ code: query.code, state: query.state });
      await input.store.upsertMetaAuthorization({
        workspaceId: decodedState.workspaceId,
        actorId: decodedState.actorId,
        authorization: result.authorization,
        pages: result.pages
      });
      return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Facebook conectado</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #0f1217; color: #f8fafc; }
      main { max-width: 480px; padding: 32px; }
      h1 { font-size: 28px; margin: 0 0 12px; }
      p { color: #aeb7c2; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Facebook quedó conectado</h1>
      <p>Vuelve a FBmaniaco y actualiza la pantalla para elegir tu página.</p>
    </main>
  </body>
</html>`);
    }
  );

  app.post(
    "/auth/meta/callback",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["code", "state"],
          properties: {
            code: { type: "string" },
            state: { type: "string" }
          },
          additionalProperties: false
        },
        response: {
          200: MetaConnectResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const body = request.body as { code: string; state: string };
      const { actor, user } = await authenticateRequest(request);
      const decodedState = JSON.parse(Buffer.from(body.state, "base64url").toString("utf8")) as {
        workspaceId: string;
        actorId: string;
      };
      if (decodedState.actorId !== actor.userId) {
        throw new AppError({
          code: "invalid_meta_state",
          statusCode: 403,
          message: "Meta OAuth state does not match actor",
          userMessage: "La autorizacion de Facebook no coincide con tu sesion. Intenta reconectar.",
          retryable: false,
          action: "reconnect"
        });
      }
      await input.store.assertWorkspaceRole({
        userId: actor.userId,
        workspaceId: decodedState.workspaceId,
        allowedRoles: ["owner", "admin"]
      });
      return runIdempotent({
        request,
        workspaceId: decodedState.workspaceId,
        actorId: actor.userId,
        routeKey: "/auth/meta/callback",
        handler: async () => {
          const result = await metaProvider.completeOAuth({ code: body.code, state: body.state });
          await input.store.upsertMetaAuthorization({
            workspaceId: decodedState.workspaceId,
            actorId: actor.userId,
            authorization: result.authorization,
            pages: result.pages
          });
          return {
            schemaVersion: "meta_connect.v1" as const,
            bootstrap: await buildBootstrap(actor, user, requestId),
            pages: await input.store.listMetaPages(decodedState.workspaceId),
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/auth/meta/refresh",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: { 200: MetaConnectResponseSchema, 401: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { actor, user } = await authenticateRequest(request);
      const { workspace } = await input.store.ensureDefaultWorkspace(actor.userId);
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/auth/meta/refresh",
        handler: async () => {
          const result = await metaProvider.refreshAuthorization();
          await input.store.upsertMetaAuthorization({
            workspaceId: workspace.id,
            actorId: actor.userId,
            authorization: result.authorization,
            pages: result.pages
          });
          return {
            schemaVersion: "meta_connect.v1" as const,
            bootstrap: await buildBootstrap(actor, user, requestId),
            pages: await input.store.listMetaPages(workspace.id),
            requestId
          };
        }
      });
    }
  );

  app.get(
    "/meta/pages",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: { 200: MetaPagesResponseSchema, 401: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { actor } = await authenticateRequest(request);
      const memberships = await input.store.listMemberships(actor.userId);
      const workspace = memberships[0]?.workspace;
      if (!workspace) throw new AppError({
        code: "workspace_not_found",
        statusCode: 404,
        message: "Workspace not found",
        userMessage: "No encontramos tu workspace.",
        retryable: false,
        action: "refresh"
      });
      await syncMetaTestPages(workspace.id, actor.userId);
      return {
        schemaVersion: "meta_pages.v1" as const,
        pages: await input.store.listMetaPages(workspace.id),
        requestId
      };
    }
  );

  app.post(
    "/dev/meta/import-pages",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: {
          200: MetaConnectResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      if (input.config.appEnv === "production" || !input.config.localAuthEnabled) {
        throw new AppError({
          code: "dev_endpoint_disabled",
          statusCode: 403,
          message: "Development Meta import endpoint is disabled",
          userMessage: "Esta accion solo esta disponible en pruebas locales.",
          retryable: false,
          action: "none"
        });
      }
      if (!input.config.metaTestUserAccessToken) {
        throw new AppError({
          code: "meta_test_token_missing",
          statusCode: 400,
          message: "Meta test token is required",
          userMessage: "Falta poner el token de prueba de Meta en el servidor.",
          retryable: false,
          action: "contact_support"
        });
      }

      const { actor, user } = await authenticateRequest(request);
      const { workspace } = await input.store.ensureDefaultWorkspace(actor.userId);
      await input.store.assertWorkspaceRole({
        userId: actor.userId,
        workspaceId: workspace.id,
        allowedRoles: ["owner", "admin"]
      });

      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/dev/meta/import-pages",
        handler: async () => {
          const result = await loadMetaPagesFromUserAccessToken(
            {
              appId: input.config.metaAppId,
              appSecret: input.config.metaAppSecret,
              redirectUri: input.config.metaRedirectUri,
              graphApiVersion: input.config.metaGraphApiVersion,
              requiredScopes: input.config.metaRequiredScopes
            },
            input.config.metaTestUserAccessToken ?? ""
          );
          await input.store.upsertMetaAuthorization({
            workspaceId: workspace.id,
            actorId: actor.userId,
            authorization: result.authorization,
            pages: result.pages
          });
          return {
            schemaVersion: "meta_connect.v1" as const,
            bootstrap: await buildBootstrap(actor, user, requestId),
            pages: await input.store.listMetaPages(workspace.id),
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/meta/pages/select",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: SelectPageBodySchema,
        response: {
          200: SelectPageResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const body = request.body as { pageId: string };
      const { actor, user } = await authenticateRequest(request);
      const memberships = await input.store.listMemberships(actor.userId);
      const workspace = memberships[0]?.workspace;
      if (!workspace) throw new AppError({
        code: "workspace_not_found",
        statusCode: 404,
        message: "Workspace not found",
        userMessage: "No encontramos tu workspace.",
        retryable: false,
        action: "refresh"
      });
      await input.store.assertWorkspaceRole({
        userId: actor.userId,
        workspaceId: workspace.id,
        allowedRoles: ["owner", "admin"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/meta/pages/select",
        handler: async () => {
          const business = await input.store.selectMetaPage({
            workspaceId: workspace.id,
            actorId: actor.userId,
            pageId: body.pageId,
            requestId
          });
          return {
            schemaVersion: "select_page.v1" as const,
            business,
            bootstrap: await buildBootstrap(actor, user, requestId),
            changed: {
              entityIds: [body.pageId, business.id],
              queryKeys: ["bootstrap", "pages", `settings:${business.id}`, `dashboard:${business.id}`]
            },
            nextStep: "home" as const,
            requestId
          };
        }
      });
    }
  );

  app.get(
    "/businesses",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: { 200: BusinessesResponseSchema, 401: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { actor } = await authenticateRequest(request);
      const memberships = await input.store.listMemberships(actor.userId);
      const workspace = memberships[0]?.workspace;
      return {
        schemaVersion: "businesses.v1" as const,
        businesses: workspace ? await input.store.listBusinesses(workspace.id) : [],
        requestId
      };
    }
  );

  app.get(
    "/billing/plans",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        response: { 200: PlansResponseSchema, 401: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      await authenticateRequest(request);
      return { schemaVersion: "plans.v1" as const, plans: PLAN_ENTITLEMENTS, requestId };
    }
  );

  app.get(
    "/billing/status",
    {
      schema: {
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { actor } = await authenticateRequest(request);
      const memberships = await input.store.listMemberships(actor.userId);
      const workspace = memberships[0]?.workspace;
      if (!workspace) {
        throw new AppError({
          code: "workspace_not_found",
          statusCode: 404,
          message: "Workspace not found",
          userMessage: "No encontramos tu workspace.",
          retryable: false,
          action: "refresh"
        });
      }
      const billing = await input.store.getBillingStatus({ workspaceId: workspace.id });
      return {
        schemaVersion: "billing_status.v1" as const,
        workspace: billing.workspace,
        billingAccount: billing.billingAccount,
        plans: PLAN_ENTITLEMENTS,
        upgrade: {
          canUpgrade: true,
          provider: "manual" as const,
          message: "Los upgrades quedan como solicitud manual durante piloto privado."
        },
        requestId
      };
    }
  );

  app.post(
    "/billing/upgrade-intent",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: UpgradeIntentBodySchema,
        response: {
          200: UpgradeIntentResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const body = request.body as { plan: "piloto" | "starter" | "pro" | "agency"; provider?: "manual" | "stripe" | "mercado_pago" };
      const { actor } = await authenticateRequest(request);
      const memberships = await input.store.listMemberships(actor.userId);
      const workspace = memberships[0]?.workspace;
      if (!workspace) throw new AppError({ code: "workspace_not_found", statusCode: 404, message: "Workspace not found", userMessage: "No encontramos tu workspace.", retryable: false, action: "refresh" });
      await input.store.assertWorkspaceRole({ userId: actor.userId, workspaceId: workspace.id, allowedRoles: ["owner"] });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/billing/upgrade-intent",
        handler: async () => {
          const provider = body.provider ?? "manual";
          const adapter = createBillingProvider(provider);
          const intent = await adapter.createCheckoutIntent({ workspaceId: workspace.id, plan: body.plan });
          await input.store.createUpgradeIntent({
            workspaceId: workspace.id,
            actorId: actor.userId,
            requestId,
            plan: body.plan,
            provider
          });
          return {
            schemaVersion: "upgrade_intent.v1" as const,
            provider: intent.provider,
            targetPlan: intent.targetPlan,
            checkoutUrl: intent.checkoutUrl,
            message: intent.message,
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/billing/webhooks/:provider",
    {
      schema: {
        params: {
          type: "object",
          required: ["provider"],
          properties: { provider: { type: "string", enum: ["manual", "stripe", "mercado_pago"] } }
        },
        body: BillingWebhookBodySchema,
        response: {
          200: BillingWebhookResponseSchema,
          401: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { provider: "manual" | "stripe" | "mercado_pago" };
      const body = request.body as {
        providerEventId: string;
        type: string;
        workspaceId?: string;
        plan?: "piloto" | "starter" | "pro" | "agency";
        billingStatus?: "trial" | "active" | "past_due" | "paused" | "cancelled";
      };
      const signature = request.headers["x-fbmaniaco-billing-signature"];
      if (input.config.billingWebhookSecret && signature !== input.config.billingWebhookSecret) {
        throw new AppError({
          code: "invalid_billing_webhook_signature",
          statusCode: 401,
          message: "Billing webhook signature mismatch",
          userMessage: "Webhook de cobro no autorizado.",
          retryable: false,
          action: "none"
        });
      }
      const eventInput: Parameters<DataStore["processBillingProviderEvent"]>[0] = {
        provider: params.provider,
        providerEventId: body.providerEventId,
        type: body.type
      };
      if (body.workspaceId !== undefined) eventInput.workspaceId = body.workspaceId;
      if (body.plan !== undefined) eventInput.plan = body.plan;
      if (body.billingStatus !== undefined) eventInput.billingStatus = body.billingStatus;
      const result = await input.store.processBillingProviderEvent(eventInput);
      return {
        schemaVersion: "billing_webhook.v1" as const,
        event: result.event,
        duplicate: result.duplicate,
        requestId
      };
    }
  );

  app.get(
    "/businesses/:businessId",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        response: { 200: BusinessDetailResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      return {
        schemaVersion: "business_detail.v1" as const,
        business,
        autonomy: await input.store.evaluateBusinessAutonomy({
          workspaceId: workspace.id,
          businessId: business.id,
          autonomyFeatureEnabled: input.config.featureFlags.autonomy
        }),
        requestId
      };
    }
  );

  app.patch(
    "/businesses/:businessId",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        body: UpdateBusinessBodySchema,
        response: {
          200: BusinessMutationResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const body = request.body as {
        name?: string;
        timezone?: string;
        metadata?: Record<string, unknown>;
        autonomySettings?: Parameters<DataStore["updateBusiness"]>[0]["autonomySettings"];
      };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId",
        handler: async () => {
          const updateInput: Parameters<DataStore["updateBusiness"]>[0] = {
            workspaceId: workspace.id,
            businessId: business.id,
            actorId: actor.userId,
            requestId
          };
          if (body.name !== undefined) updateInput.name = body.name;
          if (body.timezone !== undefined) updateInput.timezone = body.timezone;
          if (body.metadata !== undefined) updateInput.metadata = body.metadata;
          if (body.autonomySettings !== undefined) updateInput.autonomySettings = body.autonomySettings;
          const updated = await input.store.updateBusiness(updateInput);
          return {
            schemaVersion: "business_mutation.v1" as const,
            business: updated,
            autonomy: await input.store.evaluateBusinessAutonomy({
              workspaceId: workspace.id,
              businessId: business.id,
              autonomyFeatureEnabled: input.config.featureFlags.autonomy
            }),
            changed: {
              entityIds: [business.id],
              queryKeys: [`settings:${business.id}`, `business:${business.id}`, `dashboard:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/businesses/:businessId/batches",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId"],
          properties: { businessId: { type: "string" } }
        },
        response: {
          200: CreateBatchResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches",
        handler: async () => {
          const batch = await input.store.createBatch({
            workspaceId: workspace.id,
            businessId: business.id,
            actorId: actor.userId,
            requestId
          });
          return {
            schemaVersion: "create_batch.v1" as const,
            batch,
            changed: {
              entityIds: [business.id, batch.id],
              queryKeys: [`batches:${business.id}`, `activeBatch:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.get(
    "/businesses/:businessId/batches",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId"],
          properties: { businessId: { type: "string" } }
        },
        response: { 200: BatchesResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      return {
        schemaVersion: "batches.v1" as const,
        batches: await input.store.listBatches({ workspaceId: workspace.id, businessId: business.id }),
        requestId
      };
    }
  );

  app.get(
    "/businesses/:businessId/batches/active",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId"],
          properties: { businessId: { type: "string" } }
        },
        response: { 200: BatchesResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      const batch = await input.store.getActiveBatch({ workspaceId: workspace.id, businessId: business.id });
      return {
        schemaVersion: "batches.v1" as const,
        batches: batch ? [batch] : [],
        requestId
      };
    }
  );

  app.get(
    "/businesses/:businessId/batches/:batchId",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        response: { 200: BatchDetailSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      const detail = await input.store.getBatchDetail({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: params.batchId
      });
      if (!detail) {
        throw new AppError({
          code: "batch_not_found",
          statusCode: 404,
          message: "Batch not found",
          userMessage: "No encontramos ese lote.",
          retryable: false,
          action: "refresh"
        });
      }
      return {
        schemaVersion: "batch_detail.v1" as const,
        batch: detail.batch,
        photos: withPhotoUrls(request, detail.photos),
        variants: withVariantUrls(request, detail.variants),
        jobs: detail.jobs.map(jobSummary),
        requestId
      };
    }
  );

  app.get(
    "/businesses/:businessId/batches/:batchId/variants",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        response: { 200: VariantsResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      const variants = await input.store.listVariants({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: params.batchId
      });
      return {
        schemaVersion: "variants.v1" as const,
        variants: withVariantUrls(request, variants),
        requestId
      };
    }
  );

  app.post(
    "/businesses/:businessId/batches/:batchId/estimate-cost",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        body: EstimateCostBodySchema,
        response: {
          200: EstimateCostResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const body = request.body as { variantsPerPhoto: number };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      const estimate = await input.store.estimateBatchCost({
        workspaceId: workspace.id,
        businessId: business.id,
        batchId: params.batchId,
        variantsPerPhoto: body.variantsPerPhoto
      });
      return { schemaVersion: "cost_estimate.v1" as const, ...estimate, requestId };
    }
  );

  app.post(
    "/businesses/:businessId/batches/:batchId/confirm-cost",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        body: ConfirmCostBodySchema,
        response: {
          200: ConfirmCostResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const body = request.body as { variantsPerPhoto: number; priceVersion: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/confirm-cost",
        handler: async () => {
          const confirmation = await input.store.confirmBatchCost({
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            variantsPerPhoto: body.variantsPerPhoto,
            priceVersion: body.priceVersion,
            actorId: actor.userId,
            requestId
          });
          return {
            schemaVersion: "confirm_cost.v1" as const,
            batch: confirmation.batch,
            reserved: {
              variantCount: confirmation.variantCount,
              customerCostUsd: confirmation.customerCostUsd,
              providerCostUsd: confirmation.providerCostUsd,
              priceVersion: confirmation.priceVersion
            },
            changed: {
              entityIds: [business.id, params.batchId],
              queryKeys: [`batch:${params.batchId}`, `batches:${business.id}`, `usage:${workspace.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/businesses/:businessId/batches/:batchId/generate",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        body: GenerateBatchBodySchema,
        response: {
          200: GenerateBatchResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const body = request.body as { variantsPerPhoto: number };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/generate",
        handler: async () => {
          if (!input.config.featureFlags.openaiImageGeneration) {
            throw new AppError({
              code: "feature_disabled",
              statusCode: 503,
              message: "Image generation is disabled",
              userMessage: "La generacion de imagenes esta pausada temporalmente.",
              retryable: true,
              action: "retry"
            });
          }
          const generation = await input.store.requestGenerateBatch({
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            variantsPerPhoto: body.variantsPerPhoto,
            actorId: actor.userId,
            requestId
          });
          return {
            schemaVersion: "generate_batch.v1" as const,
            created: generation.created,
            available: generation.available,
            blockedReason: null,
            job: jobSummary(generation.job),
            changed: {
              entityIds: [business.id, params.batchId, generation.job.id, ...generation.variants.map((variant) => variant.id)],
              queryKeys: [`batch:${params.batchId}`, `variants:${params.batchId}`, `jobs:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.patch(
    "/businesses/:businessId/batches/:batchId/variants/:variantId/caption",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId", "variantId"],
          properties: {
            businessId: { type: "string" },
            batchId: { type: "string" },
            variantId: { type: "string" }
          }
        },
        body: UpdateCaptionBodySchema,
        response: {
          200: VariantMutationResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string; variantId: string };
      const body = request.body as { caption: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/variants/:variantId/caption",
        handler: async () => {
          const variant = await input.store.updateVariantCaption({
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            variantId: params.variantId,
            caption: body.caption,
            actorId: actor.userId,
            requestId
          });
          return {
            schemaVersion: "variant_mutation.v1" as const,
            variant: withVariantUrls(request, [variant])[0],
            changed: {
              entityIds: [variant.id, params.batchId],
              queryKeys: [`variant:${variant.id}`, `variants:${params.batchId}`, `batch:${params.batchId}`]
            },
            requestId
          };
        }
      });
    }
  );

  const registerVariantAction = (action: "approve" | "reject") => {
    app.post(
      `/businesses/:businessId/batches/:batchId/variants/:variantId/${action}`,
      {
        schema: {
          security: [{ bearerAuth: [] }],
          params: {
            type: "object",
            required: ["businessId", "batchId", "variantId"],
            properties: {
              businessId: { type: "string" },
              batchId: { type: "string" },
              variantId: { type: "string" }
            }
          },
          response: {
            200: VariantMutationResponseSchema,
            401: AppErrorResponseSchema,
            403: AppErrorResponseSchema,
            404: AppErrorResponseSchema,
            409: AppErrorResponseSchema
          }
        }
      },
      async (request) => {
        const requestId = String(request.headers["x-request-id"]);
        const params = request.params as { businessId: string; batchId: string; variantId: string };
        const { actor } = await authenticateRequest(request);
        const { workspace, business } = await requireBusinessAccess({
          actorId: actor.userId,
          businessId: params.businessId,
          allowedRoles: ["owner", "admin", "operator"]
        });
        return runIdempotent({
          request,
          workspaceId: workspace.id,
          actorId: actor.userId,
          routeKey: `/businesses/:businessId/batches/:batchId/variants/:variantId/${action}`,
          handler: async () => {
            const variant =
              action === "approve"
                ? await input.store.approveVariant({
                    workspaceId: workspace.id,
                    businessId: business.id,
                    batchId: params.batchId,
                    variantId: params.variantId,
                    actorId: actor.userId,
                    requestId
                  })
                : await input.store.rejectVariant({
                    workspaceId: workspace.id,
                    businessId: business.id,
                    batchId: params.batchId,
                    variantId: params.variantId,
                    actorId: actor.userId,
                    requestId
                  });
            return {
              schemaVersion: "variant_mutation.v1" as const,
              variant: withVariantUrls(request, [variant])[0],
              changed: {
                entityIds: [variant.id, params.batchId],
                queryKeys: [`variant:${variant.id}`, `variants:${params.batchId}`, `batch:${params.batchId}`]
              },
              requestId
            };
          }
        });
      }
    );
  };
  registerVariantAction("approve");
  registerVariantAction("reject");

  app.post(
    "/businesses/:businessId/batches/:batchId/calendar/confirm",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        body: ConfirmCalendarBodySchema,
        response: {
          200: ConfirmCalendarResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const body = request.body as { periodDays: 7 | 14 | 30 };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/calendar/confirm",
        handler: async () => {
          if (!input.config.featureFlags.metaPublishing) {
            throw new AppError({
              code: "feature_disabled",
              statusCode: 503,
              message: "Meta publishing is disabled",
              userMessage: "La publicacion en Facebook esta pausada temporalmente.",
              retryable: true,
              action: "retry"
            });
          }
          const result = await input.store.confirmCalendar({
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            periodDays: body.periodDays,
            actorId: actor.userId,
            requestId
          });
          return {
            schemaVersion: "calendar_confirm.v1" as const,
            scheduledPosts: result.scheduledPosts,
            job: jobSummary(result.job),
            changed: {
              entityIds: [params.batchId, result.job.id, ...result.scheduledPosts.map((post) => post.id)],
              queryKeys: [`batch:${params.batchId}`, `scheduledPosts:${business.id}`, `jobs:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  const listScheduledPostsHandler = async (request: FastifyRequest) => {
    const requestId = String(request.headers["x-request-id"]);
    const params = request.params as { businessId: string; batchId?: string };
    const query = request.query as { from?: string; to?: string };
    const { actor } = await authenticateRequest(request);
    const { workspace, business } = await requireBusinessAccess({
      actorId: actor.userId,
      businessId: params.businessId,
      allowedRoles: ["owner", "admin", "operator", "viewer"]
    });
    const listInput: Parameters<DataStore["listScheduledPosts"]>[0] = {
      workspaceId: workspace.id,
      businessId: business.id
    };
    if (params.batchId !== undefined) listInput.batchId = params.batchId;
    if (query.from !== undefined) listInput.from = query.from;
    if (query.to !== undefined) listInput.to = query.to;
    const scheduledPosts = await input.store.listScheduledPosts(listInput);
    return { schemaVersion: "scheduled_posts.v1" as const, scheduledPosts, requestId };
  };

  app.get(
    "/businesses/:businessId/scheduled-posts",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        querystring: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" } }
        },
        response: { 200: ScheduledPostsResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    listScheduledPostsHandler
  );

  app.get(
    "/businesses/:businessId/batches/:batchId/scheduled-posts",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        response: { 200: ScheduledPostsResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    listScheduledPostsHandler
  );

  app.patch(
    "/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId", "scheduledPostId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" }, scheduledPostId: { type: "string" } }
        },
        body: UpdateScheduledPostBodySchema,
        response: {
          200: ScheduledPostMutationResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string; scheduledPostId: string };
      const body = request.body as { scheduledFor: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId",
        handler: async () => {
          const result = await input.store.updateScheduledPost({
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            scheduledPostId: params.scheduledPostId,
            scheduledFor: body.scheduledFor,
            actorId: actor.userId,
            requestId
          });
          return {
            schemaVersion: "scheduled_post_mutation.v1" as const,
            scheduledPost: result.scheduledPost,
            job: result.job ? jobSummary(result.job) : null,
            changed: {
              entityIds: [params.scheduledPostId],
              queryKeys: [`scheduledPosts:${business.id}`, `scheduledPost:${params.scheduledPostId}`]
            },
            requestId
          };
        }
      });
    }
  );

  const registerScheduledPostAction = (action: "cancel" | "publish" | "retry") => {
    app.post(
      `/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/${action}`,
      {
        schema: {
          security: [{ bearerAuth: [] }],
          params: {
            type: "object",
            required: ["businessId", "batchId", "scheduledPostId"],
            properties: { businessId: { type: "string" }, batchId: { type: "string" }, scheduledPostId: { type: "string" } }
          },
          response: {
            200: ScheduledPostMutationResponseSchema,
            401: AppErrorResponseSchema,
            403: AppErrorResponseSchema,
            404: AppErrorResponseSchema,
            409: AppErrorResponseSchema
          }
        }
      },
      async (request) => {
        const requestId = String(request.headers["x-request-id"]);
        const params = request.params as { businessId: string; batchId: string; scheduledPostId: string };
        const { actor } = await authenticateRequest(request);
        const { workspace, business } = await requireBusinessAccess({
          actorId: actor.userId,
          businessId: params.businessId,
          allowedRoles: ["owner", "admin", "operator"]
        });
        return runIdempotent({
          request,
          workspaceId: workspace.id,
          actorId: actor.userId,
          routeKey: `/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/${action}`,
          handler: async () => {
            const result =
              action === "cancel"
                ? await input.store.cancelScheduledPost({
                    workspaceId: workspace.id,
                    businessId: business.id,
                    batchId: params.batchId,
                    scheduledPostId: params.scheduledPostId,
                    actorId: actor.userId,
                    requestId
                  })
                : await input.store.publishScheduledPostNow({
                    workspaceId: workspace.id,
                    businessId: business.id,
                    batchId: params.batchId,
                    scheduledPostId: params.scheduledPostId,
                    actorId: actor.userId,
                    requestId
                  });
            return {
              schemaVersion: "scheduled_post_mutation.v1" as const,
              scheduledPost: result.scheduledPost,
              job: result.job ? jobSummary(result.job) : null,
              changed: {
                entityIds: [params.scheduledPostId, result.job?.id ?? ""].filter(Boolean),
                queryKeys: [`scheduledPosts:${business.id}`, `scheduledPost:${params.scheduledPostId}`, `jobs:${business.id}`]
              },
              requestId
            };
          }
        });
      }
    );
  };
  registerScheduledPostAction("cancel");
  registerScheduledPostAction("publish");
  registerScheduledPostAction("retry");

  app.get(
    "/businesses/:businessId/performance",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        querystring: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" }, scope: { type: "string" } }
        },
        response: { 200: PerformanceResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const query = request.query as { from?: string; to?: string; scope?: "business_week" | "style" | "time_slot" | "caption_pattern" | "content_type" };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      const summariesInput: Parameters<DataStore["listPerformanceSummaries"]>[0] = {
        workspaceId: workspace.id,
        businessId: business.id
      };
      if (query.from !== undefined) summariesInput.from = query.from;
      if (query.to !== undefined) summariesInput.to = query.to;
      if (query.scope !== undefined) summariesInput.scope = query.scope;
      return {
        schemaVersion: "performance.v1" as const,
        summaries: await input.store.listPerformanceSummaries(summariesInput),
        metricDefinitions: await input.store.listMetricDefinitions(),
        requestId
      };
    }
  );

  app.post(
    "/businesses/:businessId/metrics/collect",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        body: CollectMetricsBodySchema,
        response: {
          200: MetricsCollectResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const body = request.body as { from?: string; to?: string; window?: "24h" | "72h" | "7d" | "lifetime" };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/metrics/collect",
        handler: async () => {
          const collectInput: Parameters<DataStore["requestCollectMetrics"]>[0] = {
            workspaceId: workspace.id,
            businessId: business.id,
            actorId: actor.userId,
            requestId
          };
          if (body.from !== undefined) collectInput.from = body.from;
          if (body.to !== undefined) collectInput.to = body.to;
          if (body.window !== undefined) collectInput.window = body.window;
          const result = await input.store.requestCollectMetrics(collectInput);
          return {
            schemaVersion: "metrics_collect.v1" as const,
            job: jobSummary(result.job),
            changed: {
              entityIds: [business.id, result.job.id],
              queryKeys: [`performance:${business.id}`, `weeklyReport:${business.id}`, `jobs:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.get(
    "/businesses/:businessId/reports/weekly",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        response: { 200: WeeklyReportResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      const report = await input.store.getLatestWeeklyReport({ workspaceId: workspace.id, businessId: business.id });
      return {
        schemaVersion: "weekly_report.v1" as const,
        report,
        emptyReason: report ? null : "Aun no hay reporte semanal generado.",
        requestId
      };
    }
  );

  app.post(
    "/businesses/:businessId/reports/weekly/generate",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        body: GenerateWeeklyReportBodySchema,
        response: {
          200: WeeklyReportGenerateResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const body = request.body as { weekStart?: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/reports/weekly/generate",
        handler: async () => {
          const reportInput: Parameters<DataStore["requestWeeklyReport"]>[0] = {
            workspaceId: workspace.id,
            businessId: business.id,
            actorId: actor.userId,
            requestId
          };
          if (body.weekStart !== undefined) reportInput.weekStart = body.weekStart;
          const result = await input.store.requestWeeklyReport(reportInput);
          return {
            schemaVersion: "weekly_report_generate.v1" as const,
            job: jobSummary(result.job),
            changed: {
              entityIds: [business.id, result.job.id],
              queryKeys: [`weeklyReport:${business.id}`, `performance:${business.id}`, `jobs:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/businesses/:businessId/evals/caption",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        body: BatchCaptionEvalBodySchema,
        response: {
          200: BatchCaptionEvalResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const body = request.body as {
        candidatePromptTemplateId?: string;
        baselinePromptTemplateId?: string;
        datasetId?: string;
        candidateCaptionEditRate?: number;
      };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/evals/caption",
        handler: async () => {
          const evalInput: Parameters<DataStore["requestBatchCaptionEval"]>[0] = {
            workspaceId: workspace.id,
            businessId: business.id,
            actorId: actor.userId,
            requestId
          };
          if (body.candidatePromptTemplateId !== undefined) evalInput.candidatePromptTemplateId = body.candidatePromptTemplateId;
          if (body.baselinePromptTemplateId !== undefined) evalInput.baselinePromptTemplateId = body.baselinePromptTemplateId;
          if (body.datasetId !== undefined) evalInput.datasetId = body.datasetId;
          if (body.candidateCaptionEditRate !== undefined) evalInput.candidateCaptionEditRate = body.candidateCaptionEditRate;
          const result = await input.store.requestBatchCaptionEval(evalInput);
          return {
            schemaVersion: "batch_caption_eval.v1" as const,
            job: jobSummary(result.job),
            changed: {
              entityIds: [business.id, result.job.id],
              queryKeys: [`aiEvaluations:${business.id}`, `jobs:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.get(
    "/businesses/:businessId/evals",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } },
        response: { 200: AiEvaluationsResponseSchema, 401: AppErrorResponseSchema, 404: AppErrorResponseSchema }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      return {
        schemaVersion: "ai_evaluations.v1" as const,
        evaluations: await input.store.listAiEvaluations({ workspaceId: workspace.id, businessId: business.id }),
        requestId
      };
    }
  );

  app.post(
    "/businesses/:businessId/batches/:batchId/photos/upload-intent",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        body: UploadIntentBodySchema,
        response: {
          200: UploadIntentResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          413: AppErrorResponseSchema,
          415: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const body = request.body as { originalFileName: string; contentType: string; fileSize: number };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/photos/upload-intent",
        handler: async () => {
          const uploadIntent = await input.store.createUploadIntent({
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            originalFileName: body.originalFileName,
            contentType: body.contentType,
            fileSize: body.fileSize
          });
          if (input.config.dataStoreMode !== "supabase") {
            throw new AppError({
              code: "real_storage_required",
              statusCode: 409,
              message: "Photo uploads require Supabase Storage",
              userMessage: "La subida de fotos necesita almacenamiento real.",
              retryable: false,
              action: "contact_support"
            });
          }
          const signed = await requireStorageClient()
            .storage
            .from(uploadIntent.bucket)
            .createSignedUploadUrl(uploadIntent.storageKey, { upsert: false });
          if (signed.error || !signed.data?.signedUrl) {
            throw new AppError({
              code: "storage_upload_url_failed",
              statusCode: 502,
              message: signed.error?.message ?? "Could not create Supabase signed upload URL",
              userMessage: "No pudimos preparar la subida real. Intenta de nuevo.",
              retryable: true,
              action: "retry"
            });
          }
          return {
            schemaVersion: "upload_intent.v1" as const,
            uploadIntent,
            upload: {
              uploadUrl: signed.data.signedUrl,
              method: "PUT" as const,
              headers: {},
              expiresAt: uploadIntent.expiresAt
            },
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/businesses/:businessId/batches/:batchId/photos/complete-upload",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["businessId", "batchId"],
          properties: { businessId: { type: "string" }, batchId: { type: "string" } }
        },
        body: CompleteUploadBodySchema,
        response: {
          200: CompleteUploadResponseSchema,
          400: AppErrorResponseSchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema,
          404: AppErrorResponseSchema,
          409: AppErrorResponseSchema,
          413: AppErrorResponseSchema,
          415: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const params = request.params as { businessId: string; batchId: string };
      const body = request.body as {
        storageKey: string;
        originalFileName: string;
        contentType: string;
        fileSize: number;
        checksum?: string;
        width?: number;
        height?: number;
      };
      const { actor } = await authenticateRequest(request);
      const { workspace, business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      return runIdempotent({
        request,
        workspaceId: workspace.id,
        actorId: actor.userId,
        routeKey: "/businesses/:businessId/batches/:batchId/photos/complete-upload",
        handler: async () => {
          const completeInput: Parameters<DataStore["completeUpload"]>[0] = {
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            storageKey: body.storageKey,
            originalFileName: body.originalFileName,
            contentType: body.contentType,
            fileSize: body.fileSize,
            actorId: actor.userId,
            requestId
          };
          if (body.checksum !== undefined) completeInput.checksum = body.checksum;
          if (body.width !== undefined) completeInput.width = body.width;
          if (body.height !== undefined) completeInput.height = body.height;
          const completed = await input.store.completeUpload(completeInput);
          return {
            schemaVersion: "complete_upload.v1" as const,
            photo: completed.photo,
            job: jobSummary(completed.job),
            changed: {
              entityIds: [business.id, params.batchId, completed.photo.id, completed.job.id],
              queryKeys: [`batch:${params.batchId}`, `batches:${business.id}`, `jobs:${business.id}`]
            },
            requestId
          };
        }
      });
    }
  );

  app.post(
    "/internal/jobs/mock",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["workspaceId", "dedupeKey"],
          properties: {
            workspaceId: { type: "string" },
            dedupeKey: { type: "string" }
          }
        },
        response: {
          200: JobSummarySchema,
          401: AppErrorResponseSchema,
          403: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      if (input.config.appEnv !== "development" || !input.config.localAuthEnabled) {
        throw new AppError({
          code: "dev_endpoint_disabled",
          statusCode: 403,
          message: "Internal mock job endpoint is disabled",
          userMessage: "Esta accion no esta disponible en este entorno.",
          retryable: false,
          action: "none"
        });
      }
      const body = request.body as { workspaceId: string; dedupeKey: string };
      const { actor } = await authenticateBearer({
        authorization: request.headers.authorization,
        config: input.config,
        store: input.store
      });
      await input.store.assertWorkspaceRole({
        userId: actor.userId,
        workspaceId: body.workspaceId,
        allowedRoles: ["owner", "admin", "operator"]
      });
      const job = await input.store.createJob({
        type: "mock_job",
        workspaceId: body.workspaceId,
        dedupeKey: body.dedupeKey,
        payload: { source: "smoke" }
      });
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        workspaceId: job.workspaceId,
        progress: job.status === "succeeded" ? 100 : 0,
        userMessage: "Trabajo en cola.",
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      };
    }
  );

  app.get(
    "/jobs/:jobId",
    {
      schema: {
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["jobId"],
          properties: { jobId: { type: "string" } }
        }
      }
    },
    async (request) => {
      const { actor } = await authenticateBearer({
        authorization: request.headers.authorization,
        config: input.config,
        store: input.store
      });
      const params = request.params as { jobId: string };
      const memberships = await input.store.listMemberships(actor.userId);
      const jobs = (
        await Promise.all(memberships.map(({ workspace }) => input.store.listJobs(workspace.id)))
      ).flat();
      const job = jobs.find((item) => item.id === params.jobId);
      if (!job) {
        throw new AppError({
          code: "not_found",
          statusCode: 404,
          message: "Job not found",
          userMessage: "No encontramos ese trabajo.",
          retryable: false,
          action: "refresh"
        });
      }
      return {
        ...jobSummary(job)
      };
    }
  );

  return app;
};

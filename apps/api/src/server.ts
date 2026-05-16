import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify, { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createMetaProvider, loadMetaPagesFromUserAccessToken, MetaProvider } from "@fbmaniaco/providers";
import {
  AppError,
  AppErrorResponseSchema,
  BootstrapStatusSchema,
  BatchDetailSchema,
  BatchesResponseSchema,
  BusinessesResponseSchema,
  BusinessDetailResponseSchema,
  BusinessMutationResponseSchema,
  CompleteUploadBodySchema,
  CompleteUploadResponseSchema,
  ConfirmCalendarBodySchema,
  ConfirmCalendarResponseSchema,
  CreateBatchResponseSchema,
  HealthSchema,
  JobSummarySchema,
  GenerateBatchBodySchema,
  GenerateBatchResponseSchema,
  MetaConnectResponseSchema,
  MetaPagesResponseSchema,
  MobileAuthSessionResponseSchema,
  ReadySchema,
  SelectPageBodySchema,
  SelectPageResponseSchema,
  ScheduledPostMutationResponseSchema,
  ScheduledPostsResponseSchema,
  UpdateCaptionBodySchema,
  UpdateBusinessBodySchema,
  UpdateScheduledPostBodySchema,
  UploadIntentBodySchema,
  UploadIntentResponseSchema,
  VariantMutationResponseSchema,
  VariantsResponseSchema,
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
      loginConfigurationId: input.config.metaLoginConfigurationId,
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
  const mobileMetaConnectedUrl = "fbmaniaco://meta-connected";
  const mediaToken = (assetId: string, expires: number) =>
    createHash("sha256").update(`${assetId}:${expires}:fbmaniaco-local-media-preview`).digest("hex");
  const requireSupabaseClient = () => {
    if (!storageClient) {
      throw new AppError({
        code: "supabase_auth_not_configured",
        statusCode: 500,
        message: "Supabase Auth is not configured",
        userMessage: "El servidor no tiene autenticacion real configurada.",
        retryable: false,
        action: "contact_support"
      });
    }
    return storageClient;
  };
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
  const mobileSessionResponse = (
    session: { access_token?: string; refresh_token?: string; expires_at?: number; token_type?: string } | null | undefined,
    user: { id?: string; email?: string } | null | undefined,
    requestId: string
  ) => {
    if (!session?.access_token) {
      throw new AppError({
        code: "mobile_session_failed",
        statusCode: 502,
        message: "Supabase did not return a mobile auth session",
        userMessage: "No pudimos crear una sesion segura. Intenta de nuevo.",
        retryable: true,
        action: "retry"
      });
    }
    return {
      schemaVersion: "mobile_auth_session.v1" as const,
      accessToken: session.access_token,
      ...(session.refresh_token ? { refreshToken: session.refresh_token } : {}),
      ...(session.expires_at ? { expiresAt: session.expires_at } : {}),
      ...(session.token_type ? { tokenType: session.token_type } : {}),
      ...(user ? { user: { ...(user.id ? { id: user.id } : {}), ...(user.email ? { email: user.email } : {}) } } : {}),
      requestId
    };
  };
  const mobileAuthFailure = (error: { message?: string | undefined; code?: string | undefined } | null | undefined) => {
    if (error?.code === "anonymous_provider_disabled" || error?.message?.toLowerCase().includes("anonymous")) {
      throw new AppError({
        code: "anonymous_auth_disabled",
        statusCode: 409,
        message: error?.message ?? "Anonymous auth is disabled",
        userMessage: "Supabase necesita tener activo el inicio anonimo para abrir Facebook sin pedir correo.",
        retryable: false,
        action: "contact_support"
      });
    }
    throw new AppError({
      code: "mobile_session_failed",
      statusCode: 502,
      message: error?.message ?? "Could not create or refresh mobile auth session",
      userMessage: "No pudimos crear una sesion segura. Intenta de nuevo.",
      retryable: true,
      action: "retry"
    });
  };
  const createControlledMobileSession = async (requestId: string) => {
    const supabase = requireSupabaseClient();
    const createdAt = new Date().toISOString();
    const email = `device-${randomUUID()}@sessions.fbmaniaco.local`;
    const password = `${randomBytes(32).toString("base64url")}aA1!`;
    const created = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        source: "fbmaniaco_mobile",
        authMode: "controlled_device",
        createdAt
      }
    });
    if (created.error || !created.data.user) mobileAuthFailure(created.error);
    const session = await supabase.auth.signInWithPassword({ email, password });
    if (session.error || !session.data.session) {
      if (created.data.user?.id) {
        await supabase.auth.admin.deleteUser(created.data.user.id).catch(() => undefined);
      }
      mobileAuthFailure(session.error);
    }
    return mobileSessionResponse(session.data.session, session.data.user, requestId);
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
        loginConfigurationId: input.config.metaLoginConfigurationId,
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
              : job.status === "succeeded"
                ? "Trabajo completado."
                : "Trabajo en proceso.",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  });
  const legalContactEmail = process.env.LEGAL_CONTACT_EMAIL ?? "soporte@fbmaniaco.app";
  const legalPage = (title: string, body: string) => `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
      main { max-width: 760px; margin: 0 auto; padding: 40px 20px; line-height: 1.65; }
      h1 { font-size: 32px; margin: 0 0 16px; }
      h2 { font-size: 20px; margin: 28px 0 8px; }
      p, li { color: #334155; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;

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

  app.get("/legal/privacy", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(
      legalPage(
        "Politica de privacidad de FBmaniaco",
        `<h1>Politica de privacidad de FBmaniaco</h1>
        <p>FBmaniaco ayuda a administrar contenido para paginas de Facebook conectadas por el usuario. Solo usamos los datos necesarios para autenticar la cuenta, listar paginas autorizadas, preparar contenido, programar publicaciones y mostrar resultados operativos dentro de la aplicacion.</p>
        <h2>Datos que tratamos</h2>
        <p>Podemos almacenar identificadores de usuario, workspace, paginas de Facebook autorizadas, permisos concedidos, imagenes subidas por el usuario, textos generados o editados, estados de jobs y registros tecnicos necesarios para seguridad y soporte.</p>
        <h2>Uso de datos de Meta</h2>
        <p>Los datos recibidos desde Meta Graph API se usan unicamente para conectar paginas autorizadas, validar permisos, publicar contenido aprobado por el usuario y consultar resultados relacionados con esas paginas. No vendemos datos ni los compartimos con terceros para publicidad.</p>
        <h2>Conservacion y eliminacion</h2>
        <p>El usuario puede solicitar eliminacion de datos escribiendo a ${legalContactEmail}. Tambien puede desconectar FBmaniaco desde la configuracion de Facebook o Meta.</p>
        <h2>Contacto</h2>
        <p>Para privacidad, soporte o eliminacion de datos: ${legalContactEmail}.</p>`
      )
    );
  });

  app.get("/legal/terms", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(
      legalPage(
        "Condiciones de servicio de FBmaniaco",
        `<h1>Condiciones de servicio de FBmaniaco</h1>
        <p>FBmaniaco es una herramienta para organizar, generar, revisar, programar y publicar contenido en paginas de Facebook autorizadas por el usuario.</p>
        <h2>Responsabilidad del usuario</h2>
        <p>El usuario es responsable del contenido que sube, aprueba y publica, asi como de contar con permisos suficientes sobre las paginas conectadas.</p>
        <h2>Publicacion y automatizacion</h2>
        <p>Las acciones sensibles, incluyendo publicacion en Facebook, requieren autorizacion del usuario y permisos validos de Meta. FBmaniaco puede procesar tareas en segundo plano para evitar bloqueos de la aplicacion.</p>
        <h2>Disponibilidad</h2>
        <p>El servicio puede cambiar durante el piloto privado. Trabajamos para mantener disponibilidad, seguridad y trazabilidad de las acciones importantes.</p>
        <h2>Contacto</h2>
        <p>Para soporte: ${legalContactEmail}.</p>`
      )
    );
  });

  app.get("/legal/data-deletion", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(
      legalPage(
        "Eliminacion de datos de FBmaniaco",
        `<h1>Eliminacion de datos de FBmaniaco</h1>
        <p>Para solicitar la eliminacion de datos asociados a FBmaniaco, envia un correo a ${legalContactEmail} con el asunto "Eliminar datos FBmaniaco".</p>
        <p>Incluye el correo o cuenta con la que usas la aplicacion y, si aplica, el nombre de la pagina de Facebook conectada. Procesaremos la solicitud y eliminaremos o anonimizaremos los datos operativos que no debamos conservar por seguridad, auditoria o cumplimiento.</p>
        <p>Tambien puedes revocar el acceso desde Facebook o Meta en la seccion de apps y sitios web conectados.</p>`
      )
    );
  });

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
      const checks = { ...configChecks, db: configChecks.db && db.ok, queue: configChecks.queue };
      const ok = Object.values(checks).every(Boolean);
      return reply.status(ok ? 200 : 503).send({ ok, checks });
    }
  );

  app.get("/openapi.json", async (_request, reply) => {
    return reply.send(app.swagger());
  });

  app.post(
    "/auth/mobile/anonymous",
    {
      schema: {
        response: {
          200: MobileAuthSessionResponseSchema,
          409: AppErrorResponseSchema,
          502: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const { data, error } = await requireSupabaseClient().auth.signInAnonymously({
        options: {
          data: {
            source: "fbmaniaco_mobile",
            createdAt: new Date().toISOString()
          }
        }
      });
      if (error?.code === "anonymous_provider_disabled" || error?.message?.toLowerCase().includes("anonymous")) {
        return createControlledMobileSession(requestId);
      }
      if (error) mobileAuthFailure(error);
      return mobileSessionResponse(data.session, data.user, requestId);
    }
  );

  app.post(
    "/auth/mobile/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string", minLength: 16 }
          },
          additionalProperties: false
        },
        response: {
          200: MobileAuthSessionResponseSchema,
          400: AppErrorResponseSchema,
          502: AppErrorResponseSchema
        }
      }
    },
    async (request) => {
      const requestId = String(request.headers["x-request-id"]);
      const body = request.body as { refreshToken: string };
      const { data, error } = await requireSupabaseClient().auth.refreshSession({ refresh_token: body.refreshToken });
      if (error) mobileAuthFailure(error);
      return mobileSessionResponse(data.session, data.user, requestId);
    }
  );

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
            flow: { type: "string", enum: ["oauth", "device_login"] }
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
      const body = (request.body ?? {}) as { flow?: "oauth" | "device_login" };
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
          properties: {
            code: { type: "string" },
            state: { type: "string" },
            error: { type: "string" },
            error_code: { type: "string" },
            error_reason: { type: "string" }
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
      const query = request.query as { code?: string; state?: string; error?: string };
      if (query.error || !query.code || !query.state) {
        return reply.redirect(`${mobileMetaConnectedUrl}?status=error&reason=meta`);
      }
      let decodedState: { workspaceId: string; actorId: string };
      try {
        decodedState = JSON.parse(Buffer.from(query.state, "base64url").toString("utf8")) as {
          workspaceId: string;
          actorId: string;
        };
      } catch {
        return reply.redirect(`${mobileMetaConnectedUrl}?status=error&reason=state`);
      }
      await input.store.assertWorkspaceRole({
        userId: decodedState.actorId,
        workspaceId: decodedState.workspaceId,
        allowedRoles: ["owner", "admin"]
      });
      let result: Awaited<ReturnType<MetaProvider["completeOAuth"]>>;
      try {
        result = await metaProvider.completeOAuth({ code: query.code, state: query.state });
      } catch {
        return reply.redirect(`${mobileMetaConnectedUrl}?status=error&reason=exchange`);
      }
      await input.store.upsertMetaAuthorization({
        workspaceId: decodedState.workspaceId,
        actorId: decodedState.actorId,
        authorization: result.authorization,
        pages: result.pages
      });
      return reply.redirect(`${mobileMetaConnectedUrl}?status=success`);
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
              loginConfigurationId: input.config.metaLoginConfigurationId,
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
      const { business } = await requireBusinessAccess({
        actorId: actor.userId,
        businessId: params.businessId,
        allowedRoles: ["owner", "admin", "operator", "viewer"]
      });
      return {
        schemaVersion: "business_detail.v1" as const,
        business,
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
          const updated = await input.store.updateBusiness(updateInput);
          return {
            schemaVersion: "business_mutation.v1" as const,
            business: updated,
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
      const body = request.body as {
        variantsPerPhoto: number;
        styleOverrides?: Parameters<DataStore["requestGenerateBatch"]>[0]["styleOverrides"];
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
          const generationInput: Parameters<DataStore["requestGenerateBatch"]>[0] = {
            workspaceId: workspace.id,
            businessId: business.id,
            batchId: params.batchId,
            variantsPerPhoto: body.variantsPerPhoto,
            actorId: actor.userId,
            requestId
          };
          if (body.styleOverrides !== undefined) generationInput.styleOverrides = body.styleOverrides;
          const generation = await input.store.requestGenerateBatch(generationInput);
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

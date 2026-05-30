import { type Response, Router } from 'express';
import { z } from 'zod';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  assignStylesToVariants,
  BATCH_ACCENT_COLORS,
  batchProgress,
  buildImagePrompt,
  calendarItemsFromSchedule,
  createBatchLabel,
  DEFAULT_USER_SETTINGS,
  findScheduleConflicts,
  isActiveBatchStatus,
  normalizeUserSettings,
  pageSettingsSchema,
  scheduleVariants,
  suggestSmartSchedule,
  userSettingsSchema,
  type Batch,
  type CalendarItem,
  type Page,
  type Photo,
} from '@cadencia/shared';
import type { ServerEnv } from './env.js';
import { secretStatus } from './env.js';
import {
  calendarForPage,
  demoPages,
  findPage,
  photosForPage,
  styleHistoryForPage,
} from './demoData.js';
import {
  buildMetaOAuthUrl,
  canStartMetaOAuth,
  connectMetaWithCode,
  disconnectMetaSession,
  getMetaConnectionStatus,
  getMetaPage,
  getMetaPages,
  getMetaPageSnapshots,
  hasActiveMetaOAuthSession,
  isMetaPageId,
  MetaGraphError,
} from './meta.js';
import {
  generateImageVariant,
  generatePhotoContext,
  generatePublicationText,
  hasOpenAiContext,
  OpenAiContextError,
} from './openai.js';
import {
  commitBatchToStore,
  archiveStoredBatch,
  clearStoredPageAccessToken,
  clearStoredPageAccessTokens,
  deleteStoredPage,
  getStoredBatches,
  getStoredBatchDetail,
  getStoredCalendar,
  getStoredPhoto,
  getStoredPage,
  getStoredPages,
  getStoredPhotos,
  getStoredSchedulingHistory,
  getStoredStyleHistory,
  getStoredUserSettings,
  getSupabaseStoreStatus,
  hasSupabaseStore,
  SupabaseStoreError,
  syncMetaPagesToStore,
  updateStoredUserSettings,
  updatePhotoMetadataInStore,
  updatePageSettingsInStore,
  updatePhotoContextInStore,
  upsertDraftBatchToStore,
  uploadGeneratedVariantImageToStore,
  uploadPhotosToStore,
} from './store.js';

const oauthStateTtlMs = 10 * 60 * 1000;
const oauthStateFutureSkewMs = 60 * 1000;
const demoBatchesById = new Map<string, Batch>();
const demoCalendarItemsByPage = new Map<string, CalendarItem[]>();
type OAuthReturnTarget = 'mobile' | 'web';
type OAuthStatePayload = {
  target: OAuthReturnTarget;
};

const batchPreviewSchema = z.object({
  pageId: z.string().min(1),
  photoIds: z.array(z.string().min(1)).min(1),
  variantsPerPhoto: z.number().int().min(1).max(10),
  distributionDays: z.number().int().min(1).max(60),
});

const batchCommitSchema = z.object({
  distributionDays: z.number().int().min(1).max(60),
  pageId: z.string().min(1),
  skipReview: z.boolean(),
  variants: z
    .array(
      z.object({
        generatedImagePath: z.string().nullable().optional(),
        generatedText: z.string().trim().min(1).max(2200),
        photoId: z.string().min(1),
        scheduledAt: z.string().datetime(),
        style: z.string().trim().min(1).max(120),
        variantIndex: z.number().int().min(0).max(9),
      }),
    )
    .min(1)
    .max(100),
  variantsPerPhoto: z.number().int().min(1).max(10),
});

const batchGenerateSchema = z.object({
  pageId: z.string().min(1),
  variants: z
    .array(
      z.object({
        photoId: z.string().min(1),
        style: z.string().trim().min(1).max(120),
        variantIndex: z.number().int().min(0).max(9),
      }),
    )
    .min(1)
    .max(30),
});

const batchDraftSchema = z.object({
  batchId: z.string().min(1).optional(),
  contextModeOverrides: z.record(z.string().max(1600)).default({}),
  pageId: z.string().min(1),
  pendingUploads: z
    .array(
      z.object({
        fileName: z.string().optional(),
        localId: z.string().min(1),
        mimeType: z.string().optional(),
        previewUri: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .max(30)
    .default([]),
  selectedPhotoIds: z.array(z.string().min(1)).max(100).default([]),
  skipReview: z.boolean(),
  variantsPerPhoto: z.number().int().min(1).max(10),
});

const scheduleSuggestionSchema = z.object({
  businessHours: z
    .object({
      end: z.string(),
      start: z.string(),
    })
    .optional(),
  distributionDays: z.number().int().min(1).max(60).optional(),
  occupiedSlots: z.array(z.string()).default([]),
  pageId: z.string().min(1),
  variantIds: z.array(z.string().min(1)).min(1).max(100),
});

const uploadPhotosSchema = z.object({
  photos: z
    .array(
      z.object({
        base64: z.string().min(1),
        fileName: z.string().optional(),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }),
    )
    .min(1)
    .max(10),
});

const updatePhotoContextSchema = z.object({
  context: z.string().max(1600).nullable(),
});

const updatePhotoMetadataSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(1600).nullable().optional(),
  isFavorite: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'archived', 'trashed']).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(24).optional(),
});

export function createRoutes(env: ServerEnv): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.json({
      ok: true,
      service: 'cadencia-backend',
      time: new Date().toISOString(),
      secrets: secretStatus(env),
    });
  });

  router.get('/legal/privacy', (_request, response) => {
    response.type('html').send(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Politica de privacidad - Cadencia</title>
        </head>
        <body>
          <main>
            <h1>Politica de privacidad de Cadencia</h1>
            <p>Cadencia usa Facebook Login para que el usuario conecte paginas que administra y pueda preparar publicaciones desde la app.</p>
            <p>Los tokens de Meta se guardan solo en el backend y se usan para listar paginas, guardar la conexion y publicar contenido solicitado por el usuario.</p>
            <p>Las fotos, borradores y configuraciones se guardan para operar el flujo de publicacion de la cuenta conectada. El usuario puede desconectar Facebook desde la app.</p>
            <p>Contacto: soporte@gortear.com</p>
          </main>
        </body>
      </html>
    `);
  });

  router.get('/legal/terms', (_request, response) => {
    response.type('html').send(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Terminos de servicio - Cadencia</title>
        </head>
        <body>
          <main>
            <h1>Terminos de servicio de Cadencia</h1>
            <p>Cadencia es una herramienta para crear, revisar y programar publicaciones en paginas conectadas por el usuario.</p>
            <p>El usuario es responsable de revisar el contenido antes de publicarlo y de mantener permisos validos en Meta.</p>
            <p>La app no vende tokens ni credenciales. La desconexion elimina la sesion activa del backend.</p>
            <p>Contacto: soporte@gortear.com</p>
          </main>
        </body>
      </html>
    `);
  });

  router.get('/api/meta/status', async (_request, response) => {
    response.json(await getMetaConnectionStatus(env));
  });

  router.get('/api/auth/meta/login-url', (_request, response) => {
    try {
      const target = normalizeOAuthReturnTarget(_request.query.target);
      const state = createOAuthState(env, target);
      response.json({
        configured: canStartMetaOAuth(env),
        url: buildMetaOAuthUrl(env, state),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/auth/meta/start', (_request, response) => {
    try {
      const state = createOAuthState(env, 'web');
      response.redirect(buildMetaOAuthUrl(env, state));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/auth/meta/callback', async (request, response) => {
    const code = String(request.query.code ?? '');
    const state = String(request.query.state ?? '');
    const errorMessage = normalizeMetaOAuthError(request.query);
    let returnTarget: OAuthReturnTarget = 'web';

    try {
      const statePayload = parseOAuthState(env, state);

      if (statePayload) {
        returnTarget = statePayload.target;
      }

      if (errorMessage) {
        throw new MetaGraphError(errorMessage, { status: 400 });
      }

      if (!code || !statePayload) {
        throw new MetaGraphError(
          'No pude validar el regreso de Facebook. Intenta iniciar sesion otra vez.',
          {
            status: 400,
          },
        );
      }

      await connectMetaWithCode(env, code);

      if (hasSupabaseStore(env)) {
        await syncMetaPagesToStore(env, await getMetaPageSnapshots(env));
      }

      response.redirect(
        buildOAuthReturnUrl(env, returnTarget, '/pages', {
          meta: 'connected',
        }),
      );
    } catch (error) {
      const query: Record<string, string> = {
        meta: 'error',
      };

      if (error instanceof MetaGraphError) {
        query.code = String(error.code ?? error.status);
      }

      response.redirect(buildOAuthReturnUrl(env, returnTarget, '/', query));
    }
  });

  router.post('/api/auth/meta/disconnect', (_request, response) => {
    Promise.all([disconnectMetaSession(env), clearStoredPageAccessTokens(env)])
      .then(() => response.json({ ok: true }))
      .catch((error) => sendApiError(response, error));
  });

  router.get('/api/supabase/status', async (_request, response) => {
    try {
      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          configured: false,
          ok: false,
          message: 'Faltan variables de Supabase.',
        });
        return;
      }

      response.json(await getSupabaseStoreStatus(env));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/user-settings', async (_request, response) => {
    try {
      if (!hasSupabaseStore(env)) {
        response.json({
          source: 'demo',
          settings: DEFAULT_USER_SETTINGS,
        });
        return;
      }

      response.json({
        source: 'meta',
        settings: await getStoredUserSettings(env),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.patch('/api/user-settings', async (request, response) => {
    const parsed = userSettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(422).json({
        error: 'invalid_user_settings',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const current = hasSupabaseStore(env)
        ? await getStoredUserSettings(env)
        : DEFAULT_USER_SETTINGS;
      const settings = normalizeUserSettings({
        ...current,
        ...parsed.data,
        notifications: {
          ...current.notifications,
          ...parsed.data.notifications,
        },
      });

      if (!hasSupabaseStore(env)) {
        response.json({
          source: 'demo',
          settings,
        });
        return;
      }

      response.json({
        source: 'meta',
        settings: await updateStoredUserSettings(env, settings),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/pages', async (_request, response) => {
    try {
      if (!(await hasActiveMetaOAuthSession(env))) {
        if (hasSupabaseStore(env)) {
          const storedPages = await getStoredPages(env);

          if (storedPages.length > 0) {
            response.json({
              authRequired: true,
              source: 'meta',
              pages: storedPages,
            });
            return;
          }
        }

        response.status(503).json({
          error: 'meta_login_required',
          message: 'Inicia sesion con Facebook para conectar paginas reales.',
        });
        return;
      }

      const pages = await pagesForListRequest(env);
      response.json({
        source: 'meta',
        pages,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/pages/:pageId', async (request, response) => {
    try {
      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      response.json({
        source: isMetaPageId(request.params.pageId) ? 'meta' : 'demo',
        page,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.patch('/api/pages/:pageId/settings', async (request, response) => {
    const parsed = pageSettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(422).json({
        error: 'invalid_page_settings',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const settings = parsed.data;

      if (!isMetaPageId(request.params.pageId)) {
        response.json({
          source: 'demo',
          page: {
            ...page,
            settings,
          },
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar configuracion.',
        });
        return;
      }

      const updatedPage = await updatePageSettingsInStore(env, request.params.pageId, settings);

      if (!updatedPage) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      response.json({
        source: 'meta',
        page: updatedPage,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/pages/:pageId/meta/disconnect', async (request, response) => {
    try {
      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      if (!isMetaPageId(request.params.pageId)) {
        response.json({
          source: 'demo',
          page,
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para desconectar una pagina.',
        });
        return;
      }

      const updatedPage = await clearStoredPageAccessToken(env, request.params.pageId);

      if (!updatedPage) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      response.json({
        source: 'meta',
        page: updatedPage,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.delete('/api/pages/:pageId', async (request, response) => {
    try {
      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      if (!isMetaPageId(request.params.pageId)) {
        response.json({
          ok: true,
          source: 'demo',
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para eliminar una pagina.',
        });
        return;
      }

      const deleted = await deleteStoredPage(env, request.params.pageId);

      if (!deleted) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      response.json({
        ok: true,
        source: 'meta',
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/pages/:pageId/photos', async (request, response) => {
    try {
      response.json({
        source: isMetaPageId(request.params.pageId) ? 'meta' : 'demo',
        photos: await photosForRequest(env, request.params.pageId),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/pages/:pageId/photos', async (request, response) => {
    const parsed = uploadPhotosSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_photo_upload',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      if (!isMetaPageId(request.params.pageId)) {
        response.status(400).json({
          error: 'demo_page_upload_not_supported',
          message: 'La subida real solo esta habilitada para paginas conectadas a Meta.',
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar fotos.',
        });
        return;
      }

      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const result = await uploadPhotosToStore(env, request.params.pageId, parsed.data.photos);
      response.status(201).json({
        ...result,
        source: 'meta',
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.patch('/api/pages/:pageId/photos/:photoId', async (request, response) => {
    const parsed = updatePhotoMetadataSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_photo_metadata',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      if (!isMetaPageId(request.params.pageId)) {
        const photo = photosForPage(request.params.pageId).find(
          (item) => item.id === request.params.photoId,
        );

        if (!photo) {
          response.status(404).json({ error: 'photo_not_found' });
          return;
        }

        response.json({
          source: 'demo',
          photo: {
            ...photo,
            ...parsed.data,
            context:
              parsed.data.description === undefined ? photo.context : parsed.data.description,
            contextSource:
              parsed.data.description === undefined
                ? photo.contextSource
                : parsed.data.description
                  ? 'manual'
                  : null,
            description:
              parsed.data.description === undefined ? photo.description : parsed.data.description,
            nameSource: parsed.data.name === undefined ? photo.nameSource : 'manual',
            trashedAt:
              parsed.data.status === 'trashed'
                ? new Date().toISOString()
                : parsed.data.status === 'active'
                  ? null
                  : photo.trashedAt,
          },
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar metadata de fotos.',
        });
        return;
      }

      const photo = await updatePhotoMetadataInStore(
        env,
        request.params.pageId,
        request.params.photoId,
        parsed.data,
      );

      if (!photo) {
        response.status(404).json({ error: 'photo_not_found' });
        return;
      }

      response.json({
        source: 'meta',
        photo,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.patch('/api/pages/:pageId/photos/:photoId/context', async (request, response) => {
    const parsed = updatePhotoContextSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_photo_context',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      if (!isMetaPageId(request.params.pageId)) {
        response.status(400).json({
          error: 'demo_page_update_not_supported',
          message:
            'La edicion real de contexto solo esta habilitada para paginas conectadas a Meta.',
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar contexto.',
        });
        return;
      }

      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const photo = await updatePhotoContextInStore(
        env,
        request.params.pageId,
        request.params.photoId,
        parsed.data.context,
      );

      if (!photo) {
        response.status(404).json({ error: 'photo_not_found' });
        return;
      }

      response.json({
        source: 'meta',
        photo,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/pages/:pageId/photos/:photoId/context/ai', async (request, response) => {
    try {
      if (!isMetaPageId(request.params.pageId)) {
        response.status(400).json({
          error: 'demo_page_ai_context_not_supported',
          message: 'El contexto con IA solo esta habilitado para paginas conectadas a Meta.',
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para leer la foto.',
        });
        return;
      }

      if (!hasOpenAiContext(env)) {
        response.status(503).json({
          error: 'openai_not_configured',
          message: 'Falta OPENAI_API_KEY para generar contexto con IA.',
        });
        return;
      }

      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const photo = await getStoredPhoto(env, page.id, request.params.photoId);

      if (!photo) {
        response.status(404).json({ error: 'photo_not_found' });
        return;
      }

      const context = await generatePhotoContext(env, { page, photo });
      const updatedPhoto = await updatePhotoContextInStore(env, page.id, photo.id, context, 'ai');

      response.json({
        source: 'meta',
        photo: updatedPhoto,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/pages/:pageId/calendar', async (request, response) => {
    try {
      response.json({
        source: isMetaPageId(request.params.pageId) ? 'meta' : 'demo',
        items: await calendarForRequest(env, request.params.pageId),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/pages/:pageId/style-history', (request, response) => {
    if (!isMetaPageId(request.params.pageId)) {
      response.json({
        source: 'demo',
        items: styleHistoryForPage(request.params.pageId),
      });
      return;
    }

    getStoredStyleHistory(env, request.params.pageId)
      .then((items) => {
        response.json({
          source: 'meta',
          items,
        });
      })
      .catch((error) => sendApiError(response, error));
  });

  router.get('/api/pages/:pageId/batches', async (request, response) => {
    try {
      if (!isMetaPageId(request.params.pageId)) {
        response.json({
          source: 'demo',
          batches: [...demoBatchesById.values()]
            .filter((batch) => batch.pageId === request.params.pageId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.json({
          source: 'meta',
          batches: [],
        });
        return;
      }

      response.json({
        source: 'meta',
        batches: await getStoredBatches(env, request.params.pageId),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/api/batches/:batchId', async (request, response) => {
    try {
      const demoBatch = demoBatchesById.get(request.params.batchId);

      if (demoBatch) {
        response.json({
          source: 'demo',
          batch: demoBatch,
          variants: [],
          progress: batchProgress(demoBatch),
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(404).json({ error: 'batch_not_found' });
        return;
      }

      const detail = await getStoredBatchDetail(env, request.params.batchId);

      if (!detail) {
        response.status(404).json({ error: 'batch_not_found' });
        return;
      }

      response.json({
        source: 'meta',
        ...detail,
        progress: batchProgress(detail.batch, detail.variants),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/pages/:pageId/batches/draft', async (request, response) => {
    const parsed = batchDraftSchema.safeParse({
      ...request.body,
      pageId: request.params.pageId,
    });

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_batch_draft',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const page = await pageForRequest(env, request.params.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const pagePhotos = await photosForRequest(env, page.id);
      const knownPhotos = new Set(pagePhotos.map((photo) => photo.id));
      const missingPhotoIds = parsed.data.selectedPhotoIds.filter(
        (photoId) => !knownPhotos.has(photoId),
      );

      if (missingPhotoIds.length > 0) {
        response.status(400).json({
          error: 'photos_not_in_active_page',
          missingPhotoIds,
        });
        return;
      }

      if (!isMetaPageId(page.id)) {
        const now = new Date().toISOString();
        const existingBatch = parsed.data.batchId
          ? demoBatchesById.get(parsed.data.batchId)
          : undefined;

        if (
          parsed.data.batchId &&
          (!existingBatch || existingBatch.pageId !== page.id || existingBatch.status !== 'draft')
        ) {
          response.status(409).json({
            error: 'draft_not_editable',
            message: 'El borrador ya no esta disponible para editar.',
          });
          return;
        }

        const existingDraft = existingBatch;
        const demoDraftCount = [...demoBatchesById.values()].filter(
          (batch) => batch.pageId === page.id && batch.status === 'draft',
        ).length;
        const batch: Batch = {
          accentColor: existingDraft?.accentColor ?? '#8EC5FF',
          archivedAt: null,
          cancelledByUser: false,
          contextModeOverrides: parsed.data.contextModeOverrides,
          createdAt: existingDraft?.createdAt ?? now,
          distributionDays: 1,
          failedReason: null,
          id: existingDraft?.id ?? parsed.data.batchId ?? randomUUID(),
          pageId: page.id,
          pendingUploads: parsed.data.pendingUploads,
          selectedPhotoIds: parsed.data.selectedPhotoIds,
          shortLabel: existingDraft?.shortLabel ?? `Lote ${String.fromCharCode(65 + demoDraftCount)}`,
          skipReview: parsed.data.skipReview,
          status: 'draft',
          updatedAt: now,
          variantsPerPhoto: parsed.data.variantsPerPhoto,
        };

        demoBatchesById.set(batch.id, batch);
        response.status(existingDraft ? 200 : 201).json({
          source: 'demo',
          batch,
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar borradores.',
        });
        return;
      }

      const batch = await upsertDraftBatchToStore(env, parsed.data);
      response.status(parsed.data.batchId ? 200 : 201).json({
        source: 'meta',
        batch,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/batches/:batchId/archive', async (request, response) => {
    try {
      const demoBatch = demoBatchesById.get(request.params.batchId);

      if (demoBatch) {
        const archived: Batch = {
          ...demoBatch,
          archivedAt: new Date().toISOString(),
          cancelledByUser: Boolean(request.body?.cancelledByUser),
          status: 'archived',
          updatedAt: new Date().toISOString(),
        };
        const currentCalendar = demoCalendarItemsByPage.get(archived.pageId) ?? [];

        demoCalendarItemsByPage.set(
          archived.pageId,
          currentCalendar.filter((item) => !item.variantId?.startsWith(`${archived.id}-`)),
        );
        demoBatchesById.set(archived.id, archived);
        response.json({
          source: 'demo',
          batch: archived,
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(404).json({ error: 'batch_not_found' });
        return;
      }

      const batch = await archiveStoredBatch(
        env,
        request.params.batchId,
        Boolean(request.body?.cancelledByUser),
      );

      if (!batch) {
        response.status(404).json({ error: 'batch_not_found' });
        return;
      }

      response.json({
        source: 'meta',
        batch,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/scheduling/suggest', async (request, response) => {
    const parsed = scheduleSuggestionSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_schedule_suggestion',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const page = await pageForRequest(env, parsed.data.pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const history =
        isMetaPageId(page.id) && hasSupabaseStore(env)
          ? await getStoredSchedulingHistory(env, page.id)
          : [];

      response.json({
        source: isMetaPageId(page.id) ? 'meta' : 'demo',
        schedule: suggestSmartSchedule({
          businessHours: parsed.data.businessHours ?? page.settings.scheduling.businessHours,
          distributionDays: parsed.data.distributionDays,
          history,
          occupiedSlots: parsed.data.occupiedSlots,
          scheduling: page.settings.scheduling,
          variantIds: parsed.data.variantIds,
        }),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/batches/preview', async (request, response) => {
    const parsed = batchPreviewSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_batch_preview',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const { pageId, photoIds, variantsPerPhoto, distributionDays } = parsed.data;
      const page = await pageForRequest(env, pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const pagePhotos = await photosForRequest(env, pageId);
      const knownPhotos = new Set(pagePhotos.map((photo) => photo.id));
      const missingPhotoIds = photoIds.filter((photoId) => !knownPhotos.has(photoId));

      if (missingPhotoIds.length > 0) {
        response.status(400).json({
          error: 'photos_not_in_active_page',
          missingPhotoIds,
        });
        return;
      }

      const pageCalendar = await calendarForRequest(env, pageId);
      const recentHistory = isMetaPageId(pageId) ? [] : styleHistoryForPage(pageId);
      const assignments = assignStylesToVariants({
        pageSettings: page.settings,
        photos: photoIds.map((photoId) => ({
          photoId,
          variants: variantsPerPhoto,
        })),
        recentHistory,
      });
      const variantIds = assignments.map((assignment) => {
        return `${assignment.photoId}-${assignment.variantIndex + 1}`;
      });
      const scheduled = scheduleVariants({
        variantIds,
        distributionDays,
        businessHours: page.settings.scheduling.businessHours,
        scheduling: page.settings.scheduling,
        occupiedSlots: pageCalendar.map((item) => item.scheduledAt),
      });

      response.json({
        source: isMetaPageId(pageId) ? 'meta' : 'demo',
        pageId,
        assignments: assignments.map((assignment, index) => ({
          ...assignment,
          variantId: variantIds[index],
          prompt: buildImagePrompt(assignment.style),
        })),
        schedule: calendarItemsFromSchedule(pageId, scheduled),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/batches/generate', async (request, response) => {
    const parsed = batchGenerateSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_batch_generation',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const { pageId, variants } = parsed.data;
      const page = await pageForRequest(env, pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const pagePhotos = await photosForRequest(env, pageId);
      const photosById = new Map(pagePhotos.map((photo) => [photo.id, photo]));
      const missingPhotoIds = variants
        .map((variant) => variant.photoId)
        .filter((photoId) => !photosById.has(photoId));

      if (missingPhotoIds.length > 0) {
        response.status(400).json({
          error: 'photos_not_in_active_page',
          missingPhotoIds: [...new Set(missingPhotoIds)],
        });
        return;
      }

      if (!isMetaPageId(pageId)) {
        response.json({
          source: 'demo',
          variants: variants.map((variant) => {
            const photo = photosById.get(variant.photoId)!;
            const id = `${variant.photoId}-${variant.variantIndex + 1}`;

            return {
              generatedImagePath: null,
              id,
              imageUrl: photo.thumbnailUrl,
              photoId: variant.photoId,
              prompt: buildImagePrompt(variant.style),
              status: 'ready',
              style: variant.style,
              text: buildFallbackPublicationText(page, photo, variant.style),
              variantIndex: variant.variantIndex,
            };
          }),
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar variantes generadas.',
        });
        return;
      }

      if (!hasOpenAiContext(env)) {
        throw new OpenAiContextError('Falta OPENAI_API_KEY para generar variantes.', 503);
      }

      const generatedVariants = await mapWithConcurrency(variants, 2, async (variant) => {
        const photo = photosById.get(variant.photoId)!;
        const id = `${variant.photoId}-${variant.variantIndex + 1}`;
        const sourceImage = await fetchImageForGeneration(photo.thumbnailUrl);
        const [generatedImage, generatedText] = await Promise.all([
          generateImageVariant(env, {
            image: sourceImage.buffer,
            mimeType: sourceImage.mimeType,
            page,
            photo,
            style: variant.style,
          }),
          generatePublicationText(env, { page, photo, style: variant.style }).catch(() =>
            buildFallbackPublicationText(page, photo, variant.style),
          ),
        ]);
        const uploaded = await uploadGeneratedVariantImageToStore(
          env,
          page.id,
          id,
          generatedImage.buffer,
          generatedImage.mimeType,
        );

        return {
          generatedImagePath: uploaded.storagePath,
          id,
          imageUrl: uploaded.imageUrl,
          photoId: variant.photoId,
          prompt: generatedImage.prompt,
          status: 'ready',
          style: variant.style,
          text: generatedText,
          variantIndex: variant.variantIndex,
        };
      });

      response.status(201).json({
        source: 'meta',
        variants: generatedVariants,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.post('/api/batches', async (request, response) => {
    const parsed = batchCommitSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_batch_commit',
        issues: parsed.error.issues,
      });
      return;
    }

    try {
      const { pageId, variants } = parsed.data;
      const page = await pageForRequest(env, pageId);

      if (!page) {
        response.status(404).json({ error: 'page_not_found' });
        return;
      }

      const pagePhotos = await photosForRequest(env, pageId);
      const knownPhotos = new Set(pagePhotos.map((photo) => photo.id));
      const missingPhotoIds = variants
        .map((variant) => variant.photoId)
        .filter((photoId) => !knownPhotos.has(photoId));

      if (missingPhotoIds.length > 0) {
        response.status(400).json({
          error: 'photos_not_in_active_page',
          missingPhotoIds: [...new Set(missingPhotoIds)],
        });
        return;
      }

      if (!isMetaPageId(pageId)) {
        const now = new Date().toISOString();
        const activeCount = [...demoBatchesById.values()].filter(
          (batch) => batch.pageId === pageId && isActiveBatchStatus(batch.status),
        ).length;
        const conflicts = findScheduleConflicts(
          variants.map((variant) => variant.scheduledAt),
          demoCalendarForPage(pageId).map((item) => item.scheduledAt),
          page.settings.scheduling.minGapMinutes,
        );

        if (activeCount >= 3) {
          response.status(409).json({
            error: 'active_batch_limit',
            message: 'La pagina ya tiene 3 lotes activos.',
          });
          return;
        }

        const batchId = `demo-batch-${Date.now()}`;
        const calendar = variants.map((variant, index) => ({
          id: `${batchId}-calendar-${index + 1}`,
          pageId,
          scheduledAt: variant.scheduledAt,
          status: 'scheduled' as const,
          title: `Publicacion ${index + 1}`,
          variantId: `${batchId}-variant-${index + 1}`,
        }));

        if (conflicts.length > 0) {
          response.status(409).json({
            error: 'schedule_conflict',
            message: 'Algunos horarios ya no estan disponibles.',
          });
          return;
        }

        const demoBatch: Batch = {
          accentColor: BATCH_ACCENT_COLORS[activeCount % BATCH_ACCENT_COLORS.length] ?? '#8EC5FF',
          archivedAt: null,
          cancelledByUser: false,
          contextModeOverrides: {},
          createdAt: now,
          distributionDays: parsed.data.distributionDays,
          failedReason: null,
          id: batchId,
          pageId,
          pendingUploads: [],
          selectedPhotoIds: [...new Set(variants.map((variant) => variant.photoId))],
          shortLabel: createBatchLabel(activeCount),
          skipReview: parsed.data.skipReview,
          status: 'scheduling',
          updatedAt: now,
          variantsPerPhoto: parsed.data.variantsPerPhoto,
        };
        demoBatchesById.set(batchId, demoBatch);
        demoCalendarItemsByPage.set(pageId, [
          ...(demoCalendarItemsByPage.get(pageId) ?? []),
          ...calendar,
        ]);

        response.json({
          batchId,
          calendar,
          source: 'demo',
          variantsCount: variants.length,
        });
        return;
      }

      if (!hasSupabaseStore(env)) {
        response.status(503).json({
          error: 'supabase_not_configured',
          message: 'Falta configurar Supabase para guardar el lote.',
        });
        return;
      }

      const result = await commitBatchToStore(env, parsed.data);
      response.status(201).json({
        ...result,
        source: 'meta',
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  router.get('/demo/pages', (_request, response) => {
    response.json({
      pages: demoPages,
    });
  });

  router.get('/demo/pages/:pageId', (request, response) => {
    const page = findPage(request.params.pageId);

    if (!page) {
      response.status(404).json({ error: 'page_not_found' });
      return;
    }

    response.json({ page });
  });

  router.get('/demo/pages/:pageId/photos', (request, response) => {
    response.json({
      photos: photosForPage(request.params.pageId),
    });
  });

  router.get('/demo/pages/:pageId/calendar', (request, response) => {
    response.json({
      items: demoCalendarForPage(request.params.pageId),
    });
  });

  router.post('/demo/batches/preview', (request, response) => {
    const parsed = batchPreviewSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_batch_preview',
        issues: parsed.error.issues,
      });
      return;
    }

    const { pageId, photoIds, variantsPerPhoto, distributionDays } = parsed.data;
    const page = findPage(pageId);

    if (!page) {
      response.status(404).json({ error: 'page_not_found' });
      return;
    }

    const knownPhotos = new Set(photosForPage(pageId).map((photo) => photo.id));
    const missingPhotoIds = photoIds.filter((photoId) => !knownPhotos.has(photoId));

    if (missingPhotoIds.length > 0) {
      response.status(400).json({
        error: 'photos_not_in_active_page',
        missingPhotoIds,
      });
      return;
    }

    const assignments = assignStylesToVariants({
      pageSettings: page.settings,
      photos: photoIds.map((photoId) => ({
        photoId,
        variants: variantsPerPhoto,
      })),
      recentHistory: styleHistoryForPage(pageId),
    });
    const variantIds = assignments.map((assignment) => {
      return `${assignment.photoId}-${assignment.variantIndex + 1}`;
    });
    const scheduled = scheduleVariants({
      variantIds,
      distributionDays,
      businessHours: page.settings.scheduling.businessHours,
      scheduling: page.settings.scheduling,
      occupiedSlots: demoCalendarForPage(pageId).map((item) => item.scheduledAt),
    });

    response.json({
      pageId,
      assignments: assignments.map((assignment, index) => ({
        ...assignment,
        variantId: variantIds[index],
        prompt: buildImagePrompt(assignment.style),
      })),
      schedule: calendarItemsFromSchedule(pageId, scheduled),
    });
  });

  return router;
}

async function pagesForListRequest(env: ServerEnv) {
  try {
    return hasSupabaseStore(env)
      ? await syncMetaPagesToStore(env, await getMetaPageSnapshots(env))
      : await getMetaPages(env);
  } catch (error) {
    if (hasSupabaseStore(env) && error instanceof MetaGraphError) {
      const storedPages = await getStoredPages(env);

      if (storedPages.length > 0) {
        return storedPages;
      }
    }

    throw error;
  }
}

function createOAuthState(env: ServerEnv, target: OAuthReturnTarget): string {
  const issuedAt = String(Date.now());
  const nonce = randomUUID();
  const payload = `${issuedAt}.${nonce}.${target}`;
  const signature = signOAuthState(env, payload);

  return `${payload}.${signature}`;
}

function parseOAuthState(env: ServerEnv, state: string): OAuthStatePayload | undefined {
  const parts = state.split('.');

  if (parts.length !== 3 && parts.length !== 4) {
    return undefined;
  }

  const [issuedAtText, nonce] = parts;
  const target = parts.length === 4 ? normalizeOAuthReturnTarget(parts[2]) : 'web';
  const signature = parts.at(-1);

  if (!issuedAtText || !nonce || !signature) {
    return undefined;
  }

  const issuedAt = Number(issuedAtText);
  const now = Date.now();

  if (!Number.isFinite(issuedAt)) {
    return undefined;
  }

  if (now - issuedAt > oauthStateTtlMs || issuedAt - now > oauthStateFutureSkewMs) {
    return undefined;
  }

  const payload = parts.length === 4 ? `${issuedAtText}.${nonce}.${target}` : `${issuedAtText}.${nonce}`;

  if (!safeEqual(signature, signOAuthState(env, payload))) {
    return undefined;
  }

  return { target };
}

function signOAuthState(env: ServerEnv, payload: string): string {
  return createHmac('sha256', env.metaAppSecret ?? 'cadencia-local-oauth-state')
    .update(payload)
    .digest('base64url');
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return (
    valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

function normalizeOAuthReturnTarget(value: unknown): OAuthReturnTarget {
  return value === 'mobile' ? 'mobile' : 'web';
}

function normalizeMetaOAuthError(query: Record<string, unknown>): string {
  const candidates = [
    query.error_message,
    query.error_description,
    query.error_reason,
    query.error,
  ];

  return candidates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value.length > 0) ?? '';
}

function buildOAuthReturnUrl(
  env: ServerEnv,
  target: OAuthReturnTarget,
  path: string,
  query: Record<string, string>,
): string {
  const baseUrl = target === 'mobile' ? env.mobileDeepLinkBaseUrl : env.appBaseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizedPath, baseUrl);

  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

async function pageForRequest(env: ServerEnv, pageId: string) {
  if (isMetaPageId(pageId)) {
    if (!hasSupabaseStore(env)) {
      return getMetaPage(env, pageId);
    }

    const stored = await getStoredPage(env, pageId);

    if (stored) {
      return stored;
    }

    const pages = await syncMetaPagesToStore(env, await getMetaPageSnapshots(env));
    return pages.find((page) => page.id === pageId);
  }

  return findPage(pageId);
}

async function photosForRequest(env: ServerEnv, pageId: string) {
  if (isMetaPageId(pageId)) {
    return hasSupabaseStore(env) ? getStoredPhotos(env, pageId) : [];
  }

  return photosForPage(pageId);
}

async function calendarForRequest(env: ServerEnv, pageId: string) {
  if (isMetaPageId(pageId)) {
    return hasSupabaseStore(env) ? getStoredCalendar(env, pageId) : [];
  }

  return demoCalendarForPage(pageId);
}

async function fetchImageForGeneration(
  imageUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    throw new OpenAiContextError('No pude leer la foto base para generar variantes.', 502);
  }

  return {
    buffer: Buffer.from(await imageResponse.arrayBuffer()),
    mimeType: normalizeImageMimeType(imageResponse.headers.get('content-type')),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];

      if (item === undefined) {
        continue;
      }

      results[index] = await mapper(item, index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function normalizeImageMimeType(value: string | null): string {
  const mimeType = value?.split(';')[0]?.trim().toLowerCase();

  if (mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/jpeg') {
    return mimeType;
  }

  return 'image/jpeg';
}

function buildFallbackPublicationText(page: Page, photo: Photo, style: string): string {
  const settings = page.settings;
  const context = photo.context ?? photo.description ?? photo.name;
  const signature = settings.brand.signature ? `\n\n${settings.brand.signature}` : '';
  const hashtags =
    settings.brand.defaultHashtags.length > 0
      ? `\n\n${settings.brand.defaultHashtags.join(' ')}`
      : '';

  return [
    `${page.name}: una propuesta con estilo ${style}.`,
    context ? `Foto base: ${context}` : 'Lista para compartir con tu comunidad.',
    settings.generation.promptSuffix,
  ]
    .filter(Boolean)
    .join(' ')
    .concat(signature, hashtags)
    .slice(0, 2200);
}

function demoCalendarForPage(pageId: string): CalendarItem[] {
  return [
    ...calendarForPage(pageId),
    ...(demoCalendarItemsByPage.get(pageId) ?? []),
  ].sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}

function sendMetaError(response: Response, error: unknown) {
  if (error instanceof MetaGraphError) {
    response.status(error.status >= 500 ? 502 : error.status).json({
      error: 'meta_unavailable',
      message: error.message,
      meta: {
        code: error.code,
        subcode: error.subcode,
        type: error.type,
      },
    });
    return;
  }

  response.status(500).json({
    error: 'internal_error',
    message: 'No se pudo completar la operacion.',
  });
}

function sendApiError(response: Response, error: unknown) {
  if (error instanceof SupabaseStoreError) {
    response.status(error.status).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  if (error instanceof OpenAiContextError) {
    response.status(error.status).json({
      error: 'openai_unavailable',
      message: error.message,
    });
    return;
  }

  sendMetaError(response, error);
}

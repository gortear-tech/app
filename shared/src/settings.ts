import { z } from 'zod';
import { DEFAULT_GALLERY_TAXONOMY } from './types.js';
import { STYLE_CATALOG_ITEMS } from './styles.js';
import type {
  AppLanguage,
  AppTheme,
  BrandVoice,
  BusinessHours,
  DefaultContextMode,
  GalleryQualityThresholds,
  GallerySettings,
  NotificationChannels,
  NotificationEventKey,
  PageGenerationSettings,
  PageNotificationOverride,
  PageSettings,
  PageStyleSettings,
  PostingLanguage,
  QuietHours,
  UserSettings,
  WeekdayKey,
} from './types.js';

export const NOTIFICATION_EVENTS: Array<{
  key: NotificationEventKey;
  title: string;
  description: string;
}> = [
  {
    key: 'batch_completed',
    title: 'Lote listo para revisar',
    description: 'Cuando una generacion termina y espera revision.',
  },
  {
    key: 'batch_generation_completed',
    title: 'Generacion completada',
    description: 'Cuando un lote termina de crear variantes.',
  },
  {
    key: 'batch_generation_failed_partial',
    title: 'Algunas variantes fallaron',
    description: 'Cuando un lote termina con variantes pendientes de reintento.',
  },
  {
    key: 'batch_generation_failed_total',
    title: 'Lote fallido',
    description: 'Cuando ninguna variante del lote pudo crearse.',
  },
  {
    key: 'batch_scheduled',
    title: 'Lote programado',
    description: 'Cuando el modo rapido deja publicaciones en calendario.',
  },
  {
    key: 'draft_purge_warning',
    title: 'Borrador por vencer',
    description: 'Aviso antes de borrar un borrador inactivo.',
  },
  {
    key: 'variant_rejected',
    title: 'Variante rechazada',
    description: 'Cuando el modelo descarta una variante generada.',
  },
  {
    key: 'publish_succeeded',
    title: 'Publicacion realizada',
    description: 'Cuando una publicacion se envia a Facebook.',
  },
  {
    key: 'generation_error',
    title: 'Error de generacion',
    description: 'Cuando IA o almacenamiento fallan durante un lote.',
  },
  {
    key: 'fb_token_expiring',
    title: 'Token de Facebook por expirar',
    description: 'Aviso para reconectar antes de perder permisos.',
  },
  {
    key: 'openai_quota_warning',
    title: 'Cuota de OpenAI cerca del limite',
    description: 'Aviso preventivo para evitar interrupciones.',
  },
  {
    key: 'weekly_summary',
    title: 'Resumen semanal',
    description: 'Resumen de actividad y publicaciones de la semana.',
  },
];

export const DEFAULT_NOTIFICATION_CHANNELS: Record<NotificationEventKey, NotificationChannels> = {
  batch_completed: { push: true, email: false },
  batch_generation_completed: { push: true, email: false },
  batch_generation_failed_partial: { push: true, email: false },
  batch_generation_failed_total: { push: true, email: true },
  batch_scheduled: { push: true, email: false },
  draft_purge_warning: { push: true, email: false },
  variant_rejected: { push: true, email: false },
  publish_succeeded: { push: false, email: false },
  generation_error: { push: true, email: true },
  fb_token_expiring: { push: true, email: true },
  openai_quota_warning: { push: true, email: true },
  weekly_summary: { push: false, email: true },
};

export const DEFAULT_PAGE_NOTIFICATION_OVERRIDES: Record<
  NotificationEventKey,
  PageNotificationOverride
> = {
  batch_completed: 'inherit',
  batch_generation_completed: 'inherit',
  batch_generation_failed_partial: 'inherit',
  batch_generation_failed_total: 'inherit',
  batch_scheduled: 'inherit',
  draft_purge_warning: 'inherit',
  variant_rejected: 'inherit',
  publish_succeeded: 'inherit',
  generation_error: 'inherit',
  fb_token_expiring: 'inherit',
  openai_quota_warning: 'inherit',
  weekly_summary: 'inherit',
};

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  start: '09:00',
  end: '20:00',
};

export const DEFAULT_ACTIVE_DAYS: WeekdayKey[] = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

export const DEFAULT_GALLERY_QUALITY_THRESHOLDS: GalleryQualityThresholds = {
  blur: 0.42,
  exposureMax: 0.92,
  exposureMin: 0.18,
  minResolution: 1200000,
};

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  autoArchiveAfterDays: 0,
  defaultSort: 'recent',
  duplicatePolicy: 'block',
  namingLanguage: 'es',
  qualityThresholds: DEFAULT_GALLERY_QUALITY_THRESHOLDS,
  stackTimeWindowMinutes: 5,
  taxonomy: [...DEFAULT_GALLERY_TAXONOMY],
};

export const DEFAULT_STYLE_SETTINGS: PageStyleSettings = {
  active: STYLE_CATALOG_ITEMS.map((style) => style.id),
  custom: [],
};

export const DEFAULT_GENERATION_SETTINGS: PageGenerationSettings = {
  defaultContextMode: 'ai',
  defaultVariantsPerPhoto: 3,
  imageModel: 'gpt_image_2',
  postingLanguage: 'inherit',
  promptSuffix: '',
  seoKeywords: [],
  skipReviewDefault: false,
  textModel: 'gpt_4o_mini',
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = withLegacySettings({
  brand: {
    brandColors: [],
    defaultHashtags: [],
    defaultMentions: [],
    logoUrl: null,
    signature: '',
    voice: 'amigable',
    voiceCustom: '',
  },
  generation: DEFAULT_GENERATION_SETTINGS,
  styles: DEFAULT_STYLE_SETTINGS,
  scheduling: {
    activeDays: DEFAULT_ACTIVE_DAYS,
    businessHours: DEFAULT_BUSINESS_HOURS,
    distributeEvenly: true,
    maxPostsPerDay: 4,
    minGapMinutes: 60,
    startTodayOrTomorrow: 'tomorrow',
    timezone: 'inherit',
  },
  gallery: DEFAULT_GALLERY_SETTINGS,
  notifications: DEFAULT_PAGE_NOTIFICATION_OVERRIDES,
});

export const DEFAULT_USER_SETTINGS: UserSettings = {
  betaFeatures: [],
  defaultTimezone: 'auto',
  displayName: 'Usuario de Cadencia',
  email: '',
  language: 'es',
  notifications: DEFAULT_NOTIFICATION_CHANNELS,
  quietHours: null,
  region: 'MX',
  theme: 'system',
  userId: 'meta-user',
};

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const notificationEventSchema = z.enum([
  'batch_completed',
  'batch_generation_completed',
  'batch_generation_failed_partial',
  'batch_generation_failed_total',
  'batch_scheduled',
  'draft_purge_warning',
  'variant_rejected',
  'publish_succeeded',
  'generation_error',
  'fb_token_expiring',
  'openai_quota_warning',
  'weekly_summary',
] as const satisfies readonly NotificationEventKey[]);

export const userSettingsSchema = z
  .object({
    betaFeatures: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    defaultTimezone: z.string().trim().min(1).max(80).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().max(180).optional(),
    language: z.enum(['es', 'en'] as const satisfies readonly AppLanguage[]).optional(),
    notifications: z
      .record(notificationEventSchema, z.object({ push: z.boolean(), email: z.boolean() }))
      .optional(),
    quietHours: z.object({ start: timeSchema, end: timeSchema }).nullable().optional(),
    region: z.string().trim().min(2).max(8).optional(),
    theme: z.enum(['system', 'light', 'dark'] as const satisfies readonly AppTheme[]).optional(),
    userId: z.string().trim().min(1).optional(),
  })
  .passthrough();

const pageSettingsObjectSchema = z
  .object({
    brand: z
      .object({
        brandColors: z
          .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
          .max(12)
          .optional(),
        defaultHashtags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
        defaultMentions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        logoUrl: z.string().trim().url().nullable().optional(),
        signature: z.string().max(100).optional(),
        voice: z
          .enum([
            'amigable',
            'formal',
            'entusiasta',
            'informativo',
            'humoristico',
            'inspirador',
          ] as const satisfies readonly BrandVoice[])
          .optional(),
        voiceCustom: z.string().max(280).optional(),
        voice_custom: z.string().max(280).optional(),
        default_hashtags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
        default_mentions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        brand_colors: z
          .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
          .max(12)
          .optional(),
        logo_url: z.string().trim().url().nullable().optional(),
      })
      .passthrough()
      .optional(),
    generation: z
      .object({
        defaultContextMode: z
          .enum(['ai', 'manual'] as const satisfies readonly DefaultContextMode[])
          .optional(),
        defaultVariantsPerPhoto: z.number().int().min(1).max(10).optional(),
        imageModel: z.string().trim().min(1).max(80).optional(),
        postingLanguage: z
          .enum(['es', 'en', 'auto', 'inherit'] as const satisfies readonly PostingLanguage[])
          .optional(),
        promptSuffix: z.string().max(800).optional(),
        seoKeywords: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
        skipReviewDefault: z.boolean().optional(),
        textModel: z.string().trim().min(1).max(80).optional(),
        default_context_mode: z.enum(['ai', 'manual']).optional(),
        default_variants_per_photo: z.number().int().min(1).max(10).optional(),
        image_model: z.string().trim().min(1).max(80).optional(),
        posting_language: z.enum(['es', 'en', 'auto', 'inherit']).optional(),
        prompt_suffix: z.string().max(800).optional(),
        seo_keywords: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
        skip_review_default: z.boolean().optional(),
        text_model: z.string().trim().min(1).max(80).optional(),
      })
      .passthrough()
      .optional(),
    styles: z
      .object({
        active: z.array(z.string().trim().min(1).max(120)).min(5).max(80).optional(),
        custom: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(80),
              name: z.string().trim().min(1).max(80),
              prompt: z.string().trim().min(1).max(300),
            }),
          )
          .max(20)
          .optional(),
      })
      .passthrough()
      .optional(),
    scheduling: z
      .object({
        activeDays: z
          .array(
            z.enum([
              'lun',
              'mar',
              'mie',
              'jue',
              'vie',
              'sab',
              'dom',
            ] as const satisfies readonly WeekdayKey[]),
          )
          .min(1)
          .max(7)
          .optional(),
        active_days: z
          .array(z.enum(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']))
          .min(1)
          .max(7)
          .optional(),
        businessHours: z.object({ start: timeSchema, end: timeSchema }).optional(),
        business_hours: z.object({ start: timeSchema, end: timeSchema }).optional(),
        distributeEvenly: z.boolean().optional(),
        distribute_evenly: z.boolean().optional(),
        maxPostsPerDay: z.number().int().min(1).max(50).optional(),
        max_posts_per_day: z.number().int().min(1).max(50).optional(),
        minGapMinutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .optional(),
        min_gap_minutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .optional(),
        startTodayOrTomorrow: z.enum(['today', 'tomorrow']).optional(),
        start_today_or_tomorrow: z.enum(['today', 'tomorrow']).optional(),
        timezone: z.string().trim().min(1).max(80).optional(),
      })
      .passthrough()
      .optional(),
    gallery: z
      .object({
        autoArchiveAfterDays: z.number().int().min(0).max(3650).optional(),
        auto_archive_after_days: z.number().int().min(0).max(3650).optional(),
        defaultSort: z.enum(['recent', 'oldest', 'most_used']).optional(),
        default_sort: z.enum(['recent', 'oldest', 'most_used']).optional(),
        duplicatePolicy: z.enum(['block', 'warn_only']).optional(),
        duplicate_policy: z.enum(['block', 'warn_only']).optional(),
        namingLanguage: z.enum(['es', 'en']).optional(),
        naming_language: z.enum(['es', 'en']).optional(),
        qualityThresholds: z
          .object({
            blur: z.number().min(0),
            exposureMax: z.number().min(0).max(1),
            exposureMin: z.number().min(0).max(1),
            minResolution: z.number().int().min(0),
          })
          .optional(),
        quality_thresholds: z.record(z.any()).optional(),
        stackTimeWindowMinutes: z.number().int().min(1).max(120).optional(),
        stack_time_window_minutes: z.number().int().min(1).max(120).optional(),
        taxonomy: z.array(z.string().trim().min(1).max(80)).min(1).max(40).optional(),
      })
      .passthrough()
      .optional(),
    notifications: z
      .record(notificationEventSchema, z.enum(['inherit', 'enabled', 'disabled']))
      .optional(),
    businessHours: z.object({ start: timeSchema, end: timeSchema }).optional(),
    defaultContextMode: z.enum(['ai', 'manual']).optional(),
    preferredImageModels: z.array(z.string().trim().min(1).max(80)).min(1).max(5).optional(),
    seoKeywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    skipReviewDefault: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    const normalized = normalizePageSettings(value);

    if (!isValidBusinessWindow(normalized.scheduling.businessHours)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El horario comercial debe durar al menos 1 hora y terminar despues de iniciar.',
        path: ['scheduling', 'businessHours'],
      });
    }

    const badHashtag = normalized.brand.defaultHashtags.find(
      (hashtag) => !/^#[^\s#]{1,39}$/.test(hashtag),
    );

    if (badHashtag) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cada hashtag debe iniciar con #, no tener espacios y medir maximo 40 caracteres.',
        path: ['brand', 'defaultHashtags'],
      });
    }

    if (normalized.styles.active.length < 5) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se necesitan al menos 5 estilos activos.',
        path: ['styles', 'active'],
      });
    }
  });

export const pageSettingsSchema = pageSettingsObjectSchema.transform((value) =>
  normalizePageSettings(value),
);

export function normalizeUserSettings(
  input: Partial<UserSettings> | Record<string, unknown> | null | undefined,
): UserSettings {
  const source = (input ?? {}) as Record<string, any>;
  const notifications = normalizeNotificationChannels(source.notifications);

  return {
    betaFeatures: uniqueClean(source.betaFeatures ?? source.beta_features ?? []),
    createdAt: source.createdAt ?? source.created_at,
    defaultTimezone: stringOr(source.defaultTimezone ?? source.default_timezone, 'auto'),
    displayName: stringOr(
      source.displayName ?? source.display_name,
      DEFAULT_USER_SETTINGS.displayName,
    ),
    email: stringOr(source.email, ''),
    language: source.language === 'en' ? 'en' : 'es',
    notifications,
    quietHours: normalizeQuietHours(source.quietHours ?? source.quiet_hours),
    region: stringOr(source.region, 'MX'),
    theme: isTheme(source.theme) ? source.theme : 'system',
    updatedAt: source.updatedAt ?? source.updated_at,
    userId: stringOr(source.userId ?? source.user_id, 'meta-user'),
  };
}

function normalizeNotificationChannels(
  input: Record<string, Partial<NotificationChannels>> | undefined,
): Record<NotificationEventKey, NotificationChannels> {
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => {
      const current = input?.[event.key];
      const defaults = DEFAULT_NOTIFICATION_CHANNELS[event.key];

      return [
        event.key,
        {
          email: typeof current?.email === 'boolean' ? current.email : defaults.email,
          push: typeof current?.push === 'boolean' ? current.push : defaults.push,
        },
      ];
    }),
  ) as Record<NotificationEventKey, NotificationChannels>;
}

export function normalizePageSettings(
  input: Partial<PageSettings> | Record<string, unknown> | null | undefined,
): PageSettings {
  const source = (input ?? {}) as Record<string, any>;
  const generationSource = source.generation ?? {};
  const schedulingSource = source.scheduling ?? {};
  const brandSource = source.brand ?? {};
  const gallerySource = source.gallery ?? {};
  const generation: PageGenerationSettings = {
    defaultContextMode: normalizeContextMode(
      generationSource.defaultContextMode ??
        generationSource.default_context_mode ??
        source.defaultContextMode,
    ),
    defaultVariantsPerPhoto: clampInt(
      generationSource.defaultVariantsPerPhoto ?? generationSource.default_variants_per_photo,
      1,
      10,
      DEFAULT_GENERATION_SETTINGS.defaultVariantsPerPhoto,
    ),
    imageModel: stringOr(
      generationSource.imageModel ??
        generationSource.image_model ??
        source.preferredImageModels?.[0],
      DEFAULT_GENERATION_SETTINGS.imageModel,
    ),
    postingLanguage: normalizePostingLanguage(
      generationSource.postingLanguage ?? generationSource.posting_language,
    ),
    promptSuffix: stringOr(
      generationSource.promptSuffix ?? generationSource.prompt_suffix,
      '',
    ).slice(0, 800),
    seoKeywords: uniqueClean(
      generationSource.seoKeywords ?? generationSource.seo_keywords ?? source.seoKeywords ?? [],
    ).slice(0, 20),
    skipReviewDefault: Boolean(
      generationSource.skipReviewDefault ??
      generationSource.skip_review_default ??
      source.skipReviewDefault ??
      false,
    ),
    textModel: stringOr(
      generationSource.textModel ?? generationSource.text_model,
      DEFAULT_GENERATION_SETTINGS.textModel,
    ),
  };

  return withLegacySettings({
    brand: {
      brandColors: uniqueClean(brandSource.brandColors ?? brandSource.brand_colors ?? []),
      defaultHashtags: uniqueClean(
        brandSource.defaultHashtags ?? brandSource.default_hashtags ?? [],
      ).slice(0, 30),
      defaultMentions: uniqueClean(
        brandSource.defaultMentions ?? brandSource.default_mentions ?? [],
      ).slice(0, 30),
      logoUrl: stringOrNull(brandSource.logoUrl ?? brandSource.logo_url),
      signature: stringOr(brandSource.signature, '').slice(0, 100),
      voice: normalizeBrandVoice(brandSource.voice),
      voiceCustom: stringOr(brandSource.voiceCustom ?? brandSource.voice_custom, '').slice(0, 280),
    },
    generation,
    styles: {
      active: uniqueStyleIds(source.styles?.active ?? DEFAULT_STYLE_SETTINGS.active),
      custom: Array.isArray(source.styles?.custom) ? source.styles.custom.slice(0, 20) : [],
    },
    scheduling: {
      activeDays: normalizeActiveDays(schedulingSource.activeDays ?? schedulingSource.active_days),
      businessHours:
        schedulingSource.businessHours ??
        schedulingSource.business_hours ??
        source.businessHours ??
        DEFAULT_BUSINESS_HOURS,
      distributeEvenly: Boolean(
        schedulingSource.distributeEvenly ?? schedulingSource.distribute_evenly ?? true,
      ),
      maxPostsPerDay: clampInt(
        schedulingSource.maxPostsPerDay ?? schedulingSource.max_posts_per_day,
        1,
        50,
        4,
      ),
      minGapMinutes: clampInt(
        schedulingSource.minGapMinutes ?? schedulingSource.min_gap_minutes,
        5,
        24 * 60,
        60,
      ),
      startTodayOrTomorrow:
        schedulingSource.startTodayOrTomorrow === 'today' ||
        schedulingSource.start_today_or_tomorrow === 'today'
          ? 'today'
          : 'tomorrow',
      timezone: stringOr(schedulingSource.timezone, 'inherit'),
    },
    gallery: normalizeGallerySettings(gallerySource),
    notifications: normalizePageNotificationOverrides(source.notifications),
  });
}

export function serializePageSettings(settings: PageSettings): Record<string, unknown> {
  const normalized = normalizePageSettings(settings);

  return {
    brand: {
      voice: normalized.brand.voice,
      voice_custom: normalized.brand.voiceCustom,
      default_hashtags: normalized.brand.defaultHashtags,
      default_mentions: normalized.brand.defaultMentions,
      signature: normalized.brand.signature,
      brand_colors: normalized.brand.brandColors,
      logo_url: normalized.brand.logoUrl,
    },
    generation: {
      default_variants_per_photo: normalized.generation.defaultVariantsPerPhoto,
      skip_review_default: normalized.generation.skipReviewDefault,
      default_context_mode: normalized.generation.defaultContextMode,
      image_model: normalized.generation.imageModel,
      text_model: normalized.generation.textModel,
      posting_language: normalized.generation.postingLanguage,
      seo_keywords: normalized.generation.seoKeywords,
      prompt_suffix: normalized.generation.promptSuffix,
    },
    styles: normalized.styles,
    scheduling: {
      timezone: normalized.scheduling.timezone,
      business_hours: normalized.scheduling.businessHours,
      active_days: normalized.scheduling.activeDays,
      min_gap_minutes: normalized.scheduling.minGapMinutes,
      max_posts_per_day: normalized.scheduling.maxPostsPerDay,
      start_today_or_tomorrow: normalized.scheduling.startTodayOrTomorrow,
      distribute_evenly: normalized.scheduling.distributeEvenly,
    },
    gallery: {
      taxonomy: normalized.gallery.taxonomy,
      naming_language: normalized.gallery.namingLanguage,
      duplicate_policy: normalized.gallery.duplicatePolicy,
      stack_time_window_minutes: normalized.gallery.stackTimeWindowMinutes,
      quality_thresholds: normalized.gallery.qualityThresholds,
      auto_archive_after_days: normalized.gallery.autoArchiveAfterDays,
      default_sort: normalized.gallery.defaultSort,
    },
    notifications: normalized.notifications,
  };
}

export function activeStyleNames(settings: PageSettings): string[] {
  const customById = new Map(settings.styles.custom.map((style) => [style.id, style.name]));

  return settings.styles.active
    .map((styleIdOrName) => {
      const catalogItem = STYLE_CATALOG_ITEMS.find(
        (style) => style.id === styleIdOrName || style.name === styleIdOrName,
      );

      return catalogItem?.name ?? customById.get(styleIdOrName) ?? styleIdOrName;
    })
    .filter(Boolean);
}

export function isValidBusinessWindow(hours: BusinessHours): boolean {
  const start = minutesFromTime(hours.start);
  const end = minutesFromTime(hours.end);

  return end - start >= 60;
}

function withLegacySettings(settings: Omit<PageSettings, keyof LegacyMirrors>): PageSettings {
  return {
    ...settings,
    businessHours: settings.scheduling.businessHours,
    defaultContextMode: settings.generation.defaultContextMode,
    preferredImageModels: [settings.generation.imageModel],
    seoKeywords: settings.generation.seoKeywords,
    skipReviewDefault: settings.generation.skipReviewDefault,
  };
}

type LegacyMirrors = {
  businessHours: BusinessHours;
  defaultContextMode: DefaultContextMode;
  preferredImageModels: string[];
  seoKeywords: string[];
  skipReviewDefault: boolean;
};

function normalizeGallerySettings(input: Record<string, any>): GallerySettings {
  return {
    autoArchiveAfterDays: clampInt(
      input.autoArchiveAfterDays ?? input.auto_archive_after_days,
      0,
      3650,
      0,
    ),
    defaultSort: ['recent', 'oldest', 'most_used'].includes(input.defaultSort ?? input.default_sort)
      ? (input.defaultSort ?? input.default_sort)
      : 'recent',
    duplicatePolicy:
      input.duplicatePolicy === 'warn_only' || input.duplicate_policy === 'warn_only'
        ? 'warn_only'
        : 'block',
    namingLanguage: input.namingLanguage === 'en' || input.naming_language === 'en' ? 'en' : 'es',
    qualityThresholds: normalizeQualityThresholds(
      input.qualityThresholds ?? input.quality_thresholds,
    ),
    stackTimeWindowMinutes: clampInt(
      input.stackTimeWindowMinutes ?? input.stack_time_window_minutes,
      1,
      120,
      5,
    ),
    taxonomy: uniqueClean(input.taxonomy ?? DEFAULT_GALLERY_TAXONOMY).slice(0, 40),
  };
}

function normalizeQualityThresholds(
  input: Record<string, any> | undefined,
): GalleryQualityThresholds {
  if (!input) {
    return DEFAULT_GALLERY_QUALITY_THRESHOLDS;
  }

  return {
    blur: numberOr(input.blur, DEFAULT_GALLERY_QUALITY_THRESHOLDS.blur),
    exposureMax: normalizeExposureThreshold(
      input.exposureMax ?? input.exposure_high,
      DEFAULT_GALLERY_QUALITY_THRESHOLDS.exposureMax,
    ),
    exposureMin: normalizeExposureThreshold(
      input.exposureMin ?? input.exposure_low,
      DEFAULT_GALLERY_QUALITY_THRESHOLDS.exposureMin,
    ),
    minResolution: clampInt(input.minResolution ?? input.min_resolution, 0, 100000000, 1200000),
  };
}

function normalizePageNotificationOverrides(
  input: Record<string, PageNotificationOverride> | undefined,
): Record<NotificationEventKey, PageNotificationOverride> {
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => {
      const value = input?.[event.key];
      return [event.key, value === 'enabled' || value === 'disabled' ? value : 'inherit'];
    }),
  ) as Record<NotificationEventKey, PageNotificationOverride>;
}

function normalizeQuietHours(
  input: QuietHours | Record<string, unknown> | null | undefined,
): QuietHours {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const start = String((input as Record<string, unknown>).start ?? '');
  const end = String((input as Record<string, unknown>).end ?? '');

  if (!timeSchema.safeParse(start).success || !timeSchema.safeParse(end).success) {
    return null;
  }

  return { start, end };
}

function normalizeContextMode(value: unknown): DefaultContextMode {
  return value === 'manual' ? 'manual' : 'ai';
}

function normalizePostingLanguage(value: unknown): PostingLanguage {
  if (value === 'es' || value === 'en' || value === 'auto') {
    return value;
  }

  return 'inherit';
}

function normalizeBrandVoice(value: unknown): BrandVoice {
  if (
    value === 'formal' ||
    value === 'entusiasta' ||
    value === 'informativo' ||
    value === 'humoristico' ||
    value === 'inspirador'
  ) {
    return value;
  }

  return 'amigable';
}

function normalizeActiveDays(value: unknown): WeekdayKey[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ACTIVE_DAYS];
  }

  const days = value.filter((day): day is WeekdayKey =>
    DEFAULT_ACTIVE_DAYS.includes(day as WeekdayKey),
  );

  return days.length > 0 ? [...new Set(days)] : [...DEFAULT_ACTIVE_DAYS];
}

function uniqueStyleIds(values: unknown): string[] {
  const ids = Array.isArray(values)
    ? uniqueClean(values.map(String))
    : DEFAULT_STYLE_SETTINGS.active;
  return ids.length >= 5 ? ids : DEFAULT_STYLE_SETTINGS.active;
}

function uniqueClean(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function isTheme(value: unknown): value is AppTheme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeExposureThreshold(value: unknown, fallback: number): number {
  const number = numberOr(value, fallback);
  const normalized = number > 1 ? number / 255 : number;

  return Math.min(1, Math.max(0, normalized));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

function minutesFromTime(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

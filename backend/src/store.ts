import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  DEFAULT_USER_SETTINGS,
  BATCH_ACCENT_COLORS,
  createBatchLabel,
  findScheduleConflicts,
  normalizePageSettings,
  normalizeUserSettings,
  serializePageSettings,
  type Batch,
  type CalendarItem,
  type Page,
  type PageSettings,
  type PendingPhotoUpload,
  type Photo,
  type PhotoMetadataUpdate,
  type SchedulingHistoryEntry,
  type StyleHistoryEntry,
  type UserSettings,
  type Variant,
} from '@cadencia/shared';
import type { ServerEnv } from './env.js';
import type { MetaPageSnapshot } from './meta.js';

type DbPage = {
  id: string;
  fb_page_id: string;
  name: string;
  category: string;
  cover_url: string;
  profile_url: string;
  page_access_token?: string | null;
  settings: PageSettings;
  meta_disconnected_at?: string | null;
};

type DbPhoto = {
  id: string;
  page_id: string;
  storage_path: string;
  thumbnail_url: string;
  file_hash: string | null;
  perceptual_hash: string | null;
  name: string | null;
  name_source: Photo['nameSource'] | null;
  description: string | null;
  alt_text: string | null;
  category: string | null;
  tags: string[] | null;
  is_favorite: boolean | null;
  status: Photo['status'] | null;
  trashed_at: string | null;
  quality_score: Photo['qualityScore'] | null;
  low_quality: boolean | null;
  stack_id: string | null;
  stack_is_primary: boolean | null;
  exif: Record<string, unknown> | null;
  taken_at: string | null;
  origin: Photo['origin'] | null;
  manual_override: boolean | null;
  context: string | null;
  context_source: Photo['contextSource'];
  created_at: string;
};

type DbCalendarItem = {
  id: string;
  page_id: string;
  title: string;
  status: CalendarItem['status'];
  scheduled_at: string;
  variant_id: string | null;
};

type DbStyleHistory = {
  page_id: string;
  style: string;
  batch_id: string;
  used_at: string;
};

type DbBatch = {
  id: string;
  page_id: string;
  status: Batch['status'];
  selected_photo_ids: string[] | null;
  pending_uploads: PendingPhotoUpload[] | null;
  context_mode_overrides: Record<string, string> | null;
  variants_per_photo: number;
  distribution_days: number;
  skip_review: boolean;
  cancelled_by_user: boolean | null;
  failed_reason: string | null;
  failure_reason?: string | null;
  short_label: string | null;
  accent_color: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type DbVariant = {
  id: string;
  batch_id: string;
  source_photo_id: string;
  variant_type: Variant['variantType'];
  style: string;
  generated_image_path: string | null;
  generated_text: string | null;
  user_text_override: string | null;
  status: Variant['status'];
  scheduled_at: string | null;
  fb_post_id: string | null;
  failed_reason: string | null;
};

type DbSchedulingHistoryEntry = {
  page_id: string;
  day_of_week: number;
  hour: number;
  score: string | number;
  last_updated: string;
};

type DbUserSettings = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  language: string | null;
  theme: string | null;
  region: string | null;
  default_timezone: string | null;
  notifications: Record<string, unknown> | null;
  quiet_hours: Record<string, unknown> | null;
  beta_features: string[] | null;
  created_at: string;
  updated_at: string;
};

export type PhotoUploadInput = {
  base64: string;
  fileName?: string;
  mimeType: string;
};

export type PhotoUploadResult = {
  duplicateCount: number;
  photos: Photo[];
  uploadedCount: number;
};

export type BatchVariantCommitInput = {
  generatedImagePath?: string | null;
  generatedText: string;
  photoId: string;
  scheduledAt: string;
  style: string;
  variantIndex: number;
};

export type BatchCommitInput = {
  distributionDays: number;
  pageId: string;
  skipReview: boolean;
  variants: BatchVariantCommitInput[];
  variantsPerPhoto: number;
};

export type BatchCommitResult = {
  batchId: string;
  calendar: CalendarItem[];
  variantsCount: number;
};

export type GeneratedVariantUploadResult = {
  imageUrl: string;
  storagePath: string;
};

export type BatchDraftInput = {
  batchId?: string;
  contextModeOverrides: Record<string, string>;
  pageId: string;
  pendingUploads: PendingPhotoUpload[];
  selectedPhotoIds: string[];
  skipReview: boolean;
  variantsPerPhoto: number;
};

export type BatchDetail = {
  batch: Batch;
  variants: Variant[];
};

const photoBucket = 'cadencia-photos';
const signedUrlTtlSeconds = 60 * 60 * 24 * 7;
const photoSelect = `
  id,
  page_id,
  storage_path,
  thumbnail_url,
  file_hash,
  perceptual_hash,
  name,
  name_source,
  description,
  alt_text,
  category,
  tags,
  is_favorite,
  status,
  trashed_at,
  quality_score,
  low_quality,
  stack_id,
  stack_is_primary,
  exif,
  taken_at,
  origin,
  manual_override,
  context,
  context_source,
  created_at
`;
const batchSelect = `
  id,
  page_id,
  status,
  selected_photo_ids,
  pending_uploads,
  context_mode_overrides,
  variants_per_photo,
  distribution_days,
  skip_review,
  cancelled_by_user,
  failed_reason,
  failure_reason,
  short_label,
  accent_color,
  created_at,
  updated_at,
  archived_at
`;
const variantSelect = `
  id,
  batch_id,
  source_photo_id,
  variant_type,
  style,
  generated_image_path,
  generated_text,
  user_text_override,
  status,
  scheduled_at,
  fb_post_id,
  failed_reason
`;

export class SupabaseStoreError extends Error {
  code: string;
  status: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'SupabaseStoreError';
    this.code = options.code ?? 'supabase_unavailable';
    this.status = options.status ?? 502;
  }
}

export function hasSupabaseStore(env: ServerEnv): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRole);
}

export async function syncMetaPagesToStore(
  env: ServerEnv,
  snapshots: MetaPageSnapshot[],
): Promise<Page[]> {
  const client = requireSupabase(env);

  if (snapshots.length === 0) {
    return [];
  }

  const pageIds = snapshots.map((snapshot) => snapshot.page.id);
  const { data: existingPages, error: existingPagesError } = await client
    .from('cadencia_pages')
    .select('id, settings, meta_disconnected_at')
    .in('id', pageIds);

  if (existingPagesError) {
    throw new SupabaseStoreError(existingPagesError.message);
  }

  const settingsByPageId = new Map(
    (existingPages as Array<Pick<DbPage, 'id' | 'settings'>>).map((page) => [
      page.id,
      normalizePageSettings(page.settings),
    ]),
  );
  const disconnectedPageIds = new Set(
    (existingPages as Array<Pick<DbPage, 'id' | 'meta_disconnected_at'>>)
      .filter((page) => page.meta_disconnected_at)
      .map((page) => page.id),
  );
  const rows = snapshots.map((snapshot) => ({
    id: snapshot.page.id,
    fb_page_id: snapshot.page.fbPageId,
    name: snapshot.page.name,
    category: snapshot.page.category,
    cover_url: snapshot.page.coverUrl,
    profile_url: snapshot.page.profileUrl,
    page_access_token: disconnectedPageIds.has(snapshot.page.id)
      ? null
      : (snapshot.pageAccessToken ?? null),
    settings: serializePageSettings(
      settingsByPageId.get(snapshot.page.id) ?? normalizePageSettings(snapshot.page.settings),
    ),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await client.from('cadencia_pages').upsert(rows, {
    onConflict: 'id',
  });

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return getStoredPages(env);
}

export async function getStoredPages(env: ServerEnv): Promise<Page[]> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_pages')
    .select('id, fb_page_id, name, category, cover_url, profile_url, page_access_token, settings, meta_disconnected_at')
    .order('name', { ascending: true });

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return (data as DbPage[]).map(mapPage);
}

export async function getStoredPage(env: ServerEnv, pageId: string): Promise<Page | undefined> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_pages')
    .select('id, fb_page_id, name, category, cover_url, profile_url, page_access_token, settings, meta_disconnected_at')
    .eq('id', pageId)
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapPage(data as DbPage) : undefined;
}

export async function clearStoredPageAccessTokens(env: ServerEnv): Promise<void> {
  if (!hasSupabaseStore(env)) {
    return;
  }

  const client = requireSupabase(env);
  const { error } = await client
    .from('cadencia_pages')
    .update({
      page_access_token: null,
      updated_at: new Date().toISOString(),
    })
    .not('page_access_token', 'is', null);

  if (error) {
    throw new SupabaseStoreError(error.message);
  }
}

export async function clearStoredPageAccessToken(
  env: ServerEnv,
  pageId: string,
): Promise<Page | undefined> {
  const client = requireSupabase(env);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('cadencia_pages')
    .update({
      meta_disconnected_at: now,
      page_access_token: null,
      updated_at: now,
    })
    .eq('id', pageId)
    .select('id, fb_page_id, name, category, cover_url, profile_url, page_access_token, settings, meta_disconnected_at')
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapPage(data as DbPage) : undefined;
}

export async function deleteStoredPage(env: ServerEnv, pageId: string): Promise<boolean> {
  const client = requireSupabase(env);
  const { error, count } = await client
    .from('cadencia_pages')
    .delete({ count: 'exact' })
    .eq('id', pageId);

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return (count ?? 0) > 0;
}

export async function updatePageSettingsInStore(
  env: ServerEnv,
  pageId: string,
  settings: PageSettings,
): Promise<Page | undefined> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_pages')
    .update({
      settings: serializePageSettings(normalizePageSettings(settings)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pageId)
    .select('id, fb_page_id, name, category, cover_url, profile_url, page_access_token, settings, meta_disconnected_at')
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapPage(data as DbPage) : undefined;
}

export async function getStoredUserSettings(env: ServerEnv): Promise<UserSettings> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('user_settings')
    .select(
      'user_id, display_name, email, language, theme, region, default_timezone, notifications, quiet_hours, beta_features, created_at, updated_at',
    )
    .eq('user_id', DEFAULT_USER_SETTINGS.userId)
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  if (!data) {
    return DEFAULT_USER_SETTINGS;
  }

  return mapUserSettings(data as DbUserSettings);
}

export async function updateStoredUserSettings(
  env: ServerEnv,
  settings: UserSettings,
): Promise<UserSettings> {
  const client = requireSupabase(env);
  const normalized = normalizeUserSettings(settings);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('user_settings')
    .upsert(
      {
        beta_features: normalized.betaFeatures,
        default_timezone: normalized.defaultTimezone,
        display_name: normalized.displayName,
        email: normalized.email,
        language: normalized.language,
        notifications: normalized.notifications,
        quiet_hours: normalized.quietHours,
        region: normalized.region,
        theme: normalized.theme,
        updated_at: now,
        user_id: normalized.userId,
      },
      { onConflict: 'user_id' },
    )
    .select(
      'user_id, display_name, email, language, theme, region, default_timezone, notifications, quiet_hours, beta_features, created_at, updated_at',
    )
    .single();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return mapUserSettings(data as DbUserSettings);
}

export async function getStoredPhotos(env: ServerEnv, pageId: string): Promise<Photo[]> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_photos')
    .select(photoSelect)
    .eq('page_id', pageId)
    .order('taken_at', { ascending: false });

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return Promise.all((data as DbPhoto[]).map((photo) => mapPhoto(client, photo)));
}

export async function getStoredPhoto(
  env: ServerEnv,
  pageId: string,
  photoId: string,
): Promise<Photo | undefined> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_photos')
    .select(photoSelect)
    .eq('id', photoId)
    .eq('page_id', pageId)
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapPhoto(client, data as DbPhoto) : undefined;
}

export async function uploadPhotosToStore(
  env: ServerEnv,
  pageId: string,
  uploads: PhotoUploadInput[],
): Promise<PhotoUploadResult> {
  const client = requireSupabase(env);
  await ensurePhotoBucket(client);

  const storedRows = [];
  const seenHashes = new Set<string>();
  let duplicateCount = 0;

  for (const upload of uploads) {
    const buffer = Buffer.from(stripDataUrlPrefix(upload.base64), 'base64');
    const fileHash = createHash('sha256').update(buffer).digest('hex');

    if (seenHashes.has(fileHash)) {
      duplicateCount += 1;
      continue;
    }

    seenHashes.add(fileHash);

    const { data: duplicate, error: duplicateError } = await client
      .from('cadencia_photos')
      .select('id')
      .eq('page_id', pageId)
      .eq('file_hash', fileHash)
      .maybeSingle();

    if (duplicateError) {
      throw new SupabaseStoreError(duplicateError.message);
    }

    if (duplicate) {
      duplicateCount += 1;
      continue;
    }

    const extension = extensionForMimeType(upload.mimeType);
    const storagePath = `${pageId}/${Date.now()}-${randomUUID()}.${extension}`;
    const createdAt = new Date().toISOString();
    const fallbackName = nameFromFile(upload.fileName, createdAt);
    const { error: uploadError } = await client.storage
      .from(photoBucket)
      .upload(storagePath, buffer, {
        contentType: upload.mimeType,
        upsert: false,
      });

    if (uploadError) {
      throw new SupabaseStoreError(uploadError.message);
    }

    storedRows.push({
      page_id: pageId,
      storage_path: storagePath,
      thumbnail_url: storagePath,
      file_hash: fileHash,
      perceptual_hash: null,
      name: fallbackName,
      name_source: 'ai',
      description: `Foto subida a Cadencia: ${fallbackName}.`,
      alt_text: fallbackName,
      category: 'otro',
      tags: [],
      is_favorite: false,
      status: 'active',
      quality_score: {
        blur: 0.8,
        exposure: 0.7,
        resolution: 0,
      },
      low_quality: false,
      stack_id: null,
      stack_is_primary: true,
      exif: {},
      taken_at: createdAt,
      origin: 'phone_gallery',
      manual_override: false,
      context: `Foto subida a Cadencia: ${fallbackName}.`,
      context_source: 'ai',
    });
  }

  if (storedRows.length === 0) {
    return {
      duplicateCount,
      photos: await getStoredPhotos(env, pageId),
      uploadedCount: 0,
    };
  }

  const { error } = await client.from('cadencia_photos').insert(storedRows);

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return {
    duplicateCount,
    photos: await getStoredPhotos(env, pageId),
    uploadedCount: storedRows.length,
  };
}

export async function uploadGeneratedVariantImageToStore(
  env: ServerEnv,
  pageId: string,
  variantKey: string,
  image: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png',
): Promise<GeneratedVariantUploadResult> {
  const client = requireSupabase(env);
  await ensurePhotoBucket(client);

  const extension = extensionForMimeType(mimeType);
  const safeKey = safeStorageSegment(variantKey);
  const storagePath = `${pageId}/generated/${Date.now()}-${safeKey}-${randomUUID()}.${extension}`;
  const { error } = await client.storage.from(photoBucket).upload(storagePath, image, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return {
    imageUrl: (await signedUrlForPath(client, storagePath)) ?? storagePath,
    storagePath,
  };
}

export async function updatePhotoContextInStore(
  env: ServerEnv,
  pageId: string,
  photoId: string,
  context: string | null,
  contextSource: NonNullable<Photo['contextSource']> = 'manual',
): Promise<Photo | undefined> {
  const client = requireSupabase(env);
  const normalizedContext = context?.trim() ? context.trim() : null;
  const { data, error } = await client
    .from('cadencia_photos')
    .update({
      context: normalizedContext,
      context_source: normalizedContext ? contextSource : null,
      description: normalizedContext,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)
    .eq('page_id', pageId)
    .select(photoSelect)
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapPhoto(client, data as DbPhoto) : undefined;
}

export async function updatePhotoMetadataInStore(
  env: ServerEnv,
  pageId: string,
  photoId: string,
  update: PhotoMetadataUpdate,
): Promise<Photo | undefined> {
  const client = requireSupabase(env);
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (update.name !== undefined) {
    row.name = update.name.trim() || null;
    row.name_source = 'manual';
  }

  if (update.description !== undefined) {
    const description = update.description?.trim() ? update.description.trim() : null;
    row.description = description;
    row.context = description;
    row.context_source = description ? 'manual' : null;
  }

  if (update.category !== undefined) {
    row.category = update.category;
  }

  if (update.tags !== undefined) {
    row.tags = uniqueClean(update.tags).slice(0, 24);
  }

  if (update.isFavorite !== undefined) {
    row.is_favorite = update.isFavorite;
  }

  if (update.status !== undefined) {
    row.status = update.status;
    row.trashed_at = update.status === 'trashed' ? new Date().toISOString() : null;
  }

  const { data, error } = await client
    .from('cadencia_photos')
    .update(row)
    .eq('id', photoId)
    .eq('page_id', pageId)
    .select(photoSelect)
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapPhoto(client, data as DbPhoto) : undefined;
}

export async function getStoredCalendar(env: ServerEnv, pageId: string): Promise<CalendarItem[]> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_calendar_items')
    .select('id, page_id, title, status, scheduled_at, variant_id')
    .eq('page_id', pageId)
    .order('scheduled_at', { ascending: true });

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return (data as DbCalendarItem[]).map((item) => ({
    id: item.id,
    pageId: item.page_id,
    title: item.title,
    status: item.status,
    scheduledAt: item.scheduled_at,
    variantId: item.variant_id ?? undefined,
  }));
}

export async function getStoredStyleHistory(
  env: ServerEnv,
  pageId: string,
): Promise<StyleHistoryEntry[]> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_styles_history')
    .select('page_id, style, batch_id, used_at')
    .eq('page_id', pageId)
    .order('used_at', { ascending: false })
    .limit(120);

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return (data as DbStyleHistory[]).map((item) => ({
    pageId: item.page_id,
    style: item.style,
    batchId: item.batch_id,
    usedAt: item.used_at,
  }));
}

export async function getStoredBatches(env: ServerEnv, pageId: string): Promise<Batch[]> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_batches')
    .select(batchSelect)
    .eq('page_id', pageId)
    .order('updated_at', { ascending: false })
    .limit(30);

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return (data as DbBatch[]).map(mapBatch);
}

export async function getStoredBatchDetail(
  env: ServerEnv,
  batchId: string,
): Promise<BatchDetail | undefined> {
  const client = requireSupabase(env);
  const { data: batchData, error: batchError } = await client
    .from('cadencia_batches')
    .select(batchSelect)
    .eq('id', batchId)
    .maybeSingle();

  if (batchError) {
    throw new SupabaseStoreError(batchError.message);
  }

  if (!batchData) {
    return undefined;
  }

  const { data: variantData, error: variantError } = await client
    .from('cadencia_variants')
    .select(variantSelect)
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  if (variantError) {
    throw new SupabaseStoreError(variantError.message);
  }

  return {
    batch: mapBatch(batchData as DbBatch),
    variants: (variantData as DbVariant[]).map(mapVariant),
  };
}

export async function getStoredSchedulingHistory(
  env: ServerEnv,
  pageId: string,
): Promise<SchedulingHistoryEntry[]> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('scheduling_history')
    .select('page_id, day_of_week, hour, score, last_updated')
    .eq('page_id', pageId)
    .order('score', { ascending: false })
    .limit(120);

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return (data as DbSchedulingHistoryEntry[]).map((item) => ({
    dayOfWeek: item.day_of_week,
    hour: item.hour,
    lastUpdated: item.last_updated,
    pageId: item.page_id,
    score: Number(item.score) || 0,
  }));
}

export async function upsertDraftBatchToStore(
  env: ServerEnv,
  input: BatchDraftInput,
): Promise<Batch> {
  const client = requireSupabase(env);
  const now = new Date().toISOString();
  const existing = await getStoredBatches(env, input.pageId);
  let existingDraft: Batch | undefined;

  if (input.batchId) {
    const { data: batchData, error: batchError } = await client
      .from('cadencia_batches')
      .select(batchSelect)
      .eq('id', input.batchId)
      .maybeSingle();

    if (batchError) {
      throw new SupabaseStoreError(batchError.message);
    }

    if (!batchData) {
      throw new SupabaseStoreError('El borrador ya no esta disponible para editar.', {
        code: 'draft_not_editable',
        status: 409,
      });
    }

    const existingBatch = mapBatch(batchData as DbBatch);

    if (existingBatch.pageId !== input.pageId || existingBatch.status !== 'draft') {
      throw new SupabaseStoreError('El borrador ya no esta disponible para editar.', {
        code: 'draft_not_editable',
        status: 409,
      });
    }

    existingDraft = existingBatch;
  }

  const batchId = existingDraft?.id ?? randomUUID();
  const activeDraftCount = existing.filter((batch) => batch.status === 'draft').length;
  const row = {
    accent_color:
      existingDraft?.accentColor ?? BATCH_ACCENT_COLORS[activeDraftCount % BATCH_ACCENT_COLORS.length],
    context_mode_overrides: input.contextModeOverrides,
    distribution_days: 1,
    id: batchId,
    page_id: input.pageId,
    pending_uploads: input.pendingUploads,
    selected_photo_ids: input.selectedPhotoIds,
    short_label: existingDraft?.shortLabel ?? createBatchLabel(activeDraftCount),
    skip_review: input.skipReview,
    status: 'draft',
    updated_at: now,
    variants_per_photo: input.variantsPerPhoto,
  };
  const { data, error } = await client
    .from('cadencia_batches')
    .upsert(row, {
      onConflict: 'id',
    })
    .select(batchSelect)
    .single();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return mapBatch(data as DbBatch);
}

export async function archiveStoredBatch(
  env: ServerEnv,
  batchId: string,
  cancelledByUser = false,
): Promise<Batch | undefined> {
  const client = requireSupabase(env);
  const { data, error } = await client
    .from('cadencia_batches')
    .update({
      archived_at: new Date().toISOString(),
      cancelled_by_user: cancelledByUser,
      status: 'archived',
    })
    .eq('id', batchId)
    .select(batchSelect)
    .maybeSingle();

  if (error) {
    throw new SupabaseStoreError(error.message);
  }

  return data ? mapBatch(data as DbBatch) : undefined;
}

export async function commitBatchToStore(
  env: ServerEnv,
  input: BatchCommitInput,
): Promise<BatchCommitResult> {
  if (!env.databaseUrl) {
    throw new SupabaseStoreError('Falta DATABASE_URL para guardar el lote.');
  }

  if (input.variants.length === 0) {
    throw new SupabaseStoreError('El lote necesita al menos una variante aprobada.');
  }

  const client = new Client({
    connectionString: env.databaseUrl,
  });
  const batchId = randomUUID();
  const calendar: CalendarItem[] = [];

  await client.connect();

  try {
    await client.query('begin');
    const photoIds = [...new Set(input.variants.map((variant) => variant.photoId))];
    const photosResult = await client.query<{ id: string }>(
      'select id from public.cadencia_photos where page_id = $1 and id = any($2::text[])',
      [input.pageId, photoIds],
    );
    const knownPhotoIds = new Set(photosResult.rows.map((row) => row.id));
    const missingPhotoIds = photoIds.filter((photoId) => !knownPhotoIds.has(photoId));

    if (missingPhotoIds.length > 0) {
      throw new SupabaseStoreError('El lote contiene fotos que no pertenecen a la pagina activa.');
    }

    const existingBatchesResult = await client.query<{ count: string }>(
      `select count(*)::text as count
       from public.cadencia_batches
       where page_id = $1
         and status in ('queued', 'generating', 'awaiting_review', 'scheduling', 'publishing')`,
      [input.pageId],
    );
    const existingActiveCount = Number(existingBatchesResult.rows[0]?.count ?? 0);

    if (existingActiveCount >= 3) {
      throw new SupabaseStoreError('La pagina ya tiene 3 lotes activos.', {
        code: 'active_batch_limit',
        status: 409,
      });
    }

    const pageSettingsResult = await client.query<{ settings: PageSettings }>(
      'select settings from public.cadencia_pages where id = $1',
      [input.pageId],
    );
    const pageSettings = normalizePageSettings(pageSettingsResult.rows[0]?.settings ?? {});
    const existingSlotsResult = await client.query<{ scheduled_at: string }>(
      'select scheduled_at from public.cadencia_calendar_items where page_id = $1',
      [input.pageId],
    );
    const conflicts = findScheduleConflicts(
      input.variants.map((variant) => variant.scheduledAt),
      existingSlotsResult.rows.map((row) => row.scheduled_at),
      pageSettings.scheduling.minGapMinutes,
    );

    if (conflicts.length > 0) {
      throw new SupabaseStoreError('Algunos horarios ya no estan disponibles.', {
        code: 'schedule_conflict',
        status: 409,
      });
    }

    await client.query(
      `insert into public.cadencia_batches
        (
          id,
          page_id,
          status,
          variants_per_photo,
          distribution_days,
          skip_review,
          selected_photo_ids,
          short_label,
          accent_color
        )
       values ($1, $2, 'scheduling', $3, $4, $5, $6, $7, $8)`,
      [
        batchId,
        input.pageId,
        input.variantsPerPhoto,
        input.distributionDays,
        input.skipReview,
        photoIds,
        createBatchLabel(existingActiveCount),
        BATCH_ACCENT_COLORS[existingActiveCount % BATCH_ACCENT_COLORS.length],
      ],
    );

    for (const [index, variant] of input.variants.entries()) {
      const variantId = randomUUID();
      const calendarId = randomUUID();
      const title = `Publicacion ${index + 1}`;

      await client.query(
        `insert into public.cadencia_variants
          (id, batch_id, source_photo_id, variant_type, style, generated_image_path, generated_text, status, scheduled_at)
         values ($1, $2, $3, 'ai_image', $4, $5, $6, 'scheduled', $7)`,
        [
          variantId,
          batchId,
          variant.photoId,
          variant.style,
          variant.generatedImagePath ?? null,
          variant.generatedText.trim(),
          variant.scheduledAt,
        ],
      );
      await client.query(
        `insert into public.cadencia_calendar_items
          (id, page_id, variant_id, title, status, scheduled_at)
         values ($1, $2, $3, $4, 'scheduled', $5)`,
        [calendarId, input.pageId, variantId, title, variant.scheduledAt],
      );
      await client.query(
        `insert into public.cadencia_styles_history
          (page_id, style, batch_id)
         values ($1, $2, $3)`,
        [input.pageId, variant.style, batchId],
      );
      calendar.push({
        id: calendarId,
        pageId: input.pageId,
        scheduledAt: variant.scheduledAt,
        status: 'scheduled',
        title,
        variantId,
      });
    }

    await client.query('commit');

    return {
      batchId,
      calendar,
      variantsCount: input.variants.length,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

export async function getSupabaseStoreStatus(env: ServerEnv) {
  const client = requireSupabase(env);
  const tables = ['cadencia_pages', 'cadencia_photos', 'cadencia_calendar_items'];
  const results = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await client.from(table).select('*', {
        count: 'exact',
        head: true,
      });

      return {
        table,
        ok: !error,
        count: count ?? 0,
        message: error?.message,
      };
    }),
  );

  return {
    configured: true,
    ok: results.every((result) => result.ok),
    tables: results,
  };
}

function requireSupabase(env: ServerEnv): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRole) {
    throw new SupabaseStoreError('Faltan variables de Supabase en el backend.');
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRole, {
    auth: {
      persistSession: false,
    },
  });
}

async function ensurePhotoBucket(client: SupabaseClient): Promise<void> {
  const { data } = await client.storage.getBucket(photoBucket);

  if (data) {
    return;
  }

  const { error } = await client.storage.createBucket(photoBucket, {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    fileSizeLimit: '10485760',
    public: false,
  });

  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new SupabaseStoreError(error.message);
  }
}

async function signedUrlForPath(
  client: SupabaseClient,
  storagePath: string,
): Promise<string | undefined> {
  const { data, error } = await client.storage
    .from(photoBucket)
    .createSignedUrl(storagePath, signedUrlTtlSeconds);

  if (error) {
    return undefined;
  }

  return data.signedUrl;
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function safeStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'variant';
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
}

async function mapPhoto(client: SupabaseClient, photo: DbPhoto): Promise<Photo> {
  const fallbackName =
    photo.name ?? `Foto del ${new Date(photo.created_at).toLocaleDateString('es-MX')}`;

  return {
    id: photo.id,
    pageId: photo.page_id,
    storagePath: photo.storage_path,
    thumbnailUrl: (await signedUrlForPath(client, photo.storage_path)) ?? photo.thumbnail_url,
    fileHash: photo.file_hash,
    perceptualHash: photo.perceptual_hash,
    name: fallbackName,
    nameSource: photo.name_source ?? 'ai',
    description: photo.description ?? photo.context,
    altText: photo.alt_text ?? photo.description ?? photo.context ?? fallbackName,
    category: photo.category ?? 'otro',
    tags: photo.tags ?? [],
    isFavorite: photo.is_favorite ?? false,
    status: photo.status ?? 'active',
    trashedAt: photo.trashed_at,
    qualityScore: photo.quality_score ?? {
      blur: 0.8,
      exposure: 0.7,
      resolution: 0,
    },
    lowQuality: photo.low_quality ?? false,
    stackId: photo.stack_id,
    stackIsPrimary: photo.stack_is_primary ?? true,
    exif: photo.exif ?? {},
    takenAt: photo.taken_at ?? photo.created_at,
    origin: photo.origin ?? 'phone_gallery',
    manualOverride: photo.manual_override ?? false,
    context: photo.context,
    contextSource: photo.context_source,
    createdAt: photo.created_at,
  };
}

function mapPage(page: DbPage): Page {
  return {
    id: page.id,
    userId: 'meta-user',
    fbPageId: page.fb_page_id,
    name: page.name,
    category: page.category,
    coverUrl: page.cover_url,
    profileUrl: page.profile_url,
    hasPageAccessToken: Boolean(page.page_access_token),
    metaDisconnectedAt: page.meta_disconnected_at ?? null,
    settings: normalizePageSettings(page.settings),
  };
}

function mapUserSettings(settings: DbUserSettings): UserSettings {
  return normalizeUserSettings({
    beta_features: settings.beta_features,
    created_at: settings.created_at,
    default_timezone: settings.default_timezone,
    display_name: settings.display_name,
    email: settings.email,
    language: settings.language,
    notifications: settings.notifications,
    quiet_hours: settings.quiet_hours,
    region: settings.region,
    theme: settings.theme,
    updated_at: settings.updated_at,
    user_id: settings.user_id,
  });
}

function mapBatch(batch: DbBatch): Batch {
  return {
    accentColor: batch.accent_color ?? '#8EC5FF',
    archivedAt: batch.archived_at,
    cancelledByUser: batch.cancelled_by_user ?? false,
    contextModeOverrides: batch.context_mode_overrides ?? {},
    createdAt: batch.created_at,
    distributionDays: batch.distribution_days,
    failedReason: batch.failed_reason ?? batch.failure_reason ?? null,
    id: batch.id,
    pageId: batch.page_id,
    pendingUploads: batch.pending_uploads ?? [],
    selectedPhotoIds: batch.selected_photo_ids ?? [],
    shortLabel: batch.short_label ?? 'Lote',
    skipReview: batch.skip_review,
    status: batch.status,
    updatedAt: batch.updated_at ?? batch.created_at,
    variantsPerPhoto: batch.variants_per_photo,
  };
}

function mapVariant(variant: DbVariant): Variant {
  return {
    batchId: variant.batch_id,
    failedReason: variant.failed_reason,
    fbPostId: variant.fb_post_id,
    generatedImagePath: variant.generated_image_path,
    generatedText: variant.generated_text,
    id: variant.id,
    scheduledAt: variant.scheduled_at,
    sourcePhotoId: variant.source_photo_id,
    status: variant.status,
    style: variant.style,
    userTextOverride: variant.user_text_override,
    variantType: variant.variant_type,
  };
}

function nameFromFile(fileName: string | undefined, createdAt: string): string {
  const cleaned = fileName
    ?.replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) {
    return cleaned
      .split(' ')
      .slice(0, 6)
      .map((part) => part.charAt(0).toLocaleUpperCase('es-MX') + part.slice(1))
      .join(' ');
  }

  return `Foto del ${new Date(createdAt).toLocaleDateString('es-MX')}`;
}

function uniqueClean(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim().toLocaleLowerCase('es-MX')).filter(Boolean)),
  ];
}

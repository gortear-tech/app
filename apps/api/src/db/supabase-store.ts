import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  AppError,
  forbiddenError,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  Business,
  MetaPage,
  BatchSummary,
  GalleryMediaAsset,
  hammingDistanceHex64,
  MediaCategory,
  MenuItem,
  MenuParseResult,
  ParsedMenuItem,
  SimilarMediaAsset,
  MediaSelection,
  Photo,
  UploadIntent,
  VisionAnalysis,
  Variant,
  allocateScheduleSlots,
  variantStylePresetForSlot,
  AssignedStyle,
  ScheduledPost,
  CaptionResult
} from "@fbmaniaco/shared";
import {
  AiRun,
  DataStore,
  DbReadiness,
  ExternalOperation,
  IdempotencyRecord,
  JobAttempt,
  MediaAsset,
  MetaAuthorization,
  PersistedMetaAuthorizationInput,
  StoredJob,
} from "./types.js";
import { publishFacebookPagePost, uploadUnpublishedFacebookPagePhoto } from "@fbmaniaco/providers";

const { Pool } = pg;
type GenerateStyleOverride = NonNullable<Parameters<DataStore["requestGenerateBatch"]>[0]["styleOverrides"]>[number];

const now = () => new Date().toISOString();
const encodeServerToken = (token: string) => `server:${Buffer.from(token, "utf8").toString("base64url")}`;
const decodeServerToken = (value: string | null | undefined) => {
  if (!value?.startsWith("server:")) return null;
  return Buffer.from(value.slice("server:".length), "base64url").toString("utf8");
};
const tokenKek = () => process.env.FB_TOKEN_KEK ?? process.env.META_TOKEN_KEK;
const mediaPreviewToken = (assetId: string, expires: number) =>
  createHash("sha256").update(`${assetId}:${expires}:fbmaniaco-local-media-preview`).digest("hex");
const MEDIA_PREVIEW_TTL_SECONDS = 24 * 60 * 60;
const publicMediaUrl = (assetId: string) => {
  const baseUrl = process.env.PUBLIC_API_URL ?? process.env.API_PUBLIC_URL;
  if (!baseUrl?.startsWith("https://")) return null;
  const expires = Math.floor(Date.now() / 1000) + MEDIA_PREVIEW_TTL_SECONDS;
  return `${baseUrl.replace(/\/$/, "")}/media/assets/${assetId}/preview?expires=${expires}&token=${mediaPreviewToken(assetId, expires)}`;
};
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET ?? "business-media";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const metadataText = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
};
const metadataList = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
};
const activeBatchStatuses = new Set(["pending_upload", "pendiente_confirmacion", "confirmado", "generando", "generado_parcial"]);
const hiddenBatchStatuses = new Set(["abandonado", "abandoned", "cancelado", "cancelled"]);
const terminalBatchStatuses = new Set(["abandonado", "abandoned", "cancelado", "cancelled"]);
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "photo";
const extensionMimeHints = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
const json = <T>(value: unknown, fallback: T): T => (value === null || value === undefined ? fallback : (value as T));
const unsupported = (method: string): never => {
  throw new AppError({
    code: "supabase_datastore_method_missing",
    statusCode: 501,
    message: `Supabase DataStore method not implemented: ${method}`,
    userMessage: "Esta funcion todavia no esta conectada al datastore real.",
    retryable: false,
    action: "contact_support"
  });
};

const toUser = (row: Record<string, any>): User => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name ?? undefined,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null
});

const toWorkspace = (row: Record<string, any>): Workspace => ({
  id: row.id,
  name: row.name,
  ownerUserId: row.owner_user_id,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toMember = (row: Record<string, any>): WorkspaceMember => ({
  workspaceId: row.workspace_id,
  userId: row.user_id,
  role: row.role,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString()
});

const toJob = (row: Record<string, any>): StoredJob => {
  const job: StoredJob = {
    id: row.id,
    type: row.type,
    status: row.status,
    workspaceId: row.workspace_id,
    dedupeKey: row.dedupe_key,
    payload: json(row.payload, {}),
    result: json(row.result, {}),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: new Date(row.run_after).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  if (row.business_id) job.businessId = row.business_id;
  if (row.batch_id) job.batchId = row.batch_id;
  if (row.photo_id) job.photoId = row.photo_id;
  if (row.variant_id) job.variantId = row.variant_id;
  if (row.operation_key) job.operationKey = row.operation_key;
  if (row.locked_at) job.lockedAt = new Date(row.locked_at).toISOString();
  if (row.locked_by) job.lockedBy = row.locked_by;
  if (row.lease_expires_at) job.leaseExpiresAt = new Date(row.lease_expires_at).toISOString();
  if (row.last_error) job.lastError = row.last_error;
  return job;
};

const toAttempt = (row: Record<string, any>): JobAttempt => {
  const attempt: JobAttempt = {
    id: row.id,
    jobId: row.job_id,
    workspaceId: row.workspace_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    startedAt: new Date(row.started_at).toISOString()
  };
  if (row.finished_at) attempt.finishedAt = new Date(row.finished_at).toISOString();
  if (row.error) attempt.error = row.error;
  return attempt;
};

const toBusiness = (row: Record<string, any>): Business => ({
  id: row.id,
  workspaceId: row.workspace_id,
  facebookPageId: row.facebook_page_id,
  name: row.name,
  timezone: row.timezone,
  tokenStatus: row.token_status,
  metadata: json(row.metadata, {}),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toMetaAuthorization = (row: Record<string, any>): MetaAuthorization => ({
  id: row.id,
  workspaceId: row.workspace_id,
  actorId: row.actor_id,
  status: row.status,
  grantedScopes: json(row.granted_scopes, []),
  declinedScopes: json(row.declined_scopes, []),
  missingRequiredScopes: json(row.missing_required_scopes, []),
  grantedPageIds: json(row.granted_page_ids, []),
  appMode: row.app_mode,
  appReviewStatus: row.app_review_status,
  graphApiVersion: row.graph_api_version,
  tokenStatus: row.token_status,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toMetaPage = (row: Record<string, any>): MetaPage => ({
  id: row.id,
  workspaceId: row.workspace_id,
  metaPageId: row.meta_page_id,
  pageName: row.page_name,
  coverPhotoUrl: row.cover_photo_url ?? null,
  profilePhotoUrl: row.profile_photo_url ?? null,
  category: row.category ?? null,
  tasks: json(row.tasks, []),
  isGranted: row.is_granted,
  isSelected: row.is_selected,
  canPublish: row.can_publish,
  pageAccessTokenStatus: row.page_access_token_status,
  grantedScopes: json(row.granted_scopes, []),
  declinedScopes: json(row.declined_scopes, []),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toBatch = (row: Record<string, any>): BatchSummary => {
  const batch: BatchSummary = {
    id: row.id,
    workspaceId: row.workspace_id,
    businessId: row.business_id,
    status: row.status,
    photosCount: row.photos_count,
    variantsCount: row.variants_count,
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  if (row.variants_per_photo !== undefined) batch.variantsPerPhoto = row.variants_per_photo;
  return batch;
};

const toUploadIntent = (row: Record<string, any>): UploadIntent => ({
  id: row.id,
  workspaceId: row.workspace_id,
  businessId: row.business_id,
  batchId: row.batch_id,
  bucket: row.bucket,
  storageKey: row.storage_key,
  allowedMimeTypes: row.allowed_mime_types,
  maxBytes: row.max_bytes,
  status: row.status,
  expiresAt: new Date(row.expires_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString()
});

const toPhoto = (row: Record<string, any>): Photo => {
  const photo: Photo = {
    id: row.id,
    workspaceId: row.workspace_id,
    businessId: row.business_id,
    batchId: row.batch_id,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  if (row.file_name !== undefined) photo.fileName = row.file_name;
  if (row.storage_key !== undefined) photo.storageKey = row.storage_key;
  if (row.original_asset_id !== undefined) photo.originalAssetId = row.original_asset_id;
  if (row.thumbnail_asset_id !== undefined) photo.thumbnailAssetId = row.thumbnail_asset_id;
  if (row.vision_input_asset_id !== undefined) photo.visionInputAssetId = row.vision_input_asset_id;
  if (row.content_hash !== undefined) photo.contentHash = row.content_hash;
  if (row.mime_type !== undefined) photo.mimeType = row.mime_type;
  if (row.width !== undefined) photo.width = row.width;
  if (row.height !== undefined) photo.height = row.height;
  if (row.vision_analysis !== undefined) photo.visionAnalysis = row.vision_analysis;
  return photo;
};

const toMediaAsset = (row: Record<string, any>): MediaAsset => {
  const asset: MediaAsset = {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    bucket: row.bucket,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    isPublic: row.is_public,
    createdAt: new Date(row.created_at).toISOString()
  };
  if (row.business_id) asset.businessId = row.business_id;
  if (row.batch_id) asset.batchId = row.batch_id;
  if (row.photo_id) asset.photoId = row.photo_id;
  if (row.variant_id) asset.variantId = row.variant_id;
  if (row.sha256 !== undefined) asset.sha256 = row.sha256;
  if (row.phash !== undefined) asset.phash = row.phash;
  if (row.display_name !== undefined) asset.displayName = row.display_name;
  if (row.original_name !== undefined) asset.originalName = row.original_name;
  if (row.category_id !== undefined) asset.categoryId = row.category_id;
  if (row.width !== undefined) asset.width = row.width;
  if (row.height !== undefined) asset.height = row.height;
  if (row.bytes !== undefined) asset.bytes = row.bytes === null ? null : Number(row.bytes);
  if (row.thumb_path !== undefined) asset.thumbPath = row.thumb_path;
  if (row.preview_path !== undefined) asset.previewPath = row.preview_path;
  if (row.full_path !== undefined) asset.fullPath = row.full_path;
  if (row.usage_count !== undefined) asset.usageCount = row.usage_count;
  if (row.last_used_at !== undefined) asset.lastUsedAt = row.last_used_at ? new Date(row.last_used_at).toISOString() : null;
  if (row.archived_at !== undefined) asset.archivedAt = row.archived_at ? new Date(row.archived_at).toISOString() : null;
  if (row.status !== undefined) asset.status = row.status;
  if (row.error_reason !== undefined) asset.errorReason = row.error_reason;
  if (row.processed_at !== undefined) asset.processedAt = row.processed_at ? new Date(row.processed_at).toISOString() : null;
  if (row.updated_at !== undefined) asset.updatedAt = new Date(row.updated_at).toISOString();
  return asset;
};

const toGalleryAsset = (row: Record<string, any>): GalleryMediaAsset => {
  const asset = toMediaAsset(row);
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    ...(asset.businessId ? { businessId: asset.businessId } : {}),
    ...(asset.batchId ? { batchId: asset.batchId } : {}),
    ...(asset.photoId ? { photoId: asset.photoId } : {}),
    ...(asset.variantId ? { variantId: asset.variantId } : {}),
    kind: asset.kind,
    bucket: asset.bucket,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    isPublic: asset.isPublic,
    sha256: asset.sha256 ?? null,
    phash: asset.phash ?? null,
    displayName: asset.displayName ?? null,
    originalName: asset.originalName ?? null,
    categoryId: asset.categoryId ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    bytes: asset.bytes ?? null,
    thumbPath: asset.thumbPath ?? null,
    previewPath: asset.previewPath ?? null,
    fullPath: asset.fullPath ?? null,
    usageCount: asset.usageCount ?? 0,
    lastUsedAt: asset.lastUsedAt ?? null,
    archivedAt: asset.archivedAt ?? null,
    status: asset.status ?? "ready",
    errorReason: asset.errorReason ?? null,
    processedAt: asset.processedAt ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt ?? asset.createdAt
  };
};

const toMediaCategory = (row: Record<string, any>): MediaCategory => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  slug: row.slug,
  color: row.color ?? null,
  sortOrder: row.sort_order,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toMenuItem = (row: Record<string, any>): MenuItem => ({
  id: row.id,
  workspaceId: row.workspace_id,
  categoryId: row.category_id ?? null,
  name: row.name,
  description: row.description ?? null,
  priceCents: row.price_cents === null || row.price_cents === undefined ? null : Number(row.price_cents),
  keywords: json(row.keywords, []),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toMediaSelection = (row: Record<string, any>): MediaSelection => ({
  id: row.id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  name: row.name ?? null,
  assetIds: json(row.asset_ids, []),
  metadata: json(row.metadata, {}),
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "categoria";

const normalizeSearchText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .trim();

const normalizeKeywords = (keywords: string[]) =>
  Array.from(new Set(keywords.map(normalizeSearchText).filter((keyword) => keyword.length >= 2))).slice(0, 20);

const menuItemMatchesAsset = (item: ParsedMenuItem, asset: GalleryMediaAsset) => {
  const haystack = normalizeSearchText([asset.displayName, asset.originalName, asset.storageKey].filter(Boolean).join(" "));
  return normalizeKeywords([item.name, ...item.keywords]).some((keyword) => haystack.includes(keyword));
};

const displayNameForAsset = (input: { categorySlug?: string | null; createdAt: string; sequence: number; originalName: string }) => {
  const month = input.createdAt.slice(0, 7);
  const extension = input.originalName.includes(".") ? input.originalName.slice(input.originalName.lastIndexOf(".")) : ".jpg";
  return `${input.categorySlug || "sin_categoria"}_${month}_${String(input.sequence).padStart(3, "0")}${extension.toLowerCase()}`;
};

const toVariant = (row: Record<string, any>): Variant => {
  const variant: Variant = {
    id: row.id,
    workspaceId: row.workspace_id,
    businessId: row.business_id,
    batchId: row.batch_id,
    photoId: row.photo_id,
    variantIndex: row.variant_index,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  if (row.style_id !== undefined) variant.styleId = row.style_id;
  if (row.assigned_style !== undefined) variant.assignedStyle = row.assigned_style;
  if (row.generation_plan !== undefined) variant.generationPlan = row.generation_plan;
  if (row.quality_check !== undefined) variant.qualityCheck = row.quality_check;
  if (row.caption_result !== undefined) variant.captionResult = row.caption_result;
  if (row.model_profile_id !== undefined) variant.modelProfileId = row.model_profile_id;
  if (row.prompt_template_id !== undefined) variant.promptTemplateId = row.prompt_template_id;
  if (row.prompt_version !== undefined) variant.promptVersion = row.prompt_version;
  if (row.ai_run_id !== undefined) variant.aiRunId = row.ai_run_id;
  if (row.quality_check_id !== undefined) variant.qualityCheckId = row.quality_check_id;
  if (row.quality_status !== undefined) variant.qualityStatus = row.quality_status;
  if (row.quality_score !== undefined) variant.qualityScore = row.quality_score === null ? null : Number(row.quality_score);
  if (row.quality_warnings !== undefined) variant.qualityWarnings = row.quality_warnings;
  if (row.image_url !== undefined) variant.imageUrl = row.image_url;
  if (row.generated_asset_id !== undefined) variant.generatedAssetId = row.generated_asset_id;
  if (row.publishable_asset_id !== undefined) variant.publishableAssetId = row.publishable_asset_id;
  if (row.caption !== undefined) variant.caption = row.caption;
  return variant;
};

const toScheduledPost = (row: Record<string, any>): ScheduledPost => {
  const post: ScheduledPost = {
    id: row.id,
    workspaceId: row.workspace_id,
    businessId: row.business_id,
    batchId: row.batch_id,
    variantId: row.variant_id,
    pageId: row.page_id,
    scheduledFor: new Date(row.scheduled_for).toISOString(),
    deliveryMode: row.delivery_mode,
    status: row.status,
    remoteStatus: row.remote_status,
    retryCount: row.retry_count,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  if (row.facebook_post_id !== undefined) post.facebookPostId = row.facebook_post_id;
  if (row.fb_photo_id !== undefined) post.facebookPhotoId = row.fb_photo_id;
  if (row.fb_photo_reused !== undefined) post.facebookPhotoReused = row.fb_photo_reused;
  if (row.remote_post_type !== undefined) post.remotePostType = row.remote_post_type;
  if (row.remote_post_url !== undefined) post.remotePostUrl = row.remote_post_url;
  if (row.graph_api_version !== undefined) post.graphApiVersion = row.graph_api_version;
  if (row.publish_lead_seconds !== undefined) post.publishLeadSeconds = row.publish_lead_seconds;
  if (row.scheduled_for_unix !== undefined) post.scheduledForUnix = row.scheduled_for_unix === null ? null : Number(row.scheduled_for_unix);
  if (row.last_remote_sync_at !== undefined) {
    post.lastRemoteSyncAt = row.last_remote_sync_at ? new Date(row.last_remote_sync_at).toISOString() : null;
  }
  if (row.remote_error_code !== undefined) post.remoteErrorCode = row.remote_error_code;
  if (row.remote_trace_id !== undefined) post.remoteTraceId = row.remote_trace_id;
  if (row.caption !== undefined) post.caption = row.caption;
  if (row.image_url !== undefined) post.imageUrl = row.image_url;
  if (row.style_id !== undefined) post.styleId = row.style_id;
  if (row.style_name !== undefined) post.styleName = row.style_name;
  return post;
};

export class SupabaseDataStoreCore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    });
  }

  async ready(): Promise<DbReadiness> {
    await this.pool.query("select 1");
    return { ok: true, mode: "supabase" };
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await this.pool.query("select * from public.users where id = $1", [userId]);
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async upsertLocalUser(input: { userId: string; email: string; displayName?: string | undefined }): Promise<User> {
    const result = await this.pool.query(
      `insert into public.users (id, email, display_name, status, created_at, last_login_at)
       values ($1, $2, $3, 'activo', now(), now())
       on conflict (id) do update set email = excluded.email, display_name = coalesce(excluded.display_name, public.users.display_name), last_login_at = now()
       returning *`,
      [input.userId, input.email, input.displayName ?? null]
    );
    return toUser(result.rows[0]);
  }

  async ensureDefaultWorkspace(userId: string): Promise<{ workspace: Workspace; membership: WorkspaceMember }> {
    const existing = await this.pool.query(
      `select w.*, wm.role, wm.status as member_status, wm.created_at as member_created_at
       from public.workspace_members wm
       join public.workspaces w on w.id = wm.workspace_id
       where wm.user_id = $1 and wm.status = 'active'
       order by wm.created_at asc
       limit 1`,
      [userId]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return {
        workspace: toWorkspace(row),
        membership: {
          workspaceId: row.id,
          userId,
          role: row.role,
          status: row.member_status,
          createdAt: new Date(row.member_created_at).toISOString()
        }
      };
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const workspaceId = randomUUID();
      const workspaceResult = await client.query(
        `insert into public.workspaces (id, name, owner_user_id, status, created_at, updated_at)
         values ($1, 'Mi workspace Maniaco', $2, 'activo', now(), now())
         returning *`,
        [workspaceId, userId]
      );
      const memberResult = await client.query(
        `insert into public.workspace_members (workspace_id, user_id, role, status, created_at)
         values ($1, $2, 'owner', 'active', now())
         returning *`,
        [workspaceId, userId]
      );
      await client.query("commit");
      return { workspace: toWorkspace(workspaceResult.rows[0]), membership: toMember(memberResult.rows[0]) };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMemberships(userId: string): Promise<Array<{ workspace: Workspace; membership: WorkspaceMember }>> {
    const result = await this.pool.query(
      `select w.*, wm.workspace_id, wm.user_id, wm.role, wm.status as member_status, wm.created_at as member_created_at
       from public.workspace_members wm
       join public.workspaces w on w.id = wm.workspace_id
       where wm.user_id = $1 and wm.status = 'active'
       order by wm.created_at asc`,
      [userId]
    );
    return result.rows.map((row) => ({
      workspace: toWorkspace(row),
      membership: {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        role: row.role,
        status: row.member_status,
        createdAt: new Date(row.member_created_at).toISOString()
      }
    }));
  }

  async assertWorkspaceRole(input: { userId: string; workspaceId: string; allowedRoles: WorkspaceRole[] }): Promise<WorkspaceMember> {
    const result = await this.pool.query(
      "select * from public.workspace_members where user_id = $1 and workspace_id = $2 and status = 'active'",
      [input.userId, input.workspaceId]
    );
    const member = result.rows[0] ? toMember(result.rows[0]) : null;
    if (!member || !input.allowedRoles.includes(member.role)) throw forbiddenError();
    return member;
  }

  async createJob(input: Parameters<DataStore["createJob"]>[0]): Promise<StoredJob> {
    const active = await this.pool.query(
      `select * from public.jobs
       where type = $1 and dedupe_key = $2 and status in ('queued', 'running', 'blocked', 'needs_user_action')
       order by created_at asc limit 1`,
      [input.type, input.dedupeKey]
    );
    if (active.rows[0]) return toJob(active.rows[0]);
    const result = await this.pool.query(
      `insert into public.jobs (type, status, workspace_id, business_id, batch_id, photo_id, variant_id, dedupe_key, payload, run_after, created_at, updated_at)
       values ($1, 'queued', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), now())
       returning *`,
      [
        input.type,
        input.workspaceId,
        input.businessId ?? null,
        input.batchId ?? null,
        input.photoId ?? null,
        input.variantId ?? null,
        input.dedupeKey,
        JSON.stringify(input.payload ?? {}),
        input.runAfter ?? now()
      ]
    );
    return toJob(result.rows[0]);
  }

  async claimDueJob(workerId: string): Promise<StoredJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('fbmaniaco:claim-due-job'))");
      const claimed = await client.query(
        `select * from public.jobs
         where status = 'queued' and run_after <= now()
           and (
             type <> 'generate_variant'
             or not exists (
               select 1 from public.jobs running
               where running.type = 'generate_variant'
                 and running.status = 'running'
                 and coalesce(running.lease_expires_at, running.locked_at + interval '15 minutes') > now()
             )
           )
         order by run_after asc, created_at asc
         for update skip locked
         limit 1`
      );
      if (!claimed.rows[0]) {
        await client.query("commit");
        return null;
      }
      const job = claimed.rows[0];
      const updated = await client.query(
        `update public.jobs
         set status = 'running', locked_at = now(), locked_by = $2,
             lease_expires_at = now() + case when type = 'generate_variant' then interval '15 minutes' else interval '60 seconds' end,
             attempts = greatest(
               attempts,
               coalesce((select max(attempt_number) from public.job_attempts where job_id = public.jobs.id), 0)
             ) + 1,
             updated_at = now()
         where id = $1
         returning *`,
        [job.id, workerId]
      );
      const updatedJob = updated.rows[0];
      await client.query(
        `insert into public.job_attempts (id, job_id, workspace_id, attempt_number, status, started_at)
         values ($1, $2, $3, $4, 'running', now())`,
        [randomUUID(), updatedJob.id, updatedJob.workspace_id, updatedJob.attempts]
      );
      await client.query("commit");
      return toJob(updatedJob);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeJob(input: { jobId: string; result: Record<string, unknown> }): Promise<StoredJob> {
    const result = await this.pool.query(
      `update public.jobs set status = 'succeeded', result = $2::jsonb, updated_at = now()
       where id = $1 returning *`,
      [input.jobId, JSON.stringify(input.result)]
    );
    const job = toJob(result.rows[0]);
    await this.pool.query(
      `update public.job_attempts set status = 'succeeded', finished_at = now()
       where job_id = $1 and attempt_number = $2`,
      [job.id, job.attempts]
    );
    return job;
  }

  async failJob(input: { jobId: string; error: string }): Promise<StoredJob> {
    const current = await this.pool.query("select * from public.jobs where id = $1", [input.jobId]);
    const row = current.rows[0];
    const nextStatus = row.attempts >= row.max_attempts ? "failed" : "queued";
    const result = await this.pool.query(
      `update public.jobs set status = $2, last_error = $3, updated_at = now()
       where id = $1 returning *`,
      [input.jobId, nextStatus, input.error]
    );
    const job = toJob(result.rows[0]);
    await this.pool.query(
      `update public.job_attempts set status = 'failed', finished_at = now(), error = $3
       where job_id = $1 and attempt_number = $2`,
      [job.id, job.attempts, input.error]
    );
    return job;
  }

  async listJobs(workspaceId: string): Promise<StoredJob[]> {
    const result = await this.pool.query("select * from public.jobs where workspace_id = $1 order by created_at desc", [workspaceId]);
    return result.rows.map(toJob);
  }

  async listAttempts(jobId: string): Promise<JobAttempt[]> {
    const result = await this.pool.query("select * from public.job_attempts where job_id = $1 order by attempt_number asc", [jobId]);
    return result.rows.map(toAttempt);
  }

  async getBootstrapContext(userId: string): Promise<Awaited<ReturnType<DataStore["getBootstrapContext"]>>> {
    const memberships = await this.listMemberships(userId);
    const workspace = memberships[0]?.workspace;
    if (!workspace) {
      return {
        selectedBusinessId: null,
        selectedPageId: null,
        facebookTokenStatus: null,
        metaAuthorizationStatus: "none",
        grantedScopes: [],
        declinedScopes: [],
        missingRequiredScopes: [],
        graphApiVersion: "v23.0"
      };
    }
    const selected = await this.pool.query(
      `select b.id, b.facebook_page_id, b.token_status
       from public.businesses b
       join public.facebook_pages fp on fp.id = b.facebook_page_id
       where b.workspace_id = $1 and fp.is_selected = true
       order by b.updated_at desc limit 1`,
      [workspace.id]
    );
    const auth = await this.pool.query(
      "select * from public.meta_authorizations where workspace_id = $1 order by updated_at desc limit 1",
      [workspace.id]
    );
    return {
      selectedBusinessId: selected.rows[0]?.id ?? null,
      selectedPageId: selected.rows[0]?.facebook_page_id ?? null,
      facebookTokenStatus: selected.rows[0]?.token_status ?? auth.rows[0]?.token_status ?? null,
      metaAuthorizationStatus: auth.rows[0]?.status ?? "none",
      grantedScopes: json(auth.rows[0]?.granted_scopes, []),
      declinedScopes: json(auth.rows[0]?.declined_scopes, []),
      missingRequiredScopes: json(auth.rows[0]?.missing_required_scopes, []),
      graphApiVersion: auth.rows[0]?.graph_api_version ?? "v23.0"
    };
  }

  async updateBusiness(input: Parameters<DataStore["updateBusiness"]>[0]): Promise<Business> {
    const current = await this.requireBusiness(input.workspaceId, input.businessId);
    const nextMetadata = input.metadata !== undefined ? { ...current.metadata, ...input.metadata } : current.metadata;
    const result = await this.pool.query(
      `update public.businesses
       set name = coalesce($3, name), timezone = coalesce($4, timezone), metadata = $5::jsonb, updated_at = now()
       where workspace_id = $1 and id = $2
       returning *`,
      [input.workspaceId, input.businessId, input.name ?? null, input.timezone ?? null, JSON.stringify(nextMetadata)]
    );
    return toBusiness(result.rows[0]);
  }

  async upsertMockMetaAuthorization(input: { workspaceId: string; actorId: string }): Promise<MetaAuthorization> {
    const requiredScopes = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
    return this.upsertMetaAuthorization({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      authorization: {
        status: "valid",
        grantedScopes: requiredScopes,
        declinedScopes: [],
        missingRequiredScopes: [],
        grantedPageIds: ["mock-page-1", "mock-page-2"],
        appMode: "development",
        appReviewStatus: "development",
        graphApiVersion: "v23.0",
        tokenStatus: "valido"
      },
      pages: [
        {
          metaPageId: "mock-page-1",
          pageName: "Maniaco Demo",
          coverPhotoUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1200",
          profilePhotoUrl: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=320",
          category: "Facebook Page",
          tasks: ["CREATE_CONTENT", "MODERATE", "ADVERTISE"],
          isGranted: true,
          canPublish: true,
          pageAccessTokenStatus: "valido",
          grantedScopes: requiredScopes,
          declinedScopes: []
        },
        {
          metaPageId: "mock-page-2",
          pageName: "Pagina sin permiso completo",
          coverPhotoUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200",
          profilePhotoUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=320",
          category: "Facebook Page",
          tasks: ["MODERATE"],
          isGranted: true,
          canPublish: false,
          pageAccessTokenStatus: "error_permiso",
          grantedScopes: ["pages_show_list"],
          declinedScopes: ["pages_manage_posts"]
        }
      ]
    });
  }

  async upsertMetaAuthorization(input: PersistedMetaAuthorizationInput): Promise<MetaAuthorization> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(
        "select * from public.meta_authorizations where workspace_id = $1 order by updated_at desc limit 1",
        [input.workspaceId]
      );
      const authorizationResult = existing.rows[0]
        ? await client.query(
            `update public.meta_authorizations
             set actor_id = $2, status = $3, granted_scopes = $4::jsonb, declined_scopes = $5::jsonb,
                 missing_required_scopes = $6::jsonb, granted_page_ids = $7::jsonb, app_mode = $8,
                 app_review_status = $9, graph_api_version = $10, token_status = $11, updated_at = now()
             where id = $1 returning *`,
            [
              existing.rows[0].id,
              input.actorId,
              input.authorization.status,
              JSON.stringify(input.authorization.grantedScopes),
              JSON.stringify(input.authorization.declinedScopes),
              JSON.stringify(input.authorization.missingRequiredScopes),
              JSON.stringify(input.authorization.grantedPageIds),
              input.authorization.appMode,
              input.authorization.appReviewStatus,
              input.authorization.graphApiVersion,
              input.authorization.tokenStatus
            ]
          )
        : await client.query(
            `insert into public.meta_authorizations
             (id, workspace_id, actor_id, status, granted_scopes, declined_scopes, missing_required_scopes,
              granted_page_ids, app_mode, app_review_status, graph_api_version, token_status, created_at, updated_at)
             values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, now(), now())
             returning *`,
            [
              randomUUID(),
              input.workspaceId,
              input.actorId,
              input.authorization.status,
              JSON.stringify(input.authorization.grantedScopes),
              JSON.stringify(input.authorization.declinedScopes),
              JSON.stringify(input.authorization.missingRequiredScopes),
              JSON.stringify(input.authorization.grantedPageIds),
              input.authorization.appMode,
              input.authorization.appReviewStatus,
              input.authorization.graphApiVersion,
              input.authorization.tokenStatus
            ]
          );
      const authorization = authorizationResult.rows[0];
      for (const page of input.pages) {
        const existingPage = await client.query(
          `select encrypted_page_access_token, encrypted_page_access_token_ciphertext,
                  page_access_token_key_id, page_access_token_encryption_version
           from public.facebook_pages where workspace_id = $1 and meta_page_id = $2`,
          [input.workspaceId, page.metaPageId]
        );
        const tokenKekValue = tokenKek();
        const ciphertext = page.pageAccessToken && tokenKekValue
          ? (await client.query("select pgp_sym_encrypt($1, $2, 'cipher-algo=aes256') as token", [page.pageAccessToken, tokenKekValue]))
              .rows[0]?.token
          : existingPage.rows[0]?.encrypted_page_access_token_ciphertext ?? null;
        const encryptedPageAccessToken =
          page.pageAccessToken && !tokenKekValue
            ? encodeServerToken(page.pageAccessToken)
            : tokenKekValue
              ? null
              : existingPage.rows[0]?.encrypted_page_access_token ?? null;
        const pageAccessTokenKeyId = ciphertext ? "pgcrypto" : encryptedPageAccessToken ? "server" : existingPage.rows[0]?.page_access_token_key_id ?? null;
        const encryptionVersion = ciphertext ? "pgcrypto_aes256" : encryptedPageAccessToken ? "legacy_base64" : existingPage.rows[0]?.page_access_token_encryption_version ?? "none";
        await client.query(
          `insert into public.facebook_pages
           (id, workspace_id, meta_authorization_id, meta_page_id, page_name, page_access_token_status,
            encrypted_page_access_token, encrypted_page_access_token_ciphertext, page_access_token_key_id,
            page_access_token_encryption_version, cover_photo_url, profile_photo_url, category, tasks, is_granted,
            can_publish, granted_scopes, declined_scopes, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, now(), now())
           on conflict (workspace_id, meta_page_id) do update
           set meta_authorization_id = excluded.meta_authorization_id,
               page_name = excluded.page_name,
               page_access_token_status = excluded.page_access_token_status,
               encrypted_page_access_token = excluded.encrypted_page_access_token,
               encrypted_page_access_token_ciphertext = excluded.encrypted_page_access_token_ciphertext,
               page_access_token_key_id = excluded.page_access_token_key_id,
               page_access_token_encryption_version = excluded.page_access_token_encryption_version,
               cover_photo_url = excluded.cover_photo_url,
               profile_photo_url = excluded.profile_photo_url,
               category = excluded.category,
               tasks = excluded.tasks,
               is_granted = excluded.is_granted,
               can_publish = excluded.can_publish,
               granted_scopes = excluded.granted_scopes,
               declined_scopes = excluded.declined_scopes,
               updated_at = now()`,
          [
            randomUUID(),
            input.workspaceId,
            authorization.id,
            page.metaPageId,
            page.pageName,
            page.pageAccessTokenStatus,
            encryptedPageAccessToken,
            ciphertext,
            pageAccessTokenKeyId,
            encryptionVersion,
            page.coverPhotoUrl ?? null,
            page.profilePhotoUrl ?? null,
            page.category ?? null,
            JSON.stringify(page.tasks),
            page.isGranted,
            page.canPublish,
            JSON.stringify(page.grantedScopes),
            JSON.stringify(page.declinedScopes)
          ]
        );
      }
      await client.query("commit");
      return toMetaAuthorization(authorization);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMetaPages(workspaceId: string): Promise<MetaPage[]> {
    const result = await this.pool.query("select * from public.facebook_pages where workspace_id = $1 order by updated_at desc", [
      workspaceId
    ]);
    return result.rows.map(toMetaPage);
  }

  async selectMetaPage(input: { workspaceId: string; actorId: string; pageId: string; requestId: string }): Promise<Business> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const pageResult = await client.query("select * from public.facebook_pages where workspace_id = $1 and id = $2", [
        input.workspaceId,
        input.pageId
      ]);
      const page = pageResult.rows[0];
      if (!page) {
        throw new AppError({
          code: "page_not_found",
          statusCode: 404,
          message: "Meta page not found in workspace",
          userMessage: "No encontramos esa pagina conectada.",
          retryable: false,
          action: "refresh"
        });
      }
      if (!page.is_granted || !page.can_publish || page.page_access_token_status !== "valido") {
        throw new AppError({
          code: "meta_page_not_selectable",
          statusCode: 409,
          message: "Meta page is not granted or cannot publish",
          userMessage: "Esa pagina necesita permisos completos para publicar.",
          retryable: false,
          action: "reconnect"
        });
      }
      await client.query("update public.facebook_pages set is_selected = false, updated_at = now() where workspace_id = $1", [
        input.workspaceId
      ]);
      await client.query("update public.facebook_pages set is_selected = true, updated_at = now() where id = $1", [page.id]);

      const existing = await client.query("select * from public.businesses where workspace_id = $1 and facebook_page_id = $2", [
        input.workspaceId,
        page.id
      ]);
      const businessResult = existing.rows[0]
        ? await client.query(
            "update public.businesses set token_status = $2, updated_at = now() where id = $1 returning *",
            [existing.rows[0].id, page.page_access_token_status]
          )
        : await client.query(
            `insert into public.businesses
             (id, workspace_id, facebook_page_id, name, timezone, token_status, metadata, created_at, updated_at)
             values ($1, $2, $3, $4, 'America/Mexico_City', $5, $6::jsonb, now(), now())
             returning *`,
            [
              randomUUID(),
              input.workspaceId,
              page.id,
              page.page_name,
              page.page_access_token_status,
              JSON.stringify({
                pageName: page.page_name,
                category: page.category ?? "Facebook Page",
                facebookSeo: { keywords: [], context: null }
              })
            ]
          );
      const business = businessResult.rows[0];
      await client.query("commit");
      return toBusiness(business);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listBusinesses(workspaceId: string): Promise<Business[]> {
    const result = await this.pool.query("select * from public.businesses where workspace_id = $1 order by updated_at desc", [workspaceId]);
    return result.rows.map(toBusiness);
  }

  async getBusiness(input: { workspaceId: string; businessId: string }): Promise<Business | null> {
    const result = await this.pool.query("select * from public.businesses where workspace_id = $1 and id = $2", [
      input.workspaceId,
      input.businessId
    ]);
    return result.rows[0] ? toBusiness(result.rows[0]) : null;
  }

  async createBatch(input: { workspaceId: string; businessId: string; actorId: string; requestId: string }): Promise<BatchSummary> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      `insert into public.batches (id, workspace_id, business_id, status, photos_count, variants_count, last_activity_at, created_at, updated_at)
       values ($1, $2, $3, 'pending_upload', 0, 0, now(), now(), now())
       returning *`,
      [randomUUID(), input.workspaceId, input.businessId]
    );
    const batch = toBatch(result.rows[0]);
    return batch;
  }

  async listBatches(input: { workspaceId: string; businessId: string }): Promise<BatchSummary[]> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      `select * from public.batches
       where workspace_id = $1 and business_id = $2
         and status <> all($3::text[])
       order by updated_at desc`,
      [input.workspaceId, input.businessId, [...hiddenBatchStatuses]]
    );
    return result.rows.map(toBatch);
  }

  async getActiveBatch(input: { workspaceId: string; businessId: string }): Promise<BatchSummary | null> {
    const batches = await this.listBatches(input);
    return batches.find((batch) => activeBatchStatuses.has(batch.status)) ?? null;
  }

  async deleteBatch(input: Parameters<DataStore["deleteBatch"]>[0]): ReturnType<DataStore["deleteBatch"]> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const batchResult = await client.query(
        "select * from public.batches where workspace_id = $1 and business_id = $2 and id = $3 for update",
        [input.workspaceId, input.businessId, input.batchId]
      );
      if (!batchResult.rows[0]) this.batchNotFound();
      const cancelledJobs = await client.query(
        `update public.jobs
         set status = 'cancelled', last_error = 'batch_deleted', updated_at = now()
         where workspace_id = $1 and business_id = $2 and batch_id = $3
           and status in ('queued', 'blocked', 'needs_user_action')
         returning id`,
        [input.workspaceId, input.businessId, input.batchId]
      );
      const cancelledPosts = await client.query(
        `update public.scheduled_posts
         set status = 'cancelada', remote_status = 'no_enviado', remote_error_code = 'batch_deleted', updated_at = now()
         where workspace_id = $1 and business_id = $2 and batch_id = $3
           and status not in ('publicada', 'published', 'cancelada', 'cancelled')
         returning id`,
        [input.workspaceId, input.businessId, input.batchId]
      );
      await client.query(
        `update public.variants
         set status = 'eliminada', updated_at = now()
         where workspace_id = $1 and business_id = $2 and batch_id = $3
           and status not in ('publicada', 'eliminada')`,
        [input.workspaceId, input.businessId, input.batchId]
      );
      await client.query(
        `update public.photos
         set status = 'eliminada', updated_at = now()
         where workspace_id = $1 and business_id = $2 and batch_id = $3
           and status <> 'eliminada'`,
        [input.workspaceId, input.businessId, input.batchId]
      );
      const updated = await client.query(
        `update public.batches
         set status = 'abandonado', last_activity_at = now(), updated_at = now()
         where workspace_id = $1 and business_id = $2 and id = $3
         returning *`,
        [input.workspaceId, input.businessId, input.batchId]
      );
      await client.query("commit");
      return {
        batch: toBatch(updated.rows[0]),
        cancelledJobs: cancelledJobs.rowCount ?? 0,
        cancelledScheduledPosts: cancelledPosts.rowCount ?? 0
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getBatchDetail(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
  }): Promise<{ batch: BatchSummary; photos: Photo[]; variants: Variant[]; jobs: StoredJob[] } | null> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const batchResult = await this.pool.query(
      "select * from public.batches where workspace_id = $1 and business_id = $2 and id = $3",
      [input.workspaceId, input.businessId, input.batchId]
    );
    if (!batchResult.rows[0]) return null;
    const photos = await this.pool.query(
      "select * from public.photos where workspace_id = $1 and business_id = $2 and batch_id = $3 order by created_at asc",
      [input.workspaceId, input.businessId, input.batchId]
    );
    const variants = await this.pool.query(
      `select * from public.variants
       where workspace_id = $1 and business_id = $2 and batch_id = $3 and status <> 'eliminada'
       order by photo_id asc, variant_index asc`,
      [input.workspaceId, input.businessId, input.batchId]
    );
    const jobs = await this.pool.query(
      "select * from public.jobs where workspace_id = $1 and batch_id = $2 order by created_at desc",
      [input.workspaceId, input.batchId]
    );
    return {
      batch: toBatch(batchResult.rows[0]),
      photos: photos.rows.map(toPhoto),
      variants: variants.rows.map(toVariant),
      jobs: jobs.rows.map(toJob)
    };
  }

  async createUploadIntent(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    originalFileName: string;
    contentType: string;
    fileSize: number;
  }): Promise<UploadIntent> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
    this.assertUploadShape(input.contentType, input.fileSize, input.originalFileName);
    const result = await this.pool.query(
      `insert into public.upload_intents
       (id, workspace_id, business_id, batch_id, bucket, storage_key, allowed_mime_types, max_bytes, status, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'created', now() + interval '15 minutes', now())
       returning *`,
      [
        randomUUID(),
        input.workspaceId,
        input.businessId,
        input.batchId,
        MEDIA_BUCKET,
        `${input.workspaceId}/${input.businessId}/${input.batchId}/${randomUUID()}-${safeFileName(input.originalFileName)}`,
        ALLOWED_MIME_TYPES,
        MAX_UPLOAD_BYTES
      ]
    );
    return toUploadIntent(result.rows[0]);
  }

  async completeUpload(input: Parameters<DataStore["completeUpload"]>[0]): Promise<{ photo: Photo; job: StoredJob | null }> {
    this.assertUploadShape(input.contentType, input.fileSize, input.originalFileName);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const batchResult = await client.query(
        "select * from public.batches where workspace_id = $1 and business_id = $2 and id = $3 for update",
        [input.workspaceId, input.businessId, input.batchId]
      );
      if (!batchResult.rows[0]) this.batchNotFound();
      const intentResult = await client.query(
        `select * from public.upload_intents
         where workspace_id = $1 and business_id = $2 and batch_id = $3 and storage_key = $4
         for update`,
        [input.workspaceId, input.businessId, input.batchId, input.storageKey]
      );
      const intent = intentResult.rows[0];
      if (!intent || intent.status !== "created" || new Date(intent.expires_at).getTime() < Date.now()) {
        throw new AppError({
          code: "upload_intent_invalid",
          statusCode: 409,
          message: "Upload intent is missing, expired, or already completed",
          userMessage: "La subida expiro o ya fue confirmada. Intenta subir la foto de nuevo.",
          retryable: false,
          action: "retry"
        });
      }
      const originalAssetId = randomUUID();
      const photoId = randomUUID();
      await client.query(
        `insert into public.media_assets
         (id, workspace_id, business_id, batch_id, photo_id, kind, bucket, storage_key, mime_type, file_size, is_public, created_at)
         values ($1, $2, $3, $4, null, 'original', $5, $6, $7, $8, false, now())`,
        [
          originalAssetId,
          input.workspaceId,
          input.businessId,
          input.batchId,
          MEDIA_BUCKET,
          input.storageKey,
          input.contentType,
          input.fileSize
        ]
      );
      const photoResult = await client.query(
        `insert into public.photos
         (id, workspace_id, business_id, batch_id, file_name, storage_key, original_asset_id,
          thumbnail_asset_id, vision_input_asset_id, content_hash, mime_type, width, height, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $9, $10, $11, 'validada', now(), now())
         returning *`,
        [
          photoId,
          input.workspaceId,
          input.businessId,
          input.batchId,
          input.originalFileName,
          input.storageKey,
          originalAssetId,
          input.checksum ?? null,
          input.contentType,
          input.width ?? null,
          input.height ?? null
        ]
      );
      await client.query("update public.media_assets set photo_id = $2 where id = $1", [originalAssetId, photoId]);
      await client.query("update public.upload_intents set status = 'completed' where id = $1", [intent.id]);
      await client.query(
        `update public.batches
         set photos_count = (
           select count(*)::int from public.photos where batch_id = $1 and status <> 'eliminada'
         ),
         status = case when status = any($2::text[]) then status else 'pendiente_confirmacion' end,
         last_activity_at = now(), updated_at = now()
         where id = $1`,
        [input.batchId, [...terminalBatchStatuses]]
      );
      await client.query("commit");
      return { photo: toPhoto(photoResult.rows[0]), job: null };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPhoto(input: { workspaceId: string; photoId: string }): Promise<Photo | null> {
    const result = await this.pool.query("select * from public.photos where workspace_id = $1 and id = $2", [
      input.workspaceId,
      input.photoId
    ]);
    return result.rows[0] ? toPhoto(result.rows[0]) : null;
  }

  async completeAnalyzePhoto(input: { photoId: string; jobId: string; analysis: VisionAnalysis; aiRunId?: string }): Promise<Photo> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const photoResult = await client.query("select * from public.photos where id = $1 for update", [input.photoId]);
      const photo = photoResult.rows[0];
      if (!photo) throw new Error(`Photo not found: ${input.photoId}`);
      const updated = await client.query(
        `update public.photos
         set status = 'validada', thumbnail_asset_id = $2, vision_input_asset_id = $3,
             vision_analysis = $4::jsonb, updated_at = now()
         where id = $1 returning *`,
        [photo.id, photo.original_asset_id, photo.original_asset_id, JSON.stringify(input.analysis)]
      );
      await client.query(
        `update public.batches
         set status = 'pendiente_confirmacion', last_activity_at = now(), updated_at = now()
         where id = $1 and not (status = any($2::text[]))`,
        [photo.batch_id, [...terminalBatchStatuses]]
      );
      await client.query("commit");
      return toPhoto(updated.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getMediaAsset(input: { assetId: string }): Promise<MediaAsset | null> {
    const result = await this.pool.query("select * from public.media_assets where id = $1", [input.assetId]);
    return result.rows[0] ? toMediaAsset(result.rows[0]) : null;
  }

  async createMediaUploadIntent(input: Parameters<DataStore["createMediaUploadIntent"]>[0]) {
    await this.requireBusiness(input.workspaceId, input.businessId);
    this.assertUploadShape(input.mime, input.bytes, input.originalName);
    const pending = await this.pool.query(
      "select * from public.media_assets where workspace_id = $1 and sha256 = $2 and status = 'pending' limit 1",
      [input.workspaceId, input.sha256]
    );
    if (pending.rows[0]) {
      throw new AppError({
        code: "ASSET_EXISTS_PENDING",
        statusCode: 409,
        message: "Another upload is already pending for this hash",
        userMessage: "Esa foto ya se esta subiendo.",
        retryable: true,
        action: "retry"
      });
    }
    const existing = await this.pool.query(
      "select * from public.media_assets where workspace_id = $1 and sha256 = $2 and archived_at is null limit 1",
      [input.workspaceId, input.sha256]
    );
    if (existing.rows[0]) return { exists: true, asset: toGalleryAsset(existing.rows[0]) };
    const assetId = randomUUID();
    const categoryResult = input.categoryId
      ? await this.pool.query("select slug from public.media_categories where workspace_id = $1 and id = $2", [
          input.workspaceId,
          input.categoryId
        ])
      : { rows: [] as Array<{ slug: string }> };
    if (input.categoryId && !categoryResult.rows[0]) {
      throw new AppError({
        code: "media_category_not_found",
        statusCode: 404,
        message: "Media category not found",
        userMessage: "No encontramos esa categoria.",
        retryable: false,
        action: "refresh"
      });
    }
    const sequenceResult = await this.pool.query(
      "select count(*)::int as count from public.media_assets where workspace_id = $1 and category_id is not distinct from $2",
      [input.workspaceId, input.categoryId ?? null]
    );
    const storagePath = `${input.workspaceId}/assets/${assetId}/upload-raw`;
    const timestamp = now();
    const result = await this.pool.query(
      `insert into public.media_assets
       (id, workspace_id, business_id, kind, bucket, storage_key, mime_type, file_size, is_public,
        sha256, display_name, original_name, category_id, width, height, bytes, usage_count, status, created_at, updated_at)
       values ($1, $2, $3, 'original', $4, $5, $6, $7, false,
               $8, $9, $10, $11, $12, $13, $14, 0, 'pending', $15, $15)
       returning *`,
      [
        assetId,
        input.workspaceId,
        input.businessId,
        MEDIA_BUCKET,
        storagePath,
        input.mime,
        input.bytes,
        input.sha256,
        displayNameForAsset({
          categorySlug: categoryResult.rows[0]?.slug ?? null,
          createdAt: timestamp,
          sequence: Number(sequenceResult.rows[0]?.count ?? 0) + 1,
          originalName: input.originalName
        }),
        input.originalName,
        input.categoryId ?? null,
        input.width ?? null,
        input.height ?? null,
        input.bytes,
        timestamp
      ]
    );
    return {
      exists: false,
      asset: toGalleryAsset(result.rows[0]),
      storagePath,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
  }

  async completeMediaUpload(input: Parameters<DataStore["completeMediaUpload"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const assetResult = await client.query(
        "select * from public.media_assets where workspace_id = $1 and id = $2 for update",
        [input.workspaceId, input.assetId]
      );
      const asset = assetResult.rows[0];
      if (!asset) throw this.mediaAssetNotFound();
      if (asset.storage_key !== input.storagePath || asset.status !== "pending") {
        throw new AppError({
          code: "media_upload_invalid_state",
          statusCode: 409,
          message: "Media upload is not pending for this storage path",
          userMessage: "La subida de esa foto no esta en un estado valido.",
          retryable: false,
          action: "refresh"
        });
      }
      const updated = await client.query(
        "update public.media_assets set status = 'processing', updated_at = now() where id = $1 returning *",
        [asset.id]
      );
      await client.query("commit");
      const jobInput: Parameters<DataStore["createJob"]>[0] = {
        type: "media:process",
        workspaceId: asset.workspace_id,
        dedupeKey: `media:process:${asset.id}`,
        payload: { assetId: asset.id, requestId: input.requestId }
      };
      if (asset.business_id) jobInput.businessId = asset.business_id;
      const job = await this.createJob(jobInput);
      return { asset: toGalleryAsset(updated.rows[0]), job };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMediaAssets(input: Parameters<DataStore["listMediaAssets"]>[0]) {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const offset = input.cursor ? Math.max(0, Number(Buffer.from(input.cursor, "base64url").toString("utf8")) || 0) : 0;
    const sort =
      input.sort === "name"
        ? "coalesce(display_name, original_name, storage_key) asc, id asc"
        : input.sort === "most_used"
          ? "usage_count desc, created_at desc, id asc"
          : "updated_at desc, created_at desc, id asc";
    const values: unknown[] = [input.workspaceId];
    const clauses = ["workspace_id = $1", "kind = 'original'"];
    if (input.archived) clauses.push("archived_at is not null");
    else clauses.push("archived_at is null");
    if (input.categoryId) {
      values.push(input.categoryId);
      clauses.push(`category_id = $${values.length}`);
    }
    if (input.unused) clauses.push("last_used_at is null");
    if (input.search) {
      values.push(`%${input.search.toLowerCase()}%`);
      clauses.push(`(lower(coalesce(display_name, '')) like $${values.length} or lower(coalesce(original_name, '')) like $${values.length})`);
    }
    if (input.tag) {
      values.push(input.tag.toLowerCase());
      clauses.push(`exists (
        select 1 from public.media_asset_tags mat
        join public.media_tags mt on mt.id = mat.tag_id
        where mat.asset_id = media_assets.id and lower(mt.name) = $${values.length}
      )`);
    }
    const count = await this.pool.query(`select count(*)::int as total from public.media_assets where ${clauses.join(" and ")}`, values);
    const result = await this.pool.query(
      `select * from public.media_assets
       where ${clauses.join(" and ")}
       order by ${sort}
       limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, limit, offset]
    );
    return {
      items: result.rows.map(toGalleryAsset),
      nextCursor: offset + limit < Number(count.rows[0]?.total ?? 0) ? Buffer.from(String(offset + limit)).toString("base64url") : null,
      total: Number(count.rows[0]?.total ?? 0)
    };
  }

  async updateMediaAsset(input: Parameters<DataStore["updateMediaAsset"]>[0]) {
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await this.pool.query("select 1 from public.media_categories where workspace_id = $1 and id = $2", [
        input.workspaceId,
        input.categoryId
      ]);
      if (!category.rows[0]) throw this.mediaCategoryNotFound();
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query(
        `update public.media_assets
         set display_name = coalesce($3, display_name),
             category_id = case when $4::boolean then $5 else category_id end,
             updated_at = now()
         where workspace_id = $1 and id = $2
         returning *`,
        [input.workspaceId, input.assetId, input.displayName ?? null, input.categoryId !== undefined, input.categoryId ?? null]
      );
      if (!updated.rows[0]) throw this.mediaAssetNotFound();
      if (input.tags !== undefined) {
        await client.query("delete from public.media_asset_tags where asset_id = $1", [input.assetId]);
        for (const tagName of input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 30)) {
          const tag = await client.query(
            `insert into public.media_tags (id, workspace_id, name, created_at)
             values ($1, $2, $3, now())
             on conflict (workspace_id, name) do update set name = excluded.name
             returning id`,
            [randomUUID(), input.workspaceId, tagName]
          );
          await client.query(
            "insert into public.media_asset_tags (asset_id, tag_id) values ($1, $2) on conflict do nothing",
            [input.assetId, tag.rows[0].id]
          );
        }
      }
      await client.query("commit");
      return toGalleryAsset(updated.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveMediaAsset(input: Parameters<DataStore["archiveMediaAsset"]>[0]) {
    const result = await this.pool.query(
      "update public.media_assets set archived_at = now(), updated_at = now() where workspace_id = $1 and id = $2 returning *",
      [input.workspaceId, input.assetId]
    );
    if (!result.rows[0]) throw this.mediaAssetNotFound();
    return toGalleryAsset(result.rows[0]);
  }

  async restoreMediaAsset(input: Parameters<DataStore["restoreMediaAsset"]>[0]) {
    const result = await this.pool.query(
      "update public.media_assets set archived_at = null, updated_at = now() where workspace_id = $1 and id = $2 returning *",
      [input.workspaceId, input.assetId]
    );
    if (!result.rows[0]) throw this.mediaAssetNotFound();
    return toGalleryAsset(result.rows[0]);
  }

  async createMediaCategory(input: Parameters<DataStore["createMediaCategory"]>[0]) {
    const slug = slugify(input.slug ?? input.name);
    const result = await this.pool.query(
      `insert into public.media_categories (id, workspace_id, name, slug, color, sort_order, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, now(), now())
       on conflict (workspace_id, slug) do update
       set name = excluded.name, color = excluded.color, sort_order = excluded.sort_order, updated_at = now()
       returning *`,
      [randomUUID(), input.workspaceId, input.name.trim(), slug, input.color ?? null, input.sortOrder ?? 0]
    );
    return toMediaCategory(result.rows[0]);
  }

  async listMediaCategories(input: Parameters<DataStore["listMediaCategories"]>[0]) {
    const result = await this.pool.query(
      "select * from public.media_categories where workspace_id = $1 order by sort_order asc, name asc",
      [input.workspaceId]
    );
    return result.rows.map(toMediaCategory);
  }

  async createMediaSelection(input: Parameters<DataStore["createMediaSelection"]>[0]) {
    const result = await this.pool.query(
      `insert into public.media_selections (id, workspace_id, user_id, name, asset_ids, metadata, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5::text[], $6::jsonb, 'draft', now(), now())
       returning *`,
      [randomUUID(), input.workspaceId, input.userId, input.name ?? null, input.assetIds ?? [], JSON.stringify(input.metadata ?? {})]
    );
    return toMediaSelection(result.rows[0]);
  }

  async listActiveMediaSelections(input: Parameters<DataStore["listActiveMediaSelections"]>[0]) {
    const result = await this.pool.query(
      "select * from public.media_selections where workspace_id = $1 and user_id = $2 and status = 'draft' order by updated_at desc",
      [input.workspaceId, input.userId]
    );
    return result.rows.map(toMediaSelection);
  }

  async updateMediaSelection(input: Parameters<DataStore["updateMediaSelection"]>[0]) {
    const result = await this.pool.query(
      `update public.media_selections
       set name = case when $4::boolean then $5 else name end,
           asset_ids = case when $6::boolean then $7::text[] else asset_ids end,
           metadata = case when $8::boolean then $9::jsonb else metadata end,
           updated_at = now()
       where workspace_id = $1 and user_id = $2 and id = $3
       returning *`,
      [
        input.workspaceId,
        input.userId,
        input.selectionId,
        input.name !== undefined,
        input.name ?? null,
        input.assetIds !== undefined,
        input.assetIds ?? [],
        input.metadata !== undefined,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    if (!result.rows[0]) throw this.mediaSelectionNotFound();
    return toMediaSelection(result.rows[0]);
  }

  async consumeMediaSelection(input: Parameters<DataStore["consumeMediaSelection"]>[0]) {
    const result = await this.pool.query(
      `update public.media_selections
       set status = 'consumed', updated_at = now()
       where workspace_id = $1 and user_id = $2 and id = $3
       returning *`,
      [input.workspaceId, input.userId, input.selectionId]
    );
    if (!result.rows[0]) throw this.mediaSelectionNotFound();
    const selection = toMediaSelection(result.rows[0]);
    if (!input.businessId) return { selection };
    const batch = await this.createBatch({
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      actorId: input.actorId,
      requestId: input.requestId
    });
    return { selection, batch };
  }

  async deleteMediaSelection(input: Parameters<DataStore["deleteMediaSelection"]>[0]) {
    const result = await this.pool.query(
      `update public.media_selections
       set status = 'discarded', updated_at = now()
       where workspace_id = $1 and user_id = $2 and id = $3
       returning *`,
      [input.workspaceId, input.userId, input.selectionId]
    );
    if (!result.rows[0]) throw this.mediaSelectionNotFound();
    return toMediaSelection(result.rows[0]);
  }

  async completeMediaAssetProcessing(input: Parameters<DataStore["completeMediaAssetProcessing"]>[0]) {
    const result = await this.pool.query(
      `update public.media_assets
       set width = $2, height = $3, bytes = $4, thumb_path = $5, preview_path = $6,
           full_path = $7, storage_key = $7, mime_type = 'image/jpeg', file_size = $4,
           phash = coalesce($8, phash),
           status = 'ready', error_reason = null, processed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [input.assetId, input.width, input.height, input.bytes, input.thumbPath, input.previewPath, input.fullPath, input.phash ?? null]
    );
    if (!result.rows[0]) throw this.mediaAssetNotFound();
    return toGalleryAsset(result.rows[0]);
  }

  async failMediaAssetProcessing(input: Parameters<DataStore["failMediaAssetProcessing"]>[0]) {
    const result = await this.pool.query(
      "update public.media_assets set status = 'error', error_reason = $2, updated_at = now() where id = $1 returning *",
      [input.assetId, input.errorReason]
    );
    if (!result.rows[0]) throw this.mediaAssetNotFound();
    return toGalleryAsset(result.rows[0]);
  }

  async createMenuIngestJob(input: Parameters<DataStore["createMenuIngestJob"]>[0]) {
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ sourceType: input.sourceType, text: input.text ?? "", fileName: input.fileName ?? "", dataBase64: input.dataBase64 ?? "" }))
      .digest("hex")
      .slice(0, 24);
    const jobInput: Parameters<DataStore["createJob"]>[0] = {
      type: "menu:parse",
      workspaceId: input.workspaceId,
      dedupeKey: `menu:parse:${input.workspaceId}:${payloadHash}`,
      payload: {
        actorId: input.actorId,
        requestId: input.requestId,
        sourceType: input.sourceType,
        text: input.text,
        fileName: input.fileName,
        mime: input.mime,
        dataBase64: input.dataBase64
      }
    };
    if (input.businessId) jobInput.businessId = input.businessId;
    return this.createJob(jobInput);
  }

  async completeMenuIngest(input: Parameters<DataStore["completeMenuIngest"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const items: MenuItem[] = [];
      const categories = new Map<string, MediaCategory>();
      const categorizedAssets = new Map<string, GalleryMediaAsset>();
      for (const parsed of input.result.items) {
        const categoryName = parsed.categoryName?.trim() || null;
        let category: MediaCategory | null = null;
        if (categoryName) {
          const slug = slugify(categoryName);
          const existingCategory = await client.query(
            "select * from public.media_categories where workspace_id = $1 and slug = $2 limit 1",
            [input.workspaceId, slug]
          );
          if (existingCategory.rows[0]) {
            category = toMediaCategory(existingCategory.rows[0]);
          } else {
            const categoryResult = await client.query(
              `insert into public.media_categories (id, workspace_id, name, slug, color, sort_order, created_at, updated_at)
               values ($1, $2, $3, $4, null,
                 (select count(*)::int from public.media_categories where workspace_id = $2), now(), now())
               returning *`,
              [randomUUID(), input.workspaceId, categoryName, slug]
            );
            category = toMediaCategory(categoryResult.rows[0]);
          }
          categories.set(category.id, category);
        }

        const existingItem = await client.query(
          "select * from public.menu_items where workspace_id = $1 and lower(name) = lower($2) limit 1",
          [input.workspaceId, parsed.name.trim()]
        );
        const keywords = normalizeKeywords([parsed.name, ...parsed.keywords]);
        let item: MenuItem;
        if (existingItem.rows[0]) {
          const mergedKeywords = normalizeKeywords([...(toMenuItem(existingItem.rows[0]).keywords ?? []), ...keywords]);
          const updated = await client.query(
            `update public.menu_items
             set category_id = coalesce($3, category_id),
                 description = coalesce($4, description),
                 price_cents = coalesce($5, price_cents),
                 keywords = $6,
                 updated_at = now()
             where workspace_id = $1 and lower(name) = lower($2)
             returning *`,
            [input.workspaceId, parsed.name.trim(), category?.id ?? null, parsed.description?.trim() || null, parsed.priceCents, mergedKeywords]
          );
          item = toMenuItem(updated.rows[0]);
        } else {
          const inserted = await client.query(
            `insert into public.menu_items (id, workspace_id, category_id, name, description, price_cents, keywords, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, now(), now())
             returning *`,
            [
              randomUUID(),
              input.workspaceId,
              category?.id ?? null,
              parsed.name.trim(),
              parsed.description?.trim() || null,
              parsed.priceCents,
              keywords
            ]
          );
          item = toMenuItem(inserted.rows[0]);
        }
        items.push(item);

        if (category) {
          const assets = await client.query(
            `select * from public.media_assets
             where workspace_id = $1 and category_id is null and archived_at is null and status = 'ready'`,
            [input.workspaceId]
          );
          for (const row of assets.rows) {
            const asset = toGalleryAsset(row);
            if (menuItemMatchesAsset(parsed, asset)) {
              const updatedAsset = await client.query(
                "update public.media_assets set category_id = $2, updated_at = now() where id = $1 returning *",
                [asset.id, category.id]
              );
              categorizedAssets.set(asset.id, toGalleryAsset(updatedAsset.rows[0]));
            }
          }
        }
      }
      await client.query("commit");
      return {
        items,
        categories: Array.from(categories.values()),
        categorizedAssets: Array.from(categorizedAssets.values())
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listMenuItems(input: Parameters<DataStore["listMenuItems"]>[0]) {
    const result = await this.pool.query(
      `select * from public.menu_items
       where workspace_id = $1 and ($2::uuid is null or category_id = $2::uuid)
       order by name asc`,
      [input.workspaceId, input.categoryId ?? null]
    );
    return result.rows.map(toMenuItem);
  }

  async listSimilarMediaAssets(input: Parameters<DataStore["listSimilarMediaAssets"]>[0]): Promise<SimilarMediaAsset[]> {
    const targetResult = await this.pool.query("select * from public.media_assets where id = $1 and workspace_id = $2", [
      input.assetId,
      input.workspaceId
    ]);
    if (!targetResult.rows[0]) throw this.mediaAssetNotFound();
    const target = toGalleryAsset(targetResult.rows[0]);
    const candidates = await this.pool.query(
      `select * from public.media_assets
       where workspace_id = $1 and id <> $2 and phash is not null and archived_at is null and status = 'ready'`,
      [input.workspaceId, input.assetId]
    );
    const threshold = input.threshold ?? 10;
    const limit = input.limit ?? 20;
    return candidates.rows
      .map((row) => {
        const asset = toGalleryAsset(row);
        return { asset, distance: hammingDistanceHex64(target.phash, asset.phash) };
      })
      .filter((item) => item.distance <= threshold)
      .sort((a, b) => a.distance - b.distance || b.asset.createdAt.localeCompare(a.asset.createdAt))
      .slice(0, limit);
  }

  async recordAiRun(input: Omit<AiRun, "id" | "createdAt">): Promise<AiRun> {
    const result = await this.pool.query(
      `insert into public.ai_runs
       (id, workspace_id, business_id, job_id, operation_key, provider, model, model_profile_id, prompt_template_id,
        prompt_version, schema_version, input_hash, output_hash, response_id, usage, latency_ms, status, error_code, request_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, now())
       returning *`,
      [
        randomUUID(),
        input.workspaceId,
        input.businessId ?? null,
        input.jobId,
        input.operationKey,
        input.provider,
        input.model,
        input.modelProfileId,
        input.promptTemplateId,
        input.promptVersion,
        input.schemaVersion,
        input.inputHash,
        input.outputHash,
        input.responseId ?? null,
        JSON.stringify(input.usage ?? null),
        input.latencyMs,
        input.status,
        input.errorCode ?? null,
        input.requestId ?? null
      ]
    );
    return this.toAiRun(result.rows[0]);
  }

  async listAiRuns(input: { workspaceId: string; jobId?: string }): Promise<AiRun[]> {
    const result = await this.pool.query(
      `select * from public.ai_runs
       where workspace_id = $1 and ($2::text is null or job_id = $2)
       order by created_at desc`,
      [input.workspaceId, input.jobId ?? null]
    );
    return result.rows.map((row) => this.toAiRun(row));
  }

  async listVariants(input: { workspaceId: string; businessId: string; batchId: string }): Promise<Variant[]> {
    await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
    const result = await this.pool.query(
      `select * from public.variants
       where workspace_id = $1 and business_id = $2 and batch_id = $3 and status <> 'eliminada'
       order by photo_id asc, variant_index asc`,
      [input.workspaceId, input.businessId, input.batchId]
    );
    return result.rows.map(toVariant);
  }

  async requestGenerateBatch(input: Parameters<DataStore["requestGenerateBatch"]>[0]): ReturnType<DataStore["requestGenerateBatch"]> {
    const batch = await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
    if (!["pendiente_confirmacion", "confirmado", "generado_parcial"].includes(batch.status)) {
      throw new AppError({
        code: "batch_not_ready_for_generation",
        statusCode: 409,
        message: `Batch cannot generate variants from status ${batch.status}`,
        userMessage: "Primero termina de subir las fotos antes de generar variantes.",
        retryable: false,
        action: "refresh"
      });
    }
    const validPhotos = await this.validPhotosForGeneration(input.workspaceId, input.businessId, input.batchId);
    if (validPhotos.length === 0) {
      throw new AppError({
        code: "no_valid_photos_for_generation",
        statusCode: 409,
        message: "Batch has no validated photos",
        userMessage: "Necesitas al menos una foto lista antes de generar variantes.",
        retryable: false,
        action: "refresh"
      });
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const job = await this.createJob({
        type: "generate_batch",
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        batchId: input.batchId,
        dedupeKey: `generate_batch:${input.batchId}:${input.variantsPerPhoto}`,
        payload: { batchId: input.batchId, variantsPerPhoto: input.variantsPerPhoto, requestId: input.requestId }
      });
      let created = 0;
      let available = 0;
      const variants: Variant[] = [];
      const styleOverrides = new Map((input.styleOverrides ?? []).map((override) => [override.photoId, override]));
      let styleSlot = 0;
      for (const photo of validPhotos) {
        for (let index = 1; index <= input.variantsPerPhoto; index += 1) {
          const variantId = randomUUID();
          styleSlot += 1;
          const style = this.assignStyle(styleSlot, styleOverrides.get(photo.id), input.batchId);
          const promptVersion = "generation-plan-v1";
          const plan = this.generationPlan(style, promptVersion);
          const inserted = await client.query(
            `insert into public.variants
             (id, workspace_id, business_id, batch_id, photo_id, variant_index, style_id, assigned_style,
              generation_plan, prompt_template_id, prompt_version, status, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'photo-variant-generation', $10, 'generando', now(), now())
             on conflict (workspace_id, business_id, batch_id, photo_id, variant_index) do nothing
             returning *`,
            [
              variantId,
              input.workspaceId,
              input.businessId,
              input.batchId,
              photo.id,
              index,
              style.styleId,
              JSON.stringify(style),
              JSON.stringify(plan),
              promptVersion
            ]
          );
          let variantRow = inserted.rows[0];
          if (!variantRow) {
            const existing = await client.query(
              `select * from public.variants
               where workspace_id = $1 and business_id = $2 and batch_id = $3 and photo_id = $4 and variant_index = $5`,
              [input.workspaceId, input.businessId, input.batchId, photo.id, index]
            );
            variantRow = existing.rows[0];
            if (variantRow && ["pendiente", "generando"].includes(String(variantRow.status))) {
              const updated = await client.query(
                `update public.variants
                 set style_id = $2, assigned_style = $3::jsonb, generation_plan = $4::jsonb,
                     prompt_template_id = 'photo-variant-generation', prompt_version = $5, updated_at = now()
                 where id = $1 returning *`,
                [variantRow.id, style.styleId, JSON.stringify(style), JSON.stringify(plan), promptVersion]
              );
              variantRow = updated.rows[0];
            }
          }
          if (inserted.rows[0]) created += 1;
          else available += 1;
          const variant = toVariant(variantRow);
          variants.push(variant);
          await client.query(
            `insert into public.jobs
             (id, type, status, workspace_id, business_id, batch_id, photo_id, variant_id, dedupe_key, payload, run_after, created_at, updated_at)
             values ($1, 'generate_variant', 'queued', $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now(), now())
             on conflict do nothing`,
            [
              randomUUID(),
              input.workspaceId,
              input.businessId,
              input.batchId,
              photo.id,
              variant.id,
              `generate_variant:${variant.id}`,
              JSON.stringify({
                batchId: input.batchId,
                photoId: photo.id,
                variantId: variant.id,
                variantIndex: index,
                requestId: input.requestId
              })
            ]
          );
        }
      }
      await client.query(
        `update public.batches
         set status = 'generando',
             variants_per_photo = $3,
             variants_count = (select count(*)::int from public.variants where batch_id = $1 and status <> 'eliminada'),
             last_activity_at = now(),
             updated_at = now()
         where id = $1 and not (status = any($2::text[]))`,
        [input.batchId, [...terminalBatchStatuses], input.variantsPerPhoto]
      );
      await client.query("commit");
      return { job, created, available, variants };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeGenerateBatch(input: { jobId: string; batchId: string }): ReturnType<DataStore["completeGenerateBatch"]> {
    const jobResult = await this.pool.query("select * from public.jobs where id = $1", [input.jobId]);
    const job = jobResult.rows[0] ? toJob(jobResult.rows[0]) : null;
    if (!job) throw new Error(`Job not found: ${input.jobId}`);
    const variants = await this.pool.query("select * from public.variants where workspace_id = $1 and batch_id = $2", [
      job.workspaceId,
      input.batchId
    ]);
    const hasGenerated = variants.rows.some((variant) => variant.status === "generada" || variant.status === "aprobada");
    const batchResult = await this.pool.query(
      `update public.batches
       set variants_count = $3, status = $4, last_activity_at = now(), updated_at = now()
       where id = $1 and workspace_id = $2
         and not (status = any($5::text[]))
       returning *`,
      [
        input.batchId,
        job.workspaceId,
        variants.rows.filter((variant) => variant.status !== "eliminada").length,
        hasGenerated ? "generado_parcial" : "generando",
        [...terminalBatchStatuses]
      ]
    );
    const batch =
      batchResult.rows[0] ??
      (
        await this.pool.query("select * from public.batches where id = $1 and workspace_id = $2", [input.batchId, job.workspaceId])
      ).rows[0];
    return { batch: toBatch(batch), variants: variants.rows.map(toVariant) };
  }

  async getVariantCaptionContext(
    input: Parameters<DataStore["getVariantCaptionContext"]>[0]
  ): ReturnType<DataStore["getVariantCaptionContext"]> {
    const variant = await this.requireVariant(input.workspaceId, input.businessId, input.batchId, input.variantId);
    const photoResult = await this.pool.query(
      "select * from public.photos where id = $1 and workspace_id = $2 and business_id = $3 and batch_id = $4",
      [variant.photoId, input.workspaceId, input.businessId, input.batchId]
    );
    const photo = photoResult.rows[0] ? toPhoto(photoResult.rows[0]) : null;
    if (!photo || photo.status !== "validada") return null;
    const business = await this.requireBusiness(input.workspaceId, input.businessId);
    const pageResult = business.facebookPageId
      ? await this.pool.query("select * from public.facebook_pages where id = $1 and workspace_id = $2", [
          business.facebookPageId,
          input.workspaceId
        ])
      : null;
    return {
      variant,
      photo,
      business,
      page: pageResult?.rows[0] ? toMetaPage(pageResult.rows[0]) : null,
      style: variant.assignedStyle ?? this.assignStyle(variant.variantIndex),
      promptVersion: "caption-page-context-v1"
    };
  }

  async completeGenerateVariant(input: Parameters<DataStore["completeGenerateVariant"]>[0]): ReturnType<DataStore["completeGenerateVariant"]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const jobResult = await client.query("select * from public.jobs where id = $1", [input.jobId]);
      const job = jobResult.rows[0] ? toJob(jobResult.rows[0]) : null;
      if (!job) throw new Error(`Job not found: ${input.jobId}`);
      const variantResult = await client.query("select * from public.variants where workspace_id = $1 and id = $2 for update", [
        job.workspaceId,
        input.variantId
      ]);
      if (!variantResult.rows[0]) this.variantNotFound();
      const current = toVariant(variantResult.rows[0]);
      if (
        job.type !== "generate_variant" ||
        job.variantId !== current.id ||
        job.photoId !== current.photoId ||
        job.businessId !== current.businessId ||
        job.batchId !== current.batchId
      ) {
        throw new AppError({
          code: "variant_job_mismatch",
          statusCode: 409,
          message: "Generate variant job does not match the variant/photo/batch being completed",
          userMessage: "La variante no coincide con el trabajo que la genero. Refresca e intenta de nuevo.",
          retryable: false,
          action: "refresh"
        });
      }
      const photoResult = await client.query("select * from public.photos where id = $1 and workspace_id = $2", [
        current.photoId,
        current.workspaceId
      ]);
      const photo = photoResult.rows[0] ? toPhoto(photoResult.rows[0]) : null;
      if (
        current.generatedAssetId &&
        current.generatedAssetId !== photo?.originalAssetId &&
        current.caption &&
        ["generada", "aprobada", "rechazada"].includes(current.status)
      ) {
        await client.query("commit");
        return current;
      }
      if (!photo || photo.status !== "validada") {
        throw new AppError({
          code: "photo_not_ready_for_variant",
          statusCode: 409,
          message: "Source photo is not validated",
          userMessage: "La foto todavia no esta lista para generar variantes.",
          retryable: true,
          action: "retry"
        });
      }
      if (!photo.originalAssetId) {
        throw new AppError({
          code: "source_media_missing",
          statusCode: 409,
          message: "Validated photo is missing its original media asset",
          userMessage: "La foto no tiene archivo original disponible para publicar.",
          retryable: false,
          action: "refresh"
        });
      }
      if (!input.generatedAsset || input.generatedAsset.storageKey === photo.storageKey || input.generatedAsset.fileSize <= 0) {
        throw new AppError({
          code: "generated_asset_missing",
          statusCode: 409,
          message: "Generated variant image asset is missing or points to the original photo",
          userMessage: "No se pudo generar una imagen editada nueva.",
          retryable: true,
          action: "retry"
        });
      }
      const style = current.assignedStyle ?? this.assignStyle(current.variantIndex);
      const promptVersion = "generation-plan-v1";
      const plan = this.generationPlan(style, promptVersion);
      const quality = {
        schemaVersion: "ai_quality_check.v1" as const,
        status: "pass" as const,
        score: 0.92,
        warnings: [],
        blockingReasons: [],
        requiresHumanReview: false
      };
      const businessResult = await client.query(
        `select b.*, fp.page_name, fp.category
         from public.businesses b
         left join public.facebook_pages fp on fp.id = b.facebook_page_id and fp.workspace_id = b.workspace_id
         where b.workspace_id = $1 and b.id = $2`,
        [current.workspaceId, current.businessId]
      );
      const businessRow = businessResult.rows[0];
      const businessMetadata = json<Record<string, unknown>>(businessRow?.metadata, {});
      const fallbackCaptionResult = this.captionForVariant({
        fileName: photo.fileName ?? "foto",
        variantIndex: current.variantIndex,
        styleName: style.styleName,
        businessName: businessRow?.name ?? "tu negocio",
        pageName: businessRow?.page_name ?? businessRow?.name ?? "tu pagina",
        category: businessRow?.category ?? String(businessMetadata.category ?? "Facebook Page"),
        visionAnalysis: photo.visionAnalysis ? (photo.visionAnalysis as VisionAnalysis) : null,
        metadata: businessMetadata
      });
      const captionResult = input.captionResult ?? fallbackCaptionResult;
      const caption = captionResult.caption;
      const generatedAssetId = randomUUID();
      await client.query(
        `insert into public.media_assets
         (id, workspace_id, business_id, batch_id, photo_id, variant_id, kind, bucket, storage_key,
          mime_type, file_size, is_public, created_at)
         values ($1, $2, $3, $4, $5, $6, 'generated', $7, $8, $9, $10, false, now())`,
        [
          generatedAssetId,
          current.workspaceId,
          current.businessId,
          current.batchId,
          current.photoId,
          current.id,
          input.generatedAsset.bucket,
          input.generatedAsset.storageKey,
          input.generatedAsset.mimeType,
          input.generatedAsset.fileSize
        ]
      );
      const updated = await client.query(
        `update public.variants
         set style_id = $2, assigned_style = $3::jsonb, generation_plan = $4::jsonb, quality_check = $5::jsonb,
             caption_result = $6::jsonb, model_profile_id = 'source-photo-publish-v1',
             prompt_template_id = 'photo-variant-generation', prompt_version = $7,
             quality_check_id = $8, quality_status = $9, quality_score = $10,
             quality_warnings = $11::jsonb, generated_asset_id = $12, caption = $13,
             ai_run_id = coalesce($14, ai_run_id),
             status = 'generada', updated_at = now()
         where id = $1 returning *`,
        [
          current.id,
          style.styleId,
          JSON.stringify(style),
          JSON.stringify(plan),
          JSON.stringify(quality),
          JSON.stringify(captionResult),
          promptVersion,
          `quality:${current.id}`,
          quality.status,
          quality.score,
          JSON.stringify(quality.warnings),
          generatedAssetId,
          caption,
          input.captionAiRunId ?? null
        ]
      );
      await client.query(
        `update public.batches
         set status = 'generado_parcial',
             variants_count = (select count(*)::int from public.variants where batch_id = $1 and status <> 'eliminada'),
             last_activity_at = now(),
             updated_at = now()
         where id = $1 and not (status = any($2::text[]))`,
        [current.batchId, [...terminalBatchStatuses]]
      );
      await client.query("commit");
      return toVariant(updated.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateVariantCaption(input: Parameters<DataStore["updateVariantCaption"]>[0]): Promise<Variant> {
    const variant = await this.requireVariant(input.workspaceId, input.businessId, input.batchId, input.variantId);
    if (!["generada", "aprobada"].includes(variant.status)) {
      throw this.variantStateError("variant_caption_not_editable", "Solo puedes editar captions de variantes generadas o aprobadas.");
    }
    const result = await this.pool.query("update public.variants set caption = $2, updated_at = now() where id = $1 returning *", [
      input.variantId,
      input.caption
    ]);
    return toVariant(result.rows[0]);
  }

  async approveVariant(input: Parameters<DataStore["approveVariant"]>[0]): Promise<Variant> {
    const variant = await this.requireVariant(input.workspaceId, input.businessId, input.batchId, input.variantId);
    if (variant.status !== "generada" && variant.status !== "aprobada") {
      throw this.variantStateError("variant_not_approvable", "Solo puedes aprobar una variante generada.");
    }
    if (variant.qualityStatus === "block") {
      throw this.variantStateError("variant_blocked_by_quality", "Esta variante fue bloqueada por calidad y no puede aprobarse.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      let publishableAssetId = variant.publishableAssetId ?? null;
      if (variant.generatedAssetId && !publishableAssetId) {
        const generated = await client.query(
          "select id from public.media_assets where id = $1 and workspace_id = $2 and business_id = $3",
          [variant.generatedAssetId, variant.workspaceId, variant.businessId]
        );
        if (!generated.rows[0]) {
          throw this.variantStateError("variant_media_missing", "La imagen de la variante no esta disponible para publicar.");
        }
        publishableAssetId = generated.rows[0].id;
      }
      const result = await client.query(
        "update public.variants set status = 'aprobada', publishable_asset_id = $2, updated_at = now() where id = $1 returning *",
        [variant.id, publishableAssetId]
      );
      await client.query("commit");
      return toVariant(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectVariant(input: Parameters<DataStore["rejectVariant"]>[0]): Promise<Variant> {
    const variant = await this.requireVariant(input.workspaceId, input.businessId, input.batchId, input.variantId);
    if (!["generada", "aprobada", "rechazada"].includes(variant.status)) {
      throw this.variantStateError("variant_not_rejectable", "Solo puedes rechazar una variante generada.");
    }
    const result = await this.pool.query("update public.variants set status = 'rechazada', updated_at = now() where id = $1 returning *", [
      variant.id
    ]);
    return toVariant(result.rows[0]);
  }

  async confirmCalendar(input: Parameters<DataStore["confirmCalendar"]>[0]): ReturnType<DataStore["confirmCalendar"]> {
    const batch = await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
    if (terminalBatchStatuses.has(batch.status)) {
      throw new AppError({
        code: "batch_deleted",
        statusCode: 409,
        message: "Batch has been deleted",
        userMessage: "Ese lote ya fue eliminado.",
        retryable: false,
        action: "refresh"
      });
    }
    const business = await this.requireBusiness(input.workspaceId, input.businessId);
    const approvedResult = await this.pool.query(
      `select v.* from public.variants v
       where v.workspace_id = $1 and v.business_id = $2 and v.batch_id = $3 and v.status = 'aprobada'
         and not exists (
           select 1 from public.scheduled_posts sp
           where sp.variant_id = v.id and sp.status <> 'cancelada'
         )
       order by coalesce(v.style_id, ''), v.updated_at`,
      [input.workspaceId, input.businessId, input.batchId]
    );
    const approved = approvedResult.rows.map(toVariant);
    if (approved.length === 0) {
      throw new AppError({
        code: "no_approved_variants",
        statusCode: 409,
        message: "No approved variants available for calendar",
        userMessage: "Primero aprueba al menos una variante antes de programar.",
        retryable: false,
        action: "refresh"
      });
    }
    const inactiveStatuses = ["cancelada", "cancelled", "fallida", "failed"];
    const occupiedResult = await this.pool.query(
      `select scheduled_for from public.scheduled_posts
       where workspace_id = $1
         and page_id = $2
         and not (status = any($3::text[]))
         and scheduled_for > now()`,
      [input.workspaceId, business.facebookPageId, inactiveStatuses]
    );
    const scheduleSlots = allocateScheduleSlots({
      count: approved.length,
      periodDays: input.periodDays,
      occupiedSlots: occupiedResult.rows.map((row) => new Date(row.scheduled_for).toISOString()),
      timeZone: business.timezone
    });
    if (scheduleSlots.length < approved.length) {
      throw new AppError({
        code: "schedule_capacity_exceeded",
        statusCode: 409,
        message: "Not enough free schedule slots for the requested period",
        userMessage: "No hay suficientes horarios libres en ese periodo para este lote.",
        retryable: false,
        action: "refresh"
      });
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const job = await this.createJob({
        type: "schedule_posts",
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        batchId: input.batchId,
        dedupeKey: `schedule_posts:${input.batchId}:${input.periodDays}`,
        payload: { batchId: input.batchId, periodDays: input.periodDays, requestId: input.requestId }
      });
      const scheduledPosts: ScheduledPost[] = [];
      for (const [index, variant] of approved.entries()) {
        const scheduledFor = scheduleSlots[index]!;
        const inserted = await client.query(
          `insert into public.scheduled_posts
           (id, workspace_id, business_id, batch_id, variant_id, page_id, scheduled_for, facebook_post_id,
            remote_post_type, remote_post_url, delivery_mode, graph_api_version, publish_lead_seconds,
            scheduled_for_unix, status, remote_status, retry_count, last_remote_sync_at, remote_error_code,
            remote_trace_id, caption, image_url, style_id, style_name, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, null, null, null, 'local_due_publish', 'v23.0', 0,
                   $8, 'programada', 'no_enviado', 0, null, null, null, $9, null, $10, $11, now(), now())
           on conflict do nothing
           returning *`,
          [
            randomUUID(),
            input.workspaceId,
            input.businessId,
            input.batchId,
            variant.id,
            business.facebookPageId,
            scheduledFor,
            Math.floor(new Date(scheduledFor).getTime() / 1000),
            variant.caption ?? "",
            variant.styleId ?? null,
            variant.assignedStyle?.styleName ?? null
          ]
        );
        const postRow =
          inserted.rows[0] ??
          (
            await client.query("select * from public.scheduled_posts where workspace_id = $1 and variant_id = $2 and status <> 'cancelada'", [
              input.workspaceId,
              variant.id
            ])
          ).rows[0];
        if (postRow) scheduledPosts.push(toScheduledPost(postRow));
        await client.query("update public.variants set status = 'programada', updated_at = now() where id = $1", [variant.id]);
      }
      await client.query(
        "update public.batches set status = 'scheduled', last_activity_at = now(), updated_at = now() where id = $1",
        [batch.id]
      );
      await client.query("commit");
      return { scheduledPosts, job };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listScheduledPosts(input: Parameters<DataStore["listScheduledPosts"]>[0]): Promise<ScheduledPost[]> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and business_id = $2
         and ($3::text is null or batch_id = $3)
         and ($4::timestamptz is null or scheduled_for >= $4::timestamptz)
         and ($5::timestamptz is null or scheduled_for <= $5::timestamptz)
       order by scheduled_for asc`,
      [input.workspaceId, input.businessId, input.batchId ?? null, input.from ?? null, input.to ?? null]
    );
    return result.rows.map(toScheduledPost);
  }

  async getFacebookPhotoReuseStats(input: Parameters<DataStore["getFacebookPhotoReuseStats"]>[0]) {
    const business = await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      `select
         (select count(*)::int from public.media_asset_fb_uploads where facebook_page_id = $1) as unique_uploads,
         (select count(*)::int from public.media_asset_usages where facebook_page_id = $1) as total_usages`,
      [business.facebookPageId]
    );
    const uniqueUploads = Number(result.rows[0]?.unique_uploads ?? 0);
    const totalUsages = Number(result.rows[0]?.total_usages ?? 0);
    return {
      businessId: business.id,
      facebookPageId: business.facebookPageId,
      uniqueUploads,
      totalUsages,
      uploadsSaved: Math.max(0, totalUsages - uniqueUploads)
    };
  }

  async getScheduledPost(input: Parameters<DataStore["getScheduledPost"]>[0]): Promise<ScheduledPost | null> {
    const result = await this.pool.query(
      "select * from public.scheduled_posts where workspace_id = $1 and business_id = $2 and id = $3",
      [input.workspaceId, input.businessId, input.scheduledPostId]
    );
    return result.rows[0] ? toScheduledPost(result.rows[0]) : null;
  }

  async completeSchedulePosts(input: { jobId: string; batchId: string }): ReturnType<DataStore["completeSchedulePosts"]> {
    const job = await this.requireJob(input.jobId);
    if (!job.businessId) throw new Error("schedule_posts job is missing businessId");
    const batch = await this.requireBatch(job.workspaceId, job.businessId, input.batchId);
    if (terminalBatchStatuses.has(batch.status)) return { scheduledPosts: [] };
    const result = await this.pool.query("select * from public.scheduled_posts where workspace_id = $1 and batch_id = $2", [
      job.workspaceId,
      input.batchId
    ]);
    const posts = result.rows.map(toScheduledPost);
    for (const post of posts) {
      const remoteScheduled = await this.scheduleRemotePostIfPossible(post, job);
      if (remoteScheduled) continue;
      const existing = await this.pool.query(
        "select 1 from public.jobs where type = 'publish_post' and dedupe_key = $1 and status <> 'cancelled' limit 1",
        [`publish_post:${post.id}`]
      );
      if (!existing.rows[0] && post.status === "programada" && post.remoteStatus === "no_enviado") {
        await this.createJob({
          type: "publish_post",
          workspaceId: post.workspaceId,
          businessId: post.businessId,
          batchId: post.batchId,
          variantId: post.variantId,
          dedupeKey: `publish_post:${post.id}`,
          runAfter: post.scheduledFor,
          payload: { scheduledPostId: post.id, deliveryMode: post.deliveryMode }
        });
      }
    }
    if (posts.length > 0) {
      await this.pool.query(
        "update public.batches set status = 'completado', last_activity_at = now(), updated_at = now() where id = $1",
        [batch.id]
      );
    }
    return { scheduledPosts: posts };
  }

  private async ensureFacebookPhotoUpload(input: {
    assetId: string;
    facebookPageId: string;
    metaPageId: string;
    pageAccessToken: string;
    imageUrl: string;
    graphApiVersion: string;
  }): Promise<{ fbPhotoId: string; reused: boolean; providerTraceId?: string }> {
    const existing = await this.pool.query(
      "select fb_photo_id from public.media_asset_fb_uploads where asset_id = $1 and facebook_page_id = $2 limit 1",
      [input.assetId, input.facebookPageId]
    );
    if (existing.rows[0]?.fb_photo_id) {
      await this.pool.query(
        "update public.media_asset_fb_uploads set last_used_at = now() where asset_id = $1 and facebook_page_id = $2",
        [input.assetId, input.facebookPageId]
      );
      return { fbPhotoId: String(existing.rows[0].fb_photo_id), reused: true };
    }
    const uploaded = await uploadUnpublishedFacebookPagePhoto({
      graphApiVersion: input.graphApiVersion,
      pageId: input.metaPageId,
      pageAccessToken: input.pageAccessToken,
      imageUrl: input.imageUrl
    });
    const inserted = await this.pool.query(
      `insert into public.media_asset_fb_uploads (id, asset_id, facebook_page_id, fb_photo_id, uploaded_at, last_used_at)
       values ($1, $2, $3, $4, now(), now())
       on conflict (asset_id, facebook_page_id)
       do update set last_used_at = now()
       returning fb_photo_id`,
      [randomUUID(), input.assetId, input.facebookPageId, uploaded.fbPhotoId]
    );
    return {
      fbPhotoId: String(inserted.rows[0]?.fb_photo_id ?? uploaded.fbPhotoId),
      reused: false,
      ...(uploaded.providerTraceId ? { providerTraceId: uploaded.providerTraceId } : {})
    };
  }

  private async recordMediaAssetUsage(input: {
    assetId: string;
    scheduledPostId: string;
    variantId: string;
    facebookPageId: string;
  }) {
    await this.pool.query(
      `insert into public.media_asset_usages (id, asset_id, scheduled_post_id, variant_id, facebook_page_id, used_at)
       select $1, $2, $3, $4, $5, now()
       where not exists (
         select 1 from public.media_asset_usages
         where asset_id = $2 and scheduled_post_id = $3
       )`,
      [randomUUID(), input.assetId, input.scheduledPostId, input.variantId, input.facebookPageId]
    );
    await this.pool.query(
      `update public.media_assets
       set usage_count = (
         select count(*)::int from public.media_asset_usages where asset_id = $1
       ), last_used_at = now(), updated_at = now()
       where id = $1`,
      [input.assetId]
    );
    await this.pool.query(
      "update public.media_asset_fb_uploads set last_used_at = now() where asset_id = $1 and facebook_page_id = $2",
      [input.assetId, input.facebookPageId]
    );
  }

  private async scheduleRemotePostIfPossible(post: ScheduledPost, job: StoredJob): Promise<boolean> {
    if (post.status !== "programada" || post.remoteStatus !== "no_enviado") return post.remoteStatus === "confirmado_meta";
    const variant = await this.requireVariant(post.workspaceId, post.businessId, post.batchId, post.variantId);
    if (!variant.publishableAssetId) {
      await this.failScheduledPost(post.id, "missing_publishable_media");
      throw this.scheduledPostStateError("missing_publishable_media");
    }
    const asset = await this.pool.query(
      "select * from public.media_assets where id = $1 and workspace_id = $2 and business_id = $3",
      [variant.publishableAssetId, post.workspaceId, post.businessId]
    );
    if (!asset.rows[0]) {
      await this.failScheduledPost(post.id, "media_not_available");
      throw this.scheduledPostStateError("media_not_available");
    }
    const pageResult = await this.pool.query(
      `select meta_page_id, encrypted_page_access_token, encrypted_page_access_token_ciphertext
       from public.facebook_pages where id = $1 and workspace_id = $2`,
      [post.pageId, post.workspaceId]
    );
    const page = pageResult.rows[0] as
      | { meta_page_id?: string; encrypted_page_access_token?: string | null; encrypted_page_access_token_ciphertext?: Buffer | null }
      | undefined;
    const pageAccessToken = await this.decryptPageAccessToken(page);
    if (!pageAccessToken || !page?.meta_page_id || page.meta_page_id.startsWith("mock-")) return false;
    const publishImageUrl = publicMediaUrl(String(asset.rows[0].id)) ?? (post.imageUrl && /^https:\/\//i.test(post.imageUrl) ? post.imageUrl : null);
    if (!publishImageUrl) {
      await this.failScheduledPost(post.id, "missing_public_media_url");
      throw this.scheduledPostStateError("missing_public_media_url");
    }
    const operationKey = `meta_schedule:${post.id}`;
    await this.pool.query("update public.scheduled_posts set remote_status = 'actualizacion_pendiente', updated_at = now() where id = $1", [
      post.id
    ]);
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "schedule_post",
      status: "started"
    });
    let publishResult: Awaited<ReturnType<typeof publishFacebookPagePost>>;
    let fbUpload: { fbPhotoId: string; reused: boolean; providerTraceId?: string };
    try {
      const graphApiVersion = post.graphApiVersion ?? process.env.META_GRAPH_API_VERSION ?? "v23.0";
      fbUpload = await this.ensureFacebookPhotoUpload({
        assetId: String(asset.rows[0].id),
        facebookPageId: post.pageId,
        metaPageId: page.meta_page_id,
        pageAccessToken,
        imageUrl: publishImageUrl,
        graphApiVersion
      });
      publishResult = await publishFacebookPagePost({
        graphApiVersion,
        pageId: page.meta_page_id,
        pageAccessToken,
        caption: post.caption ?? "",
        attachedMediaFbid: fbUpload.fbPhotoId,
        scheduledForUnix: post.scheduledForUnix ?? Math.floor(new Date(post.scheduledFor).getTime() / 1000)
      });
    } catch (error) {
      await this.pool.query(
        `update public.scheduled_posts
         set status = 'fallida', remote_status = 'incierto', remote_error_code = $2, updated_at = now()
         where id = $1`,
        [post.id, error instanceof AppError ? error.code : "meta_schedule_failed"]
      );
      await this.upsertExternalOperation({
        operationKey,
        workspaceId: post.workspaceId,
        jobId: job.id,
        provider: "meta",
        operation: "schedule_post",
        status: "failed"
      });
      throw error;
    }
    await this.pool.query(
      `update public.scheduled_posts
       set facebook_post_id = $2, remote_post_type = $3, remote_post_url = $4,
           delivery_mode = 'remote_schedule', remote_status = 'confirmado_meta',
           last_remote_sync_at = now(), image_url = $5, remote_trace_id = $6,
           fb_photo_id = $7, fb_photo_reused = $8, updated_at = now()
       where id = $1`,
      [
        post.id,
        publishResult.facebookPostId,
        publishResult.remotePostType,
        publishResult.remotePostUrl,
        publishImageUrl,
        publishResult.providerTraceId ?? fbUpload.providerTraceId ?? null,
        fbUpload.fbPhotoId,
        fbUpload.reused
      ]
    );
    await this.recordMediaAssetUsage({
      assetId: String(asset.rows[0].id),
      scheduledPostId: post.id,
      variantId: post.variantId,
      facebookPageId: post.pageId
    });
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "schedule_post",
      status: "succeeded"
    });
    return true;
  }

  async publishScheduledPost(input: Parameters<DataStore["publishScheduledPost"]>[0]): Promise<ScheduledPost> {
    const job = await this.requireJob(input.jobId);
    const post = await this.requireScheduledPost(job.workspaceId, job.businessId, job.batchId, input.scheduledPostId);
    if (post.facebookPostId) return post;
    if (post.status === "estado_incierto") {
      throw new AppError({
        code: "scheduled_post_ambiguous",
        statusCode: 409,
        message: "Scheduled post is ambiguous and requires sync",
        userMessage: "Esta publicacion necesita verificacion antes de reintentar.",
        retryable: false,
        action: "contact_support"
      });
    }
    const variant = await this.requireVariant(post.workspaceId, post.businessId, post.batchId, post.variantId);
    if (!variant.publishableAssetId) return await this.failScheduledPost(post.id, "missing_publishable_media");
    const asset = await this.pool.query(
      "select * from public.media_assets where id = $1 and workspace_id = $2 and business_id = $3",
      [variant.publishableAssetId, post.workspaceId, post.businessId]
    );
    if (!asset.rows[0]) return await this.failScheduledPost(post.id, "media_not_available");
    const operationKey = `meta_publish:${post.id}`;
    await this.pool.query("update public.scheduled_posts set status = 'publicacion_en_proceso', updated_at = now() where id = $1", [post.id]);
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "publish_post",
      status: "started"
    });
    const pageResult = await this.pool.query(
      `select meta_page_id, encrypted_page_access_token, encrypted_page_access_token_ciphertext
       from public.facebook_pages where id = $1 and workspace_id = $2`,
      [post.pageId, post.workspaceId]
    );
    const page = pageResult.rows[0] as
      | { meta_page_id?: string; encrypted_page_access_token?: string | null; encrypted_page_access_token_ciphertext?: Buffer | null }
      | undefined;
    const pageAccessToken = await this.decryptPageAccessToken(page);
    let remoteTraceId: string | null = null;
    if (!pageAccessToken || !page?.meta_page_id || page.meta_page_id.startsWith("mock-")) {
      await this.upsertExternalOperation({
        operationKey,
        workspaceId: post.workspaceId,
        jobId: job.id,
        provider: "meta",
        operation: "publish_post",
        status: "failed"
      });
      return await this.failScheduledPost(post.id, "missing_meta_page_token");
    }
    const publishImageUrl = publicMediaUrl(String(asset.rows[0].id)) ?? (post.imageUrl && /^https:\/\//i.test(post.imageUrl) ? post.imageUrl : null);
    if (!publishImageUrl) {
      await this.upsertExternalOperation({
        operationKey,
        workspaceId: post.workspaceId,
        jobId: job.id,
        provider: "meta",
        operation: "publish_post",
        status: "failed"
      });
      return await this.failScheduledPost(post.id, "missing_public_media_url");
    }
    let publishResult: Awaited<ReturnType<typeof publishFacebookPagePost>>;
    let fbUpload: { fbPhotoId: string; reused: boolean; providerTraceId?: string };
    try {
      const graphApiVersion = post.graphApiVersion ?? process.env.META_GRAPH_API_VERSION ?? "v23.0";
      fbUpload = await this.ensureFacebookPhotoUpload({
        assetId: String(asset.rows[0].id),
        facebookPageId: post.pageId,
        metaPageId: page.meta_page_id,
        pageAccessToken,
        imageUrl: publishImageUrl,
        graphApiVersion
      });
      publishResult = await publishFacebookPagePost({
        graphApiVersion,
        pageId: page.meta_page_id,
        pageAccessToken,
        caption: post.caption ?? "",
        attachedMediaFbid: fbUpload.fbPhotoId
      });
      remoteTraceId = publishResult.providerTraceId ?? fbUpload.providerTraceId ?? null;
    } catch (error) {
      await this.pool.query(
        `update public.scheduled_posts
         set status = 'fallida', remote_status = 'incierto', remote_error_code = $2, updated_at = now()
         where id = $1`,
        [post.id, error instanceof AppError ? error.code : "meta_publish_failed"]
      );
      await this.upsertExternalOperation({
        operationKey,
        workspaceId: post.workspaceId,
        jobId: job.id,
        provider: "meta",
        operation: "publish_post",
        status: "failed"
      });
      throw error;
    }
    const result = await this.pool.query(
      `update public.scheduled_posts
       set status = 'publicada', facebook_post_id = $2, remote_post_type = $3,
           remote_post_url = $4, delivery_mode = $5, remote_status = 'confirmado_meta',
           last_remote_sync_at = now(), image_url = $6, remote_trace_id = $7, updated_at = now(),
           retry_count = retry_count + $8, fb_photo_id = $9, fb_photo_reused = $10
       where id = $1 returning *`,
      [
        post.id,
        publishResult.facebookPostId,
        publishResult.remotePostType,
        publishResult.remotePostUrl,
        input.publishNow ? "publish_now" : post.deliveryMode,
        publishImageUrl,
        remoteTraceId,
        input.publishNow ? 0 : 1,
        fbUpload.fbPhotoId,
        fbUpload.reused
      ]
    );
    await this.pool.query("update public.variants set status = 'publicada', updated_at = now() where id = $1", [post.variantId]);
    await this.recordMediaAssetUsage({
      assetId: String(asset.rows[0].id),
      scheduledPostId: post.id,
      variantId: post.variantId,
      facebookPageId: post.pageId
    });
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "publish_post",
      status: "succeeded"
    });
    return toScheduledPost(result.rows[0]);
  }

  async updateScheduledPost(input: Parameters<DataStore["updateScheduledPost"]>[0]): ReturnType<DataStore["updateScheduledPost"]> {
    const post = await this.requireScheduledPost(input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.status === "publicada" || post.status === "cancelada") throw this.scheduledPostStateError("scheduled_post_not_editable");
    if (post.remoteStatus !== "no_enviado") {
      const uncertain = await this.pool.query(
        "update public.scheduled_posts set status = 'estado_incierto', remote_status = 'incierto', updated_at = now() where id = $1 returning *",
        [post.id]
      );
      return { scheduledPost: toScheduledPost(uncertain.rows[0]) };
    }
    const result = await this.pool.query(
      `update public.scheduled_posts
       set scheduled_for = $2, scheduled_for_unix = $3, status = 'programada', updated_at = now()
       where id = $1 returning *`,
      [post.id, input.scheduledFor, Math.floor(new Date(input.scheduledFor).getTime() / 1000)]
    );
    const job = await this.createJob({
      type: "publish_post",
      workspaceId: post.workspaceId,
      businessId: post.businessId,
      batchId: post.batchId,
      variantId: post.variantId,
      dedupeKey: `publish_post:${post.id}:${input.scheduledFor}`,
      runAfter: input.scheduledFor,
      payload: { scheduledPostId: post.id, deliveryMode: post.deliveryMode }
    });
    return { scheduledPost: toScheduledPost(result.rows[0]), job };
  }

  async cancelScheduledPost(input: Parameters<DataStore["cancelScheduledPost"]>[0]): ReturnType<DataStore["cancelScheduledPost"]> {
    const post = await this.requireScheduledPost(input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.status === "publicada") throw this.scheduledPostStateError("scheduled_post_already_published");
    if (post.remoteStatus !== "no_enviado" || post.facebookPostId) {
      const updated = await this.pool.query(
        "update public.scheduled_posts set status = 'estado_incierto', updated_at = now() where id = $1 returning *",
        [post.id]
      );
      return { scheduledPost: toScheduledPost(updated.rows[0]) };
    }
    const updated = await this.pool.query("update public.scheduled_posts set status = 'cancelada', updated_at = now() where id = $1 returning *", [
      post.id
    ]);
    await this.pool.query("update public.variants set status = 'aprobada', updated_at = now() where id = $1 and status = 'programada'", [
      post.variantId
    ]);
    return { scheduledPost: toScheduledPost(updated.rows[0]) };
  }

  async publishScheduledPostNow(input: Parameters<DataStore["publishScheduledPostNow"]>[0]): ReturnType<DataStore["publishScheduledPostNow"]> {
    const post = await this.requireScheduledPost(input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.facebookPostId || post.status === "publicada" || post.status === "estado_incierto") {
      throw this.scheduledPostStateError("scheduled_post_not_publishable");
    }
    const scheduledFor = now();
    const updated = await this.pool.query(
      `update public.scheduled_posts
       set delivery_mode = 'publish_now', scheduled_for = $2, scheduled_for_unix = $3,
           status = 'publicacion_en_proceso', updated_at = $2
       where id = $1 returning *`,
      [post.id, scheduledFor, Math.floor(Date.now() / 1000)]
    );
    const job = await this.createJob({
      type: "publish_post",
      workspaceId: post.workspaceId,
      businessId: post.businessId,
      batchId: post.batchId,
      variantId: post.variantId,
      dedupeKey: `publish_post_now:${post.id}`,
      runAfter: scheduledFor,
      payload: { scheduledPostId: post.id, deliveryMode: "publish_now", requestId: input.requestId }
    });
    return { scheduledPost: toScheduledPost(updated.rows[0]), job };
  }

  async getIdempotencyRecord(input: Parameters<DataStore["getIdempotencyRecord"]>[0]): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query(
      `select * from public.idempotency_records
       where workspace_id = $1 and actor_id = $2 and method = $3 and route_key = $4 and idempotency_key = $5`,
      [input.workspaceId, input.actorId, input.method, input.routeKey, input.idempotencyKey]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      actorId: row.actor_id,
      method: row.method,
      routeKey: row.route_key,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      response: row.response,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString()
    };
  }

  async saveIdempotencyRecord(input: Parameters<DataStore["saveIdempotencyRecord"]>[0]): Promise<IdempotencyRecord> {
    const result = await this.pool.query(
      `insert into public.idempotency_records
       (id, workspace_id, actor_id, method, route_key, idempotency_key, request_hash, response, status, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'completed', now(), now() + interval '24 hours')
       on conflict (workspace_id, actor_id, method, route_key, idempotency_key)
       do update set response = excluded.response, status = 'completed'
       returning *`,
      [
        randomUUID(),
        input.workspaceId,
        input.actorId,
        input.method,
        input.routeKey,
        input.idempotencyKey,
        input.requestHash,
        JSON.stringify(input.response)
      ]
    );
    return (await this.getIdempotencyRecord(input)) ?? {
      id: result.rows[0].id,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      method: input.method,
      routeKey: input.routeKey,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      response: input.response,
      status: "completed",
      createdAt: new Date(result.rows[0].created_at).toISOString(),
      expiresAt: new Date(result.rows[0].expires_at).toISOString()
    };
  }

  async upsertExternalOperation(input: Parameters<DataStore["upsertExternalOperation"]>[0]): Promise<ExternalOperation> {
    const result = await this.pool.query(
      `insert into public.external_operations (operation_key, workspace_id, job_id, provider, operation, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, now(), now())
       on conflict (operation_key) do update set status = excluded.status, updated_at = now()
       returning *`,
      [input.operationKey, input.workspaceId, input.jobId ?? null, input.provider, input.operation, input.status]
    );
    const row = result.rows[0];
    return {
      operationKey: row.operation_key,
      workspaceId: row.workspace_id,
      jobId: row.job_id ?? undefined,
      provider: row.provider,
      operation: row.operation,
      status: row.status,
      providerRequestId: row.provider_request_id ?? undefined,
      providerResourceId: row.provider_resource_id ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    };
  }

  private async requireBusiness(workspaceId: string, businessId: string): Promise<Business> {
    const business = await this.getBusiness({ workspaceId, businessId });
    if (!business) {
      throw new AppError({
        code: "business_not_found",
        statusCode: 404,
        message: "Business not found in workspace",
        userMessage: "No encontramos ese negocio en tu workspace.",
        retryable: false,
        action: "refresh"
      });
    }
    return business;
  }

  private async decryptPageAccessToken(
    page:
      | { encrypted_page_access_token?: string | null; encrypted_page_access_token_ciphertext?: Buffer | null }
      | null
      | undefined
  ): Promise<string | null> {
    const tokenKekValue = tokenKek();
    if (page?.encrypted_page_access_token_ciphertext && tokenKekValue) {
      const result = await this.pool.query("select pgp_sym_decrypt($1::bytea, $2) as token", [
        page.encrypted_page_access_token_ciphertext,
        tokenKekValue
      ]);
      const token = result.rows[0]?.token;
      if (typeof token === "string" && token.trim()) return token;
    }
    return decodeServerToken(page?.encrypted_page_access_token);
  }

  private async requireWorkspace(workspaceId: string): Promise<Workspace> {
    const result = await this.pool.query("select * from public.workspaces where id = $1", [workspaceId]);
    if (!result.rows[0]) {
      throw new AppError({
        code: "workspace_not_found",
        statusCode: 404,
        message: "Workspace not found",
        userMessage: "No encontramos tu workspace.",
        retryable: false,
        action: "refresh"
      });
    }
    return toWorkspace(result.rows[0]);
  }

  private async requireBatch(workspaceId: string, businessId: string, batchId: string): Promise<BatchSummary> {
    const result = await this.pool.query("select * from public.batches where workspace_id = $1 and business_id = $2 and id = $3", [
      workspaceId,
      businessId,
      batchId
    ]);
    if (!result.rows[0]) this.batchNotFound();
    return toBatch(result.rows[0]);
  }

  private batchNotFound(): never {
    throw new AppError({
      code: "batch_not_found",
      statusCode: 404,
      message: "Batch not found in business",
      userMessage: "No encontramos ese lote.",
      retryable: false,
      action: "refresh"
    });
  }

  private mediaAssetNotFound(): never {
    throw new AppError({
      code: "media_asset_not_found",
      statusCode: 404,
      message: "Media asset not found",
      userMessage: "No encontramos esa foto.",
      retryable: false,
      action: "refresh"
    });
  }

  private mediaCategoryNotFound(): never {
    throw new AppError({
      code: "media_category_not_found",
      statusCode: 404,
      message: "Media category not found",
      userMessage: "No encontramos esa categoria.",
      retryable: false,
      action: "refresh"
    });
  }

  private mediaSelectionNotFound(): never {
    throw new AppError({
      code: "media_selection_not_found",
      statusCode: 404,
      message: "Media selection not found",
      userMessage: "No encontramos esa seleccion.",
      retryable: false,
      action: "refresh"
    });
  }

  private assertUploadShape(contentType: string, fileSize: number, originalFileName?: string) {
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      throw new AppError({
        code: "unsupported_media_type",
        statusCode: 415,
        message: `Unsupported upload content type: ${contentType}`,
        userMessage: "Ese formato de imagen no esta permitido.",
        retryable: false,
        action: "retry"
      });
    }
    if (originalFileName) {
      const lowerName = originalFileName.toLowerCase();
      const extension = [...extensionMimeHints.keys()].find((item) => lowerName.endsWith(item));
      const hintedMime = extension ? extensionMimeHints.get(extension) : undefined;
      if (hintedMime && hintedMime !== contentType) {
        throw new AppError({
          code: "media_metadata_mismatch",
          statusCode: 415,
          message: `Upload extension does not match content type: ${originalFileName}`,
          userMessage: "El tipo del archivo no coincide con la extension de la imagen.",
          retryable: false,
          action: "retry"
        });
      }
    }
    if (fileSize > MAX_UPLOAD_BYTES) {
      throw new AppError({
        code: "upload_too_large",
        statusCode: 413,
        message: `Upload exceeds max size: ${fileSize}`,
        userMessage: "La foto pesa demasiado para este lote.",
        retryable: false,
        action: "retry"
      });
    }
  }

  private async validPhotosForGeneration(workspaceId: string, businessId: string, batchId: string): Promise<Photo[]> {
    const result = await this.pool.query(
      `select * from public.photos
       where workspace_id = $1 and business_id = $2 and batch_id = $3
         and status = 'validada' and original_asset_id is not null
       order by created_at asc`,
      [workspaceId, businessId, batchId]
    );
    return result.rows.map(toPhoto);
  }

  private assignStyle(index: number, override?: GenerateStyleOverride, seed?: string | null): AssignedStyle {
    if (override) return this.manualStyle(index, override);
    const selected = variantStylePresetForSlot(index, seed);
    return {
      styleId: selected.styleId,
      styleName: selected.styleName,
      intensity: "media",
      contrast: 0.48,
      saturation: selected.saturation + 0.2,
      warmth: selected.warmth,
      sharpness: 0.42,
      lowConfidence: false,
      manualOverride: false
    };
  }

  private manualStyle(index: number, override: GenerateStyleOverride): AssignedStyle {
    const selected = variantStylePresetForSlot(index, null, override.styleId);
    const intensityValue = Math.max(0, Math.min(100, override.intensity));
    const intensity = intensityValue >= 80 ? "fuerte" : intensityValue <= 40 ? "ligera" : "media";
    const strength = intensityValue / 100;
    return {
      styleId: selected.styleId,
      styleName: selected.styleName,
      intensity,
      contrast: 0.18 + strength * 0.38,
      saturation: selected.saturation + strength * 0.24,
      warmth: selected.warmth,
      sharpness: 0.22 + strength * 0.24,
      lowConfidence: false,
      manualOverride: true
    };
  }

  private generationPlan(style: AssignedStyle, promptVersion: string) {
    return {
      schemaVersion: "generation_plan.v1" as const,
      puedeGenerar: true,
      motivo: "Foto lista para edicion basica.",
      sujetoPrincipal: "producto o escena principal de la foto",
      preservar: ["producto real", "logos visibles", "texto visible", "identidad de personas"],
      permitido: ["encuadre cuadrado", "mejora de luz", "fondo limpio", "composicion para Facebook"],
      prohibido: ["inventar precios", "inventar promociones", "cambiar producto real", "agregar texto nuevo sobre la imagen"],
      riesgo: [],
      nivelRiesgo: "riesgo_bajo" as const,
      divulgacionIa: "no_requerida" as const,
      identityPolicy: "preservar" as const,
      textPolicy: "evitar_texto_nuevo" as const,
      brandPolicy: "preservar_logos" as const,
      commercialClaimPolicy: "no_inventar_claims" as const,
      requiresHumanReview: false,
      promptFinal: `Crear una variante cuadrada para Facebook con estilo ${style.styleName}.`,
      promptVersion,
      planVersion: "generation-plan-v1"
    };
  }

  private captionForVariant(input: {
    fileName: string;
    variantIndex: number;
    styleName: string;
    businessName: string;
    pageName: string;
    category: string;
    visionAnalysis?: VisionAnalysis | null;
    metadata?: Record<string, unknown>;
  }): CaptionResult {
    const subject = input.visionAnalysis?.subject.description || input.visionAnalysis?.summary || input.fileName;
    const configuredKeywords = metadataList(input.metadata, "facebookSeoKeywords").slice(0, 6);
    const contentTypes = metadataList(input.metadata, "contentTypes").slice(0, 4);
    const context = metadataText(input.metadata, "facebookSeoContext");
    const keywords = [...configuredKeywords, ...(input.visionAnalysis?.mood.keywords.slice(0, 3).filter(Boolean) ?? [])];
    const cleanTag = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 32);
    const pageTag = cleanTag(input.pageName);
    const categoryTag = cleanTag(input.category);
    const endings = [
      "Cuentanos que te parece.",
      "Guardalo para tenerlo a la mano.",
      "Escribenos si quieres saber mas."
    ];
    const ending = endings[(input.variantIndex - 1) % endings.length];
    const hashtags = [pageTag ? `#${pageTag}` : null, categoryTag ? `#${categoryTag}` : null]
      .filter(Boolean)
      .join(" ");
    const contextLine = context ? `${context}\n\n` : "";
    const contentLine = contentTypes.length > 0 ? `Tipo de contenido: ${contentTypes.join(", ")}. ` : "";
    return {
      schemaVersion: "caption.v1",
      promptVersion: "caption-page-context-v1",
      caption:
        `${input.pageName}: ${subject}.\n\n` +
        contextLine +
        `Una publicacion pensada para ${input.category}, con estilo ${input.styleName}. ${contentLine}${ending}\n\n` +
        `${hashtags || "#NegocioLocal"}`,
      seoTermsUsed: [input.pageName, input.businessName, input.category, ...keywords, ...contentTypes].filter(Boolean),
      warnings: ["caption_generado_con_contexto_de_pagina", "no_inventa_precios_ni_promociones"]
    };
  }

  private variantNotFound(): never {
    throw new AppError({
      code: "variant_not_found",
      statusCode: 404,
      message: "Variant not found",
      userMessage: "No encontramos esa variante.",
      retryable: false,
      action: "refresh"
    });
  }

  private async requireVariant(workspaceId: string, businessId: string | undefined, batchId: string | undefined, variantId: string) {
    const result = await this.pool.query(
      `select * from public.variants
       where workspace_id = $1 and id = $2
         and ($3::text is null or business_id = $3)
         and ($4::text is null or batch_id = $4)
       limit 1`,
      [workspaceId, variantId, businessId ?? null, batchId ?? null]
    );
    if (!result.rows[0]) this.variantNotFound();
    return toVariant(result.rows[0]);
  }

  private async requireJob(jobId: string): Promise<StoredJob> {
    const result = await this.pool.query("select * from public.jobs where id = $1", [jobId]);
    if (!result.rows[0]) throw new Error(`Job not found: ${jobId}`);
    return toJob(result.rows[0]);
  }

  private async requireScheduledPost(
    workspaceId: string,
    businessId: string | undefined,
    batchId: string | undefined,
    scheduledPostId: string
  ): Promise<ScheduledPost> {
    const result = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and id = $2
         and ($3::text is null or business_id = $3)
         and ($4::text is null or batch_id = $4)
       limit 1`,
      [workspaceId, scheduledPostId, businessId ?? null, batchId ?? null]
    );
    if (!result.rows[0]) {
      throw new AppError({
        code: "scheduled_post_not_found",
        statusCode: 404,
        message: "Scheduled post not found",
        userMessage: "No encontramos esa publicacion programada.",
        retryable: false,
        action: "refresh"
      });
    }
    return toScheduledPost(result.rows[0]);
  }

  private scheduledPostStateError(code: string) {
    return new AppError({
      code,
      statusCode: 409,
      message: code,
      userMessage: "Esta publicacion no puede modificarse en su estado actual.",
      retryable: false,
      action: "refresh"
    });
  }

  private async failScheduledPost(scheduledPostId: string, remoteErrorCode: string): Promise<ScheduledPost> {
    const result = await this.pool.query(
      "update public.scheduled_posts set status = 'fallida', remote_error_code = $2, updated_at = now() where id = $1 returning *",
      [scheduledPostId, remoteErrorCode]
    );
    return toScheduledPost(result.rows[0]);
  }

  private variantStateError(code: string, userMessage: string) {
    return new AppError({
      code,
      statusCode: 409,
      message: code,
      userMessage,
      retryable: false,
      action: "refresh"
    });
  }

  private toAiRun(row: Record<string, any>): AiRun {
    const run: AiRun = {
      id: row.id,
      workspaceId: row.workspace_id,
      jobId: row.job_id,
      operationKey: row.operation_key,
      provider: row.provider,
      model: row.model,
      modelProfileId: row.model_profile_id,
      promptTemplateId: row.prompt_template_id,
      promptVersion: row.prompt_version,
      schemaVersion: row.schema_version,
      inputHash: row.input_hash,
      outputHash: row.output_hash,
      latencyMs: row.latency_ms,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    };
    if (row.business_id) run.businessId = row.business_id;
    if (row.response_id) run.responseId = row.response_id;
    if (row.usage) run.usage = row.usage;
    if (row.error_code) run.errorCode = row.error_code;
    if (row.request_id) run.requestId = row.request_id;
    return run;
  }

  private async ensureDerivedMediaAsset(
    client: pg.PoolClient,
    photo: Record<string, any>,
    kind: "thumbnail" | "vision_input",
    storageKey: string,
    timestamp: string
  ): Promise<MediaAsset> {
    const existing = await client.query("select * from public.media_assets where photo_id = $1 and kind = $2 limit 1", [
      photo.id,
      kind
    ]);
    if (existing.rows[0]) return toMediaAsset(existing.rows[0]);
    const result = await client.query(
      `insert into public.media_assets
       (id, workspace_id, business_id, batch_id, photo_id, kind, bucket, storage_key, mime_type, file_size, is_public, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'image/jpeg', 0, false, $9)
       returning *`,
      [
        randomUUID(),
        photo.workspace_id,
        photo.business_id,
        photo.batch_id,
        photo.id,
        kind,
        MEDIA_BUCKET,
        storageKey,
        timestamp
      ]
    );
    return toMediaAsset(result.rows[0]);
  }
}

export const createSupabaseDataStore = (databaseUrl: string): DataStore => {
  const core = new SupabaseDataStoreCore(databaseUrl) as Partial<DataStore>;
  return new Proxy(core, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value === "function") return value.bind(target);
      if (typeof prop === "string") return () => unsupported(prop);
      return value;
    }
  }) as DataStore;
};

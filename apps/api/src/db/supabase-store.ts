import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  AppError,
  forbiddenError,
  PLAN_ENTITLEMENTS,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  Business,
  MetaPage,
  BatchSummary,
  Photo,
  UploadIntent,
  VisionAnalysis,
  BusinessAutonomySettings,
  ActionAutonomyState,
  AutonomyAction,
  Variant,
  AssignedStyle,
  ScheduledPost,
  MetricDefinition,
  MetricWindow,
  PerformanceSummary,
  PostMetricSnapshot,
  WeeklyReport,
  AutonomyEvaluation,
  AiEvaluation,
  BillingAccount,
  BillingProvider,
  BillingProviderEvent,
  CommercialPlan
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
  OutboxEvent,
  PersistedMetaAuthorizationInput,
  PricingRule,
  StoredJob,
  UsageMeter,
  WorkerHeartbeat
} from "./types.js";
import { publishFacebookPagePost } from "@fbmaniaco/providers";

const { Pool } = pg;

const now = () => new Date().toISOString();
const encodeServerToken = (token: string) => `server:${Buffer.from(token, "utf8").toString("base64url")}`;
const decodeServerToken = (value: string | null | undefined) => {
  if (!value?.startsWith("server:")) return null;
  return Buffer.from(value.slice("server:".length), "base64url").toString("utf8");
};
const mediaPreviewToken = (assetId: string, expires: number) =>
  createHash("sha256").update(`${assetId}:${expires}:fbmaniaco-local-media-preview`).digest("hex");
const publicMediaUrl = (assetId: string) => {
  const baseUrl = process.env.PUBLIC_API_URL ?? process.env.API_PUBLIC_URL;
  if (!baseUrl?.startsWith("https://")) return null;
  const expires = Math.floor(Date.now() / 1000) + 15 * 60;
  return `${baseUrl.replace(/\/$/, "")}/media/assets/${assetId}/preview?expires=${expires}&token=${mediaPreviewToken(assetId, expires)}`;
};
const MEDIA_BUCKET = "business-media";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const activeBatchStatuses = new Set(["pending_upload", "pendiente_confirmacion", "confirmado", "generando", "generado_parcial"]);
const autonomyActions: AutonomyAction[] = [
  "STYLE_ASSIGNMENT",
  "VARIANT_COUNT",
  "SCHEDULING",
  "CAPTION_GENERATION",
  "FACEBOOK_PUBLISH"
];
const defaultAutonomySettings = (timestamp: string): BusinessAutonomySettings => ({
  schemaVersion: "business_autonomy.v1",
  actions: Object.fromEntries(
    autonomyActions.map((action) => [
      action,
      {
        action,
        mode: action === "FACEBOOK_PUBLISH" ? "human_approval" : "suggest_only",
        score: 0,
        approvals: 0,
        threshold: action === "FACEBOOK_PUBLISH" ? 0.95 : 0.75,
        paused: action === "FACEBOOK_PUBLISH",
        consecutiveApprovals: 0,
        consecutiveRejections: 0,
        requiresExplicitOptIn: action === "FACEBOOK_PUBLISH",
        explicitOptIn: false,
        pauseReasons: action === "FACEBOOK_PUBLISH" ? ["explicit_opt_in_required"] : [],
        updatedAt: timestamp
      } satisfies ActionAutonomyState
    ])
  ) as Record<string, ActionAutonomyState>,
  updatedAt: timestamp
});
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
  plan: row.plan,
  billingStatus: row.billing_status,
  entitlements: json(row.entitlements, {}),
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
  autonomySettings: json(row.autonomy_settings, {}),
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
  if (row.estimated_cost_usd !== undefined) batch.estimatedCostUsd = row.estimated_cost_usd;
  if (row.estimated_provider_cost_usd !== undefined) batch.estimatedProviderCostUsd = row.estimated_provider_cost_usd;
  if (row.confirmed_cost_usd !== undefined) batch.confirmedCostUsd = row.confirmed_cost_usd;
  if (row.confirmed_price_version !== undefined) batch.confirmedPriceVersion = row.confirmed_price_version;
  if (row.confirmed_cost_breakdown !== undefined) batch.confirmedCostBreakdown = row.confirmed_cost_breakdown;
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
    businessId: row.business_id,
    kind: row.kind,
    bucket: row.bucket,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    isPublic: row.is_public,
    createdAt: new Date(row.created_at).toISOString()
  };
  if (row.batch_id) asset.batchId = row.batch_id;
  if (row.photo_id) asset.photoId = row.photo_id;
  if (row.variant_id) asset.variantId = row.variant_id;
  return asset;
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

const toPricingRule = (row: Record<string, any>): PricingRule => {
  const rule: PricingRule = {
    id: row.id,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    unitType: row.unit_type,
    unitSize: Number(row.unit_size),
    currency: row.currency,
    unitCostUsd: Number(row.unit_cost_usd),
    customerUnitPriceUsd: Number(row.customer_unit_price_usd),
    priceVersion: row.price_version,
    effectiveFrom: new Date(row.effective_from).toISOString(),
    active: row.active
  };
  if (row.dimensions !== undefined) rule.dimensions = row.dimensions;
  if (row.effective_to) rule.effectiveTo = new Date(row.effective_to).toISOString();
  return rule;
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

const toMetricDefinition = (row: Record<string, any>): MetricDefinition => {
  const definition: MetricDefinition = {
    id: row.id,
    provider: row.provider,
    canonicalMetric: row.canonical_metric,
    valueType: row.value_type,
    status: row.status,
    effectiveFrom: new Date(row.effective_from).toISOString()
  };
  if (row.provider_metric_name !== undefined) definition.providerMetricName = row.provider_metric_name;
  if (row.graph_api_version !== undefined) definition.graphApiVersion = row.graph_api_version;
  if (row.effective_to !== undefined) definition.effectiveTo = row.effective_to ? new Date(row.effective_to).toISOString() : null;
  if (row.notes !== undefined) definition.notes = row.notes;
  return definition;
};

const toPostMetricSnapshot = (row: Record<string, any>): PostMetricSnapshot => {
  const snapshot: PostMetricSnapshot = {
    id: row.id,
    workspaceId: row.workspace_id,
    businessId: row.business_id,
    scheduledPostId: row.scheduled_post_id,
    metricDefinitionId: row.metric_definition_id,
    provider: row.provider,
    canonicalMetric: row.canonical_metric,
    window: row.window,
    value: Number(row.value),
    collectedAt: new Date(row.collected_at).toISOString(),
    observedUntil: new Date(row.observed_until).toISOString(),
    collectionStatus: row.collection_status
  };
  if (row.facebook_post_id !== undefined) snapshot.facebookPostId = row.facebook_post_id;
  if (row.provider_metric_name !== undefined) snapshot.providerMetricName = row.provider_metric_name;
  if (row.source_version !== undefined) snapshot.sourceVersion = row.source_version;
  if (row.raw_ref !== undefined) snapshot.rawRef = row.raw_ref;
  return snapshot;
};

const toPerformanceSummary = (row: Record<string, any>): PerformanceSummary => ({
  id: row.id,
  workspaceId: row.workspace_id,
  businessId: row.business_id,
  scope: row.scope,
  scopeKey: row.scope_key,
  periodStart: new Date(row.period_start).toISOString(),
  periodEnd: new Date(row.period_end).toISOString(),
  sampleSize: row.sample_size,
  metrics: json(row.metrics, {}),
  confidence: row.confidence,
  reasonCodes: row.reason_codes ?? [],
  generatedAt: new Date(row.generated_at).toISOString()
});

const toWeeklyReport = (row: Record<string, any>): WeeklyReport => ({
  id: row.id,
  workspaceId: row.workspace_id,
  businessId: row.business_id,
  periodStart: new Date(row.period_start).toISOString(),
  periodEnd: new Date(row.period_end).toISOString(),
  confidence: row.confidence,
  sampleSize: row.sample_size,
  sections: json(row.sections, {
    worked: [],
    didNotWork: [],
    styleAcceptance: [],
    captionEdits: [],
    recommendedTimes: [],
    metaHealth: [],
    calendarCoverage: [],
    aiCost: [],
    nextActions: []
  }),
  reasonCodes: row.reason_codes ?? [],
  generatedAt: new Date(row.generated_at).toISOString()
});

const toAiEvaluation = (row: Record<string, any>): AiEvaluation => ({
  id: row.id,
  workspaceId: row.workspace_id,
  businessId: row.business_id,
  task: row.task,
  datasetId: row.dataset_id,
  baselinePromptTemplateId: row.baseline_prompt_template_id,
  candidatePromptTemplateId: row.candidate_prompt_template_id,
  status: row.status,
  metrics: json(row.metrics, {}),
  failedCriteria: row.failed_criteria ?? [],
  rolloutRecommendation: row.rollout_recommendation,
  usedBatchMode: row.used_batch_mode,
  createdAt: new Date(row.created_at).toISOString()
});

const toBillingAccount = (row: Record<string, any>): BillingAccount => ({
  id: row.id,
  workspaceId: row.workspace_id,
  provider: row.provider,
  providerCustomerId: row.provider_customer_id ?? null,
  providerSubscriptionId: row.provider_subscription_id ?? null,
  providerSubscriptionItemId: row.provider_subscription_item_id ?? null,
  providerPriceId: row.provider_price_id ?? null,
  plan: row.plan,
  billingStatus: row.billing_status,
  currentPeriodStart: row.current_period_start ? new Date(row.current_period_start).toISOString() : null,
  currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toBillingProviderEvent = (row: Record<string, any>): BillingProviderEvent => ({
  id: row.id,
  provider: row.provider,
  providerEventId: row.provider_event_id,
  workspaceId: row.workspace_id ?? null,
  type: row.type,
  status: row.status,
  receivedAt: new Date(row.received_at).toISOString(),
  processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
  lastError: row.last_error ?? null
});

const toOutboxEvent = (row: Record<string, any>): OutboxEvent => {
  const event: OutboxEvent = {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    workspaceId: row.workspace_id,
    payload: json(row.payload, {}),
    status: row.status,
    availableAt: new Date(row.available_at).toISOString(),
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString()
  };
  if (row.business_id) event.businessId = row.business_id;
  if (row.processed_at) event.processedAt = new Date(row.processed_at).toISOString();
  if (row.last_error) event.lastError = row.last_error;
  return event;
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
        `insert into public.workspaces (id, name, owner_user_id, plan, billing_status, entitlements, status, created_at, updated_at)
         values ($1, 'Mi workspace FBmaniaco', $2, 'piloto', 'trial', $3::jsonb, 'activo', now(), now())
         returning *`,
        [workspaceId, userId, JSON.stringify(PLAN_ENTITLEMENTS.piloto)]
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
      const claimed = await client.query(
        `select * from public.jobs
         where status = 'queued' and run_after <= now()
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
         set status = 'running', locked_at = now(), locked_by = $2, lease_expires_at = now() + interval '60 seconds',
             attempts = attempts + 1, updated_at = now()
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

  async recordWorkerHeartbeat(input: Parameters<DataStore["recordWorkerHeartbeat"]>[0]): Promise<WorkerHeartbeat> {
    const result = await this.pool.query(
      `insert into public.worker_heartbeats (worker_id, service, environment, release, status, last_beat_at, metadata)
       values ($1, 'worker', $2, $3, $4, now(), $5::jsonb)
       on conflict (worker_id) do update
       set environment = excluded.environment, release = excluded.release, status = excluded.status,
           last_beat_at = now(), metadata = excluded.metadata
       returning *`,
      [input.workerId, input.environment, input.release, input.status ?? "alive", JSON.stringify(input.metadata ?? {})]
    );
    const row = result.rows[0];
    return {
      workerId: row.worker_id,
      service: "worker",
      environment: row.environment,
      release: row.release,
      status: row.status,
      lastBeatAt: new Date(row.last_beat_at).toISOString(),
      metadata: json(row.metadata, {})
    };
  }

  async getLatestWorkerHeartbeat(): Promise<WorkerHeartbeat | null> {
    const result = await this.pool.query(
      "select * from public.worker_heartbeats where status = 'alive' order by last_beat_at desc limit 1"
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      workerId: row.worker_id,
      service: "worker",
      environment: row.environment,
      release: row.release,
      status: row.status,
      lastBeatAt: new Date(row.last_beat_at).toISOString(),
      metadata: json(row.metadata, {})
    };
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

  async listMetricDefinitions(): Promise<MetricDefinition[]> {
    const result = await this.pool.query("select * from public.metric_definitions order by canonical_metric asc");
    return result.rows.map(toMetricDefinition);
  }

  async listPerformanceSummaries(input: Parameters<DataStore["listPerformanceSummaries"]>[0]): Promise<PerformanceSummary[]> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      `select * from public.performance_summaries
       where workspace_id = $1 and business_id = $2
         and ($3::text is null or scope = $3)
         and ($4::timestamptz is null or period_end >= $4::timestamptz)
         and ($5::timestamptz is null or period_start <= $5::timestamptz)
       order by generated_at desc`,
      [input.workspaceId, input.businessId, input.scope ?? null, input.from ?? null, input.to ?? null]
    );
    return result.rows.map(toPerformanceSummary);
  }

  async requestCollectMetrics(input: Parameters<DataStore["requestCollectMetrics"]>[0]): Promise<{ job: StoredJob }> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const from = input.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = input.to ?? now();
    const window = input.window ?? "7d";
    const job = await this.createJob({
      type: "collect_metrics",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      dedupeKey: `collect_metrics:${input.businessId}:${from}:${to}:${window}`,
      payload: { from, to, window, actorId: input.actorId, requestId: input.requestId }
    });
    await this.createOutboxEvent({
      eventType: "metricas_recoleccion_solicitada",
      aggregateType: "business",
      aggregateId: input.businessId,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { from, to, window, actorId: input.actorId, requestId: input.requestId }
    });
    return { job };
  }

  async completeCollectMetrics(input: { jobId: string }): ReturnType<DataStore["completeCollectMetrics"]> {
    const job = await this.requireJob(input.jobId);
    if (!job.businessId) throw new Error("collect_metrics job is missing businessId");
    const from = typeof job.payload.from === "string" ? job.payload.from : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = typeof job.payload.to === "string" ? job.payload.to : now();
    const window = (typeof job.payload.window === "string" ? job.payload.window : "7d") as MetricWindow;
    const timestamp = now();
    const successDefinition = await this.metricDefinition("fbmaniaco", "publish_success");
    const failureDefinition = await this.metricDefinition("fbmaniaco", "publish_failure");
    const metaDefinitions = (
      await this.pool.query("select * from public.metric_definitions where provider = 'meta' and status <> 'active'")
    ).rows.map(toMetricDefinition);
    const snapshots: PostMetricSnapshot[] = [];
    const published = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and business_id = $2 and status = 'publicada'
         and scheduled_for >= $3::timestamptz and scheduled_for <= $4::timestamptz`,
      [job.workspaceId, job.businessId, from, to]
    );
    for (const post of published.rows.map(toScheduledPost)) {
      snapshots.push(
        await this.insertMetricSnapshot({
          workspaceId: post.workspaceId,
          businessId: post.businessId,
          scheduledPostId: post.id,
          facebookPostId: post.facebookPostId ?? null,
          definition: successDefinition,
          window,
          value: 1,
          collectedAt: timestamp,
          observedUntil: to
        })
      );
    }
    const failed = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and business_id = $2 and status in ('fallida', 'estado_incierto')
         and scheduled_for >= $3::timestamptz and scheduled_for <= $4::timestamptz`,
      [job.workspaceId, job.businessId, from, to]
    );
    for (const post of failed.rows.map(toScheduledPost)) {
      snapshots.push(
        await this.insertMetricSnapshot({
          workspaceId: post.workspaceId,
          businessId: post.businessId,
          scheduledPostId: post.id,
          facebookPostId: post.facebookPostId ?? null,
          definition: failureDefinition,
          window,
          value: 1,
          collectedAt: timestamp,
          observedUntil: to
        })
      );
    }
    const summaries = await this.recalculatePerformanceSummaries(job.workspaceId, job.businessId, from, to, timestamp);
    await this.createOutboxEvent({
      eventType: "metricas_recolectadas",
      aggregateType: "business",
      aggregateId: job.businessId,
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      payload: {
        jobId: job.id,
        snapshotCount: snapshots.length,
        unavailableMetricIds: metaDefinitions.map((definition) => definition.id)
      }
    });
    for (const definition of metaDefinitions) {
      await this.createOutboxEvent({
        eventType: "metrica_no_disponible",
        aggregateType: "metric_definition",
        aggregateId: definition.id,
        workspaceId: job.workspaceId,
        businessId: job.businessId,
        payload: { status: definition.status, canonicalMetric: definition.canonicalMetric }
      });
    }
    return { snapshots, summaries, unavailableMetrics: metaDefinitions };
  }

  async requestWeeklyReport(input: Parameters<DataStore["requestWeeklyReport"]>[0]): Promise<{ job: StoredJob }> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const periodStart = input.weekStart ?? this.weekStart(new Date()).toISOString();
    const periodEnd = new Date(new Date(periodStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const job = await this.createJob({
      type: "weekly_report",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      dedupeKey: `weekly_report:${input.businessId}:${periodStart}`,
      payload: { periodStart, periodEnd, actorId: input.actorId, requestId: input.requestId }
    });
    return { job };
  }

  async completeWeeklyReport(input: { jobId: string }): Promise<WeeklyReport> {
    const job = await this.requireJob(input.jobId);
    if (!job.businessId) throw new Error("weekly_report job is missing businessId");
    const periodStart = typeof job.payload.periodStart === "string" ? job.payload.periodStart : this.weekStart(new Date()).toISOString();
    const periodEnd =
      typeof job.payload.periodEnd === "string"
        ? job.payload.periodEnd
        : new Date(new Date(periodStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const timestamp = now();
    const summaries = await this.recalculatePerformanceSummaries(job.workspaceId, job.businessId, periodStart, periodEnd, timestamp);
    const published = await this.countScheduledPosts(job.workspaceId, job.businessId, periodStart, periodEnd, ["publicada"]);
    const failed = await this.countScheduledPosts(job.workspaceId, job.businessId, periodStart, periodEnd, ["fallida", "estado_incierto"]);
    const summary = summaries.find((item) => item.scope === "business_week");
    const sampleSize = summary?.sampleSize ?? published;
    const confidence = this.confidenceForSample(sampleSize);
    const sections = {
      worked: published > 0 ? [`${published} publicaciones quedaron confirmadas.`] : ["Aun no hay publicaciones confirmadas esta semana."],
      didNotWork: failed > 0 ? [`${failed} publicaciones requieren revision.`] : ["No se detectaron fallas propias en la ventana."],
      styleAcceptance: confidence === "exploratoria" ? ["Muestra pequena: no se declara un estilo ganador."] : ["Hay muestra suficiente para comparar estilos."],
      captionEdits: ["Se separan ediciones de caption de metricas externas para no mezclar senales."],
      recommendedTimes: confidence === "exploratoria" ? ["Mantener horarios conservadores hasta tener 20 posts publicados."] : ["Revisar horarios con snapshots comparables."],
      metaHealth: ["Insights de Meta degradados en modo local; se usan senales propias de FBmaniaco."],
      calendarCoverage: [`Cobertura semanal estimada: ${Math.round((summary?.metrics.week_coverage ?? 0) * 100)}%.`],
      aiCost: ["Costos IA se leen del ledger interno; no se infieren desde el reporte."],
      nextActions: published === 0 ? ["Publicar al menos un post para empezar aprendizaje real."] : ["Recolectar snapshots comparables antes del siguiente reporte."]
    };
    const result = await this.pool.query(
      `insert into public.weekly_reports
       (id, workspace_id, business_id, period_start, period_end, confidence, sample_size, sections, reason_codes, generated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       returning *`,
      [
        randomUUID(),
        job.workspaceId,
        job.businessId,
        periodStart,
        periodEnd,
        confidence,
        sampleSize,
        JSON.stringify(sections),
        summary?.reasonCodes ?? ["sample_size_low", "meta_insights_unavailable"],
        timestamp
      ]
    );
    const report = toWeeklyReport(result.rows[0]);
    await this.createOutboxEvent({
      eventType: "performance_summary_generado",
      aggregateType: "business",
      aggregateId: job.businessId,
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      payload: { jobId: job.id, reportId: report.id, confidence: report.confidence, sampleSize: report.sampleSize }
    });
    return report;
  }

  async getLatestWeeklyReport(input: Parameters<DataStore["getLatestWeeklyReport"]>[0]): Promise<WeeklyReport | null> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      "select * from public.weekly_reports where workspace_id = $1 and business_id = $2 order by generated_at desc limit 1",
      [input.workspaceId, input.businessId]
    );
    return result.rows[0] ? toWeeklyReport(result.rows[0]) : null;
  }

  async updateBusiness(input: Parameters<DataStore["updateBusiness"]>[0]): Promise<Business> {
    const current = await this.requireBusiness(input.workspaceId, input.businessId);
    const timestamp = now();
    const nextMetadata = input.metadata !== undefined ? { ...current.metadata, ...input.metadata } : current.metadata;
    const nextAutonomy =
      input.autonomySettings !== undefined ? this.normalizedAutonomy(input.autonomySettings, timestamp) : current.autonomySettings;
    const result = await this.pool.query(
      `update public.businesses
       set name = coalesce($3, name),
           timezone = coalesce($4, timezone),
           metadata = $5::jsonb,
           autonomy_settings = $6::jsonb,
           updated_at = $7
       where workspace_id = $1 and id = $2
       returning *`,
      [
        input.workspaceId,
        input.businessId,
        input.name ?? null,
        input.timezone ?? null,
        JSON.stringify(nextMetadata),
        JSON.stringify(nextAutonomy),
        timestamp
      ]
    );
    await this.createOutboxEvent({
      eventType: input.autonomySettings !== undefined ? "autonomia_actualizada" : "negocio_actualizado",
      aggregateType: "business",
      aggregateId: input.businessId,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
    return toBusiness(result.rows[0]);
  }

  async evaluateBusinessAutonomy(input: Parameters<DataStore["evaluateBusinessAutonomy"]>[0]): Promise<AutonomyEvaluation> {
    const business = await this.requireBusiness(input.workspaceId, input.businessId);
    const settings = this.businessAutonomy(business);
    const publish = settings.actions.FACEBOOK_PUBLISH;
    const reasons = new Set<string>();
    if (!input.autonomyFeatureEnabled) reasons.add("kill_switch_autonomy");
    if (!publish?.explicitOptIn) reasons.add("explicit_opt_in_required");
    if (publish?.mode !== "autonomous") reasons.add("publish_not_autonomous");
    if (business.tokenStatus === "expirado" || business.tokenStatus === "requiere_reconexion") reasons.add("meta_token_unhealthy");
    if (await this.hasUncertainPost(input.businessId)) reasons.add("uncertain_post_exists");
    if (await this.hasBudgetPressure(input.workspaceId)) reasons.add("budget_limit_reached");
    if (await this.hasSensitivePublishRisk(input.workspaceId, input.businessId)) reasons.add("sensitive_content_requires_review");
    const publishedCount = await this.countScheduledPosts(input.workspaceId, input.businessId, "1970-01-01T00:00:00.000Z", now(), [
      "publicada"
    ]);
    if (publishedCount < 20) reasons.add("insufficient_history");
    return {
      schemaVersion: "autonomy_evaluation.v1",
      businessId: business.id,
      canAutopublish: reasons.size === 0,
      blockingReasons: [...reasons],
      warnings: publishedCount < 100 ? ["La confianza seguira siendo conservadora hasta tener mas historial."] : [],
      evaluatedAt: now()
    };
  }

  async requestBatchCaptionEval(input: Parameters<DataStore["requestBatchCaptionEval"]>[0]): Promise<{ job: StoredJob }> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const datasetId = input.datasetId ?? "golden-caption-local-v1";
    const candidate = input.candidatePromptTemplateId ?? "caption-template-canary-v1";
    const baseline = input.baselinePromptTemplateId ?? "caption-template-active-v1";
    const job = await this.createJob({
      type: "batch_caption_eval",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      dedupeKey: `batch_caption_eval:${input.businessId}:${candidate}:${baseline}:${datasetId}`,
      payload: {
        datasetId,
        candidatePromptTemplateId: candidate,
        baselinePromptTemplateId: baseline,
        candidateCaptionEditRate: input.candidateCaptionEditRate,
        actorId: input.actorId,
        requestId: input.requestId,
        executionMode: "batch_flex_compatible"
      }
    });
    return { job };
  }

  async completeBatchCaptionEval(input: { jobId: string }): Promise<AiEvaluation> {
    const job = await this.requireJob(input.jobId);
    if (!job.businessId) throw new Error("batch_caption_eval job is missing businessId");
    const baselineEditRate = 0.1;
    const candidateEditRate =
      typeof job.payload.candidateCaptionEditRate === "number" ? job.payload.candidateCaptionEditRate : 0.08;
    const failedCriteria = [
      ...(candidateEditRate > baselineEditRate ? ["caption_edit_rate_regression"] : []),
      ...(candidateEditRate > 0.2 ? ["manual_edit_rate_too_high"] : [])
    ];
    const result = await this.pool.query(
      `insert into public.ai_evaluations
       (id, workspace_id, business_id, task, dataset_id, baseline_prompt_template_id, candidate_prompt_template_id,
        status, metrics, failed_criteria, rollout_recommendation, used_batch_mode, created_at)
       values ($1, $2, $3, 'caption', $4, $5, $6, $7, $8::jsonb, $9, $10, true, now())
       returning *`,
      [
        randomUUID(),
        job.workspaceId,
        job.businessId,
        typeof job.payload.datasetId === "string" ? job.payload.datasetId : "golden-caption-local-v1",
        typeof job.payload.baselinePromptTemplateId === "string" ? job.payload.baselinePromptTemplateId : "caption-template-active-v1",
        typeof job.payload.candidatePromptTemplateId === "string" ? job.payload.candidatePromptTemplateId : "caption-template-canary-v1",
        failedCriteria.length === 0 ? "passed" : "failed",
        JSON.stringify({
          schema_valid_rate: 1,
          refusal_rate: 0,
          baseline_caption_edit_rate: baselineEditRate,
          candidate_caption_edit_rate: candidateEditRate,
          cost_per_approved_variant_usd: 0.01,
          latency_p95_ms: 1200
        }),
        failedCriteria,
        failedCriteria.length === 0 ? "promote_canary" : "retain_baseline"
      ]
    );
    const evaluation = toAiEvaluation(result.rows[0]);
    await this.createOutboxEvent({
      eventType: "ai_eval_completada",
      aggregateType: "ai_evaluation",
      aggregateId: evaluation.id,
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      payload: {
        status: evaluation.status,
        rolloutRecommendation: evaluation.rolloutRecommendation,
        failedCriteria: evaluation.failedCriteria
      }
    });
    return evaluation;
  }

  async listAiEvaluations(input: Parameters<DataStore["listAiEvaluations"]>[0]): Promise<AiEvaluation[]> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      "select * from public.ai_evaluations where workspace_id = $1 and business_id = $2 order by created_at desc",
      [input.workspaceId, input.businessId]
    );
    return result.rows.map(toAiEvaluation);
  }

  async getBillingStatus(input: Parameters<DataStore["getBillingStatus"]>[0]): Promise<Awaited<ReturnType<DataStore["getBillingStatus"]>>> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const account = await this.pool.query(
      "select * from public.billing_accounts where workspace_id = $1 order by updated_at desc limit 1",
      [input.workspaceId]
    );
    return { workspace, billingAccount: account.rows[0] ? toBillingAccount(account.rows[0]) : null };
  }

  async createUpgradeIntent(
    input: Parameters<DataStore["createUpgradeIntent"]>[0]
  ): Promise<Awaited<ReturnType<DataStore["createUpgradeIntent"]>>> {
    await this.requireWorkspace(input.workspaceId);
    await this.createOutboxEvent({
      eventType: "billing_upgrade_intent_created",
      aggregateType: "workspace",
      aggregateId: input.workspaceId,
      workspaceId: input.workspaceId,
      payload: { actorId: input.actorId, requestId: input.requestId, plan: input.plan, provider: input.provider }
    });
    return {
      provider: input.provider,
      targetPlan: input.plan,
      checkoutUrl:
        input.provider === "manual"
          ? null
          : `https://billing.example/${input.provider}/checkout?workspace=${encodeURIComponent(input.workspaceId)}&plan=${input.plan}`,
      message:
        input.provider === "manual"
          ? "Solicitud de upgrade registrada para piloto privado."
          : "Checkout mock preparado. No se ha cobrado nada."
    };
  }

  async processBillingProviderEvent(
    input: Parameters<DataStore["processBillingProviderEvent"]>[0]
  ): Promise<Awaited<ReturnType<DataStore["processBillingProviderEvent"]>>> {
    const existing = await this.pool.query(
      "select * from public.billing_provider_events where provider = $1 and provider_event_id = $2 limit 1",
      [input.provider, input.providerEventId]
    );
    if (existing.rows[0]) return { event: toBillingProviderEvent(existing.rows[0]), duplicate: true };

    const client = await this.pool.connect();
    let event: BillingProviderEvent;
    try {
      await client.query("begin");
      const eventResult = await client.query(
        `insert into public.billing_provider_events
         (id, provider, provider_event_id, workspace_id, type, status, received_at)
         values ($1, $2, $3, $4, $5, 'received', now())
         returning *`,
        [randomUUID(), input.provider, input.providerEventId, input.workspaceId ?? null, input.type]
      );
      event = toBillingProviderEvent(eventResult.rows[0]);

      try {
        if (!input.workspaceId) {
          const ignored = await client.query(
            "update public.billing_provider_events set status = 'ignored', processed_at = now() where id = $1 returning *",
            [event.id]
          );
          event = toBillingProviderEvent(ignored.rows[0]);
        } else {
          const workspaceResult = await client.query("select * from public.workspaces where id = $1 for update", [input.workspaceId]);
          if (!workspaceResult.rows[0]) {
            throw new AppError({
              code: "workspace_not_found",
              statusCode: 404,
              message: "Workspace not found",
              userMessage: "No encontramos tu workspace.",
              retryable: false,
              action: "refresh"
            });
          }

          const workspace = toWorkspace(workspaceResult.rows[0]);
          const nextPlan = (input.plan ?? workspace.plan ?? "piloto") as CommercialPlan;
          const nextStatus = input.billingStatus ?? workspace.billingStatus;
          await client.query(
            `update public.workspaces
             set plan = $2, billing_status = $3, entitlements = $4::jsonb, updated_at = now()
             where id = $1`,
            [workspace.id, nextPlan, nextStatus, JSON.stringify(PLAN_ENTITLEMENTS[nextPlan])]
          );

          const accountResult = await client.query(
            `insert into public.billing_accounts
             (id, workspace_id, provider, plan, billing_status, current_period_start, current_period_end, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, now(), now())
             on conflict (workspace_id, provider) do update
             set plan = excluded.plan, billing_status = excluded.billing_status, updated_at = now()
             returning *`,
            [
              randomUUID(),
              workspace.id,
              input.provider,
              nextPlan,
              nextStatus,
              this.currentPeriodStart(),
              this.currentPeriodEnd()
            ]
          );
          void toBillingAccount(accountResult.rows[0]);

          await client.query(
            `insert into public.outbox_events
             (id, event_type, aggregate_type, aggregate_id, workspace_id, payload, status, available_at, attempts, created_at)
             values ($1, 'billing_updated', 'workspace', $2, $3, $4::jsonb, 'pending', now(), 0, now())`,
            [
              randomUUID(),
              workspace.id,
              workspace.id,
              JSON.stringify({
                provider: input.provider,
                providerEventId: input.providerEventId,
                plan: nextPlan,
                billingStatus: nextStatus
              })
            ]
          );

          const processed = await client.query(
            "update public.billing_provider_events set status = 'processed', processed_at = now() where id = $1 returning *",
            [event.id]
          );
          event = toBillingProviderEvent(processed.rows[0]);
        }
      } catch (error) {
        const failed = await client.query(
          "update public.billing_provider_events set status = 'failed', last_error = $2 where id = $1 returning *",
          [event.id, error instanceof Error ? error.message : "Unknown billing event error"]
        );
        event = toBillingProviderEvent(failed.rows[0]);
      }

      await client.query("commit");
      return { event, duplicate: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
          pageName: "FBmaniaco Demo",
          coverPhotoUrl: null,
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
          coverPhotoUrl: null,
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
          "select encrypted_page_access_token, page_access_token_key_id from public.facebook_pages where workspace_id = $1 and meta_page_id = $2",
          [input.workspaceId, page.metaPageId]
        );
        const encryptedPageAccessToken = page.pageAccessToken
          ? encodeServerToken(page.pageAccessToken)
          : existingPage.rows[0]?.encrypted_page_access_token ?? null;
        const pageAccessTokenKeyId = encryptedPageAccessToken ? "server" : existingPage.rows[0]?.page_access_token_key_id ?? null;
        await client.query(
          `insert into public.facebook_pages
           (id, workspace_id, meta_authorization_id, meta_page_id, page_name, page_access_token_status,
            encrypted_page_access_token, page_access_token_key_id, cover_photo_url, category, tasks, is_granted,
            can_publish, granted_scopes, declined_scopes, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, now(), now())
           on conflict (workspace_id, meta_page_id) do update
           set meta_authorization_id = excluded.meta_authorization_id,
               page_name = excluded.page_name,
               page_access_token_status = excluded.page_access_token_status,
               encrypted_page_access_token = excluded.encrypted_page_access_token,
               page_access_token_key_id = excluded.page_access_token_key_id,
               cover_photo_url = excluded.cover_photo_url,
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
            pageAccessTokenKeyId,
            page.coverPhotoUrl ?? null,
            page.category ?? null,
            JSON.stringify(page.tasks),
            page.isGranted,
            page.canPublish,
            JSON.stringify(page.grantedScopes),
            JSON.stringify(page.declinedScopes)
          ]
        );
      }
      await client.query(
        `insert into public.outbox_events (id, event_type, aggregate_type, aggregate_id, workspace_id, payload, status, available_at, attempts, created_at)
         values ($1, 'meta_autorizacion_actualizada', 'meta_authorization', $2, $3, $4::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          authorization.id,
          input.workspaceId,
          JSON.stringify({ status: input.authorization.status, grantedScopes: input.authorization.grantedScopes })
        ]
      );
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
             (id, workspace_id, facebook_page_id, name, timezone, token_status, metadata, autonomy_settings, created_at, updated_at)
             values ($1, $2, $3, $4, 'America/Mexico_City', $5, $6::jsonb, $7::jsonb, now(), now())
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
              }),
              JSON.stringify(defaultAutonomySettings(now()))
            ]
          );
      const business = businessResult.rows[0];
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'pagina_seleccionada', 'facebook_page', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          page.id,
          input.workspaceId,
          business.id,
          JSON.stringify({ actorId: input.actorId, requestId: input.requestId })
        ]
      );
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
    await this.createOutboxEvent({
      eventType: "lote_creado",
      aggregateType: "batch",
      aggregateId: batch.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
    return batch;
  }

  async listBatches(input: { workspaceId: string; businessId: string }): Promise<BatchSummary[]> {
    await this.requireBusiness(input.workspaceId, input.businessId);
    const result = await this.pool.query(
      "select * from public.batches where workspace_id = $1 and business_id = $2 order by updated_at desc",
      [input.workspaceId, input.businessId]
    );
    return result.rows.map(toBatch);
  }

  async getActiveBatch(input: { workspaceId: string; businessId: string }): Promise<BatchSummary | null> {
    const batches = await this.listBatches(input);
    return batches.find((batch) => activeBatchStatuses.has(batch.status)) ?? null;
  }

  async getBatchDetail(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
  }): Promise<{ batch: BatchSummary; photos: Photo[]; variants: []; jobs: StoredJob[] } | null> {
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
    const jobs = await this.pool.query(
      "select * from public.jobs where workspace_id = $1 and batch_id = $2 order by created_at desc",
      [input.workspaceId, input.batchId]
    );
    return {
      batch: toBatch(batchResult.rows[0]),
      photos: photos.rows.map(toPhoto),
      variants: [],
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

  async completeUpload(input: Parameters<DataStore["completeUpload"]>[0]): Promise<{ photo: Photo; job: StoredJob }> {
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
         (id, workspace_id, business_id, batch_id, file_name, storage_key, original_asset_id, content_hash,
          mime_type, width, height, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'analyzing', now(), now())
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
         ), last_activity_at = now(), updated_at = now()
         where id = $1`,
        [input.batchId]
      );
      const jobResult = await client.query(
        `insert into public.jobs
         (id, type, status, workspace_id, business_id, batch_id, photo_id, dedupe_key, payload, run_after, created_at, updated_at)
         values ($1, 'analyze_photo', 'queued', $2, $3, $4, $5, $6, $7::jsonb, now(), now(), now())
         on conflict do nothing
         returning *`,
        [
          randomUUID(),
          input.workspaceId,
          input.businessId,
          input.batchId,
          photoId,
          `analyze_photo:${photoId}`,
          JSON.stringify({
            photoId,
            batchId: input.batchId,
            contentType: input.contentType,
            fileSize: input.fileSize,
            requestId: input.requestId
          })
        ]
      );
      const job =
        jobResult.rows[0] ??
        (
          await client.query("select * from public.jobs where type = 'analyze_photo' and dedupe_key = $1", [
            `analyze_photo:${photoId}`
          ])
        ).rows[0];
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'foto_subida', 'photo', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          photoId,
          input.workspaceId,
          input.businessId,
          JSON.stringify({ batchId: input.batchId, actorId: input.actorId, requestId: input.requestId })
        ]
      );
      await client.query("commit");
      return { photo: toPhoto(photoResult.rows[0]), job: toJob(job) };
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
      const timestamp = now();
      const thumbKey = `${photo.workspace_id}/${photo.business_id}/${photo.batch_id}/derived/${photo.id}-thumb.jpg`;
      const visionKey = `${photo.workspace_id}/${photo.business_id}/${photo.batch_id}/derived/${photo.id}-vision.jpg`;
      const thumbnail = await this.ensureDerivedMediaAsset(client, photo, "thumbnail", thumbKey, timestamp);
      const visionInput = await this.ensureDerivedMediaAsset(client, photo, "vision_input", visionKey, timestamp);
      const updated = await client.query(
        `update public.photos
         set status = 'validada', thumbnail_asset_id = $2, vision_input_asset_id = $3,
             vision_analysis = $4::jsonb, updated_at = now()
         where id = $1 returning *`,
        [photo.id, thumbnail.id, visionInput.id, JSON.stringify(input.analysis)]
      );
      await client.query(
        "update public.batches set status = 'pendiente_confirmacion', last_activity_at = now(), updated_at = now() where id = $1",
        [photo.batch_id]
      );
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'foto_validada', 'photo', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          photo.id,
          photo.workspace_id,
          photo.business_id,
          JSON.stringify({ batchId: photo.batch_id, jobId: input.jobId, aiRunId: input.aiRunId ?? null })
        ]
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

  async estimateBatchCost(input: Parameters<DataStore["estimateBatchCost"]>[0]): ReturnType<DataStore["estimateBatchCost"]> {
    await this.assertWorkspaceBillingAllows(input.workspaceId, "costly");
    const batch = await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
    const workspace = await this.requireWorkspace(input.workspaceId);
    const rule = await this.activePricingRule();
    const validPhotos = await this.validPhotosForGeneration(input.workspaceId, input.businessId, input.batchId);
    const variantCount = validPhotos.length * input.variantsPerPhoto;
    const customerCost = this.money(variantCount * (rule.customerUnitPriceUsd / rule.unitSize));
    const providerCost = this.money(variantCount * (rule.unitCostUsd / rule.unitSize));
    const usage = [
      await this.usageSnapshot(workspace, "generated_variants", variantCount),
      await this.usageSnapshot(workspace, "ai_customer_spend_usd", customerCost),
      await this.usageSnapshot(workspace, "ai_provider_cost_usd", providerCost)
    ];
    const blocked = usage.find((item) => item.availableValue !== null && item.availableValue !== undefined && item.availableValue < 0);
    return {
      batchId: batch.id,
      variantsPerPhoto: input.variantsPerPhoto,
      photoCount: validPhotos.length,
      variantCount,
      priceVersion: rule.priceVersion,
      estimatedCostUsd: customerCost,
      estimatedProviderCostUsd: providerCost,
      breakdown: [
        {
          operation: rule.operation,
          provider: rule.provider,
          model: rule.model,
          unitType: rule.unitType,
          quantity: variantCount,
          unitPriceUsd: rule.customerUnitPriceUsd,
          estimatedCostUsd: customerCost,
          priceVersion: rule.priceVersion
        }
      ],
      canConfirm: variantCount > 0 && !blocked,
      blockedReason: variantCount === 0 ? "no_valid_photos" : blocked ? `limit_exceeded:${blocked.metric}` : null,
      usage
    };
  }

  async confirmBatchCost(input: Parameters<DataStore["confirmBatchCost"]>[0]): ReturnType<DataStore["confirmBatchCost"]> {
    await this.assertWorkspaceBillingAllows(input.workspaceId, "costly");
    const estimate = await this.estimateBatchCost(input);
    if (!estimate.canConfirm) {
      throw new AppError({
        code: "cost_limit_exceeded",
        statusCode: 409,
        message: `Cost confirmation blocked: ${estimate.blockedReason ?? "unknown"}`,
        userMessage: "Este lote supera el limite disponible del plan.",
        retryable: false,
        action: "contact_support"
      });
    }
    if (estimate.priceVersion !== input.priceVersion) {
      throw new AppError({
        code: "price_version_changed",
        statusCode: 409,
        message: "Price version no longer matches active pricing",
        userMessage: "El calculo de costo cambio. Vuelve a revisar la estimacion.",
        retryable: false,
        action: "refresh"
      });
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(
        `select * from public.cost_ledger
         where workspace_id = $1 and batch_id = $2 and entry_type = 'reservation'
           and operation = 'generated_variant' and price_version = $3
         limit 1`,
        [input.workspaceId, input.batchId, input.priceVersion]
      );
      if (!existing.rows[0]) {
        await this.reserveUsage(client, input.workspaceId, "generated_variants", estimate.variantCount);
        await this.reserveUsage(client, input.workspaceId, "ai_customer_spend_usd", estimate.estimatedCostUsd);
        await this.reserveUsage(client, input.workspaceId, "ai_provider_cost_usd", estimate.estimatedProviderCostUsd);
        await client.query(
          `insert into public.cost_ledger
           (id, workspace_id, business_id, batch_id, operation, operation_key, entry_type, usage_metric, quantity,
            price_version, customer_cost_usd, provider_cost_usd, status, created_at)
           values ($1, $2, $3, $4, 'generated_variant', $5, 'reservation', 'generated_variants', $6,
                   $7, $8, $9, 'reserved', now())`,
          [
            randomUUID(),
            input.workspaceId,
            input.businessId,
            input.batchId,
            `batch_generation:${input.batchId}:${input.priceVersion}`,
            estimate.variantCount,
            input.priceVersion,
            estimate.estimatedCostUsd,
            estimate.estimatedProviderCostUsd
          ]
        );
      }
      const batchResult = await client.query(
        `update public.batches
         set status = 'confirmado',
             estimated_cost_usd = $2,
             estimated_provider_cost_usd = $3,
             confirmed_cost_usd = $2,
             confirmed_price_version = $4,
             confirmed_cost_breakdown = $5::jsonb,
             variants_per_photo = $6,
             last_activity_at = now(),
             updated_at = now()
         where id = $1 and workspace_id = $7 and business_id = $8
         returning *`,
        [
          input.batchId,
          estimate.estimatedCostUsd,
          estimate.estimatedProviderCostUsd,
          input.priceVersion,
          JSON.stringify({
            schemaVersion: "cost_breakdown.v1",
            breakdown: estimate.breakdown,
            providerCostUsd: estimate.estimatedProviderCostUsd
          }),
          input.variantsPerPhoto,
          input.workspaceId,
          input.businessId
        ]
      );
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'costo_confirmado', 'batch', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          input.batchId,
          input.workspaceId,
          input.businessId,
          JSON.stringify({
            actorId: input.actorId,
            requestId: input.requestId,
            priceVersion: input.priceVersion,
            variantCount: estimate.variantCount
          })
        ]
      );
      await client.query("commit");
      return {
        batch: toBatch(batchResult.rows[0]),
        variantCount: estimate.variantCount,
        customerCostUsd: estimate.estimatedCostUsd,
        providerCostUsd: estimate.estimatedProviderCostUsd,
        priceVersion: input.priceVersion
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
    await this.assertWorkspaceBillingAllows(input.workspaceId, "publish");
    const batch = await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
    if (!["confirmado", "generado_parcial"].includes(batch.status)) {
      throw new AppError({
        code: "batch_not_ready_for_generation",
        statusCode: 409,
        message: `Batch cannot generate variants from status ${batch.status}`,
        userMessage: "Primero confirma el costo del lote antes de generar variantes.",
        retryable: false,
        action: "refresh"
      });
    }
    if (
      !batch.confirmedPriceVersion ||
      !batch.confirmedCostUsd ||
      batch.variantsPerPhoto !== input.variantsPerPhoto ||
      !(await this.hasReservation(input.workspaceId, input.batchId, batch.confirmedPriceVersion))
    ) {
      throw new AppError({
        code: "cost_not_confirmed",
        statusCode: 409,
        message: "Batch generation requires a confirmed cost reservation",
        userMessage: "Confirma el costo del lote antes de generar variantes.",
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
        userMessage: "Necesitas al menos una foto analizada antes de generar variantes.",
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
      for (const photo of validPhotos) {
        for (let index = 1; index <= input.variantsPerPhoto; index += 1) {
          const variantId = randomUUID();
          const inserted = await client.query(
            `insert into public.variants
             (id, workspace_id, business_id, batch_id, photo_id, variant_index, status, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, 'generando', now(), now())
             on conflict (workspace_id, business_id, batch_id, photo_id, variant_index) do nothing
             returning *`,
            [variantId, input.workspaceId, input.businessId, input.batchId, photo.id, index]
          );
          const variantRow =
            inserted.rows[0] ??
            (
              await client.query(
                `select * from public.variants
                 where workspace_id = $1 and business_id = $2 and batch_id = $3 and photo_id = $4 and variant_index = $5`,
                [input.workspaceId, input.businessId, input.batchId, photo.id, index]
              )
            ).rows[0];
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
             variants_count = (select count(*)::int from public.variants where batch_id = $1 and status <> 'eliminada'),
             last_activity_at = now(),
             updated_at = now()
         where id = $1`,
        [input.batchId]
      );
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'generacion_solicitada', 'batch', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          input.batchId,
          input.workspaceId,
          input.businessId,
          JSON.stringify({ actorId: input.actorId, requestId: input.requestId, variantsPerPhoto: input.variantsPerPhoto, created, available })
        ]
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
       returning *`,
      [input.batchId, job.workspaceId, variants.rows.filter((variant) => variant.status !== "eliminada").length, hasGenerated ? "generado_parcial" : "generando"]
    );
    return { batch: toBatch(batchResult.rows[0]), variants: variants.rows.map(toVariant) };
  }

  async completeGenerateVariant(input: { jobId: string; variantId: string }): ReturnType<DataStore["completeGenerateVariant"]> {
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
      if (current.generatedAssetId && current.caption && ["generada", "aprobada", "rechazada"].includes(current.status)) {
        await client.query("commit");
        return current;
      }
      const photoResult = await client.query("select * from public.photos where id = $1 and workspace_id = $2", [
        current.photoId,
        current.workspaceId
      ]);
      const photo = photoResult.rows[0] ? toPhoto(photoResult.rows[0]) : null;
      if (!photo || photo.status !== "validada" || !photo.visionAnalysis) {
        throw new AppError({
          code: "photo_not_ready_for_variant",
          statusCode: 409,
          message: "Source photo is not validated",
          userMessage: "La foto todavia no esta lista para generar variantes.",
          retryable: true,
          action: "retry"
        });
      }
      const style = this.assignStyle(current.variantIndex);
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
      const caption = this.captionForVariant(photo.fileName ?? "foto", current.variantIndex, style.styleName);
      const captionResult = {
        schemaVersion: "caption.v1" as const,
        promptVersion: "caption-v1",
        caption,
        seoTermsUsed: ["Facebook", "negocio local"],
        warnings: []
      };
      const assetResult = await client.query(
        `insert into public.media_assets
         (id, workspace_id, business_id, batch_id, photo_id, variant_id, kind, bucket, storage_key, mime_type, file_size, is_public, created_at)
         values ($1, $2, $3, $4, $5, $6, 'generated', $7, $8, 'image/jpeg', 0, false, now())
         returning *`,
        [
          randomUUID(),
          current.workspaceId,
          current.businessId,
          current.batchId,
          current.photoId,
          current.id,
          MEDIA_BUCKET,
          `${current.workspaceId}/${current.businessId}/${current.batchId}/generated/${current.id}.jpg`
        ]
      );
      const asset = toMediaAsset(assetResult.rows[0]);
      const updated = await client.query(
        `update public.variants
         set style_id = $2, assigned_style = $3::jsonb, generation_plan = $4::jsonb, quality_check = $5::jsonb,
             caption_result = $6::jsonb, model_profile_id = 'image-generation-local-v1',
             prompt_template_id = 'photo-variant-generation', prompt_version = $7,
             quality_check_id = $8, quality_status = $9, quality_score = $10,
             quality_warnings = $11::jsonb, generated_asset_id = $12, caption = $13,
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
          asset.id,
          caption
        ]
      );
      await client.query(
        `update public.batches
         set status = 'generado_parcial',
             variants_count = (select count(*)::int from public.variants where batch_id = $1 and status <> 'eliminada'),
             last_activity_at = now(),
             updated_at = now()
         where id = $1`,
        [current.batchId]
      );
      await this.consumeVariantReservation(client, toVariant(updated.rows[0]), input.jobId, asset.id);
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'variante_generada', 'variant', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          current.id,
          current.workspaceId,
          current.businessId,
          JSON.stringify({ batchId: current.batchId, photoId: current.photoId, jobId: input.jobId })
        ]
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
    await this.createOutboxEvent({
      eventType: "caption_editado_por_usuario",
      aggregateType: "variant",
      aggregateId: input.variantId,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { batchId: input.batchId, actorId: input.actorId, requestId: input.requestId }
    });
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
        const generated = await client.query("select * from public.media_assets where id = $1", [variant.generatedAssetId]);
        const publishable = await client.query(
          `insert into public.media_assets
           (id, workspace_id, business_id, batch_id, photo_id, variant_id, kind, bucket, storage_key, mime_type, file_size, is_public, created_at)
           values ($1, $2, $3, $4, $5, $6, 'publishable', $7, $8, $9, $10, true, now())
           returning *`,
          [
            randomUUID(),
            variant.workspaceId,
            variant.businessId,
            variant.batchId,
            variant.photoId,
            variant.id,
            MEDIA_BUCKET,
            `${variant.workspaceId}/${variant.businessId}/${variant.batchId}/publishable/${variant.id}.jpg`,
            generated.rows[0]?.mime_type ?? "image/jpeg",
            generated.rows[0]?.file_size ?? 0
          ]
        );
        publishableAssetId = publishable.rows[0].id;
      }
      const result = await client.query(
        "update public.variants set status = 'aprobada', publishable_asset_id = $2, updated_at = now() where id = $1 returning *",
        [variant.id, publishableAssetId]
      );
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'variante_aprobada', 'variant', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          variant.id,
          input.workspaceId,
          input.businessId,
          JSON.stringify({ batchId: input.batchId, actorId: input.actorId, requestId: input.requestId })
        ]
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
    await this.createOutboxEvent({
      eventType: "variante_rechazada",
      aggregateType: "variant",
      aggregateId: variant.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { batchId: input.batchId, actorId: input.actorId, requestId: input.requestId }
    });
    return toVariant(result.rows[0]);
  }

  async confirmCalendar(input: Parameters<DataStore["confirmCalendar"]>[0]): ReturnType<DataStore["confirmCalendar"]> {
    const batch = await this.requireBatch(input.workspaceId, input.businessId, input.batchId);
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
        const scheduledFor = this.scheduledFor(index, input.periodDays);
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
        "update public.batches set status = 'completado', last_activity_at = now(), updated_at = now() where id = $1",
        [batch.id]
      );
      await client.query(
        `insert into public.outbox_events
         (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
         values ($1, 'calendario_confirmado', 'batch', $2, $3, $4, $5::jsonb, 'pending', now(), 0, now())`,
        [
          randomUUID(),
          batch.id,
          input.workspaceId,
          input.businessId,
          JSON.stringify({ actorId: input.actorId, requestId: input.requestId, scheduledPostIds: scheduledPosts.map((post) => post.id) })
        ]
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

  async getScheduledPost(input: Parameters<DataStore["getScheduledPost"]>[0]): Promise<ScheduledPost | null> {
    const result = await this.pool.query(
      "select * from public.scheduled_posts where workspace_id = $1 and business_id = $2 and id = $3",
      [input.workspaceId, input.businessId, input.scheduledPostId]
    );
    return result.rows[0] ? toScheduledPost(result.rows[0]) : null;
  }

  async completeSchedulePosts(input: { jobId: string; batchId: string }): ReturnType<DataStore["completeSchedulePosts"]> {
    const job = await this.requireJob(input.jobId);
    const result = await this.pool.query("select * from public.scheduled_posts where workspace_id = $1 and batch_id = $2", [
      job.workspaceId,
      input.batchId
    ]);
    const posts = result.rows.map(toScheduledPost);
    for (const post of posts) {
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
    return { scheduledPosts: posts };
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
    const asset = await this.pool.query("select * from public.media_assets where id = $1 and kind = 'publishable'", [
      variant.publishableAssetId
    ]);
    if (!asset.rows[0]?.is_public) return await this.failScheduledPost(post.id, "media_not_publicable");
    const operationKey = `meta_publish:${post.id}`;
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "publish_post",
      status: "started"
    });
    const pageResult = await this.pool.query(
      "select meta_page_id, encrypted_page_access_token from public.facebook_pages where id = $1 and workspace_id = $2",
      [post.pageId, post.workspaceId]
    );
    const page = pageResult.rows[0] as { meta_page_id?: string; encrypted_page_access_token?: string | null } | undefined;
    const pageAccessToken = decodeServerToken(page?.encrypted_page_access_token);
    let facebookPostId = `mock_${post.pageId}_${post.id}`;
    let remotePostType: "photo" | "feed" = "photo";
    let remotePostUrl = `https://facebook.example/posts/${facebookPostId}`;
    let remoteTraceId: string | null = null;
    if (pageAccessToken && page?.meta_page_id && !page.meta_page_id.startsWith("mock-")) {
      try {
        const publishImageUrl = publicMediaUrl(String(asset.rows[0].id)) ?? (post.imageUrl && /^https:\/\//i.test(post.imageUrl) ? post.imageUrl : null);
        const publishResult = await publishFacebookPagePost({
          graphApiVersion: post.graphApiVersion ?? process.env.META_GRAPH_API_VERSION ?? "v23.0",
          pageId: page.meta_page_id,
          pageAccessToken,
          caption: post.caption ?? "",
          imageUrl: publishImageUrl
        });
        facebookPostId = publishResult.facebookPostId;
        remotePostType = publishResult.remotePostType;
        remotePostUrl = publishResult.remotePostUrl;
        remoteTraceId = publishResult.providerTraceId ?? null;
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
    }
    const result = await this.pool.query(
      `update public.scheduled_posts
       set status = 'publicada', facebook_post_id = $2, remote_post_type = $3,
           remote_post_url = $4, delivery_mode = $5, remote_status = 'confirmado_meta',
           last_remote_sync_at = now(), image_url = $6, remote_trace_id = $7, updated_at = now(),
           retry_count = retry_count + $8
       where id = $1 returning *`,
      [
        post.id,
        facebookPostId,
        remotePostType,
        remotePostUrl,
        input.publishNow ? "publish_now" : post.deliveryMode,
        `local://public/${asset.rows[0].bucket}/${asset.rows[0].storage_key}`,
        remoteTraceId,
        input.publishNow ? 0 : 1
      ]
    );
    await this.pool.query("update public.variants set status = 'publicada', updated_at = now() where id = $1", [post.variantId]);
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: pageAccessToken ? "meta" : "meta_mock",
      operation: "publish_post",
      status: "succeeded"
    });
    await this.createOutboxEvent({
      eventType: "post_publicado",
      aggregateType: "scheduled_post",
      aggregateId: post.id,
      workspaceId: post.workspaceId,
      businessId: post.businessId,
      payload: { facebookPostId, jobId: job.id }
    });
    return toScheduledPost(result.rows[0]);
  }

  async updateScheduledPost(input: Parameters<DataStore["updateScheduledPost"]>[0]): ReturnType<DataStore["updateScheduledPost"]> {
    await this.assertWorkspaceBillingAllows(input.workspaceId, "publish");
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
    await this.createOutboxEvent({
      eventType: "post_reprogramado",
      aggregateType: "scheduled_post",
      aggregateId: post.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId, scheduledFor: input.scheduledFor }
    });
    return { scheduledPost: toScheduledPost(result.rows[0]), job };
  }

  async cancelScheduledPost(input: Parameters<DataStore["cancelScheduledPost"]>[0]): ReturnType<DataStore["cancelScheduledPost"]> {
    const post = await this.requireScheduledPost(input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.status === "publicada") throw this.scheduledPostStateError("scheduled_post_already_published");
    if (post.remoteStatus !== "no_enviado" || post.facebookPostId) {
      const updated = await this.pool.query(
        "update public.scheduled_posts set status = 'estado_incierto', remote_status = 'cancelacion_pendiente', updated_at = now() where id = $1 returning *",
        [post.id]
      );
      const job = await this.createJob({
        type: "cancel_remote_post",
        workspaceId: post.workspaceId,
        businessId: post.businessId,
        batchId: post.batchId,
        variantId: post.variantId,
        dedupeKey: `cancel_remote_post:${post.id}:${post.facebookPostId ?? "unknown"}`,
        payload: { scheduledPostId: post.id }
      });
      return { scheduledPost: toScheduledPost(updated.rows[0]), job };
    }
    const updated = await this.pool.query("update public.scheduled_posts set status = 'cancelada', updated_at = now() where id = $1 returning *", [
      post.id
    ]);
    await this.pool.query("update public.variants set status = 'aprobada', updated_at = now() where id = $1 and status = 'programada'", [
      post.variantId
    ]);
    await this.createOutboxEvent({
      eventType: "post_cancelado",
      aggregateType: "scheduled_post",
      aggregateId: post.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
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
       set delivery_mode = 'publish_now', scheduled_for = $2, scheduled_for_unix = $3, updated_at = $2
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

  async createOutboxEvent(input: Parameters<DataStore["createOutboxEvent"]>[0]): Promise<OutboxEvent> {
    const result = await this.pool.query(
      `insert into public.outbox_events
       (id, event_type, aggregate_type, aggregate_id, workspace_id, business_id, payload, status, available_at, attempts, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', now(), 0, now())
       returning *`,
      [
        randomUUID(),
        input.eventType,
        input.aggregateType,
        input.aggregateId,
        input.workspaceId,
        input.businessId ?? null,
        JSON.stringify(input.payload ?? {})
      ]
    );
    return toOutboxEvent(result.rows[0]);
  }

  async listOutboxEvents(workspaceId: string): Promise<OutboxEvent[]> {
    const result = await this.pool.query("select * from public.outbox_events where workspace_id = $1 order by created_at desc", [workspaceId]);
    return result.rows.map(toOutboxEvent);
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

  private async assertWorkspaceBillingAllows(workspaceId: string, action: "costly" | "publish") {
    const workspace = await this.requireWorkspace(workspaceId);
    if (["past_due", "paused", "cancelled"].includes(workspace.billingStatus)) {
      throw new AppError({
        code: "billing_status_blocked",
        statusCode: 402,
        message: `Workspace billing status blocks ${action}: ${workspace.billingStatus}`,
        userMessage:
          action === "publish"
            ? "Tu plan necesita atencion antes de publicar."
            : "Tu plan necesita atencion antes de usar funciones con costo.",
        retryable: false,
        action: "contact_support"
      });
    }
  }

  private async activePricingRule(): Promise<PricingRule> {
    const result = await this.pool.query(
      `select * from public.pricing_rules
       where active = true and operation = 'generated_variant'
         and effective_from <= now()
         and (effective_to is null or effective_to > now())
       order by effective_from desc
       limit 1`
    );
    if (!result.rows[0]) {
      throw new AppError({
        code: "pricing_rule_missing",
        statusCode: 503,
        message: "No active pricing rule for generated variants",
        userMessage: "No pudimos calcular el costo en este momento.",
        retryable: true,
        action: "retry"
      });
    }
    return toPricingRule(result.rows[0]);
  }

  private async validPhotosForGeneration(workspaceId: string, businessId: string, batchId: string): Promise<Photo[]> {
    const result = await this.pool.query(
      `select * from public.photos
       where workspace_id = $1 and business_id = $2 and batch_id = $3
         and status = 'validada' and vision_analysis is not null
       order by created_at asc`,
      [workspaceId, businessId, batchId]
    );
    return result.rows.map(toPhoto);
  }

  private async usageSnapshot(
    workspace: Workspace,
    metric: UsageMeter["metric"],
    requestedValue: number
  ): Promise<{
    metric: UsageMeter["metric"];
    limitValue?: number | null;
    usedValue: number;
    reservedValue: number;
    availableValue?: number | null;
  }> {
    const meter = await this.ensureUsageMeter(this.pool, workspace, metric);
    const limitValue = meter.limitValue ?? null;
    const availableValue = limitValue === null ? null : this.money(limitValue - meter.usedValue - meter.reservedValue - requestedValue);
    return {
      metric,
      limitValue,
      usedValue: meter.usedValue,
      reservedValue: meter.reservedValue,
      availableValue
    };
  }

  private entitlementLimit(workspace: Workspace, metric: UsageMeter["metric"]) {
    const entitlements = (workspace.entitlements ?? {}) as Record<string, unknown>;
    const fromKey = (key: string) => {
      const value = entitlements[key];
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    };
    if (metric === "generated_variants") return fromKey("monthlyGeneratedVariants");
    if (metric === "ai_customer_spend_usd") return fromKey("monthlyAiBudgetUsd") ?? fromKey("includedAiCreditsUsd");
    if (metric === "ai_provider_cost_usd") return fromKey("monthlyProviderBudgetUsd");
    if (metric === "photo_uploads") return fromKey("monthlyPhotoUploads");
    if (metric === "scheduled_posts") return fromKey("monthlyScheduledPosts");
    return undefined;
  }

  private async ensureUsageMeter(
    executor: pg.Pool | pg.PoolClient,
    workspace: Workspace,
    metric: UsageMeter["metric"]
  ): Promise<UsageMeter> {
    const periodStart = this.currentPeriodStart();
    const periodEnd = this.currentPeriodEnd();
    const limitValue = this.entitlementLimit(workspace, metric);
    const id = `${workspace.id}:${metric}:${periodStart}`;
    const result = await executor.query(
      `insert into public.usage_meters
       (id, workspace_id, metric, period_start, period_end, limit_value, reserved_value, used_value, updated_at)
       values ($1, $2, $3, $4, $5, $6, 0, 0, now())
       on conflict (workspace_id, metric, period_start) do update
       set limit_value = coalesce(excluded.limit_value, public.usage_meters.limit_value), updated_at = now()
       returning *`,
      [id, workspace.id, metric, periodStart, periodEnd, limitValue ?? null]
    );
    const row = result.rows[0];
    const meter: UsageMeter = {
      id: row.id,
      workspaceId: row.workspace_id,
      metric: row.metric,
      periodStart: new Date(row.period_start).toISOString(),
      periodEnd: new Date(row.period_end).toISOString(),
      reservedValue: Number(row.reserved_value),
      usedValue: Number(row.used_value),
      updatedAt: new Date(row.updated_at).toISOString()
    };
    if (row.limit_value !== null && row.limit_value !== undefined) meter.limitValue = Number(row.limit_value);
    return meter;
  }

  private async reserveUsage(client: pg.PoolClient, workspaceId: string, metric: UsageMeter["metric"], value: number) {
    const workspace = await this.requireWorkspace(workspaceId);
    const meter = await this.ensureUsageMeter(client, workspace, metric);
    const nextReserved = this.money(meter.reservedValue + value);
    if (meter.limitValue !== undefined && this.money(meter.usedValue + nextReserved) > meter.limitValue) {
      throw new AppError({
        code: "usage_limit_exceeded",
        statusCode: 409,
        message: `Usage limit exceeded for ${metric}`,
        userMessage: "Este lote supera el limite disponible del plan.",
        retryable: false,
        action: "contact_support"
      });
    }
    await client.query(
      "update public.usage_meters set reserved_value = $2, updated_at = now() where id = $1",
      [meter.id, nextReserved]
    );
  }

  private async hasReservation(workspaceId: string, batchId: string, priceVersion: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from public.cost_ledger
       where workspace_id = $1 and batch_id = $2 and price_version = $3
         and entry_type = 'reservation' and status = 'reserved'
       limit 1`,
      [workspaceId, batchId, priceVersion]
    );
    return Boolean(result.rows[0]);
  }

  private async consumeUsage(client: pg.PoolClient, workspaceId: string, metric: UsageMeter["metric"], value: number) {
    const workspace = await this.requireWorkspace(workspaceId);
    const meter = await this.ensureUsageMeter(client, workspace, metric);
    await client.query(
      `update public.usage_meters
       set reserved_value = greatest(0, reserved_value - $2),
           used_value = used_value + $2,
           updated_at = now()
       where id = $1`,
      [meter.id, value]
    );
  }

  private async consumeVariantReservation(client: pg.PoolClient, variant: Variant, jobId: string, generatedAssetId: string) {
    const batch = await client.query("select * from public.batches where id = $1 and workspace_id = $2", [
      variant.batchId,
      variant.workspaceId
    ]);
    const confirmedPriceVersion = batch.rows[0]?.confirmed_price_version;
    if (!confirmedPriceVersion) return;
    const operationKey = `openai_image:${variant.id}`;
    const existingActual = await client.query(
      "select 1 from public.cost_ledger where operation_key = $1 and entry_type = 'actual' limit 1",
      [operationKey]
    );
    if (existingActual.rows[0]) return;
    const ruleResult = await client.query("select * from public.pricing_rules where price_version = $1 limit 1", [
      confirmedPriceVersion
    ]);
    const rule = ruleResult.rows[0] ? toPricingRule(ruleResult.rows[0]) : await this.activePricingRule();
    const customerCost = this.money(rule.customerUnitPriceUsd / rule.unitSize);
    const providerCost = this.money(rule.unitCostUsd / rule.unitSize);
    await this.consumeUsage(client, variant.workspaceId, "generated_variants", 1);
    await this.consumeUsage(client, variant.workspaceId, "ai_customer_spend_usd", customerCost);
    await this.consumeUsage(client, variant.workspaceId, "ai_provider_cost_usd", providerCost);
    await client.query(
      `insert into public.cost_ledger
       (id, workspace_id, business_id, batch_id, job_id, variant_id, operation, operation_key, entry_type,
        usage_metric, quantity, price_version, customer_cost_usd, provider_cost_usd, status, created_at)
       values ($1, $2, $3, $4, $5, $6, 'generated_variant', $7, 'actual',
               'generated_variants', 1, $8, $9, $10, 'used', now())`,
      [
        randomUUID(),
        variant.workspaceId,
        variant.businessId,
        variant.batchId,
        jobId,
        variant.id,
        operationKey,
        rule.priceVersion,
        customerCost,
        providerCost
      ]
    );
    await client.query(
      `insert into public.cost_ledger
       (id, workspace_id, business_id, batch_id, job_id, variant_id, operation, operation_key, entry_type,
        quantity, price_version, customer_cost_usd, provider_cost_usd, status, created_at)
       values ($1, $2, $3, $4, $5, $6, 'generated_asset', $7, 'actual',
               1, $8, 0, 0, 'used', now())`,
      [
        randomUUID(),
        variant.workspaceId,
        variant.businessId,
        variant.batchId,
        jobId,
        variant.id,
        `asset:${generatedAssetId}`,
        rule.priceVersion
      ]
    );
  }

  private assignStyle(index: number): AssignedStyle {
    const styles: AssignedStyle[] = [
      {
        styleId: "clean-bright",
        styleName: "Limpio y luminoso",
        intensity: "ligera",
        contrast: 0.12,
        saturation: 0.08,
        warmth: 0.04,
        sharpness: 0.1,
        lowConfidence: false,
        manualOverride: false
      },
      {
        styleId: "warm-local",
        styleName: "Calido de negocio local",
        intensity: "media",
        contrast: 0.08,
        saturation: 0.12,
        warmth: 0.18,
        sharpness: 0.06,
        lowConfidence: false,
        manualOverride: false
      },
      {
        styleId: "social-pop",
        styleName: "Color social",
        intensity: "media",
        contrast: 0.16,
        saturation: 0.2,
        warmth: 0,
        sharpness: 0.12,
        lowConfidence: false,
        manualOverride: false
      }
    ];
    return styles[(index - 1) % styles.length]!;
  }

  private generationPlan(style: AssignedStyle, promptVersion: string) {
    return {
      schemaVersion: "generation_plan.v1" as const,
      puedeGenerar: true,
      motivo: "Foto validada con analisis disponible.",
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

  private captionForVariant(fileName: string, variantIndex: number, styleName: string) {
    const openings = [
      "Una opcion fresca para mostrar lo mejor de tu negocio en Facebook.",
      "Lista para compartir: una imagen clara, cuidada y pensada para atraer miradas locales.",
      "Un post sencillo y directo para que tus clientes recuerden lo que ofreces hoy."
    ];
    const opening = openings[(variantIndex - 1) % openings.length];
    return `${opening}\n\nFoto base: ${fileName}. Estilo: ${styleName}.\n\n#NegocioLocal #Facebook`;
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

  private scheduledFor(index: number, periodDays: 7 | 14 | 30) {
    const dayStep = Math.max(1, Math.floor(periodDays / Math.max(1, index + 1)));
    const date = new Date();
    date.setDate(date.getDate() + 1 + index * dayStep);
    date.setHours(10 + (index % 4) * 2, 0, 0, 0);
    return date.toISOString();
  }

  private async failScheduledPost(scheduledPostId: string, remoteErrorCode: string): Promise<ScheduledPost> {
    const result = await this.pool.query(
      "update public.scheduled_posts set status = 'fallida', remote_error_code = $2, updated_at = now() where id = $1 returning *",
      [scheduledPostId, remoteErrorCode]
    );
    return toScheduledPost(result.rows[0]);
  }

  private async metricDefinition(provider: MetricDefinition["provider"], canonicalMetric: MetricDefinition["canonicalMetric"]) {
    const result = await this.pool.query(
      "select * from public.metric_definitions where provider = $1 and canonical_metric = $2 and status = 'active' limit 1",
      [provider, canonicalMetric]
    );
    if (!result.rows[0]) throw new Error(`Metric definition not found: ${provider}:${canonicalMetric}`);
    return toMetricDefinition(result.rows[0]);
  }

  private businessAutonomy(business: Business): BusinessAutonomySettings {
    const timestamp = now();
    const raw = business.autonomySettings as Partial<BusinessAutonomySettings>;
    return this.normalizedAutonomy(raw, timestamp);
  }

  private normalizedAutonomy(input: Partial<BusinessAutonomySettings>, timestamp: string): BusinessAutonomySettings {
    const base = defaultAutonomySettings(timestamp);
    const incomingActions = input.actions ?? {};
    for (const action of autonomyActions) {
      const current = incomingActions[action] as Partial<ActionAutonomyState> | undefined;
      if (!current) continue;
      const merged = { ...base.actions[action]!, ...current, action, updatedAt: timestamp };
      if (action === "FACEBOOK_PUBLISH" && !merged.explicitOptIn) {
        merged.mode = "human_approval";
        merged.paused = true;
        merged.pauseReasons = [...new Set([...(merged.pauseReasons ?? []), "explicit_opt_in_required"])];
      }
      base.actions[action] = merged;
    }
    return { schemaVersion: "business_autonomy.v1", actions: base.actions, updatedAt: timestamp };
  }

  private async hasUncertainPost(businessId: string): Promise<boolean> {
    const result = await this.pool.query(
      "select 1 from public.scheduled_posts where business_id = $1 and status = 'estado_incierto' limit 1",
      [businessId]
    );
    return Boolean(result.rows[0]);
  }

  private async hasBudgetPressure(workspaceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from public.usage_meters
       where workspace_id = $1 and limit_value is not null and used_value + reserved_value >= limit_value
       limit 1`,
      [workspaceId]
    );
    return Boolean(result.rows[0]);
  }

  private async hasSensitivePublishRisk(workspaceId: string, businessId: string): Promise<boolean> {
    const result = await this.pool.query(
      `select 1
       from public.photos p
       join public.variants v on v.photo_id = p.id and v.workspace_id = p.workspace_id
       where p.workspace_id = $1 and p.business_id = $2
         and v.status in ('aprobada', 'programada', 'publicada')
         and (
           coalesce((p.vision_analysis #>> '{sensitiveElements,personVisible}')::boolean, false) = true
           or coalesce((p.vision_analysis #>> '{sensitiveElements,priceVisible}')::boolean, false) = true
           or coalesce((p.vision_analysis #>> '{sensitiveElements,promotionVisible}')::boolean, false) = true
         )
       limit 1`,
      [workspaceId, businessId]
    );
    return Boolean(result.rows[0]);
  }

  private async insertMetricSnapshot(input: {
    workspaceId: string;
    businessId: string;
    scheduledPostId: string;
    facebookPostId: string | null;
    definition: MetricDefinition;
    window: MetricWindow;
    value: number;
    collectedAt: string;
    observedUntil: string;
  }): Promise<PostMetricSnapshot> {
    const result = await this.pool.query(
      `insert into public.post_metric_snapshots
       (id, workspace_id, business_id, scheduled_post_id, facebook_post_id, metric_definition_id,
        provider, canonical_metric, provider_metric_name, window, value, collected_at, observed_until,
        collection_status, source_version, raw_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ok', 'fbmaniaco-local-metrics-v1', null)
       returning *`,
      [
        randomUUID(),
        input.workspaceId,
        input.businessId,
        input.scheduledPostId,
        input.facebookPostId,
        input.definition.id,
        input.definition.provider,
        input.definition.canonicalMetric,
        input.definition.providerMetricName ?? null,
        input.window,
        input.value,
        input.collectedAt,
        input.observedUntil
      ]
    );
    return toPostMetricSnapshot(result.rows[0]);
  }

  private async recalculatePerformanceSummaries(
    workspaceId: string,
    businessId: string,
    periodStart: string,
    periodEnd: string,
    generatedAt: string
  ): Promise<PerformanceSummary[]> {
    const published = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and business_id = $2 and status = 'publicada'
         and scheduled_for >= $3::timestamptz and scheduled_for <= $4::timestamptz`,
      [workspaceId, businessId, periodStart, periodEnd]
    );
    const failed = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and business_id = $2 and status in ('fallida', 'estado_incierto')
         and scheduled_for >= $3::timestamptz and scheduled_for <= $4::timestamptz`,
      [workspaceId, businessId, periodStart, periodEnd]
    );
    const scheduled = await this.pool.query(
      `select * from public.scheduled_posts
       where workspace_id = $1 and business_id = $2
         and scheduled_for >= $3::timestamptz and scheduled_for <= $4::timestamptz`,
      [workspaceId, businessId, periodStart, periodEnd]
    );
    const scheduledPosts = scheduled.rows.map(toScheduledPost);
    const sampleSize = published.rows.length;
    const confidence = this.confidenceForSample(sampleSize);
    const metaUnavailable = (
      await this.pool.query("select 1 from public.metric_definitions where provider = 'meta' and status <> 'active' limit 1")
    ).rows[0];
    const reasonCodes = [...(sampleSize < 20 ? ["sample_size_low"] : []), ...(metaUnavailable ? ["meta_insights_unavailable"] : [])];
    await this.pool.query(
      `delete from public.performance_summaries
       where workspace_id = $1 and business_id = $2 and period_start = $3::timestamptz and period_end = $4::timestamptz`,
      [workspaceId, businessId, periodStart, periodEnd]
    );
    const summaries: PerformanceSummary[] = [];
    const businessSummary = await this.insertPerformanceSummary({
      workspaceId,
      businessId,
      scope: "business_week",
      scopeKey: periodStart.slice(0, 10),
      periodStart,
      periodEnd,
      sampleSize,
      metrics: {
        publish_success: published.rows.length,
        publish_failure: failed.rows.length,
        week_coverage: Math.min(1, scheduledPosts.length / 7)
      },
      confidence,
      reasonCodes,
      generatedAt
    });
    summaries.push(businessSummary);
    const byStyle = new Map<string, { label: string; published: number; scheduled: number }>();
    for (const post of scheduledPosts) {
      const key = post.styleId ?? "sin_estilo";
      const entry = byStyle.get(key) ?? { label: post.styleName ?? key, published: 0, scheduled: 0 };
      entry.scheduled += 1;
      if (post.status === "publicada") entry.published += 1;
      byStyle.set(key, entry);
    }
    for (const [styleId, entry] of byStyle.entries()) {
      summaries.push(
        await this.insertPerformanceSummary({
          workspaceId,
          businessId,
          scope: "style",
          scopeKey: styleId,
          periodStart,
          periodEnd,
          sampleSize: entry.published,
          metrics: {
            publish_success: entry.published,
            scheduled_posts: entry.scheduled,
            acceptance_proxy: entry.scheduled === 0 ? 0 : entry.published / entry.scheduled
          },
          confidence: this.confidenceForSample(entry.published),
          reasonCodes: entry.published < 20 ? ["sample_size_low", `style_label:${entry.label}`] : [`style_label:${entry.label}`],
          generatedAt
        })
      );
    }
    return summaries;
  }

  private async insertPerformanceSummary(input: {
    workspaceId: string;
    businessId: string;
    scope: PerformanceSummary["scope"];
    scopeKey: string;
    periodStart: string;
    periodEnd: string;
    sampleSize: number;
    metrics: Record<string, number>;
    confidence: PerformanceSummary["confidence"];
    reasonCodes: string[];
    generatedAt: string;
  }): Promise<PerformanceSummary> {
    const result = await this.pool.query(
      `insert into public.performance_summaries
       (id, workspace_id, business_id, scope, scope_key, period_start, period_end, sample_size, metrics, confidence, reason_codes, generated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
       returning *`,
      [
        randomUUID(),
        input.workspaceId,
        input.businessId,
        input.scope,
        input.scopeKey,
        input.periodStart,
        input.periodEnd,
        input.sampleSize,
        JSON.stringify(input.metrics),
        input.confidence,
        input.reasonCodes,
        input.generatedAt
      ]
    );
    return toPerformanceSummary(result.rows[0]);
  }

  private async countScheduledPosts(
    workspaceId: string,
    businessId: string,
    periodStart: string,
    periodEnd: string,
    statuses: string[]
  ): Promise<number> {
    const result = await this.pool.query(
      `select count(*)::int as count from public.scheduled_posts
       where workspace_id = $1 and business_id = $2 and status = any($3::text[])
         and scheduled_for >= $4::timestamptz and scheduled_for <= $5::timestamptz`,
      [workspaceId, businessId, statuses, periodStart, periodEnd]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private confidenceForSample(sampleSize: number): PerformanceSummary["confidence"] {
    if (sampleSize < 20) return "exploratoria";
    if (sampleSize < 100) return "media";
    return "alta";
  }

  private weekStart(date: Date) {
    const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    const day = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() - day + 1);
    return copy;
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

  private currentPeriodStart() {
    const date = new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
  }

  private currentPeriodEnd() {
    const date = new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
  }

  private money(value: number) {
    return Math.round(value * 1_000_000) / 1_000_000;
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

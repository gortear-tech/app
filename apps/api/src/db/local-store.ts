import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  AppError,
  ActionAutonomyState,
  AiEvaluation,
  AutonomyAction,
  AutonomyEvaluation,
  BillingAccount,
  BillingProvider,
  BillingProviderEvent,
  BusinessAutonomySettings,
  AssignedStyle,
  BatchSummary,
  Business,
  CaptionResult,
  CommercialPlan,
  FacebookTokenStatus,
  forbiddenError,
  MetaAuthorizationStatus,
  MetaPage,
  MetricDefinition,
  MetricWindow,
  PerformanceSummary,
  Photo,
  PLAN_ENTITLEMENTS,
  PostMetricSnapshot,
  ScheduledPost,
  UploadIntent,
  User,
  Variant,
  VisionAnalysis,
  WeeklyReport,
  Workspace,
  WorkspaceMember,
  WorkspaceRole
} from "@fbmaniaco/shared";
import {
  DataStore,
  AiRun,
  DbReadiness,
  ExternalOperation,
  IdempotencyRecord,
  JobAttempt,
  MediaAsset,
  MetaAuthorization,
  OutboxEvent,
  PersistedMetaAuthorizationInput,
  CostLedgerEntry,
  PricingRule,
  UsageMeter,
  WorkerHeartbeat,
  StoredJob
} from "./types.js";
import { publishFacebookPagePost } from "@fbmaniaco/providers";

type LocalMetaPage = MetaPage & {
  encryptedPageAccessToken?: string | null;
  pageAccessTokenKeyId?: string | null;
};

type LocalState = {
  users: User[];
  workspaces: Workspace[];
  members: WorkspaceMember[];
  metaAuthorizations: MetaAuthorization[];
  pages: LocalMetaPage[];
  businesses: Business[];
  batches: BatchSummary[];
  photos: Photo[];
  uploadIntents: UploadIntent[];
  mediaAssets: MediaAsset[];
  aiRuns: AiRun[];
  variants: Variant[];
  scheduledPosts: ScheduledPost[];
  selectedByWorkspace: Record<string, { pageId?: string; businessId?: string }>;
  jobs: StoredJob[];
  jobAttempts: JobAttempt[];
  idempotencyRecords: IdempotencyRecord[];
  outboxEvents: OutboxEvent[];
  externalOperations: ExternalOperation[];
  pricingRules: PricingRule[];
  usageMeters: UsageMeter[];
  costLedger: CostLedgerEntry[];
  workerHeartbeats: WorkerHeartbeat[];
  metricDefinitions: MetricDefinition[];
  postMetricSnapshots: PostMetricSnapshot[];
  performanceSummaries: PerformanceSummary[];
  weeklyReports: WeeklyReport[];
  aiEvaluations: AiEvaluation[];
  billingAccounts: BillingAccount[];
  billingProviderEvents: BillingProviderEvent[];
};

const now = () => new Date().toISOString();
const encodeServerToken = (token: string) => `local-dev:${Buffer.from(token, "utf8").toString("base64url")}`;
const decodeServerToken = (value: string | null | undefined) => {
  if (!value?.startsWith("local-dev:")) return null;
  return Buffer.from(value.slice("local-dev:".length), "base64url").toString("utf8");
};
const mediaPreviewToken = (assetId: string, expires: number) =>
  createHash("sha256").update(`${assetId}:${expires}:fbmaniaco-local-media-preview`).digest("hex");
const publicMediaUrl = (assetId: string) => {
  const baseUrl = process.env.PUBLIC_API_URL ?? process.env.API_PUBLIC_URL;
  if (!baseUrl?.startsWith("https://")) return null;
  const expires = Math.floor(Date.now() / 1000) + 15 * 60;
  return `${baseUrl.replace(/\/$/, "")}/media/assets/${assetId}/preview?expires=${expires}&token=${mediaPreviewToken(assetId, expires)}`;
};
const publicMetaPage = (page: LocalMetaPage): MetaPage => {
  const { encryptedPageAccessToken: _encryptedPageAccessToken, pageAccessTokenKeyId: _pageAccessTokenKeyId, ...safePage } = page;
  return safePage;
};
const MEDIA_BUCKET = "business-media";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const activeBatchStatuses = new Set(["pending_upload", "pendiente_confirmacion", "confirmado", "generando", "generado_parcial"]);
const defaultPricingRules = (): PricingRule[] => [
  {
    id: "price-local-generated-variant-v1",
    provider: "local",
    model: "mock-image-caption-v1",
    operation: "generated_variant",
    unitType: "image",
    unitSize: 1,
    dimensions: { size: "1:1", quality: "mock", includesCaption: true },
    currency: "USD",
    unitCostUsd: 0.002,
    customerUnitPriceUsd: 0.01,
    priceVersion: "local-2026-05-01",
    effectiveFrom: "2026-05-01T00:00:00.000Z",
    active: true
  }
];
const defaultMetricDefinitions = (): MetricDefinition[] => [
  {
    id: "metric-fbmaniaco-publish-success-v1",
    provider: "fbmaniaco",
    canonicalMetric: "publish_success",
    providerMetricName: null,
    graphApiVersion: null,
    valueType: "count",
    status: "active",
    effectiveFrom: "2026-05-01T00:00:00.000Z",
    notes: "Publicaciones confirmadas por FBmaniaco."
  },
  {
    id: "metric-fbmaniaco-publish-failure-v1",
    provider: "fbmaniaco",
    canonicalMetric: "publish_failure",
    providerMetricName: null,
    graphApiVersion: null,
    valueType: "count",
    status: "active",
    effectiveFrom: "2026-05-01T00:00:00.000Z",
    notes: "Publicaciones fallidas o inciertas en FBmaniaco."
  },
  {
    id: "metric-fbmaniaco-week-coverage-v1",
    provider: "fbmaniaco",
    canonicalMetric: "week_coverage",
    providerMetricName: null,
    graphApiVersion: null,
    valueType: "rate",
    status: "active",
    effectiveFrom: "2026-05-01T00:00:00.000Z",
    notes: "Cobertura semanal de publicaciones programadas o publicadas."
  },
  {
    id: "metric-meta-engagements-v23-unavailable",
    provider: "meta",
    canonicalMetric: "engagements",
    providerMetricName: "post_engaged_users",
    graphApiVersion: "v23.0",
    valueType: "count",
    status: "unavailable",
    effectiveFrom: "2026-05-01T00:00:00.000Z",
    notes: "Insights Meta degradados en adaptador local hasta configurar permisos reales."
  }
];
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

const emptyState = (): LocalState => ({
  users: [],
  workspaces: [],
  members: [],
  metaAuthorizations: [],
  pages: [],
  businesses: [],
  batches: [],
  photos: [],
  uploadIntents: [],
  mediaAssets: [],
  aiRuns: [],
  variants: [],
  scheduledPosts: [],
  selectedByWorkspace: {},
  jobs: [],
  jobAttempts: [],
  idempotencyRecords: [],
  outboxEvents: [],
  externalOperations: [],
  pricingRules: defaultPricingRules(),
  usageMeters: [],
  costLedger: [],
  workerHeartbeats: [],
  metricDefinitions: defaultMetricDefinitions(),
  postMetricSnapshots: [],
  performanceSummaries: [],
  weeklyReports: [],
  aiEvaluations: [],
  billingAccounts: [],
  billingProviderEvents: []
});

const hasNewerTimestamp = (candidate: unknown, current: unknown) => {
  const candidateUpdatedAt =
    typeof candidate === "object" && candidate !== null && "updatedAt" in candidate ? Date.parse(String(candidate.updatedAt)) : NaN;
  const currentUpdatedAt =
    typeof current === "object" && current !== null && "updatedAt" in current ? Date.parse(String(current.updatedAt)) : NaN;
  if (Number.isNaN(candidateUpdatedAt) || Number.isNaN(currentUpdatedAt)) return true;
  return candidateUpdatedAt >= currentUpdatedAt;
};

const mergeById = <T extends { id: string }>(latest: T[], current: T[]) => {
  return mergeByKey(latest, current, (item) => item.id);
};

const mergeByKey = <T>(latest: T[], current: T[], keyFor: (item: T) => string) => {
  const merged = new Map<string, T>();
  for (const item of latest) merged.set(keyFor(item), item);
  for (const item of current) {
    const key = keyFor(item);
    const existing = merged.get(key);
    if (!existing || hasNewerTimestamp(item, existing)) merged.set(key, item);
  }
  return Array.from(merged.values());
};

const mergeLocalState = (latest: LocalState, current: LocalState): LocalState => ({
  ...latest,
  ...current,
  users: mergeById(latest.users, current.users),
  workspaces: mergeById(latest.workspaces, current.workspaces),
  members: mergeByKey(latest.members, current.members, (item) => `${item.workspaceId}:${item.userId}`),
  metaAuthorizations: mergeById(latest.metaAuthorizations, current.metaAuthorizations),
  pages: mergeById(latest.pages, current.pages),
  businesses: mergeById(latest.businesses, current.businesses),
  batches: mergeById(latest.batches, current.batches),
  photos: mergeById(latest.photos, current.photos),
  uploadIntents: mergeById(latest.uploadIntents, current.uploadIntents),
  mediaAssets: mergeById(latest.mediaAssets, current.mediaAssets),
  aiRuns: mergeById(latest.aiRuns, current.aiRuns),
  variants: mergeById(latest.variants, current.variants),
  scheduledPosts: mergeById(latest.scheduledPosts, current.scheduledPosts),
  jobs: mergeById(latest.jobs, current.jobs),
  jobAttempts: mergeById(latest.jobAttempts, current.jobAttempts),
  idempotencyRecords: mergeById(latest.idempotencyRecords, current.idempotencyRecords),
  outboxEvents: mergeById(latest.outboxEvents, current.outboxEvents),
  externalOperations: mergeByKey(latest.externalOperations, current.externalOperations, (item) => item.operationKey),
  pricingRules: mergeById(latest.pricingRules, current.pricingRules),
  usageMeters: mergeById(latest.usageMeters, current.usageMeters),
  costLedger: mergeById(latest.costLedger, current.costLedger),
  workerHeartbeats: mergeByKey(latest.workerHeartbeats, current.workerHeartbeats, (item) => item.workerId),
  metricDefinitions: mergeById(latest.metricDefinitions, current.metricDefinitions),
  postMetricSnapshots: mergeById(latest.postMetricSnapshots, current.postMetricSnapshots),
  performanceSummaries: mergeById(latest.performanceSummaries, current.performanceSummaries),
  weeklyReports: mergeById(latest.weeklyReports, current.weeklyReports),
  aiEvaluations: mergeById(latest.aiEvaluations, current.aiEvaluations),
  billingAccounts: mergeById(latest.billingAccounts, current.billingAccounts),
  billingProviderEvents: mergeById(latest.billingProviderEvents, current.billingProviderEvents),
  selectedByWorkspace: { ...latest.selectedByWorkspace, ...current.selectedByWorkspace }
});

export class LocalDataStore implements DataStore {
  private readonly path: string;
  private state: LocalState | null = null;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async ready(): Promise<DbReadiness> {
    await this.load();
    return { ok: true, mode: "local" };
  }

  async getUser(userId: string): Promise<User | null> {
    const state = await this.load();
    return state.users.find((user) => user.id === userId) ?? null;
  }

  async upsertLocalUser(input: { userId: string; email: string; displayName?: string | undefined }): Promise<User> {
    const state = await this.load();
    const existing = state.users.find((user) => user.id === input.userId);
    const timestamp = now();
    if (existing) {
      existing.email = input.email;
      if (input.displayName !== undefined) existing.displayName = input.displayName;
      existing.lastLoginAt = timestamp;
      await this.persist();
      return existing;
    }
    const user: User = {
      id: input.userId,
      email: input.email,
      status: "activo",
      createdAt: timestamp,
      lastLoginAt: timestamp
    };
    if (input.displayName !== undefined) user.displayName = input.displayName;
    state.users.push(user);
    await this.persist();
    return user;
  }

  async ensureDefaultWorkspace(userId: string): Promise<{ workspace: Workspace; membership: WorkspaceMember }> {
    const state = await this.load();
    const existing = state.members.find((member) => member.userId === userId && member.status === "active");
    if (existing) {
      const workspace = state.workspaces.find((item) => item.id === existing.workspaceId);
      if (workspace) return { workspace, membership: existing };
    }

    const timestamp = now();
    const workspace: Workspace = {
      id: randomUUID(),
      name: "Mi workspace FBmaniaco",
      ownerUserId: userId,
      plan: "piloto",
      billingStatus: "trial",
      entitlements: PLAN_ENTITLEMENTS.piloto,
      status: "activo",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const membership: WorkspaceMember = {
      workspaceId: workspace.id,
      userId,
      role: "owner",
      status: "active",
      createdAt: timestamp
    };
    state.workspaces.push(workspace);
    state.members.push(membership);
    state.billingAccounts.push({
      id: randomUUID(),
      workspaceId: workspace.id,
      provider: "manual",
      providerCustomerId: null,
      providerSubscriptionId: null,
      providerSubscriptionItemId: null,
      providerPriceId: null,
      plan: "piloto",
      billingStatus: "trial",
      currentPeriodStart: this.currentPeriodStart(),
      currentPeriodEnd: this.currentPeriodEnd(),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await this.persist();
    return { workspace, membership };
  }

  async listMemberships(userId: string) {
    const state = await this.load();
    return state.members
      .filter((membership) => membership.userId === userId && membership.status === "active")
      .flatMap((membership) => {
        const workspace = state.workspaces.find((item) => item.id === membership.workspaceId);
        return workspace ? [{ workspace, membership }] : [];
      });
  }

  async assertWorkspaceRole(input: {
    userId: string;
    workspaceId: string;
    allowedRoles: WorkspaceRole[];
  }): Promise<WorkspaceMember> {
    const state = await this.load();
    const membership = state.members.find(
      (item) => item.userId === input.userId && item.workspaceId === input.workspaceId && item.status === "active"
    );
    if (!membership || !input.allowedRoles.includes(membership.role)) {
      throw forbiddenError();
    }
    return membership;
  }

  async createJob(input: {
    type: StoredJob["type"];
    workspaceId: string;
    businessId?: string;
    batchId?: string;
    photoId?: string;
    variantId?: string;
    dedupeKey: string;
    payload?: Record<string, unknown>;
    runAfter?: string;
  }): Promise<StoredJob> {
    const state = await this.load();
    const active = state.jobs.find(
      (job) =>
        job.type === input.type &&
        job.dedupeKey === input.dedupeKey &&
        ["queued", "running", "blocked", "needs_user_action"].includes(job.status)
    );
    if (active) return active;
    const timestamp = now();
    const job: StoredJob = {
      id: randomUUID(),
      type: input.type,
      status: "queued",
      workspaceId: input.workspaceId,
      dedupeKey: input.dedupeKey,
      payload: input.payload ?? {},
      result: {},
      attempts: 0,
      maxAttempts: 3,
      runAfter: input.runAfter ?? timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (input.businessId !== undefined) job.businessId = input.businessId;
    if (input.batchId !== undefined) job.batchId = input.batchId;
    if (input.photoId !== undefined) job.photoId = input.photoId;
    if (input.variantId !== undefined) job.variantId = input.variantId;
    state.jobs.push(job);
    await this.persist();
    return job;
  }

  async claimDueJob(workerId: string): Promise<StoredJob | null> {
    const state = await this.load();
    const timestamp = now();
    const job = state.jobs
      .filter((item) => item.status === "queued" && item.runAfter <= timestamp)
      .sort((a, b) => a.runAfter.localeCompare(b.runAfter) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!job) return null;

    job.status = "running";
    job.lockedAt = timestamp;
    job.lockedBy = workerId;
    job.leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    job.attempts += 1;
    job.updatedAt = timestamp;
    state.jobAttempts.push({
      id: randomUUID(),
      jobId: job.id,
      workspaceId: job.workspaceId,
      attemptNumber: job.attempts,
      status: "running",
      startedAt: timestamp
    });
    await this.persist();
    return job;
  }

  async completeJob(input: { jobId: string; result: Record<string, unknown> }): Promise<StoredJob> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const timestamp = now();
    job.status = "succeeded";
    job.result = input.result;
    job.updatedAt = timestamp;
    const attempt = state.jobAttempts.find((item) => item.jobId === job.id && item.attemptNumber === job.attempts);
    if (attempt) {
      attempt.status = "succeeded";
      attempt.finishedAt = timestamp;
    }
    await this.persist();
    return job;
  }

  async failJob(input: { jobId: string; error: string }): Promise<StoredJob> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const timestamp = now();
    job.status = job.attempts >= job.maxAttempts ? "failed" : "queued";
    job.lastError = input.error;
    job.updatedAt = timestamp;
    const attempt = state.jobAttempts.find((item) => item.jobId === job.id && item.attemptNumber === job.attempts);
    if (attempt) {
      attempt.status = "failed";
      attempt.finishedAt = timestamp;
      attempt.error = input.error;
    }
    await this.persist();
    return job;
  }

  async listJobs(workspaceId: string): Promise<StoredJob[]> {
    const state = await this.load();
    return state.jobs.filter((job) => job.workspaceId === workspaceId);
  }

  async listAttempts(jobId: string): Promise<JobAttempt[]> {
    const state = await this.load();
    return state.jobAttempts.filter((attempt) => attempt.jobId === jobId);
  }

  async recordWorkerHeartbeat(input: {
    workerId: string;
    environment: string;
    release: string;
    status?: "alive" | "stopping";
    metadata?: Record<string, unknown>;
  }): Promise<WorkerHeartbeat> {
    const state = await this.load();
    const timestamp = now();
    let heartbeat = state.workerHeartbeats.find((item) => item.workerId === input.workerId);
    if (!heartbeat) {
      heartbeat = {
        workerId: input.workerId,
        service: "worker",
        environment: input.environment,
        release: input.release,
        status: input.status ?? "alive",
        lastBeatAt: timestamp,
        metadata: input.metadata ?? {}
      };
      state.workerHeartbeats.push(heartbeat);
    } else {
      heartbeat.environment = input.environment;
      heartbeat.release = input.release;
      heartbeat.status = input.status ?? "alive";
      heartbeat.lastBeatAt = timestamp;
      heartbeat.metadata = input.metadata ?? {};
    }
    await this.persist();
    return heartbeat;
  }

  async getLatestWorkerHeartbeat(): Promise<WorkerHeartbeat | null> {
    const state = await this.load();
    return state.workerHeartbeats
      .filter((heartbeat) => heartbeat.status === "alive")
      .sort((a, b) => b.lastBeatAt.localeCompare(a.lastBeatAt))[0] ?? null;
  }

  async listMetricDefinitions(): Promise<MetricDefinition[]> {
    const state = await this.load();
    return [...state.metricDefinitions].sort((a, b) => a.canonicalMetric.localeCompare(b.canonicalMetric));
  }

  async listPerformanceSummaries(input: {
    workspaceId: string;
    businessId: string;
    from?: string;
    to?: string;
    scope?: PerformanceSummary["scope"];
  }): Promise<PerformanceSummary[]> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    return state.performanceSummaries
      .filter(
        (summary) =>
          summary.workspaceId === input.workspaceId &&
          summary.businessId === input.businessId &&
          (input.scope === undefined || summary.scope === input.scope) &&
          (input.from === undefined || summary.periodEnd >= input.from) &&
          (input.to === undefined || summary.periodStart <= input.to)
      )
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }

  async requestCollectMetrics(input: {
    workspaceId: string;
    businessId: string;
    from?: string;
    to?: string;
    window?: MetricWindow;
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob }> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
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
    await this.persist();
    return { job };
  }

  async completeCollectMetrics(input: { jobId: string }): Promise<{
    snapshots: PostMetricSnapshot[];
    summaries: PerformanceSummary[];
    unavailableMetrics: MetricDefinition[];
  }> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    if (!job.businessId) throw new Error("collect_metrics job is missing businessId");
    const from = typeof job.payload.from === "string" ? job.payload.from : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = typeof job.payload.to === "string" ? job.payload.to : now();
    const window = (typeof job.payload.window === "string" ? job.payload.window : "7d") as MetricWindow;
    const timestamp = now();
    const publishedPosts = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === job.workspaceId &&
        post.businessId === job.businessId &&
        post.status === "publicada" &&
        post.scheduledFor >= from &&
        post.scheduledFor <= to
    );
    const successDefinition = this.metricDefinition(state, "fbmaniaco", "publish_success");
    const failureDefinition = this.metricDefinition(state, "fbmaniaco", "publish_failure");
    const metaDefinitions = state.metricDefinitions.filter((definition) => definition.provider === "meta" && definition.status !== "active");
    const snapshots: PostMetricSnapshot[] = [];
    for (const post of publishedPosts) {
      const snapshot: PostMetricSnapshot = {
        id: randomUUID(),
        workspaceId: post.workspaceId,
        businessId: post.businessId,
        scheduledPostId: post.id,
        facebookPostId: post.facebookPostId ?? null,
        metricDefinitionId: successDefinition.id,
        provider: "fbmaniaco",
        canonicalMetric: "publish_success",
        providerMetricName: null,
        window,
        value: 1,
        collectedAt: timestamp,
        observedUntil: to,
        collectionStatus: "ok",
        sourceVersion: "fbmaniaco-local-metrics-v1",
        rawRef: null
      };
      snapshots.push(snapshot);
      state.postMetricSnapshots.push(snapshot);
    }
    const failedPosts = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === job.workspaceId &&
        post.businessId === job.businessId &&
        ["fallida", "estado_incierto"].includes(post.status) &&
        post.scheduledFor >= from &&
        post.scheduledFor <= to
    );
    for (const post of failedPosts) {
      const snapshot: PostMetricSnapshot = {
        id: randomUUID(),
        workspaceId: post.workspaceId,
        businessId: post.businessId,
        scheduledPostId: post.id,
        facebookPostId: post.facebookPostId ?? null,
        metricDefinitionId: failureDefinition.id,
        provider: "fbmaniaco",
        canonicalMetric: "publish_failure",
        providerMetricName: null,
        window,
        value: 1,
        collectedAt: timestamp,
        observedUntil: to,
        collectionStatus: "ok",
        sourceVersion: "fbmaniaco-local-metrics-v1",
        rawRef: null
      };
      snapshots.push(snapshot);
      state.postMetricSnapshots.push(snapshot);
    }
    const summaries = this.recalculatePerformanceSummaries(state, job.workspaceId, job.businessId, from, to, timestamp);
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
    await this.persist();
    return { snapshots, summaries, unavailableMetrics: metaDefinitions };
  }

  async requestWeeklyReport(input: {
    workspaceId: string;
    businessId: string;
    weekStart?: string;
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob }> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    const periodStart = input.weekStart ?? this.weekStart(new Date()).toISOString();
    const periodEnd = new Date(new Date(periodStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const job = await this.createJob({
      type: "weekly_report",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      dedupeKey: `weekly_report:${input.businessId}:${periodStart}`,
      payload: { periodStart, periodEnd, actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return { job };
  }

  async completeWeeklyReport(input: { jobId: string }): Promise<WeeklyReport> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    if (!job.businessId) throw new Error("weekly_report job is missing businessId");
    const periodStart = typeof job.payload.periodStart === "string" ? job.payload.periodStart : this.weekStart(new Date()).toISOString();
    const periodEnd =
      typeof job.payload.periodEnd === "string"
        ? job.payload.periodEnd
        : new Date(new Date(periodStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const timestamp = now();
    const summaries = this.recalculatePerformanceSummaries(state, job.workspaceId, job.businessId, periodStart, periodEnd, timestamp);
    const published = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === job.workspaceId &&
        post.businessId === job.businessId &&
        post.status === "publicada" &&
        post.scheduledFor >= periodStart &&
        post.scheduledFor <= periodEnd
    );
    const failed = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === job.workspaceId &&
        post.businessId === job.businessId &&
        ["fallida", "estado_incierto"].includes(post.status) &&
        post.scheduledFor >= periodStart &&
        post.scheduledFor <= periodEnd
    );
    const summary = summaries.find((item) => item.scope === "business_week");
    const sampleSize = summary?.sampleSize ?? published.length;
    const confidence = this.confidenceForSample(sampleSize);
    const report: WeeklyReport = {
      id: randomUUID(),
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      periodStart,
      periodEnd,
      confidence,
      sampleSize,
      sections: {
        worked: published.length > 0 ? [`${published.length} publicaciones quedaron confirmadas.`] : ["Aun no hay publicaciones confirmadas esta semana."],
        didNotWork: failed.length > 0 ? [`${failed.length} publicaciones requieren revision.`] : ["No se detectaron fallas propias en la ventana."],
        styleAcceptance: confidence === "exploratoria" ? ["Muestra pequena: no se declara un estilo ganador."] : ["Hay muestra suficiente para comparar estilos."],
        captionEdits: ["Se separan ediciones de caption de metricas externas para no mezclar senales."],
        recommendedTimes: confidence === "exploratoria" ? ["Mantener horarios conservadores hasta tener 20 posts publicados."] : ["Revisar horarios con snapshots comparables."],
        metaHealth: ["Insights de Meta degradados en modo local; se usan senales propias de FBmaniaco."],
        calendarCoverage: [`Cobertura semanal estimada: ${Math.round((summary?.metrics.week_coverage ?? 0) * 100)}%.`],
        aiCost: ["Costos IA se leen del ledger interno; no se infieren desde el reporte."],
        nextActions: published.length === 0 ? ["Publicar al menos un post para empezar aprendizaje real."] : ["Recolectar snapshots comparables antes del siguiente reporte."]
      },
      reasonCodes: summary?.reasonCodes ?? ["sample_size_low", "meta_insights_unavailable"],
      generatedAt: timestamp
    };
    state.weeklyReports.push(report);
    await this.createOutboxEvent({
      eventType: "performance_summary_generado",
      aggregateType: "business",
      aggregateId: job.businessId,
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      payload: { jobId: job.id, reportId: report.id, confidence: report.confidence, sampleSize: report.sampleSize }
    });
    await this.persist();
    return report;
  }

  async getLatestWeeklyReport(input: { workspaceId: string; businessId: string }): Promise<WeeklyReport | null> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    return state.weeklyReports
      .filter((report) => report.workspaceId === input.workspaceId && report.businessId === input.businessId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
  }

  async updateBusiness(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    requestId: string;
    name?: string;
    timezone?: string;
    metadata?: Record<string, unknown>;
    autonomySettings?: BusinessAutonomySettings;
  }): Promise<Business> {
    const state = await this.load();
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const timestamp = now();
    if (input.name !== undefined) business.name = input.name;
    if (input.timezone !== undefined) business.timezone = input.timezone;
    if (input.metadata !== undefined) business.metadata = { ...business.metadata, ...input.metadata };
    if (input.autonomySettings !== undefined) {
      business.autonomySettings = this.normalizedAutonomy(input.autonomySettings, timestamp);
    }
    business.updatedAt = timestamp;
    await this.createOutboxEvent({
      eventType: input.autonomySettings !== undefined ? "autonomia_actualizada" : "negocio_actualizado",
      aggregateType: "business",
      aggregateId: business.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return business;
  }

  async evaluateBusinessAutonomy(input: {
    workspaceId: string;
    businessId: string;
    autonomyFeatureEnabled: boolean;
  }): Promise<AutonomyEvaluation> {
    const state = await this.load();
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const settings = this.businessAutonomy(business);
    const publish = settings.actions.FACEBOOK_PUBLISH;
    const reasons = new Set<string>();
    if (!input.autonomyFeatureEnabled) reasons.add("kill_switch_autonomy");
    if (!publish?.explicitOptIn) reasons.add("explicit_opt_in_required");
    if (publish?.mode !== "autonomous") reasons.add("publish_not_autonomous");
    if (business.tokenStatus === "expirado" || business.tokenStatus === "requiere_reconexion") reasons.add("meta_token_unhealthy");
    if (state.scheduledPosts.some((post) => post.businessId === business.id && post.status === "estado_incierto")) reasons.add("uncertain_post_exists");
    if (this.hasBudgetPressure(state, input.workspaceId)) reasons.add("budget_limit_reached");
    if (this.hasSensitivePublishRisk(state, input.workspaceId, input.businessId)) reasons.add("sensitive_content_requires_review");
    const publishedCount = state.scheduledPosts.filter((post) => post.businessId === business.id && post.status === "publicada").length;
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

  async requestBatchCaptionEval(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    requestId: string;
    candidatePromptTemplateId?: string;
    baselinePromptTemplateId?: string;
    datasetId?: string;
    candidateCaptionEditRate?: number;
  }): Promise<{ job: StoredJob }> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
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
    await this.persist();
    return { job };
  }

  async completeBatchCaptionEval(input: { jobId: string }): Promise<AiEvaluation> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    if (!job.businessId) throw new Error("batch_caption_eval job is missing businessId");
    const baselineEditRate = 0.1;
    const candidateEditRate =
      typeof job.payload.candidateCaptionEditRate === "number" ? job.payload.candidateCaptionEditRate : 0.08;
    const failedCriteria = [
      ...(candidateEditRate > baselineEditRate ? ["caption_edit_rate_regression"] : []),
      ...(candidateEditRate > 0.2 ? ["manual_edit_rate_too_high"] : [])
    ];
    const timestamp = now();
    const evaluation: AiEvaluation = {
      id: randomUUID(),
      workspaceId: job.workspaceId,
      businessId: job.businessId,
      task: "caption",
      datasetId: typeof job.payload.datasetId === "string" ? job.payload.datasetId : "golden-caption-local-v1",
      baselinePromptTemplateId:
        typeof job.payload.baselinePromptTemplateId === "string" ? job.payload.baselinePromptTemplateId : "caption-template-active-v1",
      candidatePromptTemplateId:
        typeof job.payload.candidatePromptTemplateId === "string" ? job.payload.candidatePromptTemplateId : "caption-template-canary-v1",
      status: failedCriteria.length === 0 ? "passed" : "failed",
      metrics: {
        schema_valid_rate: 1,
        refusal_rate: 0,
        baseline_caption_edit_rate: baselineEditRate,
        candidate_caption_edit_rate: candidateEditRate,
        cost_per_approved_variant_usd: 0.01,
        latency_p95_ms: 1200
      },
      failedCriteria,
      rolloutRecommendation: failedCriteria.length === 0 ? "promote_canary" : "retain_baseline",
      usedBatchMode: true,
      createdAt: timestamp
    };
    state.aiEvaluations.push(evaluation);
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
    await this.persist();
    return evaluation;
  }

  async listAiEvaluations(input: { workspaceId: string; businessId: string }): Promise<AiEvaluation[]> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    return state.aiEvaluations
      .filter((evaluation) => evaluation.workspaceId === input.workspaceId && evaluation.businessId === input.businessId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBillingStatus(input: { workspaceId: string }): Promise<{ workspace: Workspace; billingAccount: BillingAccount | null }> {
    const state = await this.load();
    const workspace = this.requireWorkspace(state, input.workspaceId);
    const billingAccount =
      state.billingAccounts
        .filter((account) => account.workspaceId === input.workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    return { workspace, billingAccount };
  }

  async createUpgradeIntent(input: {
    workspaceId: string;
    actorId: string;
    requestId: string;
    plan: CommercialPlan;
    provider: BillingProvider;
  }): Promise<{ provider: BillingProvider; targetPlan: CommercialPlan; checkoutUrl: string | null; message: string }> {
    const state = await this.load();
    this.requireWorkspace(state, input.workspaceId);
    await this.createOutboxEvent({
      eventType: "billing_upgrade_intent_created",
      aggregateType: "workspace",
      aggregateId: input.workspaceId,
      workspaceId: input.workspaceId,
      payload: { actorId: input.actorId, requestId: input.requestId, plan: input.plan, provider: input.provider }
    });
    await this.persist();
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

  async processBillingProviderEvent(input: {
    provider: BillingProvider;
    providerEventId: string;
    type: string;
    workspaceId?: string;
    plan?: CommercialPlan;
    billingStatus?: Workspace["billingStatus"];
  }): Promise<{ event: BillingProviderEvent; duplicate: boolean }> {
    const state = await this.load();
    const existing = state.billingProviderEvents.find(
      (event) => event.provider === input.provider && event.providerEventId === input.providerEventId
    );
    if (existing) return { event: existing, duplicate: true };
    const timestamp = now();
    const event: BillingProviderEvent = {
      id: randomUUID(),
      provider: input.provider,
      providerEventId: input.providerEventId,
      workspaceId: input.workspaceId ?? null,
      type: input.type,
      status: "received",
      receivedAt: timestamp,
      processedAt: null,
      lastError: null
    };
    state.billingProviderEvents.push(event);
    try {
      if (!input.workspaceId) {
        event.status = "ignored";
        event.processedAt = timestamp;
      } else {
        const workspace = this.requireWorkspace(state, input.workspaceId);
        const nextPlan = input.plan ?? (workspace.plan as CommercialPlan | undefined) ?? "piloto";
        const nextStatus = input.billingStatus ?? workspace.billingStatus;
        workspace.plan = nextPlan;
        workspace.billingStatus = nextStatus;
        workspace.entitlements = PLAN_ENTITLEMENTS[nextPlan];
        workspace.updatedAt = timestamp;
        let account = state.billingAccounts.find(
          (item) => item.workspaceId === workspace.id && item.provider === input.provider
        );
        if (!account) {
          account = {
            id: randomUUID(),
            workspaceId: workspace.id,
            provider: input.provider,
            providerCustomerId: null,
            providerSubscriptionId: null,
            providerSubscriptionItemId: null,
            providerPriceId: null,
            plan: nextPlan,
            billingStatus: nextStatus,
            currentPeriodStart: this.currentPeriodStart(),
            currentPeriodEnd: this.currentPeriodEnd(),
            createdAt: timestamp,
            updatedAt: timestamp
          };
          state.billingAccounts.push(account);
        } else {
          account.plan = nextPlan;
          account.billingStatus = nextStatus;
          account.updatedAt = timestamp;
        }
        event.status = "processed";
        event.processedAt = timestamp;
        await this.createOutboxEvent({
          eventType: "billing_updated",
          aggregateType: "workspace",
          aggregateId: workspace.id,
          workspaceId: workspace.id,
          payload: { provider: input.provider, providerEventId: input.providerEventId, plan: nextPlan, billingStatus: nextStatus }
        });
      }
    } catch (error) {
      event.status = "failed";
      event.lastError = error instanceof Error ? error.message : "Unknown billing event error";
    }
    await this.persist();
    return { event, duplicate: false };
  }

  async getBootstrapContext(userId: string): Promise<{
    selectedBusinessId: string | null;
    selectedPageId: string | null;
    facebookTokenStatus: FacebookTokenStatus | null;
    metaAuthorizationStatus: MetaAuthorizationStatus;
    grantedScopes: string[];
    declinedScopes: string[];
    missingRequiredScopes: string[];
    graphApiVersion: string;
  }> {
    const state = await this.load();
    const membership = state.members.find((item) => item.userId === userId && item.status === "active");
    if (!membership) {
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
    const selected = state.selectedByWorkspace[membership.workspaceId];
    const authorization = this.latestMetaAuthorization(state, membership.workspaceId);
    return {
      selectedBusinessId: selected?.businessId ?? null,
      selectedPageId: selected?.pageId ?? null,
      facebookTokenStatus: authorization?.tokenStatus ?? null,
      metaAuthorizationStatus: authorization?.status ?? "none",
      grantedScopes: authorization?.grantedScopes ?? [],
      declinedScopes: authorization?.declinedScopes ?? [],
      missingRequiredScopes: authorization?.missingRequiredScopes ?? [],
      graphApiVersion: authorization?.graphApiVersion ?? "v23.0"
    };
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
    const state = await this.load();
    const timestamp = now();
    let authorization = this.latestMetaAuthorization(state, input.workspaceId);
    if (!authorization) {
      authorization = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        status: input.authorization.status,
        grantedScopes: input.authorization.grantedScopes,
        declinedScopes: input.authorization.declinedScopes,
        missingRequiredScopes: input.authorization.missingRequiredScopes,
        grantedPageIds: input.authorization.grantedPageIds,
        appMode: input.authorization.appMode,
        appReviewStatus: input.authorization.appReviewStatus,
        graphApiVersion: input.authorization.graphApiVersion,
        tokenStatus: input.authorization.tokenStatus,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.metaAuthorizations.push(authorization);
    } else {
      authorization.status = input.authorization.status;
      authorization.grantedScopes = input.authorization.grantedScopes;
      authorization.declinedScopes = input.authorization.declinedScopes;
      authorization.missingRequiredScopes = input.authorization.missingRequiredScopes;
      authorization.grantedPageIds = input.authorization.grantedPageIds;
      authorization.appMode = input.authorization.appMode;
      authorization.appReviewStatus = input.authorization.appReviewStatus;
      authorization.graphApiVersion = input.authorization.graphApiVersion;
      authorization.tokenStatus = input.authorization.tokenStatus;
      authorization.updatedAt = timestamp;
    }

    for (const page of input.pages) {
      const existing = state.pages.find((item) => item.workspaceId === input.workspaceId && item.metaPageId === page.metaPageId);
      const encryptedPageAccessToken = page.pageAccessToken
        ? encodeServerToken(page.pageAccessToken)
        : existing?.encryptedPageAccessToken ?? null;
      const pageAccessTokenKeyId = encryptedPageAccessToken ? "local-dev" : existing?.pageAccessTokenKeyId ?? null;
      const { pageAccessToken: _pageAccessToken, ...safePage } = page;
      if (existing) {
        Object.assign(existing, safePage, { encryptedPageAccessToken, pageAccessTokenKeyId, updatedAt: timestamp });
        continue;
      }
      state.pages.push({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        isSelected: false,
        updatedAt: timestamp,
        encryptedPageAccessToken,
        pageAccessTokenKeyId,
        ...safePage
      });
    }

    await this.createOutboxEvent({
      eventType: "meta_autorizacion_actualizada",
      aggregateType: "meta_authorization",
      aggregateId: authorization.id,
      workspaceId: input.workspaceId,
      payload: { status: authorization.status, grantedScopes: authorization.grantedScopes }
    });
    await this.persist();
    return authorization;
  }

  async listMetaPages(workspaceId: string): Promise<MetaPage[]> {
    const state = await this.load();
    return state.pages.filter((page) => page.workspaceId === workspaceId).map(publicMetaPage);
  }

  async selectMetaPage(input: {
    workspaceId: string;
    actorId: string;
    pageId: string;
    requestId: string;
  }): Promise<Business> {
    const state = await this.load();
    const page = state.pages.find((item) => item.id === input.pageId && item.workspaceId === input.workspaceId);
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
    if (!page.isGranted || !page.canPublish || page.pageAccessTokenStatus !== "valido") {
      throw new AppError({
        code: "meta_page_not_selectable",
        statusCode: 409,
        message: "Meta page is not granted or cannot publish",
        userMessage: "Esa pagina necesita permisos completos para publicar.",
        retryable: false,
        action: "reconnect"
      });
    }

    const timestamp = now();
    state.pages
      .filter((item) => item.workspaceId === input.workspaceId)
      .forEach((item) => {
        item.isSelected = item.id === page.id;
        item.updatedAt = timestamp;
      });

    let business = state.businesses.find(
      (item) => item.workspaceId === input.workspaceId && item.facebookPageId === page.id
    );
    if (!business) {
      business = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        facebookPageId: page.id,
        name: page.pageName,
        timezone: "America/Mexico_City",
        tokenStatus: page.pageAccessTokenStatus,
        metadata: {
          pageName: page.pageName,
          category: page.category ?? "Facebook Page",
          facebookSeo: { keywords: [], context: null }
        },
        autonomySettings: defaultAutonomySettings(timestamp),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.businesses.push(business);
      await this.createOutboxEvent({
        eventType: "negocio_creado",
        aggregateType: "business",
        aggregateId: business.id,
        workspaceId: input.workspaceId,
        businessId: business.id,
        payload: { actorId: input.actorId, requestId: input.requestId }
      });
    } else {
      business.tokenStatus = page.pageAccessTokenStatus;
      business.updatedAt = timestamp;
    }

    state.selectedByWorkspace[input.workspaceId] = { pageId: page.id, businessId: business.id };
    await this.createOutboxEvent({
      eventType: "pagina_seleccionada",
      aggregateType: "facebook_page",
      aggregateId: page.id,
      workspaceId: input.workspaceId,
      businessId: business.id,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return business;
  }

  async listBusinesses(workspaceId: string): Promise<Business[]> {
    const state = await this.load();
    return state.businesses.filter((business) => business.workspaceId === workspaceId);
  }

  async getBusiness(input: { workspaceId: string; businessId: string }): Promise<Business | null> {
    const state = await this.load();
    return (
      state.businesses.find(
        (business) => business.workspaceId === input.workspaceId && business.id === input.businessId
      ) ?? null
    );
  }

  async createBatch(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    requestId: string;
  }): Promise<BatchSummary> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    const timestamp = now();
    const batch: BatchSummary = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      status: "pending_upload",
      photosCount: 0,
      variantsCount: 0,
      lastActivityAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.batches.push(batch);
    await this.createOutboxEvent({
      eventType: "lote_creado",
      aggregateType: "batch",
      aggregateId: batch.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return batch;
  }

  async listBatches(input: { workspaceId: string; businessId: string }): Promise<BatchSummary[]> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    return state.batches
      .filter((batch) => batch.workspaceId === input.workspaceId && batch.businessId === input.businessId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getActiveBatch(input: { workspaceId: string; businessId: string }): Promise<BatchSummary | null> {
    const batches = await this.listBatches(input);
    return batches.find((batch) => activeBatchStatuses.has(batch.status)) ?? null;
  }

  async getBatchDetail(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
  }): Promise<{ batch: BatchSummary; photos: Photo[]; variants: Variant[]; jobs: StoredJob[] } | null> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    const batch = state.batches.find(
      (item) => item.id === input.batchId && item.workspaceId === input.workspaceId && item.businessId === input.businessId
    );
    if (!batch) return null;
    return {
      batch,
      photos: state.photos.filter((photo) => photo.batchId === batch.id && photo.workspaceId === input.workspaceId),
      variants: state.variants.filter((variant) => variant.batchId === batch.id && variant.workspaceId === input.workspaceId),
      jobs: state.jobs.filter((job) => job.batchId === batch.id && job.workspaceId === input.workspaceId)
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
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    this.assertUploadShape(input.contentType, input.fileSize, input.originalFileName);
    const timestamp = now();
    const intent: UploadIntent = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      batchId: input.batchId,
      bucket: MEDIA_BUCKET,
      storageKey: `${input.workspaceId}/${input.businessId}/${input.batchId}/${randomUUID()}-${safeFileName(input.originalFileName)}`,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      maxBytes: MAX_UPLOAD_BYTES,
      status: "created",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      createdAt: timestamp
    };
    state.uploadIntents.push(intent);
    await this.persist();
    return intent;
  }

  async completeUpload(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    storageKey: string;
    originalFileName: string;
    contentType: string;
    fileSize: number;
    checksum?: string;
    width?: number;
    height?: number;
    actorId: string;
    requestId: string;
  }): Promise<{ photo: Photo; job: StoredJob }> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    this.assertUploadShape(input.contentType, input.fileSize, input.originalFileName);
    const intent = state.uploadIntents.find(
      (item) =>
        item.workspaceId === input.workspaceId &&
        item.businessId === input.businessId &&
        item.batchId === input.batchId &&
        item.storageKey === input.storageKey
    );
    if (!intent || intent.status !== "created" || intent.expiresAt < now()) {
      throw new AppError({
        code: "upload_intent_invalid",
        statusCode: 409,
        message: "Upload intent is missing, expired, or already completed",
        userMessage: "La subida expiro o ya fue confirmada. Intenta subir la foto de nuevo.",
        retryable: false,
        action: "retry"
      });
    }
    const timestamp = now();
    const originalAsset: MediaAsset = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      batchId: input.batchId,
      kind: "original",
      bucket: MEDIA_BUCKET,
      storageKey: input.storageKey,
      mimeType: input.contentType,
      fileSize: input.fileSize,
      isPublic: false,
      createdAt: timestamp
    };
    const photo: Photo = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      batchId: input.batchId,
      fileName: input.originalFileName,
      storageKey: input.storageKey,
      originalAssetId: originalAsset.id,
      contentHash: input.checksum ?? null,
      mimeType: input.contentType,
      status: "analyzing",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (input.width !== undefined) photo.width = input.width;
    if (input.height !== undefined) photo.height = input.height;
    originalAsset.photoId = photo.id;
    state.mediaAssets.push(originalAsset);
    state.photos.push(photo);
    intent.status = "completed";
    batch.photosCount = state.photos.filter((item) => item.batchId === batch.id && item.status !== "eliminada").length;
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    const job = await this.createJob({
      type: "analyze_photo",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      batchId: input.batchId,
      photoId: photo.id,
      dedupeKey: `analyze_photo:${photo.id}`,
      payload: {
        photoId: photo.id,
        batchId: input.batchId,
        imageUrl: publicMediaUrl(originalAsset.id),
        contentType: input.contentType,
        fileSize: input.fileSize,
        requestId: input.requestId
      }
    });
    await this.createOutboxEvent({
      eventType: "foto_subida",
      aggregateType: "photo",
      aggregateId: photo.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { batchId: input.batchId, actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return { photo, job };
  }

  async getPhoto(input: { workspaceId: string; photoId: string }): Promise<Photo | null> {
    const state = await this.load();
    return state.photos.find((item) => item.workspaceId === input.workspaceId && item.id === input.photoId) ?? null;
  }

  async completeAnalyzePhoto(input: {
    photoId: string;
    jobId: string;
    analysis: VisionAnalysis;
    aiRunId?: string;
  }): Promise<Photo> {
    const state = await this.load();
    const photo = state.photos.find((item) => item.id === input.photoId);
    if (!photo) {
      throw new Error(`Photo not found: ${input.photoId}`);
    }
    const batch = state.batches.find(
      (item) => item.id === photo.batchId && item.workspaceId === photo.workspaceId && item.businessId === photo.businessId
    );
    const timestamp = now();
    let thumbnailAsset = state.mediaAssets.find((item) => item.photoId === photo.id && item.kind === "thumbnail");
    let visionInputAsset = state.mediaAssets.find((item) => item.photoId === photo.id && item.kind === "vision_input");
    if (!thumbnailAsset) {
      thumbnailAsset = {
        id: randomUUID(),
        workspaceId: photo.workspaceId,
        businessId: photo.businessId,
        batchId: photo.batchId,
        photoId: photo.id,
        kind: "thumbnail",
        bucket: MEDIA_BUCKET,
        storageKey: `${photo.workspaceId}/${photo.businessId}/${photo.batchId}/derived/${photo.id}-thumb.jpg`,
        mimeType: "image/jpeg",
        fileSize: 0,
        isPublic: false,
        createdAt: timestamp
      };
      state.mediaAssets.push(thumbnailAsset);
    }
    if (!visionInputAsset) {
      visionInputAsset = {
        id: randomUUID(),
        workspaceId: photo.workspaceId,
        businessId: photo.businessId,
        batchId: photo.batchId,
        photoId: photo.id,
        kind: "vision_input",
        bucket: MEDIA_BUCKET,
        storageKey: `${photo.workspaceId}/${photo.businessId}/${photo.batchId}/derived/${photo.id}-vision.jpg`,
        mimeType: "image/jpeg",
        fileSize: 0,
        isPublic: false,
        createdAt: timestamp
      };
      state.mediaAssets.push(visionInputAsset);
    }
    photo.status = "validada";
    photo.thumbnailAssetId = thumbnailAsset.id;
    photo.visionInputAssetId = visionInputAsset.id;
    photo.visionAnalysis = input.analysis;
    photo.updatedAt = timestamp;
    if (batch) {
      batch.status = "pendiente_confirmacion";
      batch.lastActivityAt = timestamp;
      batch.updatedAt = timestamp;
    }
    await this.createOutboxEvent({
      eventType: "foto_validada",
      aggregateType: "photo",
      aggregateId: photo.id,
      workspaceId: photo.workspaceId,
      businessId: photo.businessId,
      payload: { batchId: photo.batchId, jobId: input.jobId, aiRunId: input.aiRunId ?? null }
    });
    await this.persist();
    return photo;
  }

  async getMediaAsset(input: { assetId: string }): Promise<MediaAsset | null> {
    const state = await this.load();
    return state.mediaAssets.find((asset) => asset.id === input.assetId) ?? null;
  }

  async estimateBatchCost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
  }) {
    const state = await this.load();
    this.assertWorkspaceBillingAllows(state, input.workspaceId, "costly");
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    const workspace = this.requireWorkspace(state, input.workspaceId);
    const rule = this.activePricingRule(state);
    const validPhotos = this.validPhotosForGeneration(state, input.workspaceId, input.businessId, input.batchId);
    const variantCount = validPhotos.length * input.variantsPerPhoto;
    const customerCost = this.money(variantCount * (rule.customerUnitPriceUsd / rule.unitSize));
    const providerCost = this.money(variantCount * (rule.unitCostUsd / rule.unitSize));
    const usage = [
      this.usageSnapshot(state, workspace, "generated_variants", variantCount),
      this.usageSnapshot(state, workspace, "ai_customer_spend_usd", customerCost),
      this.usageSnapshot(state, workspace, "ai_provider_cost_usd", providerCost)
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

  async confirmBatchCost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
    priceVersion: string;
    actorId: string;
    requestId: string;
  }): Promise<{ batch: BatchSummary; variantCount: number; customerCostUsd: number; providerCostUsd: number; priceVersion: string }> {
    const state = await this.load();
    this.assertWorkspaceBillingAllows(state, input.workspaceId, "costly");
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
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
    const existingReservation = state.costLedger.find(
      (entry) =>
        entry.workspaceId === input.workspaceId &&
        entry.batchId === input.batchId &&
        entry.entryType === "reservation" &&
        entry.operation === "generated_variant" &&
        entry.priceVersion === input.priceVersion
    );
    const timestamp = now();
    if (!existingReservation) {
      this.reserveUsage(state, input.workspaceId, "generated_variants", estimate.variantCount);
      this.reserveUsage(state, input.workspaceId, "ai_customer_spend_usd", estimate.estimatedCostUsd);
      this.reserveUsage(state, input.workspaceId, "ai_provider_cost_usd", estimate.estimatedProviderCostUsd);
      state.costLedger.push({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        batchId: input.batchId,
        operation: "generated_variant",
        operationKey: `batch_generation:${input.batchId}:${input.priceVersion}`,
        entryType: "reservation",
        usageMetric: "generated_variants",
        quantity: estimate.variantCount,
        priceVersion: input.priceVersion,
        customerCostUsd: estimate.estimatedCostUsd,
        providerCostUsd: estimate.estimatedProviderCostUsd,
        status: "reserved",
        createdAt: timestamp
      });
    }
    batch.status = "confirmado";
    batch.estimatedCostUsd = estimate.estimatedCostUsd;
    batch.estimatedProviderCostUsd = estimate.estimatedProviderCostUsd;
    batch.confirmedCostUsd = estimate.estimatedCostUsd;
    batch.confirmedPriceVersion = input.priceVersion;
    batch.confirmedCostBreakdown = {
      schemaVersion: "cost_breakdown.v1",
      breakdown: estimate.breakdown,
      providerCostUsd: estimate.estimatedProviderCostUsd
    };
    batch.variantsPerPhoto = input.variantsPerPhoto;
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    await this.createOutboxEvent({
      eventType: "costo_confirmado",
      aggregateType: "batch",
      aggregateId: batch.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: {
        actorId: input.actorId,
        requestId: input.requestId,
        priceVersion: input.priceVersion,
        variantCount: estimate.variantCount
      }
    });
    await this.persist();
    return {
      batch,
      variantCount: estimate.variantCount,
      customerCostUsd: estimate.estimatedCostUsd,
      providerCostUsd: estimate.estimatedProviderCostUsd,
      priceVersion: input.priceVersion
    };
  }

  async recordAiRun(input: Omit<AiRun, "id" | "createdAt">): Promise<AiRun> {
    const state = await this.load();
    const run: AiRun = {
      id: randomUUID(),
      createdAt: now(),
      ...input
    };
    state.aiRuns.push(run);
    await this.persist();
    return run;
  }

  async listAiRuns(input: { workspaceId: string; jobId?: string }): Promise<AiRun[]> {
    const state = await this.load();
    return state.aiRuns.filter(
      (run) => run.workspaceId === input.workspaceId && (input.jobId === undefined || run.jobId === input.jobId)
    );
  }

  async listVariants(input: { workspaceId: string; businessId: string; batchId: string }): Promise<Variant[]> {
    const state = await this.load();
    this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    return state.variants
      .filter(
        (variant) =>
          variant.workspaceId === input.workspaceId &&
          variant.businessId === input.businessId &&
          variant.batchId === input.batchId &&
          variant.status !== "eliminada"
      )
      .sort((a, b) => a.photoId.localeCompare(b.photoId) || a.variantIndex - b.variantIndex);
  }

  async requestGenerateBatch(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob; created: number; available: number; variants: Variant[] }> {
    const state = await this.load();
    this.assertWorkspaceBillingAllows(state, input.workspaceId, "publish");
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
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
      !this.hasReservation(state, input.workspaceId, input.batchId, batch.confirmedPriceVersion)
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
    const validPhotos = this.validPhotosForGeneration(state, input.workspaceId, input.businessId, input.batchId);
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
    const timestamp = now();
    const job = await this.createJob({
      type: "generate_batch",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      batchId: input.batchId,
      dedupeKey: `generate_batch:${input.batchId}:${input.variantsPerPhoto}`,
      payload: {
        batchId: input.batchId,
        variantsPerPhoto: input.variantsPerPhoto,
        requestId: input.requestId
      }
    });
    let created = 0;
    let available = 0;
    const touched: Variant[] = [];
    for (const photo of validPhotos) {
      for (let index = 1; index <= input.variantsPerPhoto; index += 1) {
        let variant = state.variants.find(
          (item) =>
            item.workspaceId === input.workspaceId &&
            item.businessId === input.businessId &&
            item.batchId === input.batchId &&
            item.photoId === photo.id &&
            item.variantIndex === index &&
            item.status !== "eliminada"
        );
        if (!variant) {
          variant = {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            businessId: input.businessId,
            batchId: input.batchId,
            photoId: photo.id,
            variantIndex: index,
            status: "generando",
            createdAt: timestamp,
            updatedAt: timestamp
          };
          state.variants.push(variant);
          created += 1;
        } else {
          available += 1;
        }
        touched.push(variant);
        await this.createJob({
          type: "generate_variant",
          workspaceId: input.workspaceId,
          businessId: input.businessId,
          batchId: input.batchId,
          photoId: photo.id,
          variantId: variant.id,
          dedupeKey: `generate_variant:${variant.id}`,
          payload: {
            batchId: input.batchId,
            photoId: photo.id,
            variantId: variant.id,
            variantIndex: index,
            requestId: input.requestId
          }
        });
      }
    }
    batch.status = "generando";
    batch.variantsCount = state.variants.filter((variant) => variant.batchId === batch.id && variant.status !== "eliminada").length;
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    await this.createOutboxEvent({
      eventType: "generacion_solicitada",
      aggregateType: "batch",
      aggregateId: batch.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId, variantsPerPhoto: input.variantsPerPhoto, created, available }
    });
    await this.persist();
    return { job, created, available, variants: touched };
  }

  async completeGenerateBatch(input: { jobId: string; batchId: string }): Promise<{ batch: BatchSummary; variants: Variant[] }> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const batch = state.batches.find((item) => item.id === input.batchId && item.workspaceId === job.workspaceId);
    if (!batch) throw new Error(`Batch not found: ${input.batchId}`);
    const variants = state.variants.filter((variant) => variant.batchId === batch.id && variant.workspaceId === batch.workspaceId);
    const timestamp = now();
    batch.variantsCount = variants.filter((variant) => variant.status !== "eliminada").length;
    batch.status = variants.some((variant) => variant.status === "generada" || variant.status === "aprobada")
      ? "generado_parcial"
      : "generando";
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    await this.persist();
    return { batch, variants };
  }

  async getVariantCaptionContext(input: Parameters<DataStore["getVariantCaptionContext"]>[0]): ReturnType<DataStore["getVariantCaptionContext"]> {
    const state = await this.load();
    const variant = this.requireVariant(state, input.workspaceId, input.businessId, input.batchId, input.variantId);
    const photo = state.photos.find(
      (item) =>
        item.id === variant.photoId &&
        item.workspaceId === input.workspaceId &&
        item.businessId === input.businessId &&
        item.batchId === input.batchId
    );
    if (!photo?.visionAnalysis) return null;
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const page = business.facebookPageId
      ? state.pages.find((item) => item.id === business.facebookPageId && item.workspaceId === input.workspaceId)
      : null;
    return {
      variant,
      photo: photo as Photo & { visionAnalysis: VisionAnalysis },
      business,
      page: page ? publicMetaPage(page) : null,
      style: this.assignStyle(variant.variantIndex),
      promptVersion: "caption-page-context-v1"
    };
  }

  async completeGenerateVariant(input: Parameters<DataStore["completeGenerateVariant"]>[0]): Promise<Variant> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const variant = this.requireVariant(state, job.workspaceId, job.businessId, job.batchId, input.variantId);
    if (variant.generatedAssetId && variant.caption && ["generada", "aprobada", "rechazada"].includes(variant.status)) {
      return variant;
    }
    const photo = state.photos.find((item) => item.id === variant.photoId && item.workspaceId === variant.workspaceId);
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
    const style = this.assignStyle(variant.variantIndex);
    const promptVersion = "generation-plan-v1";
    const timestamp = now();
    const plan = {
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
    const quality = {
      schemaVersion: "ai_quality_check.v1" as const,
      status: "pass" as const,
      score: 0.92,
      warnings: [],
      blockingReasons: [],
      requiresHumanReview: false
    };
    const business = state.businesses.find((item) => item.id === variant.businessId && item.workspaceId === variant.workspaceId);
    const page = business?.facebookPageId
      ? state.pages.find((item) => item.id === business.facebookPageId && item.workspaceId === variant.workspaceId)
      : null;
    const fallbackCaptionResult = this.captionForVariant({
      fileName: photo.fileName ?? "foto",
      variantIndex: variant.variantIndex,
      styleName: style.styleName,
      businessName: business?.name ?? "tu negocio",
      pageName: page?.pageName ?? business?.name ?? "tu pagina",
      category: page?.category ?? String(business?.metadata.category ?? "Facebook Page"),
      visionAnalysis: photo.visionAnalysis as VisionAnalysis
    });
    const captionResult = input.captionResult ?? fallbackCaptionResult;
    const caption = captionResult.caption;
    const asset: MediaAsset = {
      id: randomUUID(),
      workspaceId: variant.workspaceId,
      businessId: variant.businessId,
      batchId: variant.batchId,
      photoId: variant.photoId,
      variantId: variant.id,
      kind: "generated",
      bucket: MEDIA_BUCKET,
      storageKey: `${variant.workspaceId}/${variant.businessId}/${variant.batchId}/generated/${variant.id}.jpg`,
      mimeType: "image/jpeg",
      fileSize: 0,
      isPublic: false,
      createdAt: timestamp
    };
    state.mediaAssets.push(asset);
    variant.styleId = style.styleId;
    variant.assignedStyle = style;
    variant.generationPlan = plan;
    variant.qualityCheck = quality;
    variant.captionResult = captionResult;
    variant.modelProfileId = "image-generation-local-v1";
    variant.promptTemplateId = "photo-variant-generation";
    variant.promptVersion = promptVersion;
    if (input.captionAiRunId !== undefined) variant.aiRunId = input.captionAiRunId;
    variant.qualityCheckId = `quality:${variant.id}`;
    variant.qualityStatus = quality.status;
    variant.qualityScore = quality.score;
    variant.qualityWarnings = quality.warnings;
    variant.generatedAssetId = asset.id;
    variant.caption = caption;
    variant.status = "generada";
    variant.updatedAt = timestamp;
    const batch = state.batches.find((item) => item.id === variant.batchId && item.workspaceId === variant.workspaceId);
    if (batch) {
      batch.status = "generado_parcial";
      batch.variantsCount = state.variants.filter((item) => item.batchId === batch.id && item.status !== "eliminada").length;
      batch.lastActivityAt = timestamp;
      batch.updatedAt = timestamp;
    }
    this.consumeVariantReservation(state, variant, input.jobId, asset.id);
    await this.createOutboxEvent({
      eventType: "variante_generada",
      aggregateType: "variant",
      aggregateId: variant.id,
      workspaceId: variant.workspaceId,
      businessId: variant.businessId,
      payload: { batchId: variant.batchId, photoId: variant.photoId, jobId: input.jobId }
    });
    await this.persist();
    return variant;
  }

  async confirmCalendar(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    periodDays: 7 | 14 | 30;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPosts: ScheduledPost[]; job: StoredJob }> {
    const state = await this.load();
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    const approved = state.variants
      .filter(
        (variant) =>
          variant.workspaceId === input.workspaceId &&
          variant.businessId === input.businessId &&
          variant.batchId === input.batchId &&
          variant.status === "aprobada" &&
          !state.scheduledPosts.some((post) => post.variantId === variant.id && post.status !== "cancelada")
      )
      .sort((a, b) => (a.styleId ?? "").localeCompare(b.styleId ?? "") || a.updatedAt.localeCompare(b.updatedAt));
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
    const timestamp = now();
    const job = await this.createJob({
      type: "schedule_posts",
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      batchId: input.batchId,
      dedupeKey: `schedule_posts:${input.batchId}:${input.periodDays}`,
      payload: { batchId: input.batchId, periodDays: input.periodDays, requestId: input.requestId }
    });
    const scheduledPosts: ScheduledPost[] = [];
    approved.forEach((variant, index) => {
      const existing = state.scheduledPosts.find((post) => post.variantId === variant.id && post.status !== "cancelada");
      if (existing) {
        scheduledPosts.push(existing);
        return;
      }
      const scheduledFor = this.scheduledFor(index, input.periodDays);
      const post: ScheduledPost = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        batchId: input.batchId,
        variantId: variant.id,
        pageId: this.requireBusiness(state, input.workspaceId, input.businessId).facebookPageId,
        scheduledFor,
        facebookPostId: null,
        remotePostType: null,
        remotePostUrl: null,
        deliveryMode: "local_due_publish",
        graphApiVersion: "v23.0",
        publishLeadSeconds: 0,
        scheduledForUnix: Math.floor(new Date(scheduledFor).getTime() / 1000),
        status: "programada",
        remoteStatus: "no_enviado",
        retryCount: 0,
        lastRemoteSyncAt: null,
        remoteErrorCode: null,
        remoteTraceId: null,
        caption: variant.caption ?? "",
        imageUrl: null,
        styleId: variant.styleId ?? null,
        styleName: variant.assignedStyle?.styleName ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.scheduledPosts.push(post);
      variant.status = "programada";
      variant.updatedAt = timestamp;
      scheduledPosts.push(post);
    });
    batch.status = "completado";
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    await this.createOutboxEvent({
      eventType: "calendario_confirmado",
      aggregateType: "batch",
      aggregateId: batch.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId, scheduledPostIds: scheduledPosts.map((post) => post.id) }
    });
    await this.persist();
    return { scheduledPosts, job };
  }

  async listScheduledPosts(input: {
    workspaceId: string;
    businessId: string;
    batchId?: string;
    from?: string;
    to?: string;
  }): Promise<ScheduledPost[]> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    return state.scheduledPosts
      .filter(
        (post) =>
          post.workspaceId === input.workspaceId &&
          post.businessId === input.businessId &&
          (input.batchId === undefined || post.batchId === input.batchId) &&
          (input.from === undefined || post.scheduledFor >= input.from) &&
          (input.to === undefined || post.scheduledFor <= input.to)
      )
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  async getScheduledPost(input: { workspaceId: string; businessId: string; scheduledPostId: string }) {
    const state = await this.load();
    return (
      state.scheduledPosts.find(
        (post) => post.workspaceId === input.workspaceId && post.businessId === input.businessId && post.id === input.scheduledPostId
      ) ?? null
    );
  }

  async completeSchedulePosts(input: { jobId: string; batchId: string }): Promise<{ scheduledPosts: ScheduledPost[] }> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const scheduledPosts = state.scheduledPosts.filter((post) => post.workspaceId === job.workspaceId && post.batchId === input.batchId);
    for (const post of scheduledPosts) {
      const existingPublishJob = state.jobs.find(
        (item) => item.type === "publish_post" && item.dedupeKey === `publish_post:${post.id}` && item.status !== "cancelled"
      );
      if (!existingPublishJob && post.status === "programada" && post.remoteStatus === "no_enviado") {
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
    await this.persist();
    return { scheduledPosts };
  }

  async publishScheduledPost(input: { jobId: string; scheduledPostId: string; publishNow?: boolean }): Promise<ScheduledPost> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const post = this.requireScheduledPost(state, job.workspaceId, job.businessId, job.batchId, input.scheduledPostId);
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
    const variant = state.variants.find((item) => item.id === post.variantId);
    if (!variant?.publishableAssetId) {
      post.status = "fallida";
      post.remoteErrorCode = "missing_publishable_media";
      post.updatedAt = now();
      await this.persist();
      return post;
    }
    const asset = state.mediaAssets.find((item) => item.id === variant.publishableAssetId && item.kind === "publishable");
    if (!asset?.isPublic) {
      post.status = "fallida";
      post.remoteErrorCode = "media_not_publicable";
      post.updatedAt = now();
      await this.persist();
      return post;
    }
    const timestamp = now();
    post.status = "publicacion_en_proceso";
    post.updatedAt = timestamp;
    const operationKey = `meta_publish:${post.id}`;
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "publish_post",
      status: "started"
    });
    const page = state.pages.find((item) => item.id === post.pageId && item.workspaceId === post.workspaceId);
    const pageAccessToken = decodeServerToken(page?.encryptedPageAccessToken);
    if (pageAccessToken && page?.metaPageId && !page.metaPageId.startsWith("mock-")) {
      try {
        const publishImageUrl = publicMediaUrl(asset.id) ?? (post.imageUrl && /^https:\/\//i.test(post.imageUrl) ? post.imageUrl : null);
        const publishResult = await publishFacebookPagePost({
          graphApiVersion: post.graphApiVersion ?? process.env.META_GRAPH_API_VERSION ?? "v23.0",
          pageId: page.metaPageId,
          pageAccessToken,
          caption: post.caption ?? "",
          imageUrl: publishImageUrl
        });
        post.facebookPostId = publishResult.facebookPostId;
        post.remotePostType = publishResult.remotePostType;
        post.remotePostUrl = publishResult.remotePostUrl;
        if (publishResult.providerTraceId) post.remoteTraceId = publishResult.providerTraceId;
      } catch (error) {
        post.status = "fallida";
        post.remoteStatus = "incierto";
        post.remoteErrorCode = error instanceof AppError ? error.code : "meta_publish_failed";
        post.updatedAt = now();
        await this.upsertExternalOperation({
          operationKey,
          workspaceId: post.workspaceId,
          jobId: job.id,
          provider: "meta",
          operation: "publish_post",
          status: "failed"
        });
        await this.persist();
        throw error;
      }
    } else {
      post.facebookPostId = `mock_${post.pageId}_${post.id}`;
      post.remotePostType = "photo";
      post.remotePostUrl = `https://facebook.example/posts/${post.facebookPostId}`;
    }
    post.deliveryMode = input.publishNow ? "publish_now" : post.deliveryMode;
    post.remoteStatus = "confirmado_meta";
    post.status = "publicada";
    post.lastRemoteSyncAt = timestamp;
    post.imageUrl = `local://public/${asset.bucket}/${asset.storageKey}`;
    post.updatedAt = timestamp;
    variant.status = "publicada";
    variant.updatedAt = timestamp;
    post.retryCount += input.publishNow ? 0 : 1;
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
      payload: { facebookPostId: post.facebookPostId, jobId: job.id }
    });
    await this.persist();
    return post;
  }

  async updateScheduledPost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    scheduledPostId: string;
    scheduledFor: string;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPost: ScheduledPost; job?: StoredJob }> {
    const state = await this.load();
    this.assertWorkspaceBillingAllows(state, input.workspaceId, "publish");
    const post = this.requireScheduledPost(state, input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.status === "publicada" || post.status === "cancelada") throw this.scheduledPostStateError("scheduled_post_not_editable");
    if (post.remoteStatus !== "no_enviado") {
      post.status = "estado_incierto";
      post.remoteStatus = "incierto";
      post.updatedAt = now();
      await this.persist();
      return { scheduledPost: post };
    }
    post.scheduledFor = input.scheduledFor;
    post.scheduledForUnix = Math.floor(new Date(input.scheduledFor).getTime() / 1000);
    post.status = "programada";
    post.updatedAt = now();
    const job = await this.createJob({
      type: "publish_post",
      workspaceId: post.workspaceId,
      businessId: post.businessId,
      batchId: post.batchId,
      variantId: post.variantId,
      dedupeKey: `publish_post:${post.id}:${post.scheduledFor}`,
      runAfter: post.scheduledFor,
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
    await this.persist();
    return { scheduledPost: post, job };
  }

  async cancelScheduledPost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    scheduledPostId: string;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPost: ScheduledPost; job?: StoredJob }> {
    const state = await this.load();
    const post = this.requireScheduledPost(state, input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.status === "publicada") throw this.scheduledPostStateError("scheduled_post_already_published");
    if (post.remoteStatus !== "no_enviado" || post.facebookPostId) {
      post.status = "estado_incierto";
      post.remoteStatus = "cancelacion_pendiente";
      post.updatedAt = now();
      const job = await this.createJob({
        type: "cancel_remote_post",
        workspaceId: post.workspaceId,
        businessId: post.businessId,
        batchId: post.batchId,
        variantId: post.variantId,
        dedupeKey: `cancel_remote_post:${post.id}:${post.facebookPostId ?? "unknown"}`,
        payload: { scheduledPostId: post.id }
      });
      await this.persist();
      return { scheduledPost: post, job };
    }
    post.status = "cancelada";
    post.updatedAt = now();
    const variant = state.variants.find((item) => item.id === post.variantId);
    if (variant?.status === "programada") {
      variant.status = "aprobada";
      variant.updatedAt = post.updatedAt;
    }
    await this.createOutboxEvent({
      eventType: "post_cancelado",
      aggregateType: "scheduled_post",
      aggregateId: post.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return { scheduledPost: post };
  }

  async publishScheduledPostNow(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    scheduledPostId: string;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPost: ScheduledPost; job: StoredJob }> {
    const state = await this.load();
    const post = this.requireScheduledPost(state, input.workspaceId, input.businessId, input.batchId, input.scheduledPostId);
    if (post.facebookPostId || post.status === "publicada" || post.status === "estado_incierto") {
      throw this.scheduledPostStateError("scheduled_post_not_publishable");
    }
    post.deliveryMode = "publish_now";
    post.scheduledFor = now();
    post.scheduledForUnix = Math.floor(Date.now() / 1000);
    post.updatedAt = post.scheduledFor;
    const job = await this.createJob({
      type: "publish_post",
      workspaceId: post.workspaceId,
      businessId: post.businessId,
      batchId: post.batchId,
      variantId: post.variantId,
      dedupeKey: `publish_post_now:${post.id}`,
      runAfter: post.scheduledFor,
      payload: { scheduledPostId: post.id, deliveryMode: "publish_now", requestId: input.requestId }
    });
    await this.persist();
    return { scheduledPost: post, job };
  }

  async updateVariantCaption(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
    caption: string;
    actorId: string;
    requestId: string;
  }): Promise<Variant> {
    const state = await this.load();
    const variant = this.requireVariant(state, input.workspaceId, input.businessId, input.batchId, input.variantId);
    if (!["generada", "aprobada"].includes(variant.status)) {
      throw this.variantStateError("variant_caption_not_editable", "Solo puedes editar captions de variantes generadas o aprobadas.");
    }
    variant.caption = input.caption;
    variant.updatedAt = now();
    await this.createOutboxEvent({
      eventType: "caption_editado_por_usuario",
      aggregateType: "variant",
      aggregateId: variant.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { batchId: input.batchId, actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return variant;
  }

  async approveVariant(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
    actorId: string;
    requestId: string;
  }): Promise<Variant> {
    const state = await this.load();
    const variant = this.requireVariant(state, input.workspaceId, input.businessId, input.batchId, input.variantId);
    if (variant.status !== "generada" && variant.status !== "aprobada") {
      throw this.variantStateError("variant_not_approvable", "Solo puedes aprobar una variante generada.");
    }
    if (variant.qualityStatus === "block") {
      throw this.variantStateError("variant_blocked_by_quality", "Esta variante fue bloqueada por calidad y no puede aprobarse.");
    }
    const timestamp = now();
    if (variant.generatedAssetId && !variant.publishableAssetId) {
      const generated = state.mediaAssets.find((asset) => asset.id === variant.generatedAssetId);
      const publishable: MediaAsset = {
        id: randomUUID(),
        workspaceId: variant.workspaceId,
        businessId: variant.businessId,
        batchId: variant.batchId,
        photoId: variant.photoId,
        variantId: variant.id,
        kind: "publishable",
        bucket: MEDIA_BUCKET,
        storageKey: `${variant.workspaceId}/${variant.businessId}/${variant.batchId}/publishable/${variant.id}.jpg`,
        mimeType: generated?.mimeType ?? "image/jpeg",
        fileSize: generated?.fileSize ?? 0,
        isPublic: true,
        createdAt: timestamp
      };
      state.mediaAssets.push(publishable);
      variant.publishableAssetId = publishable.id;
    }
    variant.status = "aprobada";
    variant.updatedAt = timestamp;
    await this.createOutboxEvent({
      eventType: "variante_aprobada",
      aggregateType: "variant",
      aggregateId: variant.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { batchId: input.batchId, actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return variant;
  }

  async rejectVariant(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
    actorId: string;
    requestId: string;
  }): Promise<Variant> {
    const state = await this.load();
    const variant = this.requireVariant(state, input.workspaceId, input.businessId, input.batchId, input.variantId);
    if (!["generada", "aprobada", "rechazada"].includes(variant.status)) {
      throw this.variantStateError("variant_not_rejectable", "Solo puedes rechazar una variante generada.");
    }
    variant.status = "rechazada";
    variant.updatedAt = now();
    await this.createOutboxEvent({
      eventType: "variante_rechazada",
      aggregateType: "variant",
      aggregateId: variant.id,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      payload: { batchId: input.batchId, actorId: input.actorId, requestId: input.requestId }
    });
    await this.persist();
    return variant;
  }

  async getIdempotencyRecord(input: {
    workspaceId: string;
    actorId: string;
    method: string;
    routeKey: string;
    idempotencyKey: string;
  }): Promise<IdempotencyRecord | null> {
    const state = await this.load();
    return (
      state.idempotencyRecords.find(
        (record) =>
          record.workspaceId === input.workspaceId &&
          record.actorId === input.actorId &&
          record.method === input.method &&
          record.routeKey === input.routeKey &&
          record.idempotencyKey === input.idempotencyKey
      ) ?? null
    );
  }

  async saveIdempotencyRecord(input: {
    workspaceId: string;
    actorId: string;
    method: string;
    routeKey: string;
    idempotencyKey: string;
    requestHash: string;
    response: unknown;
  }): Promise<IdempotencyRecord> {
    const state = await this.load();
    const timestamp = now();
    const existing = await this.getIdempotencyRecord(input);
    if (existing) {
      existing.response = input.response;
      existing.status = "completed";
      await this.persist();
      return existing;
    }
    const record: IdempotencyRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      method: input.method,
      routeKey: input.routeKey,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      response: input.response,
      status: "completed",
      createdAt: timestamp,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
    state.idempotencyRecords.push(record);
    await this.persist();
    return record;
  }

  async createOutboxEvent(input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    workspaceId: string;
    businessId?: string;
    payload?: Record<string, unknown>;
  }): Promise<OutboxEvent> {
    const state = await this.load();
    const timestamp = now();
    const event: OutboxEvent = {
      id: randomUUID(),
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      workspaceId: input.workspaceId,
      payload: input.payload ?? {},
      status: "pending",
      availableAt: timestamp,
      attempts: 0,
      createdAt: timestamp
    };
    if (input.businessId !== undefined) event.businessId = input.businessId;
    state.outboxEvents.push(event);
    await this.persist();
    return event;
  }

  async listOutboxEvents(workspaceId: string): Promise<OutboxEvent[]> {
    const state = await this.load();
    return state.outboxEvents.filter((event) => event.workspaceId === workspaceId);
  }

  async upsertExternalOperation(input: {
    operationKey: string;
    workspaceId: string;
    jobId?: string;
    provider: string;
    operation: string;
    status: ExternalOperation["status"];
  }): Promise<ExternalOperation> {
    const state = await this.load();
    const timestamp = now();
    let operation = state.externalOperations.find((item) => item.operationKey === input.operationKey);
    if (!operation) {
      operation = {
        operationKey: input.operationKey,
        workspaceId: input.workspaceId,
        provider: input.provider,
        operation: input.operation,
        status: input.status,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      if (input.jobId !== undefined) operation.jobId = input.jobId;
      state.externalOperations.push(operation);
    } else {
      operation.status = input.status;
      operation.updatedAt = timestamp;
    }
    await this.persist();
    return operation;
  }

  private requireBusiness(state: LocalState, workspaceId: string, businessId: string) {
    const business = state.businesses.find((item) => item.workspaceId === workspaceId && item.id === businessId);
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

  private metricDefinition(state: LocalState, provider: MetricDefinition["provider"], canonicalMetric: MetricDefinition["canonicalMetric"]) {
    const definition = state.metricDefinitions.find(
      (item) => item.provider === provider && item.canonicalMetric === canonicalMetric && item.status === "active"
    );
    if (!definition) throw new Error(`Metric definition not found: ${provider}:${canonicalMetric}`);
    return definition;
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

  private hasBudgetPressure(state: LocalState, workspaceId: string) {
    return state.usageMeters.some(
      (meter) =>
        meter.workspaceId === workspaceId &&
        meter.limitValue !== undefined &&
        this.money(meter.usedValue + meter.reservedValue) >= meter.limitValue
    );
  }

  private hasSensitivePublishRisk(state: LocalState, workspaceId: string, businessId: string) {
    const riskyPhotoIds = new Set(
      state.photos
        .filter((photo) => {
          const sensitive = photo.visionAnalysis?.sensitiveElements as
            | { personVisible?: boolean; priceVisible?: boolean; promotionVisible?: boolean }
            | undefined;
          return (
            photo.workspaceId === workspaceId &&
            photo.businessId === businessId &&
            Boolean(sensitive?.personVisible || sensitive?.priceVisible || sensitive?.promotionVisible)
          );
        })
        .map((photo) => photo.id)
    );
    if (riskyPhotoIds.size === 0) return false;
    return state.variants.some(
      (variant) =>
        variant.workspaceId === workspaceId &&
        variant.businessId === businessId &&
        riskyPhotoIds.has(variant.photoId) &&
        ["aprobada", "programada", "publicada"].includes(variant.status)
    );
  }

  private recalculatePerformanceSummaries(
    state: LocalState,
    workspaceId: string,
    businessId: string,
    periodStart: string,
    periodEnd: string,
    generatedAt: string
  ): PerformanceSummary[] {
    const published = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === workspaceId &&
        post.businessId === businessId &&
        post.status === "publicada" &&
        post.scheduledFor >= periodStart &&
        post.scheduledFor <= periodEnd
    );
    const failed = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === workspaceId &&
        post.businessId === businessId &&
        ["fallida", "estado_incierto"].includes(post.status) &&
        post.scheduledFor >= periodStart &&
        post.scheduledFor <= periodEnd
    );
    const scheduled = state.scheduledPosts.filter(
      (post) =>
        post.workspaceId === workspaceId &&
        post.businessId === businessId &&
        post.scheduledFor >= periodStart &&
        post.scheduledFor <= periodEnd
    );
    const sampleSize = published.length;
    const confidence = this.confidenceForSample(sampleSize);
    const reasonCodes = [
      ...(sampleSize < 20 ? ["sample_size_low"] : []),
      ...state.metricDefinitions.some((definition) => definition.provider === "meta" && definition.status !== "active")
        ? ["meta_insights_unavailable"]
        : []
    ];
    const businessSummary: PerformanceSummary = {
      id: randomUUID(),
      workspaceId,
      businessId,
      scope: "business_week",
      scopeKey: periodStart.slice(0, 10),
      periodStart,
      periodEnd,
      sampleSize,
      metrics: {
        publish_success: published.length,
        publish_failure: failed.length,
        week_coverage: Math.min(1, scheduled.length / 7)
      },
      confidence,
      reasonCodes,
      generatedAt
    };
    const byStyle = new Map<string, { label: string; published: number; scheduled: number }>();
    for (const post of scheduled) {
      const key = post.styleId ?? "sin_estilo";
      const entry = byStyle.get(key) ?? { label: post.styleName ?? key, published: 0, scheduled: 0 };
      entry.scheduled += 1;
      if (post.status === "publicada") entry.published += 1;
      byStyle.set(key, entry);
    }
    const styleSummaries = [...byStyle.entries()].map(([styleId, entry]) => ({
      id: randomUUID(),
      workspaceId,
      businessId,
      scope: "style" as const,
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
      reasonCodes: entry.published < 20 ? ["sample_size_low", "style_label:" + entry.label] : ["style_label:" + entry.label],
      generatedAt
    }));
    const summaries = [businessSummary, ...styleSummaries];
    state.performanceSummaries = state.performanceSummaries.filter(
      (summary) =>
        !(
          summary.workspaceId === workspaceId &&
          summary.businessId === businessId &&
          summary.periodStart === periodStart &&
          summary.periodEnd === periodEnd
        )
    );
    state.performanceSummaries.push(...summaries);
    return summaries;
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

  private requireBatch(state: LocalState, workspaceId: string, businessId: string, batchId: string) {
    const batch = state.batches.find(
      (item) => item.workspaceId === workspaceId && item.businessId === businessId && item.id === batchId
    );
    if (!batch) {
      throw new AppError({
        code: "batch_not_found",
        statusCode: 404,
        message: "Batch not found in business",
        userMessage: "No encontramos ese lote.",
        retryable: false,
        action: "refresh"
      });
    }
    return batch;
  }

  private requireWorkspace(state: LocalState, workspaceId: string) {
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
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
    return workspace;
  }

  private assertWorkspaceBillingAllows(state: LocalState, workspaceId: string, action: "costly" | "publish") {
    const workspace = this.requireWorkspace(state, workspaceId);
    if (!["trial", "active"].includes(workspace.billingStatus)) {
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

  private activePricingRule(state: LocalState) {
    const timestamp = now();
    const rule = state.pricingRules
      .filter(
        (item) =>
          item.active &&
          item.operation === "generated_variant" &&
          item.effectiveFrom <= timestamp &&
          (item.effectiveTo === undefined || item.effectiveTo > timestamp)
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (!rule) {
      throw new AppError({
        code: "pricing_rule_missing",
        statusCode: 503,
        message: "No active pricing rule for generated variants",
        userMessage: "No pudimos calcular el costo en este momento.",
        retryable: true,
        action: "retry"
      });
    }
    return rule;
  }

  private validPhotosForGeneration(state: LocalState, workspaceId: string, businessId: string, batchId: string) {
    return state.photos.filter(
      (photo) =>
        photo.workspaceId === workspaceId &&
        photo.businessId === businessId &&
        photo.batchId === batchId &&
        photo.status === "validada" &&
        photo.visionAnalysis
    );
  }

  private usageSnapshot(
    state: LocalState,
    workspace: Workspace,
    metric: UsageMeter["metric"],
    requestedValue: number
  ): { metric: UsageMeter["metric"]; limitValue?: number | null; usedValue: number; reservedValue: number; availableValue?: number | null } {
    const meter = this.ensureUsageMeter(state, workspace.id, metric, this.entitlementLimit(workspace, metric));
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

  private ensureUsageMeter(state: LocalState, workspaceId: string, metric: UsageMeter["metric"], limitValue?: number) {
    const periodStart = this.currentPeriodStart();
    let meter = state.usageMeters.find(
      (item) => item.workspaceId === workspaceId && item.metric === metric && item.periodStart === periodStart
    );
    if (!meter) {
      meter = {
        id: randomUUID(),
        workspaceId,
        metric,
        periodStart,
        periodEnd: this.currentPeriodEnd(),
        reservedValue: 0,
        usedValue: 0,
        updatedAt: now()
      };
      if (limitValue !== undefined) meter.limitValue = limitValue;
      state.usageMeters.push(meter);
    } else if (limitValue !== undefined) {
      meter.limitValue = limitValue;
    }
    return meter;
  }

  private reserveUsage(state: LocalState, workspaceId: string, metric: UsageMeter["metric"], value: number) {
    const workspace = this.requireWorkspace(state, workspaceId);
    const meter = this.ensureUsageMeter(state, workspaceId, metric, this.entitlementLimit(workspace, metric));
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
    meter.reservedValue = nextReserved;
    meter.updatedAt = now();
  }

  private consumeUsage(state: LocalState, workspaceId: string, metric: UsageMeter["metric"], value: number) {
    const workspace = this.requireWorkspace(state, workspaceId);
    const meter = this.ensureUsageMeter(state, workspaceId, metric, this.entitlementLimit(workspace, metric));
    meter.reservedValue = Math.max(0, this.money(meter.reservedValue - value));
    meter.usedValue = this.money(meter.usedValue + value);
    meter.updatedAt = now();
  }

  private hasReservation(state: LocalState, workspaceId: string, batchId: string, priceVersion: string) {
    return state.costLedger.some(
      (entry) =>
        entry.workspaceId === workspaceId &&
        entry.batchId === batchId &&
        entry.priceVersion === priceVersion &&
        entry.entryType === "reservation" &&
        entry.status === "reserved"
    );
  }

  private consumeVariantReservation(state: LocalState, variant: Variant, jobId: string, generatedAssetId: string) {
    const batch = state.batches.find((item) => item.id === variant.batchId && item.workspaceId === variant.workspaceId);
    if (!batch?.confirmedPriceVersion) return;
    const operationKey = `openai_image:${variant.id}`;
    const existingActual = state.costLedger.find((entry) => entry.operationKey === operationKey && entry.entryType === "actual");
    if (existingActual) return;
    const rule = state.pricingRules.find((item) => item.priceVersion === batch.confirmedPriceVersion) ?? this.activePricingRule(state);
    const customerCost = this.money(rule.customerUnitPriceUsd / rule.unitSize);
    const providerCost = this.money(rule.unitCostUsd / rule.unitSize);
    this.consumeUsage(state, variant.workspaceId, "generated_variants", 1);
    this.consumeUsage(state, variant.workspaceId, "ai_customer_spend_usd", customerCost);
    this.consumeUsage(state, variant.workspaceId, "ai_provider_cost_usd", providerCost);
    state.costLedger.push({
      id: randomUUID(),
      workspaceId: variant.workspaceId,
      businessId: variant.businessId,
      batchId: variant.batchId,
      jobId,
      variantId: variant.id,
      operation: "generated_variant",
      operationKey,
      entryType: "actual",
      usageMetric: "generated_variants",
      quantity: 1,
      priceVersion: rule.priceVersion,
      customerCostUsd: customerCost,
      providerCostUsd: providerCost,
      status: "used",
      createdAt: now()
    });
    state.costLedger.push({
      id: randomUUID(),
      workspaceId: variant.workspaceId,
      businessId: variant.businessId,
      batchId: variant.batchId,
      jobId,
      variantId: variant.id,
      operation: "generated_asset",
      operationKey: `asset:${generatedAssetId}`,
      entryType: "actual",
      quantity: 1,
      priceVersion: rule.priceVersion,
      customerCostUsd: 0,
      providerCostUsd: 0,
      status: "used",
      createdAt: now()
    });
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

  private requireVariant(
    state: LocalState,
    workspaceId: string,
    businessId: string | undefined,
    batchId: string | undefined,
    variantId: string
  ) {
    const variant = state.variants.find(
      (item) =>
        item.workspaceId === workspaceId &&
        item.id === variantId &&
        (businessId === undefined || item.businessId === businessId) &&
        (batchId === undefined || item.batchId === batchId)
    );
    if (!variant) {
      throw new AppError({
        code: "variant_not_found",
        statusCode: 404,
        message: "Variant not found",
        userMessage: "No encontramos esa variante.",
        retryable: false,
        action: "refresh"
      });
    }
    return variant;
  }

  private requireScheduledPost(
    state: LocalState,
    workspaceId: string,
    businessId: string | undefined,
    batchId: string | undefined,
    scheduledPostId: string
  ) {
    const post = state.scheduledPosts.find(
      (item) =>
        item.workspaceId === workspaceId &&
        item.id === scheduledPostId &&
        (businessId === undefined || item.businessId === businessId) &&
        (batchId === undefined || item.batchId === batchId)
    );
    if (!post) {
      throw new AppError({
        code: "scheduled_post_not_found",
        statusCode: 404,
        message: "Scheduled post not found",
        userMessage: "No encontramos esa publicacion programada.",
        retryable: false,
        action: "refresh"
      });
    }
    return post;
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

  private assignStyle(variantIndex: number): AssignedStyle {
    const styles: AssignedStyle[] = [
      {
        styleId: "luminoso-editorial",
        styleName: "Luminoso editorial",
        intensity: "media" as const,
        contrast: 0.48,
        saturation: 0.34,
        warmth: 0.18,
        sharpness: 0.42,
        lowConfidence: false,
        manualOverride: false
      },
      {
        styleId: "moderno-limpio",
        styleName: "Moderno limpio",
        intensity: "ligera" as const,
        contrast: 0.3,
        saturation: 0.16,
        warmth: 0.04,
        sharpness: 0.36,
        lowConfidence: false,
        manualOverride: false
      },
      {
        styleId: "color-local",
        styleName: "Color local",
        intensity: "fuerte" as const,
        contrast: 0.58,
        saturation: 0.52,
        warmth: 0.26,
        sharpness: 0.45,
        lowConfidence: false,
        manualOverride: false
      }
    ];
    const selected = styles[(variantIndex - 1) % styles.length] ?? styles[0]!;
    return selected;
  }

  private captionForVariant(input: {
    fileName: string;
    variantIndex: number;
    styleName: string;
    businessName: string;
    pageName: string;
    category: string;
    visionAnalysis?: VisionAnalysis | null;
  }): CaptionResult {
    const subject = input.visionAnalysis?.subject.description || input.visionAnalysis?.summary || input.fileName;
    const keywords = input.visionAnalysis?.mood.keywords.slice(0, 3).filter(Boolean) ?? [];
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
    return {
      schemaVersion: "caption.v1",
      promptVersion: "caption-page-context-v1",
      caption:
        `${input.pageName}: ${subject}.\n\n` +
        `Una publicacion pensada para ${input.category}, con estilo ${input.styleName}. ${ending}\n\n` +
        `${hashtags || "#NegocioLocal"}`,
      seoTermsUsed: [input.pageName, input.businessName, input.category, ...keywords].filter(Boolean),
      warnings: ["caption_generado_con_contexto_de_pagina", "no_inventa_precios_ni_promociones"]
    };
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

  private requireJob(state: LocalState, jobId: string) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return job;
  }

  private latestMetaAuthorization(state: LocalState, workspaceId: string) {
    return state.metaAuthorizations
      .filter((authorization) => authorization.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  private async load(): Promise<LocalState> {
    if (this.state) return this.state;
    try {
      const content = await readFile(this.path, "utf8");
      this.state = { ...emptyState(), ...(JSON.parse(content) as Partial<LocalState>) };
    } catch {
      this.state = emptyState();
      await this.persist();
    }
    return this.state;
  }

  private async persist() {
    if (!this.state) return;
    let state = this.state;
    try {
      const content = await readFile(this.path, "utf8");
      const latest = { ...emptyState(), ...(JSON.parse(content) as Partial<LocalState>) };
      Object.assign(this.state, mergeLocalState(latest, this.state));
      state = this.state;
    } catch {
      state = this.state;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2));
  }
}

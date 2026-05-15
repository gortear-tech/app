import {
  Business,
  BusinessAutonomySettings,
  CaptionResult,
  AutonomyEvaluation,
  AiEvaluation,
  BillingAccount,
  BillingProvider,
  BillingProviderEvent,
  BatchSummary,
  CommercialPlan,
  FacebookTokenStatus,
  IdempotencyRecordStatus,
  JobStatus,
  JobType,
  MetaAuthorizationStatus,
  MetaPage,
  MetricDefinition,
  MetricWindow,
  PerformanceSummary,
  Photo,
  PostMetricSnapshot,
  ScheduledPost,
  UploadIntent,
  User,
  Variant,
  AssignedStyle,
  VisionAnalysis,
  WeeklyReport,
  Workspace,
  WorkspaceMember,
  WorkspaceRole
} from "@fbmaniaco/shared";

export type PersistedMetaProviderPage = Omit<MetaPage, "id" | "workspaceId" | "isSelected" | "updatedAt"> & {
  pageAccessToken?: string | null;
};

export type PersistedMetaAuthorizationInput = {
  workspaceId: string;
  actorId: string;
  authorization: {
    status: Exclude<MetaAuthorizationStatus, "none" | "pending" | "expired" | "revoked" | "requires_review">;
    grantedScopes: string[];
    declinedScopes: string[];
    missingRequiredScopes: string[];
    grantedPageIds: string[];
    graphApiVersion: string;
    tokenStatus: FacebookTokenStatus;
    appMode: "development" | "live" | "unknown";
    appReviewStatus: "development" | "review_required" | "approved" | "rejected" | "unknown";
  };
  pages: PersistedMetaProviderPage[];
};

export type StoredJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  workspaceId: string;
  businessId?: string;
  batchId?: string;
  photoId?: string;
  variantId?: string;
  dedupeKey: string;
  operationKey?: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt?: string;
  lockedBy?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type JobAttempt = {
  id: string;
  jobId: string;
  workspaceId: string;
  attemptNumber: number;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export type MetaAuthorization = {
  id: string;
  workspaceId: string;
  actorId: string;
  status: MetaAuthorizationStatus;
  grantedScopes: string[];
  declinedScopes: string[];
  missingRequiredScopes: string[];
  grantedPageIds: string[];
  appMode: "development" | "live" | "unknown";
  appReviewStatus: "development" | "review_required" | "approved" | "rejected" | "unknown";
  graphApiVersion: string;
  tokenStatus: FacebookTokenStatus;
  createdAt: string;
  updatedAt: string;
};

export type IdempotencyRecord = {
  id: string;
  workspaceId: string;
  actorId: string;
  method: string;
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
  response?: unknown;
  status: IdempotencyRecordStatus;
  createdAt: string;
  expiresAt: string;
};

export type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  workspaceId: string;
  businessId?: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "processed" | "failed";
  availableAt: string;
  processedAt?: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
};

export type ExternalOperation = {
  operationKey: string;
  workspaceId: string;
  jobId?: string;
  provider: string;
  operation: string;
  status: "started" | "succeeded" | "failed" | "ambiguous";
  providerRequestId?: string;
  providerResourceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiRun = {
  id: string;
  workspaceId: string;
  businessId?: string;
  jobId: string;
  operationKey: string;
  provider: "openai" | "mock";
  model: string;
  modelProfileId: string;
  promptTemplateId: string;
  promptVersion: string;
  schemaVersion: string;
  inputHash: string;
  outputHash: string;
  responseId?: string;
  usage?: Record<string, unknown>;
  latencyMs: number;
  status: "succeeded" | "failed";
  errorCode?: string;
  requestId?: string;
  createdAt: string;
};

export type MediaAsset = {
  id: string;
  workspaceId: string;
  businessId: string;
  batchId?: string;
  photoId?: string;
  variantId?: string;
  kind: "original" | "thumbnail" | "vision_input" | "generated" | "publishable";
  bucket: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  isPublic: boolean;
  createdAt: string;
};

export type PricingRule = {
  id: string;
  provider: string;
  model: string;
  operation: "vision" | "image_generation" | "caption" | "generated_variant";
  unitType: "token" | "image" | "request" | "post" | "month" | "credit_usd";
  unitSize: number;
  dimensions?: Record<string, unknown>;
  currency: "USD";
  unitCostUsd: number;
  customerUnitPriceUsd: number;
  priceVersion: string;
  effectiveFrom: string;
  effectiveTo?: string;
  active: boolean;
};

export type UsageMeter = {
  id: string;
  workspaceId: string;
  metric: "photo_uploads" | "generated_variants" | "scheduled_posts" | "ai_customer_spend_usd" | "ai_provider_cost_usd";
  periodStart: string;
  periodEnd: string;
  limitValue?: number;
  reservedValue: number;
  usedValue: number;
  updatedAt: string;
};

export type CostLedgerEntry = {
  id: string;
  workspaceId: string;
  businessId?: string;
  batchId?: string;
  jobId?: string;
  variantId?: string;
  operation: string;
  operationKey?: string;
  entryType: "estimate" | "reservation" | "actual" | "release";
  usageMetric?: UsageMeter["metric"];
  quantity: number;
  priceVersion: string;
  customerCostUsd: number;
  providerCostUsd: number;
  status: "estimated" | "reserved" | "used" | "released";
  createdAt: string;
};

export type WorkerHeartbeat = {
  workerId: string;
  service: "worker";
  environment: string;
  release: string;
  status: "alive" | "stopping";
  lastBeatAt: string;
  metadata: Record<string, unknown>;
};

export type VariantCaptionContext = {
  variant: Variant;
  photo: Photo & { visionAnalysis: VisionAnalysis };
  business: Business;
  page: MetaPage | null;
  style: AssignedStyle;
  promptVersion: string;
};

export type DbReadiness = {
  ok: boolean;
  mode: "local" | "supabase";
};

export type DataStore = {
  ready(): Promise<DbReadiness>;
  getUser(userId: string): Promise<User | null>;
  upsertLocalUser(input: { userId: string; email: string; displayName?: string | undefined }): Promise<User>;
  ensureDefaultWorkspace(userId: string): Promise<{ workspace: Workspace; membership: WorkspaceMember }>;
  listMemberships(userId: string): Promise<Array<{ workspace: Workspace; membership: WorkspaceMember }>>;
  assertWorkspaceRole(input: {
    userId: string;
    workspaceId: string;
    allowedRoles: WorkspaceRole[];
  }): Promise<WorkspaceMember>;
  createJob(input: {
    type: JobType;
    workspaceId: string;
    businessId?: string;
    batchId?: string;
    photoId?: string;
    variantId?: string;
    dedupeKey: string;
    payload?: Record<string, unknown>;
    runAfter?: string;
  }): Promise<StoredJob>;
  claimDueJob(workerId: string): Promise<StoredJob | null>;
  completeJob(input: { jobId: string; result: Record<string, unknown> }): Promise<StoredJob>;
  failJob(input: { jobId: string; error: string }): Promise<StoredJob>;
  listJobs(workspaceId: string): Promise<StoredJob[]>;
  listAttempts(jobId: string): Promise<JobAttempt[]>;
  recordWorkerHeartbeat(input: {
    workerId: string;
    environment: string;
    release: string;
    status?: "alive" | "stopping";
    metadata?: Record<string, unknown>;
  }): Promise<WorkerHeartbeat>;
  getLatestWorkerHeartbeat(): Promise<WorkerHeartbeat | null>;
  listMetricDefinitions(): Promise<MetricDefinition[]>;
  listPerformanceSummaries(input: {
    workspaceId: string;
    businessId: string;
    from?: string;
    to?: string;
    scope?: PerformanceSummary["scope"];
  }): Promise<PerformanceSummary[]>;
  requestCollectMetrics(input: {
    workspaceId: string;
    businessId: string;
    from?: string;
    to?: string;
    window?: MetricWindow;
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob }>;
  completeCollectMetrics(input: { jobId: string }): Promise<{
    snapshots: PostMetricSnapshot[];
    summaries: PerformanceSummary[];
    unavailableMetrics: MetricDefinition[];
  }>;
  requestWeeklyReport(input: {
    workspaceId: string;
    businessId: string;
    weekStart?: string;
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob }>;
  completeWeeklyReport(input: { jobId: string }): Promise<WeeklyReport>;
  getLatestWeeklyReport(input: { workspaceId: string; businessId: string }): Promise<WeeklyReport | null>;
  getBootstrapContext(userId: string): Promise<{
    selectedBusinessId: string | null;
    selectedPageId: string | null;
    facebookTokenStatus: FacebookTokenStatus | null;
    metaAuthorizationStatus: MetaAuthorizationStatus;
    grantedScopes: string[];
    declinedScopes: string[];
    missingRequiredScopes: string[];
    graphApiVersion: string;
  }>;
  upsertMockMetaAuthorization(input: { workspaceId: string; actorId: string }): Promise<MetaAuthorization>;
  upsertMetaAuthorization(input: PersistedMetaAuthorizationInput): Promise<MetaAuthorization>;
  listMetaPages(workspaceId: string): Promise<MetaPage[]>;
  selectMetaPage(input: { workspaceId: string; actorId: string; pageId: string; requestId: string }): Promise<Business>;
  listBusinesses(workspaceId: string): Promise<Business[]>;
  getBusiness(input: { workspaceId: string; businessId: string }): Promise<Business | null>;
  updateBusiness(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    requestId: string;
    name?: string;
    timezone?: string;
    metadata?: Record<string, unknown>;
    autonomySettings?: BusinessAutonomySettings;
  }): Promise<Business>;
  evaluateBusinessAutonomy(input: {
    workspaceId: string;
    businessId: string;
    autonomyFeatureEnabled: boolean;
  }): Promise<AutonomyEvaluation>;
  requestBatchCaptionEval(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    requestId: string;
    candidatePromptTemplateId?: string;
    baselinePromptTemplateId?: string;
    datasetId?: string;
    candidateCaptionEditRate?: number;
  }): Promise<{ job: StoredJob }>;
  completeBatchCaptionEval(input: { jobId: string }): Promise<AiEvaluation>;
  listAiEvaluations(input: { workspaceId: string; businessId: string }): Promise<AiEvaluation[]>;
  getBillingStatus(input: { workspaceId: string }): Promise<{ workspace: Workspace; billingAccount: BillingAccount | null }>;
  createUpgradeIntent(input: {
    workspaceId: string;
    actorId: string;
    requestId: string;
    plan: CommercialPlan;
    provider: BillingProvider;
  }): Promise<{ provider: BillingProvider; targetPlan: CommercialPlan; checkoutUrl: string | null; message: string }>;
  processBillingProviderEvent(input: {
    provider: BillingProvider;
    providerEventId: string;
    type: string;
    workspaceId?: string;
    plan?: CommercialPlan;
    billingStatus?: Workspace["billingStatus"];
  }): Promise<{ event: BillingProviderEvent; duplicate: boolean }>;
  createBatch(input: { workspaceId: string; businessId: string; actorId: string; requestId: string }): Promise<BatchSummary>;
  listBatches(input: { workspaceId: string; businessId: string }): Promise<BatchSummary[]>;
  getActiveBatch(input: { workspaceId: string; businessId: string }): Promise<BatchSummary | null>;
  getBatchDetail(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
  }): Promise<{ batch: BatchSummary; photos: Photo[]; variants: Variant[]; jobs: StoredJob[] } | null>;
  createUploadIntent(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    originalFileName: string;
    contentType: string;
    fileSize: number;
  }): Promise<UploadIntent>;
  completeUpload(input: {
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
  }): Promise<{ photo: Photo; job: StoredJob }>;
  getPhoto(input: { workspaceId: string; photoId: string }): Promise<Photo | null>;
  completeAnalyzePhoto(input: {
    photoId: string;
    jobId: string;
    analysis: VisionAnalysis;
    aiRunId?: string;
  }): Promise<Photo>;
  getMediaAsset(input: { assetId: string }): Promise<MediaAsset | null>;
  estimateBatchCost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
  }): Promise<{
    batchId: string;
    variantsPerPhoto: number;
    photoCount: number;
    variantCount: number;
    priceVersion: string;
    estimatedCostUsd: number;
    estimatedProviderCostUsd: number;
    breakdown: Array<{
      operation: string;
      provider: string;
      model: string;
      unitType: string;
      quantity: number;
      unitPriceUsd: number;
      estimatedCostUsd: number;
      priceVersion: string;
    }>;
    canConfirm: boolean;
    blockedReason?: string | null;
    usage: Array<{
      metric: UsageMeter["metric"];
      limitValue?: number | null;
      usedValue: number;
      reservedValue: number;
      availableValue?: number | null;
    }>;
  }>;
  confirmBatchCost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
    priceVersion: string;
    actorId: string;
    requestId: string;
  }): Promise<{ batch: BatchSummary; variantCount: number; customerCostUsd: number; providerCostUsd: number; priceVersion: string }>;
  listVariants(input: { workspaceId: string; businessId: string; batchId: string }): Promise<Variant[]>;
  requestGenerateBatch(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob; created: number; available: number; variants: Variant[] }>;
  completeGenerateBatch(input: { jobId: string; batchId: string }): Promise<{ batch: BatchSummary; variants: Variant[] }>;
  getVariantCaptionContext(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
  }): Promise<VariantCaptionContext | null>;
  completeGenerateVariant(input: { jobId: string; variantId: string; captionResult?: CaptionResult; captionAiRunId?: string }): Promise<Variant>;
  confirmCalendar(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    periodDays: 7 | 14 | 30;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPosts: ScheduledPost[]; job: StoredJob }>;
  listScheduledPosts(input: {
    workspaceId: string;
    businessId: string;
    batchId?: string;
    from?: string;
    to?: string;
  }): Promise<ScheduledPost[]>;
  getScheduledPost(input: { workspaceId: string; businessId: string; scheduledPostId: string }): Promise<ScheduledPost | null>;
  completeSchedulePosts(input: { jobId: string; batchId: string }): Promise<{ scheduledPosts: ScheduledPost[] }>;
  publishScheduledPost(input: { jobId: string; scheduledPostId: string; publishNow?: boolean }): Promise<ScheduledPost>;
  updateScheduledPost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    scheduledPostId: string;
    scheduledFor: string;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPost: ScheduledPost; job?: StoredJob }>;
  cancelScheduledPost(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    scheduledPostId: string;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPost: ScheduledPost; job?: StoredJob }>;
  publishScheduledPostNow(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    scheduledPostId: string;
    actorId: string;
    requestId: string;
  }): Promise<{ scheduledPost: ScheduledPost; job: StoredJob }>;
  updateVariantCaption(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
    caption: string;
    actorId: string;
    requestId: string;
  }): Promise<Variant>;
  approveVariant(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
    actorId: string;
    requestId: string;
  }): Promise<Variant>;
  rejectVariant(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantId: string;
    actorId: string;
    requestId: string;
  }): Promise<Variant>;
  recordAiRun(input: Omit<AiRun, "id" | "createdAt">): Promise<AiRun>;
  listAiRuns(input: { workspaceId: string; jobId?: string }): Promise<AiRun[]>;
  getIdempotencyRecord(input: {
    workspaceId: string;
    actorId: string;
    method: string;
    routeKey: string;
    idempotencyKey: string;
  }): Promise<IdempotencyRecord | null>;
  saveIdempotencyRecord(input: {
    workspaceId: string;
    actorId: string;
    method: string;
    routeKey: string;
    idempotencyKey: string;
    requestHash: string;
    response: unknown;
  }): Promise<IdempotencyRecord>;
  createOutboxEvent(input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    workspaceId: string;
    businessId?: string;
    payload?: Record<string, unknown>;
  }): Promise<OutboxEvent>;
  listOutboxEvents(workspaceId: string): Promise<OutboxEvent[]>;
  upsertExternalOperation(input: {
    operationKey: string;
    workspaceId: string;
    jobId?: string;
    provider: string;
    operation: string;
    status: ExternalOperation["status"];
  }): Promise<ExternalOperation>;
};

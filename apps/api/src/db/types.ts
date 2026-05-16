import {
  Business,
  CaptionResult,
  BatchSummary,
  FacebookTokenStatus,
  IdempotencyRecordStatus,
  JobStatus,
  JobType,
  MetaAuthorizationStatus,
  MetaPage,
  Photo,
  ScheduledPost,
  UploadIntent,
  User,
  Variant,
  GenerateBatchStyleOverride,
  AssignedStyle,
  VisionAnalysis,
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

export type GeneratedVariantAssetInput = {
  bucket: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
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
  }): Promise<Business>;
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
  listVariants(input: { workspaceId: string; businessId: string; batchId: string }): Promise<Variant[]>;
  requestGenerateBatch(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    variantsPerPhoto: number;
    styleOverrides?: GenerateBatchStyleOverride[];
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
  completeGenerateVariant(input: {
    jobId: string;
    variantId: string;
    generatedAsset: GeneratedVariantAssetInput;
    captionResult?: CaptionResult;
    captionAiRunId?: string;
  }): Promise<Variant>;
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
  upsertExternalOperation(input: {
    operationKey: string;
    workspaceId: string;
    jobId?: string;
    provider: string;
    operation: string;
    status: ExternalOperation["status"];
  }): Promise<ExternalOperation>;
};

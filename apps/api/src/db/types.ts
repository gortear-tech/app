import {
  Business,
  CaptionResult,
  BatchStageName,
  BatchStageTiming,
  BatchStageTimingStatus,
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
  GalleryMediaAsset,
  AssignedStyle,
  FacebookPhotoReuseStats,
  MediaAssetFbUpload,
  MediaAssetUsage,
  MediaCategory,
  MenuItem,
  MenuParseResult,
  MediaSelection,
  SimilarMediaAsset,
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

export type WorkerHeartbeat = {
  workerId: string;
  service: string;
  environment: string;
  release: string;
  status: "starting" | "idle" | "processing" | "stopping" | "error";
  lastBeatAt: string;
  metadata: Record<string, unknown>;
};

export type WorkerStatus = {
  ok: boolean;
  lastBeatAt?: string;
  workerId?: string;
  status?: WorkerHeartbeat["status"];
};

export type MobileDeviceSession = {
  deviceKeyHash: string;
  userId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  userAgent?: string | null;
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
  businessId?: string;
  batchId?: string;
  photoId?: string;
  variantId?: string;
  kind: "original" | "thumbnail" | "vision_input" | "generated" | "publishable";
  bucket: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
  isPublic: boolean;
  sha256?: string | null;
  phash?: string | null;
  displayName?: string | null;
  originalName?: string | null;
  categoryId?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  thumbPath?: string | null;
  previewPath?: string | null;
  fullPath?: string | null;
  usageCount?: number;
  lastUsedAt?: string | null;
  archivedAt?: string | null;
  status?: "pending" | "processing" | "ready" | "error";
  errorReason?: string | null;
  processedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type GeneratedVariantAssetInput = {
  bucket: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
};

export type StoredMediaAssetFbUpload = MediaAssetFbUpload;
export type StoredMediaAssetUsage = MediaAssetUsage;

export type VariantCaptionContext = {
  variant: Variant;
  photo: Photo;
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
  getMobileDeviceSession(input: { deviceKeyHash: string }): Promise<MobileDeviceSession | null>;
  upsertMobileDeviceSession(input: { deviceKeyHash: string; userId: string; userAgent?: string | null }): Promise<MobileDeviceSession>;
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
  recordWorkerHeartbeat(input: {
    workerId: string;
    service: string;
    environment: string;
    release: string;
    status: WorkerHeartbeat["status"];
    metadata?: Record<string, unknown>;
  }): Promise<WorkerHeartbeat | null>;
  getWorkerStatus(input: { maxAgeMs: number }): Promise<WorkerStatus>;
  completeJob(input: { jobId: string; result: Record<string, unknown> }): Promise<StoredJob>;
  failJob(input: { jobId: string; error: string }): Promise<StoredJob>;
  listJobs(workspaceId: string): Promise<StoredJob[]>;
  listAttempts(jobId: string): Promise<JobAttempt[]>;
  markBatchStageStarted(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    stage: BatchStageName;
    counters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<BatchStageTiming>;
  markBatchStageCompleted(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    stage: BatchStageName;
    status?: BatchStageTimingStatus;
    counters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<BatchStageTiming>;
  listBatchStageTimings(input: { workspaceId: string; businessId: string; batchId: string }): Promise<BatchStageTiming[]>;
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
  recoverWorkspaceMembershipByMetaPages(input: {
    actorId: string;
    currentWorkspaceId: string;
    metaPageIds: string[];
  }): Promise<{ workspaceId: string } | null>;
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
  deleteBatch(input: {
    workspaceId: string;
    businessId: string;
    batchId: string;
    actorId: string;
    requestId: string;
  }): Promise<{ batch: BatchSummary; cancelledJobs: number; cancelledScheduledPosts: number }>;
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
  }): Promise<{ photo: Photo; job: StoredJob | null }>;
  getPhoto(input: { workspaceId: string; photoId: string }): Promise<Photo | null>;
  completeAnalyzePhoto(input: {
    photoId: string;
    jobId: string;
    analysis: VisionAnalysis;
    aiRunId?: string;
  }): Promise<Photo>;
  getMediaAsset(input: { assetId: string }): Promise<MediaAsset | null>;
  createMediaUploadIntent(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    sha256: string;
    bytes: number;
    mime: string;
    originalName: string;
    width?: number;
    height?: number;
    categoryId?: string | null;
    requestId: string;
  }): Promise<{ exists: boolean; asset: GalleryMediaAsset; storagePath?: string; expiresAt?: string; resumable?: boolean }>;
  completeMediaUpload(input: {
    workspaceId: string;
    assetId: string;
    storagePath: string;
    actorId: string;
    requestId: string;
  }): Promise<{ asset: GalleryMediaAsset; job: StoredJob }>;
  listMediaAssets(input: {
    workspaceId: string;
    categoryId?: string;
    tag?: string;
    search?: string;
    unused?: boolean;
    archived?: boolean;
    cursor?: string;
    limit?: number;
    sort?: "recent" | "most_used" | "name";
  }): Promise<{ items: GalleryMediaAsset[]; nextCursor: string | null; total?: number }>;
  updateMediaAsset(input: {
    workspaceId: string;
    assetId: string;
    actorId: string;
    requestId: string;
    displayName?: string;
    categoryId?: string | null;
    tags?: string[];
  }): Promise<GalleryMediaAsset>;
  archiveMediaAsset(input: { workspaceId: string; assetId: string; actorId: string; requestId: string }): Promise<GalleryMediaAsset>;
  restoreMediaAsset(input: { workspaceId: string; assetId: string; actorId: string; requestId: string }): Promise<GalleryMediaAsset>;
  createMediaCategory(input: {
    workspaceId: string;
    actorId: string;
    requestId: string;
    name: string;
    slug?: string;
    color?: string | null;
    sortOrder?: number;
  }): Promise<MediaCategory>;
  listMediaCategories(input: { workspaceId: string }): Promise<MediaCategory[]>;
  createMediaSelection(input: {
    workspaceId: string;
    userId: string;
    name?: string | null;
    assetIds?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<MediaSelection>;
  listActiveMediaSelections(input: { workspaceId: string; userId: string }): Promise<MediaSelection[]>;
  updateMediaSelection(input: {
    workspaceId: string;
    userId: string;
    selectionId: string;
    name?: string | null;
    assetIds?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<MediaSelection>;
  consumeMediaSelection(input: {
    workspaceId: string;
    userId: string;
    selectionId: string;
    businessId?: string;
    actorId: string;
    requestId: string;
  }): Promise<{ selection: MediaSelection; batch?: BatchSummary }>;
  deleteMediaSelection(input: { workspaceId: string; userId: string; selectionId: string }): Promise<MediaSelection>;
  completeMediaAssetProcessing(input: {
    assetId: string;
    width: number;
    height: number;
    bytes: number;
    thumbPath: string;
    previewPath: string;
    fullPath: string;
    phash?: string | null;
  }): Promise<GalleryMediaAsset>;
  failMediaAssetProcessing(input: { assetId: string; errorReason: string }): Promise<GalleryMediaAsset>;
  createMenuIngestJob(input: {
    workspaceId: string;
    businessId?: string;
    actorId: string;
    requestId: string;
    sourceType: "text" | "pdf" | "image";
    text?: string;
    fileName?: string;
    mime?: string;
    dataBase64?: string;
  }): Promise<StoredJob>;
  completeMenuIngest(input: {
    jobId: string;
    workspaceId: string;
    result: MenuParseResult;
  }): Promise<{ items: MenuItem[]; categories: MediaCategory[]; categorizedAssets: GalleryMediaAsset[] }>;
  listMenuItems(input: { workspaceId: string; categoryId?: string }): Promise<MenuItem[]>;
  listSimilarMediaAssets(input: {
    workspaceId: string;
    assetId: string;
    threshold?: number;
    limit?: number;
  }): Promise<SimilarMediaAsset[]>;
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
  getFacebookPhotoReuseStats(input: { workspaceId: string; businessId: string }): Promise<Omit<FacebookPhotoReuseStats, "schemaVersion" | "requestId">>;
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

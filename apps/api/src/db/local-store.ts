import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  AppError,
  AssignedStyle,
  BatchSummary,
  Business,
  CaptionResult,
  FacebookTokenStatus,
  GalleryMediaAsset,
  hammingDistanceHex64,
  MediaCategory,
  MenuItem,
  MenuParseResult,
  ParsedMenuItem,
  SimilarMediaAsset,
  MediaSelection,
  forbiddenError,
  MetaAuthorizationStatus,
  MetaPage,
  Photo,
  ScheduledPost,
  allocateScheduleSlots,
  UploadIntent,
  User,
  Variant,
  variantStylePresetForSlot,
  VisionAnalysis,
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
  PersistedMetaAuthorizationInput,
  StoredMediaAssetFbUpload,
  StoredMediaAssetUsage,
  StoredJob
} from "./types.js";
import { publishFacebookPagePost, uploadUnpublishedFacebookPagePhoto } from "@fbmaniaco/providers";

type GenerateStyleOverride = NonNullable<Parameters<DataStore["requestGenerateBatch"]>[0]["styleOverrides"]>[number];

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
  mediaCategories: MediaCategory[];
  mediaTags: Array<{ id: string; workspaceId: string; name: string; createdAt: string }>;
  mediaAssetTags: Array<{ assetId: string; tagId: string }>;
  mediaAssetFbUploads: StoredMediaAssetFbUpload[];
  mediaAssetUsages: StoredMediaAssetUsage[];
  mediaSelections: MediaSelection[];
  menuItems: MenuItem[];
  aiRuns: AiRun[];
  variants: Variant[];
  scheduledPosts: ScheduledPost[];
  selectedByWorkspace: Record<string, { pageId?: string; businessId?: string }>;
  jobs: StoredJob[];
  jobAttempts: JobAttempt[];
  idempotencyRecords: IdempotencyRecord[];
  externalOperations: ExternalOperation[];
};

const now = () => new Date().toISOString();
const encodeServerToken = (token: string) => `local-dev:${Buffer.from(token, "utf8").toString("base64url")}`;
const decodeServerToken = (value: string | null | undefined) => {
  if (!value?.startsWith("local-dev:")) return null;
  return Buffer.from(value.slice("local-dev:".length), "base64url").toString("utf8");
};
const mediaPreviewToken = (assetId: string, expires: number) =>
  createHash("sha256").update(`${assetId}:${expires}:fbmaniaco-local-media-preview`).digest("hex");
const MEDIA_PREVIEW_TTL_SECONDS = 24 * 60 * 60;
const publicMediaUrl = (assetId: string) => {
  const baseUrl = process.env.PUBLIC_API_URL ?? process.env.API_PUBLIC_URL;
  if (!baseUrl?.startsWith("https://")) return null;
  const expires = Math.floor(Date.now() / 1000) + MEDIA_PREVIEW_TTL_SECONDS;
  return `${baseUrl.replace(/\/$/, "")}/media/assets/${assetId}/preview?expires=${expires}&token=${mediaPreviewToken(assetId, expires)}`;
};
const publicMetaPage = (page: LocalMetaPage): MetaPage => {
  const { encryptedPageAccessToken: _encryptedPageAccessToken, pageAccessTokenKeyId: _pageAccessTokenKeyId, ...safePage } = page;
  return safePage;
};
const MEDIA_BUCKET = "business-media";
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

const workspaceRecoveryRank = (state: LocalState, workspaceId: string) => {
  const hasActiveBatch = state.batches.some((batch) => batch.workspaceId === workspaceId && activeBatchStatuses.has(batch.status));
  const hasSelectedPublishablePage = state.businesses.some((business) => {
    if (business.workspaceId !== workspaceId || !business.facebookPageId) return false;
    return state.pages.some(
      (page) =>
        page.workspaceId === workspaceId &&
        page.id === business.facebookPageId &&
        page.isSelected &&
        page.isGranted &&
        page.canPublish
    );
  });
  return (hasActiveBatch ? 2 : 0) + (hasSelectedPublishablePage ? 1 : 0);
};

const compareMembershipForRecovery = (state: LocalState, left: WorkspaceMember, right: WorkspaceMember) => {
  const rankDelta = workspaceRecoveryRank(state, right.workspaceId) - workspaceRecoveryRank(state, left.workspaceId);
  if (rankDelta !== 0) return rankDelta;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
};

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
  mediaCategories: [],
  mediaTags: [],
  mediaAssetTags: [],
  mediaAssetFbUploads: [],
  mediaAssetUsages: [],
  mediaSelections: [],
  menuItems: [],
  aiRuns: [],
  variants: [],
  scheduledPosts: [],
  selectedByWorkspace: {},
  jobs: [],
  jobAttempts: [],
  idempotencyRecords: [],
  externalOperations: []
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

const cleanWorkspace = (workspace: Workspace): Workspace => ({
  id: workspace.id,
  name: workspace.name,
  ownerUserId: workspace.ownerUserId,
  status: workspace.status,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt
});

const cleanBusiness = (business: Business): Business => ({
  id: business.id,
  workspaceId: business.workspaceId,
  facebookPageId: business.facebookPageId,
  name: business.name,
  timezone: business.timezone,
  tokenStatus: business.tokenStatus,
  metadata: business.metadata,
  createdAt: business.createdAt,
  updatedAt: business.updatedAt
});

const cleanBatch = (batch: BatchSummary): BatchSummary => {
  const cleaned: BatchSummary = {
    id: batch.id,
    workspaceId: batch.workspaceId,
    businessId: batch.businessId,
    status: batch.status,
    photosCount: batch.photosCount,
    variantsCount: batch.variantsCount,
    lastActivityAt: batch.lastActivityAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt
  };
  if (batch.variantsPerPhoto !== undefined) cleaned.variantsPerPhoto = batch.variantsPerPhoto;
  return cleaned;
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "categoria";

const displayNameForAsset = (input: { categorySlug?: string | null; createdAt: string; sequence: number; originalName: string }) => {
  const month = input.createdAt.slice(0, 7);
  const extension = input.originalName.includes(".") ? input.originalName.slice(input.originalName.lastIndexOf(".")) : ".jpg";
  return `${input.categorySlug || "sin_categoria"}_${month}_${String(input.sequence).padStart(3, "0")}${extension.toLowerCase()}`;
};

const normalizeSearchText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .trim();

const normalizeKeywords = (keywords: string[]) =>
  Array.from(new Set(keywords.map(normalizeSearchText).filter((keyword) => keyword.length >= 2))).slice(0, 20);

const menuItemMatchesAsset = (item: ParsedMenuItem, asset: MediaAsset) => {
  const haystack = normalizeSearchText(
    [asset.displayName, asset.originalName, asset.storageKey].filter((value): value is string => typeof value === "string").join(" ")
  );
  return normalizeKeywords([item.name, ...(item.keywords ?? [])]).some((keyword) => haystack.includes(keyword));
};

const toGalleryAsset = (asset: MediaAsset): GalleryMediaAsset => ({
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
});

const mergeLocalState = (latest: LocalState, current: LocalState): LocalState => ({
  ...emptyState(),
  users: mergeById(latest.users, current.users),
  workspaces: mergeById(latest.workspaces, current.workspaces).map(cleanWorkspace),
  members: mergeByKey(latest.members, current.members, (item) => `${item.workspaceId}:${item.userId}`),
  metaAuthorizations: mergeById(latest.metaAuthorizations, current.metaAuthorizations),
  pages: mergeById(latest.pages, current.pages),
  businesses: mergeById(latest.businesses, current.businesses).map(cleanBusiness),
  batches: mergeById(latest.batches, current.batches).map(cleanBatch),
  photos: mergeById(latest.photos, current.photos),
  uploadIntents: mergeById(latest.uploadIntents, current.uploadIntents),
  mediaAssets: mergeById(latest.mediaAssets, current.mediaAssets),
  mediaCategories: mergeById(latest.mediaCategories ?? [], current.mediaCategories ?? []),
  mediaTags: mergeById(latest.mediaTags ?? [], current.mediaTags ?? []),
  mediaAssetTags: mergeByKey(latest.mediaAssetTags ?? [], current.mediaAssetTags ?? [], (item) => `${item.assetId}:${item.tagId}`),
  mediaAssetFbUploads: mergeByKey(latest.mediaAssetFbUploads ?? [], current.mediaAssetFbUploads ?? [], (item) => `${item.assetId}:${item.facebookPageId}`),
  mediaAssetUsages: mergeById(latest.mediaAssetUsages ?? [], current.mediaAssetUsages ?? []),
  mediaSelections: mergeById(latest.mediaSelections ?? [], current.mediaSelections ?? []),
  menuItems: mergeById(latest.menuItems ?? [], current.menuItems ?? []),
  aiRuns: mergeById(latest.aiRuns, current.aiRuns),
  variants: mergeById(latest.variants, current.variants),
  scheduledPosts: mergeById(latest.scheduledPosts, current.scheduledPosts),
  jobs: mergeById(latest.jobs, current.jobs),
  jobAttempts: mergeById(latest.jobAttempts, current.jobAttempts),
  idempotencyRecords: mergeById(latest.idempotencyRecords, current.idempotencyRecords),
  externalOperations: mergeByKey(latest.externalOperations, current.externalOperations, (item) => item.operationKey),
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
    const existing = state.members
      .filter((member) => member.userId === userId && member.status === "active")
      .sort((left, right) => compareMembershipForRecovery(state, left, right))[0];
    if (existing) {
      const workspace = state.workspaces.find((item) => item.id === existing.workspaceId);
      if (workspace) return { workspace, membership: existing };
    }

    const timestamp = now();
    const workspace: Workspace = {
      id: randomUUID(),
      name: "Mi workspace Maniaco",
      ownerUserId: userId,
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
    await this.persist();
    return { workspace, membership };
  }

  async listMemberships(userId: string) {
    const state = await this.load();
    return state.members
      .filter((membership) => membership.userId === userId && membership.status === "active")
      .sort((left, right) => compareMembershipForRecovery(state, left, right))
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
    const hasRunningVariant = state.jobs.some(
      (item) =>
        item.type === "generate_variant" &&
        item.status === "running" &&
        (item.leaseExpiresAt === undefined || item.leaseExpiresAt > timestamp)
    );
    const job = state.jobs
      .filter((item) => item.status === "queued" && item.runAfter <= timestamp && (item.type !== "generate_variant" || !hasRunningVariant))
      .sort((a, b) => a.runAfter.localeCompare(b.runAfter) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!job) return null;

    job.status = "running";
    job.lockedAt = timestamp;
    job.lockedBy = workerId;
    job.leaseExpiresAt = new Date(Date.now() + (job.type === "generate_variant" ? 15 * 60_000 : 60_000)).toISOString();
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

  async updateBusiness(input: {
    workspaceId: string;
    businessId: string;
    actorId: string;
    requestId: string;
    name?: string;
    timezone?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Business> {
    const state = await this.load();
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const timestamp = now();
    if (input.name !== undefined) business.name = input.name;
    if (input.timezone !== undefined) business.timezone = input.timezone;
    if (input.metadata !== undefined) business.metadata = { ...business.metadata, ...input.metadata };
    business.updatedAt = timestamp;
    await this.persist();
    return business;
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
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.businesses.push(business);
    } else {
      business.tokenStatus = page.pageAccessTokenStatus;
      business.updatedAt = timestamp;
    }

    state.selectedByWorkspace[input.workspaceId] = { pageId: page.id, businessId: business.id };
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
    await this.persist();
    return batch;
  }

  async listBatches(input: { workspaceId: string; businessId: string }): Promise<BatchSummary[]> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    return state.batches
      .filter((batch) => batch.workspaceId === input.workspaceId && batch.businessId === input.businessId && !hiddenBatchStatuses.has(batch.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getActiveBatch(input: { workspaceId: string; businessId: string }): Promise<BatchSummary | null> {
    const batches = await this.listBatches(input);
    return batches.find((batch) => activeBatchStatuses.has(batch.status)) ?? null;
  }

  async deleteBatch(input: Parameters<DataStore["deleteBatch"]>[0]): ReturnType<DataStore["deleteBatch"]> {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    const timestamp = now();
    let cancelledJobs = 0;
    let cancelledScheduledPosts = 0;
    state.jobs.forEach((job) => {
      if (
        job.workspaceId === input.workspaceId &&
        job.businessId === input.businessId &&
        job.batchId === input.batchId &&
        ["queued", "blocked", "needs_user_action"].includes(job.status)
      ) {
        job.status = "cancelled";
        job.lastError = "batch_deleted";
        job.updatedAt = timestamp;
        cancelledJobs += 1;
      }
    });
    state.scheduledPosts.forEach((post) => {
      if (
        post.workspaceId === input.workspaceId &&
        post.businessId === input.businessId &&
        post.batchId === input.batchId &&
        !["publicada", "published", "cancelada", "cancelled"].includes(post.status)
      ) {
        post.status = "cancelada";
        post.remoteStatus = "no_enviado";
        post.remoteErrorCode = "batch_deleted";
        post.updatedAt = timestamp;
        cancelledScheduledPosts += 1;
      }
    });
    state.variants.forEach((variant) => {
      if (
        variant.workspaceId === input.workspaceId &&
        variant.businessId === input.businessId &&
        variant.batchId === input.batchId &&
        !["publicada", "eliminada"].includes(variant.status)
      ) {
        variant.status = "eliminada";
        variant.updatedAt = timestamp;
      }
    });
    state.photos.forEach((photo) => {
      if (photo.workspaceId === input.workspaceId && photo.businessId === input.businessId && photo.batchId === input.batchId) {
        photo.status = "eliminada";
        photo.updatedAt = timestamp;
      }
    });
    batch.status = "abandonado";
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    await this.persist();
    return { batch, cancelledJobs, cancelledScheduledPosts };
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
  }): Promise<{ photo: Photo; job: StoredJob | null }> {
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
      thumbnailAssetId: originalAsset.id,
      visionInputAssetId: originalAsset.id,
      status: "validada",
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
    if (!terminalBatchStatuses.has(batch.status)) {
      batch.status = "pendiente_confirmacion";
    }
    batch.lastActivityAt = timestamp;
    batch.updatedAt = timestamp;
    await this.persist();
    return { photo, job: null };
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
    if (batch && !terminalBatchStatuses.has(batch.status)) {
      batch.status = "pendiente_confirmacion";
      batch.lastActivityAt = timestamp;
      batch.updatedAt = timestamp;
    }
    await this.persist();
    return photo;
  }

  async getMediaAsset(input: { assetId: string }): Promise<MediaAsset | null> {
    const state = await this.load();
    return state.mediaAssets.find((asset) => asset.id === input.assetId) ?? null;
  }

  async createMediaUploadIntent(input: Parameters<DataStore["createMediaUploadIntent"]>[0]) {
    const state = await this.load();
    this.requireBusiness(state, input.workspaceId, input.businessId);
    this.assertUploadShape(input.mime, input.bytes, input.originalName);
    const pending = state.mediaAssets.find(
      (asset) => asset.workspaceId === input.workspaceId && asset.sha256 === input.sha256 && asset.status === "pending"
    );
    if (pending) {
      throw new AppError({
        code: "ASSET_EXISTS_PENDING",
        statusCode: 409,
        message: "Another upload is already pending for this hash",
        userMessage: "Esa foto ya se esta subiendo.",
        retryable: true,
        action: "retry"
      });
    }
    const existing = state.mediaAssets.find(
      (asset) => asset.workspaceId === input.workspaceId && asset.sha256 === input.sha256 && !asset.archivedAt
    );
    if (existing) return { exists: true, asset: toGalleryAsset(existing) };
    const timestamp = now();
    const category = input.categoryId ? state.mediaCategories.find((item) => item.id === input.categoryId) : null;
    const assetId = randomUUID();
    const storagePath = `${input.workspaceId}/assets/${assetId}/upload-raw`;
    const sequence = state.mediaAssets.filter((asset) => asset.workspaceId === input.workspaceId && asset.categoryId === (input.categoryId ?? null)).length + 1;
    const asset: MediaAsset = {
      id: assetId,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      kind: "original",
      bucket: MEDIA_BUCKET,
      storageKey: storagePath,
      mimeType: input.mime,
      fileSize: input.bytes,
      isPublic: false,
      sha256: input.sha256,
      displayName: displayNameForAsset({
        categorySlug: category?.slug ?? null,
        createdAt: timestamp,
        sequence,
        originalName: input.originalName
      }),
      originalName: input.originalName,
      categoryId: input.categoryId ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes,
      usageCount: 0,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.mediaAssets.push(asset);
    await this.persist();
    return {
      exists: false,
      asset: toGalleryAsset(asset),
      storagePath,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
  }

  async completeMediaUpload(input: Parameters<DataStore["completeMediaUpload"]>[0]) {
    const state = await this.load();
    const asset = state.mediaAssets.find((item) => item.id === input.assetId && item.workspaceId === input.workspaceId);
    if (!asset) {
      throw new AppError({
        code: "media_asset_not_found",
        statusCode: 404,
        message: "Media asset not found",
        userMessage: "No encontramos esa foto.",
        retryable: false,
        action: "refresh"
      });
    }
    if (asset.storageKey !== input.storagePath || asset.status !== "pending") {
      throw new AppError({
        code: "media_upload_invalid_state",
        statusCode: 409,
        message: "Media upload is not pending for this storage path",
        userMessage: "La subida de esa foto no esta en un estado valido.",
        retryable: false,
        action: "refresh"
      });
    }
    const timestamp = now();
    asset.status = "processing";
    asset.updatedAt = timestamp;
    const jobInput: Parameters<DataStore["createJob"]>[0] = {
      type: "media:process",
      workspaceId: asset.workspaceId,
      dedupeKey: `media:process:${asset.id}`,
      payload: { assetId: asset.id, requestId: input.requestId }
    };
    if (asset.businessId !== undefined) jobInput.businessId = asset.businessId;
    const job = await this.createJob(jobInput);
    await this.persist();
    return { asset: toGalleryAsset(asset), job };
  }

  async listMediaAssets(input: Parameters<DataStore["listMediaAssets"]>[0]) {
    const state = await this.load();
    let items = state.mediaAssets.filter((asset) => asset.workspaceId === input.workspaceId && asset.kind === "original");
    if (input.archived) items = items.filter((asset) => Boolean(asset.archivedAt));
    else items = items.filter((asset) => !asset.archivedAt);
    if (input.categoryId) items = items.filter((asset) => asset.categoryId === input.categoryId);
    if (input.unused) items = items.filter((asset) => !asset.lastUsedAt);
    if (input.tag) {
      const tag = state.mediaTags.find((item) => item.workspaceId === input.workspaceId && item.name === input.tag);
      items = tag ? items.filter((asset) => state.mediaAssetTags.some((link) => link.assetId === asset.id && link.tagId === tag.id)) : [];
    }
    if (input.search) {
      const term = input.search.toLowerCase();
      items = items.filter((asset) =>
        [asset.displayName, asset.originalName, asset.storageKey].some((value) => value?.toLowerCase().includes(term))
      );
    }
    const sort = input.sort ?? "recent";
    items = items.sort((a, b) => {
      if (sort === "name") return (a.displayName ?? a.originalName ?? "").localeCompare(b.displayName ?? b.originalName ?? "");
      if (sort === "most_used") return (b.usageCount ?? 0) - (a.usageCount ?? 0) || b.createdAt.localeCompare(a.createdAt);
      return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
    });
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const start = input.cursor ? Math.max(0, Number(Buffer.from(input.cursor, "base64url").toString("utf8")) || 0) : 0;
    const page = items.slice(start, start + limit);
    const nextCursor = start + limit < items.length ? Buffer.from(String(start + limit)).toString("base64url") : null;
    return { items: page.map(toGalleryAsset), nextCursor, total: items.length };
  }

  async updateMediaAsset(input: Parameters<DataStore["updateMediaAsset"]>[0]) {
    const state = await this.load();
    const asset = state.mediaAssets.find((item) => item.id === input.assetId && item.workspaceId === input.workspaceId);
    if (!asset) throw this.mediaAssetNotFound();
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = state.mediaCategories.find((item) => item.id === input.categoryId && item.workspaceId === input.workspaceId);
      if (!category) throw this.mediaCategoryNotFound();
    }
    const timestamp = now();
    if (input.displayName !== undefined) asset.displayName = input.displayName;
    if (input.categoryId !== undefined) asset.categoryId = input.categoryId;
    if (input.tags !== undefined) {
      state.mediaAssetTags = state.mediaAssetTags.filter((link) => link.assetId !== asset.id);
      for (const rawTag of input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 30)) {
        let tag = state.mediaTags.find((item) => item.workspaceId === input.workspaceId && item.name.toLowerCase() === rawTag.toLowerCase());
        if (!tag) {
          tag = { id: randomUUID(), workspaceId: input.workspaceId, name: rawTag, createdAt: timestamp };
          state.mediaTags.push(tag);
        }
        state.mediaAssetTags.push({ assetId: asset.id, tagId: tag.id });
      }
    }
    asset.updatedAt = timestamp;
    await this.persist();
    return toGalleryAsset(asset);
  }

  async archiveMediaAsset(input: Parameters<DataStore["archiveMediaAsset"]>[0]) {
    const state = await this.load();
    const asset = state.mediaAssets.find((item) => item.id === input.assetId && item.workspaceId === input.workspaceId);
    if (!asset) throw this.mediaAssetNotFound();
    asset.archivedAt = now();
    asset.updatedAt = asset.archivedAt;
    await this.persist();
    return toGalleryAsset(asset);
  }

  async restoreMediaAsset(input: Parameters<DataStore["restoreMediaAsset"]>[0]) {
    const state = await this.load();
    const asset = state.mediaAssets.find((item) => item.id === input.assetId && item.workspaceId === input.workspaceId);
    if (!asset) throw this.mediaAssetNotFound();
    asset.archivedAt = null;
    asset.updatedAt = now();
    await this.persist();
    return toGalleryAsset(asset);
  }

  async createMediaCategory(input: Parameters<DataStore["createMediaCategory"]>[0]) {
    const state = await this.load();
    const slug = slugify(input.slug ?? input.name);
    const existing = state.mediaCategories.find((item) => item.workspaceId === input.workspaceId && item.slug === slug);
    if (existing) return existing;
    const timestamp = now();
    const category: MediaCategory = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      slug,
      color: input.color ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.mediaCategories.push(category);
    await this.persist();
    return category;
  }

  async listMediaCategories(input: Parameters<DataStore["listMediaCategories"]>[0]) {
    const state = await this.load();
    return state.mediaCategories
      .filter((item) => item.workspaceId === input.workspaceId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async createMediaSelection(input: Parameters<DataStore["createMediaSelection"]>[0]) {
    const state = await this.load();
    const timestamp = now();
    const selection: MediaSelection = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      name: input.name ?? null,
      assetIds: input.assetIds ?? [],
      metadata: input.metadata ?? {},
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.mediaSelections.push(selection);
    await this.persist();
    return selection;
  }

  async listActiveMediaSelections(input: Parameters<DataStore["listActiveMediaSelections"]>[0]) {
    const state = await this.load();
    return state.mediaSelections
      .filter((item) => item.workspaceId === input.workspaceId && item.userId === input.userId && item.status === "draft")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateMediaSelection(input: Parameters<DataStore["updateMediaSelection"]>[0]) {
    const state = await this.load();
    const selection = this.requireMediaSelection(state, input.workspaceId, input.userId, input.selectionId);
    if (input.name !== undefined) selection.name = input.name;
    if (input.assetIds !== undefined) selection.assetIds = input.assetIds;
    if (input.metadata !== undefined) selection.metadata = input.metadata;
    selection.updatedAt = now();
    await this.persist();
    return selection;
  }

  async consumeMediaSelection(input: Parameters<DataStore["consumeMediaSelection"]>[0]) {
    const state = await this.load();
    const selection = this.requireMediaSelection(state, input.workspaceId, input.userId, input.selectionId);
    selection.status = "consumed";
    selection.updatedAt = now();
    let batch: BatchSummary | undefined;
    if (input.businessId) {
      batch = await this.createBatch({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        actorId: input.actorId,
        requestId: input.requestId
      });
    }
    await this.persist();
    return batch ? { selection, batch } : { selection };
  }

  async deleteMediaSelection(input: Parameters<DataStore["deleteMediaSelection"]>[0]) {
    const state = await this.load();
    const selection = this.requireMediaSelection(state, input.workspaceId, input.userId, input.selectionId);
    selection.status = "discarded";
    selection.updatedAt = now();
    await this.persist();
    return selection;
  }

  async completeMediaAssetProcessing(input: Parameters<DataStore["completeMediaAssetProcessing"]>[0]) {
    const state = await this.load();
    const asset = state.mediaAssets.find((item) => item.id === input.assetId);
    if (!asset) throw this.mediaAssetNotFound();
    const timestamp = now();
    asset.width = input.width;
    asset.height = input.height;
    asset.bytes = input.bytes;
    asset.phash = input.phash ?? asset.phash ?? null;
    asset.thumbPath = input.thumbPath;
    asset.previewPath = input.previewPath;
    asset.fullPath = input.fullPath;
    asset.storageKey = input.fullPath;
    asset.mimeType = "image/jpeg";
    asset.fileSize = input.bytes;
    asset.status = "ready";
    asset.errorReason = null;
    asset.processedAt = timestamp;
    asset.updatedAt = timestamp;
    await this.persist();
    return toGalleryAsset(asset);
  }

  async failMediaAssetProcessing(input: Parameters<DataStore["failMediaAssetProcessing"]>[0]) {
    const state = await this.load();
    const asset = state.mediaAssets.find((item) => item.id === input.assetId);
    if (!asset) throw this.mediaAssetNotFound();
    asset.status = "error";
    asset.errorReason = input.errorReason;
    asset.updatedAt = now();
    await this.persist();
    return toGalleryAsset(asset);
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
    const state = await this.load();
    const timestamp = now();
    const categories: MediaCategory[] = [];
    const items: MenuItem[] = [];
    const categorizedAssets: GalleryMediaAsset[] = [];
    for (const parsed of input.result.items) {
      const categoryName = parsed.categoryName?.trim() || null;
      let category: MediaCategory | null = null;
      if (categoryName) {
        const slug = slugify(categoryName);
        category = state.mediaCategories.find((item) => item.workspaceId === input.workspaceId && item.slug === slug) ?? null;
        if (!category) {
          category = {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            name: categoryName,
            slug,
            color: null,
            sortOrder: state.mediaCategories.filter((item) => item.workspaceId === input.workspaceId).length,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          state.mediaCategories.push(category);
        }
        categories.push(category);
      }

      const normalizedName = normalizeSearchText(parsed.name);
      let item = state.menuItems.find(
        (candidate) => candidate.workspaceId === input.workspaceId && normalizeSearchText(candidate.name) === normalizedName
      );
      if (!item) {
        item = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          categoryId: category?.id ?? null,
          name: parsed.name.trim(),
          description: parsed.description?.trim() || null,
          priceCents: parsed.priceCents,
          keywords: normalizeKeywords([parsed.name, ...parsed.keywords]),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        state.menuItems.push(item);
      } else {
        item.categoryId = category?.id ?? item.categoryId ?? null;
        item.description = parsed.description?.trim() || (item.description ?? null);
        item.priceCents = parsed.priceCents ?? item.priceCents ?? null;
        item.keywords = normalizeKeywords([...item.keywords, parsed.name, ...parsed.keywords]);
        item.updatedAt = timestamp;
      }
      items.push(item);

      if (category) {
        for (const asset of state.mediaAssets) {
          if (
            asset.workspaceId === input.workspaceId &&
            !asset.categoryId &&
            (asset.archivedAt ?? null) === null &&
            menuItemMatchesAsset(parsed, asset)
          ) {
            asset.categoryId = category.id;
            asset.updatedAt = timestamp;
            categorizedAssets.push(toGalleryAsset(asset));
          }
        }
      }
    }
    await this.persist();
    return {
      items,
      categories: Array.from(new Map(categories.map((category) => [category.id, category])).values()),
      categorizedAssets: Array.from(new Map(categorizedAssets.map((asset) => [asset.id, asset])).values())
    };
  }

  async listMenuItems(input: Parameters<DataStore["listMenuItems"]>[0]) {
    const state = await this.load();
    return state.menuItems
      .filter((item) => item.workspaceId === input.workspaceId && (!input.categoryId || item.categoryId === input.categoryId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listSimilarMediaAssets(input: Parameters<DataStore["listSimilarMediaAssets"]>[0]): Promise<SimilarMediaAsset[]> {
    const state = await this.load();
    const target = state.mediaAssets.find((item) => item.id === input.assetId && item.workspaceId === input.workspaceId);
    if (!target) throw this.mediaAssetNotFound();
    const threshold = input.threshold ?? 10;
    const limit = input.limit ?? 20;
    return state.mediaAssets
      .filter((asset) => asset.workspaceId === input.workspaceId && asset.id !== target.id && asset.phash && (asset.archivedAt ?? null) === null)
      .map((asset) => ({ asset: toGalleryAsset(asset), distance: hammingDistanceHex64(target.phash, asset.phash) }))
      .filter((item) => item.distance <= threshold)
      .sort((a, b) => a.distance - b.distance || b.asset.createdAt.localeCompare(a.asset.createdAt))
      .slice(0, limit);
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
    styleOverrides?: Parameters<DataStore["requestGenerateBatch"]>[0]["styleOverrides"];
    actorId: string;
    requestId: string;
  }): Promise<{ job: StoredJob; created: number; available: number; variants: Variant[] }> {
    const state = await this.load();
    const batch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
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
    const validPhotos = this.validPhotosForGeneration(state, input.workspaceId, input.businessId, input.batchId);
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
    const styleOverrides = new Map((input.styleOverrides ?? []).map((override) => [override.photoId, override]));
    let styleSlot = 0;
    for (const photo of validPhotos) {
      for (let index = 1; index <= input.variantsPerPhoto; index += 1) {
        styleSlot += 1;
        const style = this.assignStyle(styleSlot, styleOverrides.get(photo.id), input.batchId);
        const promptVersion = "generation-plan-v1";
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
            styleId: style.styleId,
            assignedStyle: style,
            generationPlan: this.generationPlan(style, promptVersion),
            promptTemplateId: "photo-variant-generation",
            promptVersion,
            status: "generando",
            createdAt: timestamp,
            updatedAt: timestamp
          };
          state.variants.push(variant);
          created += 1;
        } else {
          if (["pendiente", "generando"].includes(variant.status)) {
            variant.styleId = style.styleId;
            variant.assignedStyle = style;
            variant.generationPlan = this.generationPlan(style, promptVersion);
            variant.promptTemplateId = "photo-variant-generation";
            variant.promptVersion = promptVersion;
            variant.updatedAt = timestamp;
          }
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
    if (!terminalBatchStatuses.has(batch.status)) {
      batch.status = "generando";
      batch.variantsPerPhoto = input.variantsPerPhoto;
      batch.variantsCount = state.variants.filter((variant) => variant.batchId === batch.id && variant.status !== "eliminada").length;
      batch.lastActivityAt = timestamp;
      batch.updatedAt = timestamp;
    }
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
    if (!terminalBatchStatuses.has(batch.status)) {
      batch.status = variants.some((variant) => variant.status === "generada" || variant.status === "aprobada")
        ? "generado_parcial"
        : "generando";
      batch.lastActivityAt = timestamp;
      batch.updatedAt = timestamp;
    }
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
    if (!photo || photo.status !== "validada") return null;
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const page = business.facebookPageId
      ? state.pages.find((item) => item.id === business.facebookPageId && item.workspaceId === input.workspaceId)
      : null;
    return {
      variant,
      photo,
      business,
      page: page ? publicMetaPage(page) : null,
      style: variant.assignedStyle ?? this.assignStyle(variant.variantIndex),
      promptVersion: "caption-page-context-v1"
    };
  }

  async completeGenerateVariant(input: Parameters<DataStore["completeGenerateVariant"]>[0]): Promise<Variant> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const variant = this.requireVariant(state, job.workspaceId, job.businessId, job.batchId, input.variantId);
    if (
      job.type !== "generate_variant" ||
      job.variantId !== variant.id ||
      job.photoId !== variant.photoId ||
      job.businessId !== variant.businessId ||
      job.batchId !== variant.batchId
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
    const photo = state.photos.find((item) => item.id === variant.photoId && item.workspaceId === variant.workspaceId);
    if (
      variant.generatedAssetId &&
      variant.generatedAssetId !== photo?.originalAssetId &&
      variant.caption &&
      ["generada", "aprobada", "rechazada"].includes(variant.status)
    ) {
      return variant;
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
    const style = variant.assignedStyle ?? this.assignStyle(variant.variantIndex);
    const promptVersion = "generation-plan-v1";
    const timestamp = now();
    const plan = {
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
      visionAnalysis: photo.visionAnalysis ? (photo.visionAnalysis as VisionAnalysis) : null,
      metadata: business?.metadata ?? {}
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
      bucket: input.generatedAsset.bucket,
      storageKey: input.generatedAsset.storageKey,
      mimeType: input.generatedAsset.mimeType,
      fileSize: input.generatedAsset.fileSize,
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
    if (batch && !terminalBatchStatuses.has(batch.status)) {
      batch.status = "generado_parcial";
      batch.variantsCount = state.variants.filter((item) => item.batchId === batch.id && item.status !== "eliminada").length;
      batch.lastActivityAt = timestamp;
      batch.updatedAt = timestamp;
    }
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
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const inactiveStatuses = new Set(["cancelada", "cancelled", "fallida", "failed"]);
    const occupiedSlots = state.scheduledPosts
      .filter(
        (post) =>
          post.workspaceId === input.workspaceId &&
          post.pageId === business.facebookPageId &&
          !inactiveStatuses.has(post.status) &&
          post.scheduledFor > timestamp
      )
      .map((post) => post.scheduledFor);
    const scheduleSlots = allocateScheduleSlots({
      count: approved.length,
      periodDays: input.periodDays,
      occupiedSlots,
      now: new Date(timestamp),
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
      const scheduledFor = scheduleSlots[index]!;
      const post: ScheduledPost = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        batchId: input.batchId,
        variantId: variant.id,
        pageId: business.facebookPageId,
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
    const updatedBatch = this.requireBatch(state, input.workspaceId, input.businessId, input.batchId);
    updatedBatch.status = "scheduled";
    updatedBatch.lastActivityAt = timestamp;
    updatedBatch.updatedAt = timestamp;
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

  async getFacebookPhotoReuseStats(input: Parameters<DataStore["getFacebookPhotoReuseStats"]>[0]) {
    const state = await this.load();
    const business = this.requireBusiness(state, input.workspaceId, input.businessId);
    const uniqueUploads = state.mediaAssetFbUploads.filter((upload) => upload.facebookPageId === business.facebookPageId).length;
    const totalUsages = state.mediaAssetUsages.filter((usage) => usage.facebookPageId === business.facebookPageId).length;
    return {
      businessId: business.id,
      facebookPageId: business.facebookPageId,
      uniqueUploads,
      totalUsages,
      uploadsSaved: Math.max(0, totalUsages - uniqueUploads)
    };
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
    if (!job.businessId) throw new Error("schedule_posts job is missing businessId");
    const batch = this.requireBatch(state, job.workspaceId, job.businessId, input.batchId);
    if (terminalBatchStatuses.has(batch.status)) return { scheduledPosts: [] };
    const scheduledPosts = state.scheduledPosts.filter((post) => post.workspaceId === job.workspaceId && post.batchId === input.batchId);
    for (const post of scheduledPosts) {
      const remoteScheduled = await this.scheduleRemotePostIfPossible(state, post, job);
      if (remoteScheduled) continue;
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
    if (scheduledPosts.length > 0) {
      const updatedBatch = this.requireBatch(state, job.workspaceId, job.businessId, input.batchId);
      updatedBatch.status = "completado";
      updatedBatch.lastActivityAt = now();
      updatedBatch.updatedAt = updatedBatch.lastActivityAt;
    }
    await this.persist();
    return { scheduledPosts };
  }

  private async ensureFacebookPhotoUpload(
    state: LocalState,
    input: {
      assetId: string;
      facebookPageId: string;
      metaPageId: string;
      pageAccessToken: string;
      imageUrl: string;
      graphApiVersion: string;
    }
  ): Promise<{ fbPhotoId: string; reused: boolean; providerTraceId?: string }> {
    const existing = state.mediaAssetFbUploads.find(
      (upload) => upload.assetId === input.assetId && upload.facebookPageId === input.facebookPageId
    );
    const timestamp = now();
    if (existing) {
      existing.lastUsedAt = timestamp;
      return { fbPhotoId: existing.fbPhotoId, reused: true };
    }
    const uploaded = await uploadUnpublishedFacebookPagePhoto({
      graphApiVersion: input.graphApiVersion,
      pageId: input.metaPageId,
      pageAccessToken: input.pageAccessToken,
      imageUrl: input.imageUrl
    });
    state.mediaAssetFbUploads.push({
      id: randomUUID(),
      assetId: input.assetId,
      facebookPageId: input.facebookPageId,
      fbPhotoId: uploaded.fbPhotoId,
      uploadedAt: timestamp,
      lastUsedAt: timestamp
    });
    return {
      fbPhotoId: uploaded.fbPhotoId,
      reused: false,
      ...(uploaded.providerTraceId ? { providerTraceId: uploaded.providerTraceId } : {})
    };
  }

  private recordMediaAssetUsage(
    state: LocalState,
    input: { assetId: string; scheduledPostId: string; variantId: string; facebookPageId: string }
  ) {
    if (!state.mediaAssetUsages.some((usage) => usage.scheduledPostId === input.scheduledPostId && usage.assetId === input.assetId)) {
      const timestamp = now();
      state.mediaAssetUsages.push({
        id: randomUUID(),
        assetId: input.assetId,
        scheduledPostId: input.scheduledPostId,
        variantId: input.variantId,
        facebookPageId: input.facebookPageId,
        usedAt: timestamp
      });
      const asset = state.mediaAssets.find((item) => item.id === input.assetId);
      if (asset) {
        asset.usageCount = (asset.usageCount ?? 0) + 1;
        asset.lastUsedAt = timestamp;
        asset.updatedAt = timestamp;
      }
    }
    const upload = state.mediaAssetFbUploads.find(
      (item) => item.assetId === input.assetId && item.facebookPageId === input.facebookPageId
    );
    if (upload) upload.lastUsedAt = now();
  }

  private async scheduleRemotePostIfPossible(state: LocalState, post: ScheduledPost, job: StoredJob): Promise<boolean> {
    if (post.status !== "programada" || post.remoteStatus !== "no_enviado") return post.remoteStatus === "confirmado_meta";
    const variant = state.variants.find((item) => item.id === post.variantId && item.workspaceId === post.workspaceId);
    if (!variant?.publishableAssetId) {
      post.status = "fallida";
      post.remoteErrorCode = "missing_publishable_media";
      post.updatedAt = now();
      await this.persist();
      throw this.scheduledPostStateError("missing_publishable_media");
    }
    const asset = state.mediaAssets.find((item) => item.id === variant.publishableAssetId && item.kind === "publishable");
    if (!asset?.isPublic) {
      post.status = "fallida";
      post.remoteErrorCode = "media_not_publicable";
      post.updatedAt = now();
      await this.persist();
      throw this.scheduledPostStateError("media_not_publicable");
    }
    const page = state.pages.find((item) => item.id === post.pageId && item.workspaceId === post.workspaceId);
    const pageAccessToken = decodeServerToken(page?.encryptedPageAccessToken);
    if (!pageAccessToken || !page?.metaPageId || page.metaPageId.startsWith("mock-")) return false;
    const publishImageUrl = publicMediaUrl(asset.id) ?? (post.imageUrl && /^https:\/\//i.test(post.imageUrl) ? post.imageUrl : null);
    if (!publishImageUrl) {
      post.status = "fallida";
      post.remoteErrorCode = "missing_public_media_url";
      post.updatedAt = now();
      await this.persist();
      throw this.scheduledPostStateError("missing_public_media_url");
    }
    const operationKey = `meta_schedule:${post.id}`;
    post.remoteStatus = "actualizacion_pendiente";
    post.updatedAt = now();
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: "meta",
      operation: "schedule_post",
      status: "started"
    });
    try {
      const graphApiVersion = post.graphApiVersion ?? process.env.META_GRAPH_API_VERSION ?? "v23.0";
      const fbUpload = await this.ensureFacebookPhotoUpload(state, {
        assetId: asset.id,
        facebookPageId: post.pageId,
        metaPageId: page.metaPageId,
        pageAccessToken,
        imageUrl: publishImageUrl,
        graphApiVersion
      });
      const publishResult = await publishFacebookPagePost({
        graphApiVersion,
        pageId: page.metaPageId,
        pageAccessToken,
        caption: post.caption ?? "",
        attachedMediaFbid: fbUpload.fbPhotoId,
        scheduledForUnix: post.scheduledForUnix ?? Math.floor(new Date(post.scheduledFor).getTime() / 1000)
      });
      post.facebookPostId = publishResult.facebookPostId;
      post.facebookPhotoId = fbUpload.fbPhotoId;
      post.facebookPhotoReused = fbUpload.reused;
      post.remotePostType = publishResult.remotePostType;
      post.remotePostUrl = publishResult.remotePostUrl;
      post.deliveryMode = "remote_schedule";
      post.remoteStatus = "confirmado_meta";
      post.lastRemoteSyncAt = now();
      post.imageUrl = publishImageUrl;
      const traceId = publishResult.providerTraceId ?? fbUpload.providerTraceId;
      if (traceId !== undefined) post.remoteTraceId = traceId;
      post.updatedAt = now();
      this.recordMediaAssetUsage(state, {
        assetId: asset.id,
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
    } catch (error) {
      post.status = "fallida";
      post.remoteStatus = "incierto";
      post.remoteErrorCode = error instanceof AppError ? error.code : "meta_schedule_failed";
      post.updatedAt = now();
      await this.upsertExternalOperation({
        operationKey,
        workspaceId: post.workspaceId,
        jobId: job.id,
        provider: "meta",
        operation: "schedule_post",
        status: "failed"
      });
      await this.persist();
      throw error;
    }
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
        if (!publishImageUrl) {
          post.status = "fallida";
          post.remoteStatus = "incierto";
          post.remoteErrorCode = "missing_public_media_url";
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
          return post;
        }
        const graphApiVersion = post.graphApiVersion ?? process.env.META_GRAPH_API_VERSION ?? "v23.0";
        const fbUpload = await this.ensureFacebookPhotoUpload(state, {
          assetId: asset.id,
          facebookPageId: post.pageId,
          metaPageId: page.metaPageId,
          pageAccessToken,
          imageUrl: publishImageUrl,
          graphApiVersion
        });
        const publishResult = await publishFacebookPagePost({
          graphApiVersion,
          pageId: page.metaPageId,
          pageAccessToken,
          caption: post.caption ?? "",
          attachedMediaFbid: fbUpload.fbPhotoId
        });
        post.facebookPostId = publishResult.facebookPostId;
        post.facebookPhotoId = fbUpload.fbPhotoId;
        post.facebookPhotoReused = fbUpload.reused;
        post.remotePostType = publishResult.remotePostType;
        post.remotePostUrl = publishResult.remotePostUrl;
        post.imageUrl = publishImageUrl;
        const traceId = publishResult.providerTraceId ?? fbUpload.providerTraceId;
        if (traceId !== undefined) post.remoteTraceId = traceId;
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
      const existingMockUpload = state.mediaAssetFbUploads.find(
        (upload) => upload.assetId === asset.id && upload.facebookPageId === post.pageId
      );
      post.facebookPhotoId = existingMockUpload?.fbPhotoId ?? `mock_photo_${asset.id}_${post.pageId}`;
      post.facebookPhotoReused = Boolean(existingMockUpload);
      if (!existingMockUpload) {
        state.mediaAssetFbUploads.push({
          id: randomUUID(),
          assetId: asset.id,
          facebookPageId: post.pageId,
          fbPhotoId: post.facebookPhotoId,
          uploadedAt: timestamp,
          lastUsedAt: timestamp
        });
      }
      post.remotePostType = "photo";
      post.remotePostUrl = `https://facebook.example/posts/${post.facebookPostId}`;
    }
    post.deliveryMode = input.publishNow ? "publish_now" : post.deliveryMode;
    post.remoteStatus = "confirmado_meta";
    post.status = "publicada";
    post.lastRemoteSyncAt = timestamp;
    post.imageUrl = post.imageUrl ?? `local://public/${asset.bucket}/${asset.storageKey}`;
    post.updatedAt = timestamp;
    variant.status = "publicada";
    variant.updatedAt = timestamp;
    post.retryCount += input.publishNow ? 0 : 1;
    this.recordMediaAssetUsage(state, {
      assetId: asset.id,
      scheduledPostId: post.id,
      variantId: post.variantId,
      facebookPageId: post.pageId
    });
    await this.upsertExternalOperation({
      operationKey,
      workspaceId: post.workspaceId,
      jobId: job.id,
      provider: pageAccessToken ? "meta" : "meta_mock",
      operation: "publish_post",
      status: "succeeded"
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
      post.updatedAt = now();
      await this.persist();
      return { scheduledPost: post };
    }
    post.status = "cancelada";
    post.updatedAt = now();
    const variant = state.variants.find((item) => item.id === post.variantId);
    if (variant?.status === "programada") {
      variant.status = "aprobada";
      variant.updatedAt = post.updatedAt;
    }
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
    post.status = "publicacion_en_proceso";
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

  private requireMediaSelection(state: LocalState, workspaceId: string, userId: string, selectionId: string) {
    const selection = state.mediaSelections.find(
      (item) => item.id === selectionId && item.workspaceId === workspaceId && item.userId === userId
    );
    if (!selection) {
      throw new AppError({
        code: "media_selection_not_found",
        statusCode: 404,
        message: "Media selection not found",
        userMessage: "No encontramos esa seleccion.",
        retryable: false,
        action: "refresh"
      });
    }
    return selection;
  }

  private requireBatch(state: LocalState, workspaceId: string, businessId: string, batchId: string) {
    const batch = state.batches.find(
      (item) => item.id === batchId && item.workspaceId === workspaceId && item.businessId === businessId
    );
    if (!batch) {
      throw new AppError({
        code: "batch_not_found",
        statusCode: 404,
        message: "Batch not found",
        userMessage: "No encontramos ese lote.",
        retryable: false,
        action: "refresh"
      });
    }
    return batch;
  }

  private validPhotosForGeneration(state: LocalState, workspaceId: string, businessId: string, batchId: string) {
    return state.photos.filter(
      (photo) =>
        photo.workspaceId === workspaceId &&
        photo.businessId === businessId &&
        photo.batchId === batchId &&
        photo.status === "validada" &&
        Boolean(photo.originalAssetId)
    );
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

  private assignStyle(variantIndex: number, override?: GenerateStyleOverride, seed?: string | null): AssignedStyle {
    if (override) return this.manualStyle(variantIndex, override);
    const selected = variantStylePresetForSlot(variantIndex, seed);
    return {
      styleId: selected.styleId,
      styleName: selected.styleName,
      intensity: "media" as const,
      contrast: 0.48,
      saturation: selected.saturation + 0.2,
      warmth: selected.warmth,
      sharpness: 0.42,
      lowConfidence: false,
      manualOverride: false
    };
  }

  private manualStyle(
    variantIndex: number,
    override: GenerateStyleOverride
  ): AssignedStyle {
    const selected = variantStylePresetForSlot(variantIndex, null, override.styleId);
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
      this.state = mergeLocalState(emptyState(), { ...emptyState(), ...(JSON.parse(content) as Partial<LocalState>) });
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

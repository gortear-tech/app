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
  forbiddenError,
  MetaAuthorizationStatus,
  MetaPage,
  Photo,
  ScheduledPost,
  UploadIntent,
  User,
  Variant,
  variantStylePresetForIndex,
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
  StoredJob
} from "./types.js";
import { publishFacebookPagePost } from "@fbmaniaco/providers";

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
        userMessage: "Primero termina de subir y analizar las fotos antes de generar variantes.",
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
    const styleOverrides = new Map((input.styleOverrides ?? []).map((override) => [override.photoId, override]));
    for (const photo of validPhotos) {
      for (let index = 1; index <= input.variantsPerPhoto; index += 1) {
        const style = this.assignStyle(index, styleOverrides.get(photo.id));
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
      style: variant.assignedStyle ?? this.assignStyle(variant.variantIndex),
      promptVersion: "caption-page-context-v1"
    };
  }

  async completeGenerateVariant(input: Parameters<DataStore["completeGenerateVariant"]>[0]): Promise<Variant> {
    const state = await this.load();
    const job = this.requireJob(state, input.jobId);
    const variant = this.requireVariant(state, job.workspaceId, job.businessId, job.batchId, input.variantId);
    const photo = state.photos.find((item) => item.id === variant.photoId && item.workspaceId === variant.workspaceId);
    if (
      variant.generatedAssetId &&
      variant.generatedAssetId !== photo?.originalAssetId &&
      variant.caption &&
      ["generada", "aprobada", "rechazada"].includes(variant.status)
    ) {
      return variant;
    }
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
    if (!job.businessId) throw new Error("schedule_posts job is missing businessId");
    const batch = this.requireBatch(state, job.workspaceId, job.businessId, input.batchId);
    if (terminalBatchStatuses.has(batch.status)) return { scheduledPosts: [] };
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
        photo.visionAnalysis
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

  private assignStyle(variantIndex: number, override?: GenerateStyleOverride): AssignedStyle {
    if (override) return this.manualStyle(variantIndex, override);
    const selected = variantStylePresetForIndex(variantIndex);
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
    const selected = variantStylePresetForIndex(variantIndex, override.styleId);
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

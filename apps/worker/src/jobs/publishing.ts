import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ScheduledPostStatus =
  | "pendiente"
  | "programada"
  | "publicacion_en_proceso"
  | "publicada"
  | "estado_incierto"
  | "fallida"
  | "pausada_por_token"
  | "cancelada";

export type WorkerStatePage = {
  pageId: string;
  pageName: string;
  category?: string | null;
  categoryList?: Array<{ id?: string; name?: string }> | null;
  tasks?: string[] | null;
  coverPhotoUrl?: string | null;
  pageAccessTokenStatus?: string | null;
  isSelected: boolean;
  pageAccessToken?: string | null;
};

export type WorkerStateBusiness = {
  id: string;
  facebookPageId: string;
  name?: string | null;
  industry?: string | null;
  timezone?: string | null;
  tokenStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  autonomySettings?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WorkerStateBatch = {
  id: string;
  businessId: string;
  status: string;
  photosCount: number;
  variantsCount: number;
  estimatedCostUsd?: number | null;
  confirmedCostUsd?: number | null;
  lastActivityAt: string;
  variantsPerPhoto?: number | null;
  photoIds?: string[] | null;
  variantIds?: string[] | null;
  scheduledPostIds?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WorkerStatePhoto = {
  id: string;
  batchId: string;
  fileName?: string | null;
  storageKey?: string | null;
  uploadUrl?: string | null;
  status: string;
  visionAnalysis?: unknown;
  assignedStyle?: unknown;
  editingPrompt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WorkerStateVariant = {
  id: string;
  batchId: string;
  photoId: string;
  styleId: string;
  generationPlan?: unknown;
  promptUsed?: string | null;
  imageUrl?: string | null;
  caption?: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WorkerStateScheduledPost = {
  id: string;
  variantId: string;
  businessId: string;
  batchId: string;
  scheduledFor: string;
  facebookPostId?: string | null;
  status: ScheduledPostStatus;
  retryCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WorkerStateFile = {
  pages?: WorkerStatePage[];
  businesses?: WorkerStateBusiness[];
  batches?: WorkerStateBatch[];
  photos?: WorkerStatePhoto[];
  variants?: WorkerStateVariant[];
  scheduledPosts?: WorkerStateScheduledPost[];
  events?: Array<Record<string, unknown>>;
  autonomyByBusiness?: Array<[string, unknown]>;
  [key: string]: unknown;
};

export interface ScheduledPublishingJobData {
  scheduledPostId: string;
  negocioId: string;
  batchId: string;
  trigger: "schedule" | "manual";
  requestedAt: string;
  scheduledFor?: string;
}

export interface StateStore {
  read(): WorkerStateFile;
  write(state: WorkerStateFile): void;
}

type StateWriteCallback = (state: WorkerStateFile) => void | Promise<void>;

const normalizeState = (state: WorkerStateFile): WorkerStateFile => ({
  ...state,
  pages: Array.isArray(state.pages) ? state.pages : [],
  businesses: Array.isArray(state.businesses) ? state.businesses : [],
  batches: Array.isArray(state.batches) ? state.batches : [],
  photos: Array.isArray(state.photos) ? state.photos : [],
  variants: Array.isArray(state.variants) ? state.variants : [],
  scheduledPosts: Array.isArray(state.scheduledPosts) ? state.scheduledPosts : [],
  events: Array.isArray(state.events) ? state.events : [],
  autonomyByBusiness: Array.isArray(state.autonomyByBusiness) ? state.autonomyByBusiness : [],
});

export function createStateStore(stateFilePath: string, onWrite?: StateWriteCallback): StateStore {
  const read = (): WorkerStateFile => {
    try {
      if (!existsSync(stateFilePath)) {
        return normalizeState({});
      }
      const raw = readFileSync(stateFilePath, "utf8");
      return raw.trim() ? normalizeState(JSON.parse(raw) as WorkerStateFile) : normalizeState({});
    } catch (error) {
      console.warn("[worker] unable to read state file", error);
      return normalizeState({});
    }
  };

  const write = (state: WorkerStateFile): void => {
    try {
      const normalized = normalizeState(state);
      const directory = dirname(stateFilePath);
      mkdirSync(directory, { recursive: true });
      writeFileSync(stateFilePath, JSON.stringify(normalized, null, 2), "utf8");
      if (onWrite) {
        void Promise.resolve(onWrite(normalized)).catch((error) => {
          console.warn("[worker] unable to sync Supabase planner mirror", error);
        });
      }
    } catch (error) {
      console.warn("[worker] unable to write state file", error);
    }
  };

  return { read, write };
}

const publishFeedPost = async (pageId: string, accessToken: string, message: string, scheduledFor: string): Promise<string> => {
  const body = new URLSearchParams();
  body.set("access_token", accessToken);
  body.set("message", message);
  body.set("published", "true");

  const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(pageId)}/feed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message ?? `Facebook feed publish failed at ${scheduledFor}`);
  }
  return json.id;
};

const publishPhotoPost = async (pageId: string, accessToken: string, imageUrl: string, message: string, scheduledFor: string): Promise<string> => {
  const form = new FormData();
  form.set("access_token", accessToken);
  form.set("published", "true");
  form.set("message", message);

  if (imageUrl.startsWith("data:")) {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    form.set("source", blob, "fbmaniaco-image.jpg");
  } else {
    form.set("url", imageUrl);
  }

  const response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(pageId)}/photos`, {
    method: "POST",
    body: form,
  });

  const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message ?? `Facebook photo publish failed at ${scheduledFor}`);
  }
  return json.id;
};

const isTokenProblem = (message: string): boolean => /token|oauth|permission|expired|invalid|permissions/i.test(message);

const appendEvent = (state: WorkerStateFile, event: Record<string, unknown>): void => {
  const events = Array.isArray(state.events) ? state.events : [];
  events.push(event);
  state.events = events;
};

const normalizeImageUrl = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname.endsWith(".local")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

const updateScheduledPostInState = (
  state: WorkerStateFile,
  scheduledPost: WorkerStateScheduledPost,
  patch: Partial<WorkerStateScheduledPost>,
): void => {
  Object.assign(scheduledPost, patch);
  state.scheduledPosts = (state.scheduledPosts ?? []).map((entry) => (entry.id === scheduledPost.id ? scheduledPost : entry));
};

export async function processScheduledPostById(
  stateStore: StateStore,
  scheduledPostId: string,
  expectedScheduledFor?: string,
  requestedAt = new Date().toISOString(),
): Promise<{ ok: true; skipped?: boolean; facebookPostId?: string }> {
  const state = stateStore.read();
  const scheduledPost = (state.scheduledPosts ?? []).find((entry) => entry.id === scheduledPostId);

  if (!scheduledPost) {
    return { ok: true, skipped: true };
  }

  if (scheduledPost.status !== "programada") {
    return { ok: true, skipped: true };
  }

  if (expectedScheduledFor && scheduledPost.scheduledFor !== expectedScheduledFor) {
    return { ok: true, skipped: true };
  }

  const business = (state.businesses ?? []).find((entry) => entry.id === scheduledPost.businessId);
  const variant = (state.variants ?? []).find((entry) => entry.id === scheduledPost.variantId);

  updateScheduledPostInState(state, scheduledPost, {
    status: "publicacion_en_proceso",
    updatedAt: requestedAt,
  });
  stateStore.write(state);

  if (scheduledPost.facebookPostId) {
    updateScheduledPostInState(state, scheduledPost, {
      status: "publicada",
      updatedAt: requestedAt,
    });
    if (variant) {
      variant.status = "publicada";
      variant.updatedAt = requestedAt;
    }
    appendEvent(state, {
      negocioId: scheduledPost.businessId,
      type: "post_publicado",
      occurredAt: requestedAt,
      styleId: variant?.styleId,
      captionPattern: variant?.caption ?? undefined,
      score: 1,
      scheduledFor: scheduledPost.scheduledFor,
    });
    stateStore.write(state);
    return { ok: true, facebookPostId: scheduledPost.facebookPostId, skipped: true };
  }

  const page = business ? (state.pages ?? []).find((entry) => entry.pageId === business.facebookPageId) : null;
  const accessToken = page?.pageAccessToken?.trim() ?? "";

  if (!business || !variant || !page || !accessToken) {
    updateScheduledPostInState(state, scheduledPost, {
      status: "pausada_por_token",
      retryCount: scheduledPost.retryCount + 1,
      updatedAt: requestedAt,
    });
    if (variant) {
      variant.status = "pausada_por_token";
      variant.updatedAt = requestedAt;
    }
    appendEvent(state, {
      negocioId: scheduledPost.businessId,
      type: "post_fallido",
      occurredAt: requestedAt,
      scheduledFor: scheduledPost.scheduledFor,
      errorMessage: "missing_page_token",
    });
    stateStore.write(state);
    return { ok: true, skipped: true };
  }

  try {
    const renderableImageUrl = normalizeImageUrl(variant.imageUrl);
    const postId = renderableImageUrl
      ? await publishPhotoPost(page.pageId, accessToken, renderableImageUrl, variant.caption ?? "", scheduledPost.scheduledFor)
      : await publishFeedPost(page.pageId, accessToken, variant.caption ?? "", scheduledPost.scheduledFor);

    updateScheduledPostInState(state, scheduledPost, {
      facebookPostId: postId,
      status: "publicada",
      updatedAt: requestedAt,
    });
    if (variant) {
      variant.status = "publicada";
      variant.updatedAt = requestedAt;
    }
    appendEvent(state, {
      negocioId: scheduledPost.businessId,
      type: "post_publicado",
      occurredAt: requestedAt,
      styleId: variant.styleId,
      captionPattern: variant.caption ?? undefined,
      score: 1,
      scheduledFor: scheduledPost.scheduledFor,
    });
    stateStore.write(state);
    return { ok: true, facebookPostId: postId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateScheduledPostInState(state, scheduledPost, {
      status: isTokenProblem(message) ? "pausada_por_token" : "fallida",
      retryCount: scheduledPost.retryCount + 1,
      updatedAt: requestedAt,
    });
    if (variant) {
      variant.status = isTokenProblem(message) ? "pausada_por_token" : "fallida";
      variant.updatedAt = requestedAt;
    }
    appendEvent(state, {
      negocioId: scheduledPost.businessId,
      type: "post_fallido",
      occurredAt: requestedAt,
      styleId: variant?.styleId,
      captionPattern: variant?.caption ?? undefined,
      score: 0,
      scheduledFor: scheduledPost.scheduledFor,
      errorMessage: message,
    });
    stateStore.write(state);
    throw error;
  }
}

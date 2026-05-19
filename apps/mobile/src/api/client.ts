import {
  BatchDetail,
  BatchMutationResponse,
  BatchSummary,
  BootstrapStatus,
  Business,
  BusinessDetailResponse,
  ConfirmCalendarResponse,
  GenerateBatchResponse,
  GenerateBatchStyleOverride,
  MetaConnectResponse,
  MetaPage,
  MobileAuthSessionResponse,
  ScheduledPost,
  ScheduledPostMutationResponse,
  ScheduledPostsResponse,
  VariantMutationResponse
} from "@fbmaniaco/shared";
import * as SecureStore from "expo-secure-store";
import { getMobileConfig } from "../config";

const LEGACY_SESSION_TOKEN_KEY = "fbmaniaco.sessionToken";
const SESSION_KEY = "fbmaniaco.authSession.v1";
const REFRESH_WINDOW_SECONDS = 90;

type StoredAuthSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  userId?: string;
  email?: string;
};

let memorySession: StoredAuthSession | null = null;

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly userMessage?: string;
  public readonly action?: string;

  constructor(input: { status: number; message: string; code?: string; userMessage?: string; action?: string }) {
    super(input.message);
    this.status = input.status;
    if (input.code) this.code = input.code;
    if (input.userMessage) this.userMessage = input.userMessage;
    if (input.action) this.action = input.action;
  }
}

export const isAuthSessionError = (error: unknown) =>
  error instanceof ApiClientError && (error.status === 401 || error.code === "unauthorized");

const responseJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const json = (await response.json()) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const stringField = (json: Record<string, unknown>, key: string) => {
  const value = json[key];
  return typeof value === "string" ? value : undefined;
};

const apiError = (response: Response, json: Record<string, unknown>, fallback: string) => {
  const code = stringField(json, "code") ?? stringField(json, "error");
  const userMessage = stringField(json, "userMessage");
  const action = stringField(json, "action");
  const input: { status: number; message: string; code?: string; userMessage?: string; action?: string } = {
    status: response.status,
    message: userMessage ?? stringField(json, "error_description") ?? stringField(json, "msg") ?? stringField(json, "error") ?? fallback
  };
  if (code) input.code = code;
  if (userMessage) input.userMessage = userMessage;
  if (action) input.action = action;
  return new ApiClientError(input);
};

const jsonRequest = async (url: string, init: RequestInit, fallback: string) => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ApiClientError({
      status: 0,
      code: "network_request_failed",
      userMessage: "No pudimos llegar al servidor. Revisa internet e intenta de nuevo.",
      message: error instanceof Error ? error.message : "Network request failed"
    });
  }
  const json = await responseJson(response);
  if (!response.ok) throw apiError(response, json, fallback);
  return json;
};

const canUseSecureStore = async () => {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
};

export const getStoredSessionToken = async () => {
  const session = await getStoredSession();
  if (!session?.accessToken) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!session.refreshToken && session.expiresAt && session.expiresAt <= now) {
    await clearStoredSession();
    return null;
  }
  if (session.refreshToken && session.expiresAt && session.expiresAt - now <= REFRESH_WINDOW_SECONDS) {
    try {
      const refreshed = await refreshStoredSession(session.refreshToken);
      return refreshed.accessToken;
    } catch (error) {
      if (session.expiresAt <= now || isAuthSessionError(error)) {
        await clearStoredSession();
        return null;
      }
      return session.accessToken;
    }
  }
  return session.accessToken;
};

const getStoredSession = async (): Promise<StoredAuthSession | null> => {
  if (memorySession?.accessToken) return memorySession;
  if (await canUseSecureStore()) {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (raw) {
      try {
        memorySession = JSON.parse(raw) as StoredAuthSession;
        return memorySession;
      } catch {
        await SecureStore.deleteItemAsync(SESSION_KEY);
      }
    }
    const legacyToken = await SecureStore.getItemAsync(LEGACY_SESSION_TOKEN_KEY);
    if (legacyToken) {
      memorySession = { accessToken: legacyToken };
      return memorySession;
    }
  }
  return memorySession;
};

const storeSession = async (session: StoredAuthSession) => {
  memorySession = session;
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    await SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY);
  }
};

export const clearStoredSession = async () => {
  memorySession = null;
  if (await canUseSecureStore()) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await SecureStore.deleteItemAsync(LEGACY_SESSION_TOKEN_KEY);
  }
};

const mobileAuthRequest = async (path: "anonymous" | "refresh", body: Record<string, unknown>): Promise<MobileAuthSessionResponse> => {
  const { apiUrl } = getMobileConfig();
  const json = await jsonRequest(`${apiUrl}/auth/mobile/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify(body)
  }, "No pudimos iniciar sesion.");
  return json as MobileAuthSessionResponse;
};

const sessionFromApiResponse = (json: MobileAuthSessionResponse): StoredAuthSession => {
  if (!json.accessToken) throw new Error("Supabase no regreso una sesion valida.");
  const session: StoredAuthSession = {
    accessToken: json.accessToken,
    ...(json.refreshToken ? { refreshToken: json.refreshToken } : {}),
    ...(json.expiresAt ? { expiresAt: json.expiresAt } : {}),
    ...(json.tokenType ? { tokenType: json.tokenType } : {}),
    ...(json.user?.id ? { userId: json.user.id } : {}),
    ...(json.user?.email ? { email: json.user.email } : {})
  };
  return session;
};

const refreshStoredSession = async (refreshToken: string) => {
  const json = await mobileAuthRequest("refresh", { refreshToken });
  const session = sessionFromApiResponse(json);
  await storeSession(session);
  return session;
};

export const startAnonymousSession = async () => {
  const json = await mobileAuthRequest("anonymous", {});
  const session = sessionFromApiResponse(json);
  await storeSession(session);
  return session;
};

export const ensureSessionForMeta = async () => {
  const token = await getStoredSessionToken();
  if (token) return token;
  const session = await startAnonymousSession();
  return session.accessToken;
};

export const getBootstrapStatus = async (token: string): Promise<BootstrapStatus> => {
  const { apiUrl } = getMobileConfig();
  const json = await jsonRequest(`${apiUrl}/auth/bootstrap-status`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos iniciar FBmaniaco.");
  return json as BootstrapStatus;
};

const idempotencyKey = (scope: string) => `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const transientUploadStatus = (status: number) => status === 408 || status === 429 || status >= 500;
const duplicateUploadResponse = (status: number, body: string) => status === 409 || /already exists|resource already exists|duplicate/i.test(body);

const uploadToSignedStorage = async (input: {
  uploadUrl: string;
  method: string;
  headers?: Record<string, string>;
  uri: string;
  fileName: string;
  contentType: string;
}) => {
  const retryDelays = [0, 1200, 3000];
  let lastResponseText = "";
  let lastStatus = 0;
  for (const [attempt, delay] of retryDelays.entries()) {
    if (delay > 0) await wait(delay);
    const uploadBody = new FormData();
    uploadBody.append("cacheControl", "3600");
    uploadBody.append("", {
      uri: input.uri,
      name: input.fileName,
      type: input.contentType
    } as unknown as Blob);
    try {
      const response = await fetch(input.uploadUrl, {
        method: input.method,
        headers: {
          "x-upsert": "false",
          ...(input.headers ?? {})
        },
        body: uploadBody
      });
      if (response.ok) return;
      lastStatus = response.status;
      lastResponseText = await response.text().catch(() => "");
      if (duplicateUploadResponse(response.status, lastResponseText)) return;
      if (!transientUploadStatus(response.status) || attempt === retryDelays.length - 1) break;
    } catch (error) {
      lastResponseText = error instanceof Error ? error.message : "network_error";
      if (attempt === retryDelays.length - 1) break;
    }
  }
  const detailSuffix = lastResponseText ? ` (${lastStatus || "red"}: ${lastResponseText.slice(0, 140)})` : lastStatus ? ` (${lastStatus})` : "";
  if (lastStatus === 413) throw new Error("La foto pesa demasiado. Intenta con una imagen mas ligera.");
  throw new Error(`No pudimos subir la foto al almacenamiento${detailSuffix}`);
};

export const connectMeta = async (token: string, flow: "oauth" | "device_login" = "oauth"): Promise<MetaConnectResponse> => {
  const { apiUrl } = getMobileConfig();
  const json = await jsonRequest(`${apiUrl}/auth/meta/connect`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("meta-connect"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ flow })
  }, "No pudimos conectar Facebook.");
  return json as MetaConnectResponse;
};

export const listMetaPages = async (token: string): Promise<MetaPage[]> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/meta/pages`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer tus paginas.");
  return json.pages as MetaPage[];
};

export const selectMetaPage = async (token: string, pageId: string): Promise<{ business: Business; bootstrap: BootstrapStatus }> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/meta/pages/select`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("select-page"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ pageId })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos seleccionar esa pagina.");
  return json as { business: Business; bootstrap: BootstrapStatus };
};

export const getBusinessDetail = async (token: string, businessId: string): Promise<BusinessDetailResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer la configuracion del negocio.");
  return json as BusinessDetailResponse;
};

export const getActiveBatch = async (token: string, businessId: string): Promise<BatchSummary | null> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/active`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer el lote activo.");
  return (json.batches?.[0] ?? null) as BatchSummary | null;
};

export const listBatches = async (token: string, businessId: string): Promise<BatchSummary[]> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer tus lotes.");
  return (json.batches ?? []) as BatchSummary[];
};

export const createBatch = async (token: string, businessId: string): Promise<BatchSummary> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("create-batch"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos crear el lote.");
  return json.batch as BatchSummary;
};

export const getBatchDetail = async (token: string, businessId: string, batchId: string): Promise<BatchDetail> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer ese lote.");
  return json as BatchDetail;
};

export const deleteBatch = async (token: string, businessId: string, batchId: string): Promise<BatchMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": idempotencyKey("delete-batch"),
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos eliminar ese lote.");
  return json as BatchMutationResponse;
};

export type PhotoUploadFile = {
  uri: string;
  name: string;
  contentType: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export const uploadPhoto = async (token: string, businessId: string, batchId: string, file: PhotoUploadFile) => {
  const { apiUrl } = getMobileConfig();
  const fileName = file.name || `foto-${Date.now()}.jpg`;
  let fileSize = file.fileSize;
  if (fileSize === undefined) {
    const source = await fetch(file.uri);
    if (!source.ok) throw new Error("No pudimos leer la foto seleccionada.");
    const blob = await source.blob();
    fileSize = blob.size;
  }
  const intentResponse = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/photos/upload-intent`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("upload-intent"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ originalFileName: fileName, contentType: file.contentType, fileSize })
  });
  const intentJson = await intentResponse.json();
  if (!intentResponse.ok) throw new Error(intentJson.userMessage ?? "No pudimos preparar la foto.");

  await uploadToSignedStorage({
    uploadUrl: intentJson.upload.uploadUrl,
    method: intentJson.upload.method,
    headers: intentJson.upload.headers ?? {},
    uri: file.uri,
    fileName,
    contentType: file.contentType
  });

  const completeResponse = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/photos/complete-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("complete-upload"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({
      storageKey: intentJson.uploadIntent.storageKey,
      originalFileName: fileName,
      contentType: file.contentType,
      fileSize,
      width: file.width,
      height: file.height
    })
  });
  const completeJson = await completeResponse.json();
  if (!completeResponse.ok) throw new Error(completeJson.userMessage ?? "No pudimos confirmar la foto.");
  return completeJson;
};

export const generateBatchVariants = async (
  token: string,
  businessId: string,
  batchId: string,
  variantsPerPhoto: number,
  styleOverrides?: GenerateBatchStyleOverride[]
): Promise<GenerateBatchResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("generate-batch"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ variantsPerPhoto, ...(styleOverrides?.length ? { styleOverrides } : {}) })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos generar variantes.");
  return json as GenerateBatchResponse;
};

export const updateVariantCaption = async (
  token: string,
  businessId: string,
  batchId: string,
  variantId: string,
  caption: string
): Promise<VariantMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/variants/${variantId}/caption`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("variant-caption"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ caption })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos editar el caption.");
  return json as VariantMutationResponse;
};

export const approveVariant = async (
  token: string,
  businessId: string,
  batchId: string,
  variantId: string
): Promise<VariantMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/variants/${variantId}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("approve-variant"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos aprobar la variante.");
  return json as VariantMutationResponse;
};

export const rejectVariant = async (
  token: string,
  businessId: string,
  batchId: string,
  variantId: string
): Promise<VariantMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/variants/${variantId}/reject`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("reject-variant"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos rechazar la variante.");
  return json as VariantMutationResponse;
};

export const confirmCalendar = async (
  token: string,
  businessId: string,
  batchId: string,
  periodDays: 7 | 14 | 30
): Promise<ConfirmCalendarResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/calendar/confirm`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("confirm-calendar"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ periodDays })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos confirmar el calendario.");
  return json as ConfirmCalendarResponse;
};

export const listScheduledPosts = async (token: string, businessId: string): Promise<ScheduledPost[]> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/scheduled-posts`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer el calendario.");
  return (json as ScheduledPostsResponse).scheduledPosts;
};

export const publishScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string
): Promise<ScheduledPostMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/publish`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("publish-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos publicar ahora.");
  return json as ScheduledPostMutationResponse;
};

export const cancelScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string
): Promise<ScheduledPostMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/cancel`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("cancel-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos cancelar la publicacion.");
  return json as ScheduledPostMutationResponse;
};

export const updateScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string,
  scheduledFor: string
): Promise<ScheduledPostMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("update-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ scheduledFor })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos reprogramar la publicacion.");
  return json as ScheduledPostMutationResponse;
};

export const retryScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string
): Promise<ScheduledPostMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/retry`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("retry-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos reintentar la publicacion.");
  return json as ScheduledPostMutationResponse;
};

import {
  BatchDetail,
  BatchMutationResponse,
  BatchSummary,
  BootstrapStatus,
  Business,
  BusinessDetailResponse,
  BusinessMutationResponse,
  ConfirmCalendarResponse,
  GenerateBatchResponse,
  GenerateBatchStyleOverride,
  GalleryMediaAsset,
  MediaAssetsResponse,
  MediaCategory,
  MediaSelection,
  MenuIngestResponse,
  MenuItem,
  MenuItemsResponse,
  MetaConnectResponse,
  MetaPage,
  MobileAuthSessionResponse,
  ScheduledPost,
  ScheduledPostMutationResponse,
  ScheduledPostsResponse,
  UpdateBusinessBody,
  VariantMutationResponse
} from "@fbmaniaco/shared";
import * as SecureStore from "expo-secure-store";
import { getMobileConfig } from "../config";

type MediaSelectionMutationResponse = {
  schemaVersion: "media_selection_mutation.v1";
  selection: MediaSelection;
  requestId: string;
};

type BatchUploadIntentResponse = {
  uploadIntent: { storageKey: string };
  upload: {
    uploadUrl: string;
    method: "PUT";
    headers?: Record<string, string>;
  };
};

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
let refreshInFlight: Promise<StoredAuthSession> | null = null;

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
  error instanceof ApiClientError &&
  (error.status === 401 || error.code === "unauthorized" || error.code === "session_refresh_invalid");

export const isTransientSessionError = (error: unknown) =>
  error instanceof ApiClientError &&
  (error.status === 0 || error.status >= 500 || error.code === "network_request_failed" || error.code === "mobile_session_failed");

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

const getHeaderValue = (headers: HeadersInit | undefined, key: string) => {
  if (!headers) return undefined;
  const lowerKey = key.toLowerCase();
  if (headers instanceof Headers) return headers.get(key) ?? undefined;
  if (Array.isArray(headers)) {
    const pair = headers.find(([name]) => name.toLowerCase() === lowerKey);
    return pair ? String(pair[1]) : undefined;
  }
  const record = headers as Record<string, string>;
  const match = Object.keys(record).find((name) => name.toLowerCase() === lowerKey);
  return match ? record[match] : undefined;
};

const setHeaderValue = (headers: HeadersInit | undefined, key: string, value: string): HeadersInit => {
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    next.set(key, value);
    return next;
  }
  if (Array.isArray(headers)) {
    return [...headers.filter(([name]) => name.toLowerCase() !== key.toLowerCase()), [key, value]];
  }
  return { ...(headers as Record<string, string> | undefined), [key]: value };
};

const jsonRequest = async (url: string, init: RequestInit, fallback: string, allowAuthRetry = true): Promise<Record<string, unknown>> => {
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
  if (!response.ok) {
    const error = apiError(response, json, fallback);
    const authorization = getHeaderValue(init.headers, "authorization");
    if (allowAuthRetry && isAuthSessionError(error) && authorization?.toLowerCase().startsWith("bearer ")) {
      const refreshedToken = await refreshStoredSessionToken();
      if (refreshedToken) {
        return jsonRequest(
          url,
          {
            ...init,
            headers: setHeaderValue(init.headers, "authorization", `Bearer ${refreshedToken}`)
          },
          fallback,
          false
        );
      }
    }
    throw error;
  }
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
      if (isAuthSessionError(error)) {
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
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const json = await mobileAuthRequest("refresh", { refreshToken });
      const session = sessionFromApiResponse(json);
      await storeSession(session);
      return session;
    })();
  }
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
};

export const refreshStoredSessionToken = async () => {
  const session = await getStoredSession();
  if (!session?.refreshToken) return null;
  try {
    const refreshed = await refreshStoredSession(session.refreshToken);
    return refreshed.accessToken;
  } catch (error) {
    if (isAuthSessionError(error)) {
      await clearStoredSession();
      return null;
    }
    throw error;
  }
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
  }, "No pudimos iniciar Maniaco.");
  return json as BootstrapStatus;
};

const idempotencyKey = (scope: string) => `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const authorizedJsonRequest = async (token: string, path: string, init: RequestInit, fallback: string) => {
  const { apiUrl } = getMobileConfig();
  return jsonRequest(
    `${apiUrl}${path}`,
    {
      ...init,
      headers: setHeaderValue(init.headers, "authorization", `Bearer ${token}`)
    },
    fallback
  );
};
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
  const json = await authorizedJsonRequest(token, "/meta/pages", {
    headers: {
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer tus paginas.");
  return json.pages as MetaPage[];
};

export const selectMetaPage = async (token: string, pageId: string): Promise<{ business: Business; bootstrap: BootstrapStatus }> => {
  const json = await authorizedJsonRequest(token, "/meta/pages/select", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("select-page"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ pageId })
  }, "No pudimos seleccionar esa pagina.");
  return json as { business: Business; bootstrap: BootstrapStatus };
};

export const getBusinessDetail = async (token: string, businessId: string): Promise<BusinessDetailResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}`, {
    headers: {
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer la configuracion del negocio.");
  return json as BusinessDetailResponse;
};

export const updateBusiness = async (
  token: string,
  businessId: string,
  body: UpdateBusinessBody
): Promise<BusinessMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("update-business"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify(body)
  }, "No pudimos guardar los ajustes.");
  return json as BusinessMutationResponse;
};

export const getActiveBatch = async (token: string, businessId: string): Promise<BatchSummary | null> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/active`, {
    headers: {
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer el lote activo.");
  const batches = Array.isArray(json.batches) ? json.batches : [];
  return (batches[0] ?? null) as BatchSummary | null;
};

export const listBatches = async (token: string, businessId: string): Promise<BatchSummary[]> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches`, {
    headers: {
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer tus lotes.");
  return (json.batches ?? []) as BatchSummary[];
};

export const createBatch = async (token: string, businessId: string): Promise<BatchSummary> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("create-batch"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  }, "No pudimos crear el lote.");
  return json.batch as BatchSummary;
};

export const getBatchDetail = async (token: string, businessId: string, batchId: string): Promise<BatchDetail> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}`, {
    headers: {
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer ese lote.");
  return json as BatchDetail;
};

export const deleteBatch = async (token: string, businessId: string, batchId: string): Promise<BatchMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}`, {
    method: "DELETE",
    headers: {
      "idempotency-key": idempotencyKey("delete-batch"),
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos eliminar ese lote.");
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
  const fileName = file.name || `foto-${Date.now()}.jpg`;
  let fileSize = file.fileSize;
  if (fileSize === undefined) {
    const source = await fetch(file.uri);
    if (!source.ok) throw new Error("No pudimos leer la foto seleccionada.");
    const blob = await source.blob();
    fileSize = blob.size;
  }
  const intentJson = (await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/photos/upload-intent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("upload-intent"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ originalFileName: fileName, contentType: file.contentType, fileSize })
  }, "No pudimos preparar la foto.")) as BatchUploadIntentResponse;

  await uploadToSignedStorage({
    uploadUrl: intentJson.upload.uploadUrl,
    method: intentJson.upload.method,
    headers: intentJson.upload.headers ?? {},
    uri: file.uri,
    fileName,
    contentType: file.contentType
  });

  const completeJson = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/photos/complete-upload`, {
    method: "POST",
    headers: {
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
  }, "No pudimos confirmar la foto.");
  return completeJson;
};

export const listMediaAssets = async (
  token: string,
  input: {
    workspaceId: string;
    categoryId?: string;
    search?: string;
    unused?: boolean;
    archived?: boolean;
    limit?: number;
  }
): Promise<MediaAssetsResponse> => {
  const { apiUrl } = getMobileConfig();
  const params = new URLSearchParams({ workspaceId: input.workspaceId });
  if (input.categoryId) params.set("categoryId", input.categoryId);
  if (input.search) params.set("search", input.search);
  if (input.unused !== undefined) params.set("unused", String(input.unused));
  if (input.archived !== undefined) params.set("archived", String(input.archived));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const json = await jsonRequest(`${apiUrl}/media/assets?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer la galeria.");
  return json as MediaAssetsResponse;
};

export const listMediaCategories = async (token: string, workspaceId: string): Promise<MediaCategory[]> => {
  const { apiUrl } = getMobileConfig();
  const params = new URLSearchParams({ workspaceId });
  const json = await jsonRequest(`${apiUrl}/media/categories?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer categorias.");
  return (json.categories ?? []) as MediaCategory[];
};

export const ingestMenuText = async (
  token: string,
  input: { workspaceId: string; businessId?: string; text: string }
): Promise<MenuIngestResponse> => {
  const { apiUrl } = getMobileConfig();
  const json = await jsonRequest(`${apiUrl}/menu/ingest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("menu-ingest"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      sourceType: "text",
      text: input.text
    })
  }, "No pudimos importar el menu.");
  return json as MenuIngestResponse;
};

export const listMenuItems = async (token: string, workspaceId: string): Promise<MenuItem[]> => {
  const { apiUrl } = getMobileConfig();
  const params = new URLSearchParams({ workspaceId });
  const json = await jsonRequest(`${apiUrl}/menu/items?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer el menu importado.");
  return ((json as MenuItemsResponse).items ?? []) as MenuItem[];
};

export const listMediaSelections = async (token: string, workspaceId: string): Promise<MediaSelection[]> => {
  const { apiUrl } = getMobileConfig();
  const params = new URLSearchParams({ workspaceId });
  const json = await jsonRequest(`${apiUrl}/media/selections/active?${params.toString()}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer la seleccion activa.");
  return (json.selections ?? []) as MediaSelection[];
};

export const createMediaSelection = async (
  token: string,
  body: { workspaceId: string; name?: string; assetIds?: string[]; metadata?: Record<string, unknown> }
): Promise<MediaSelectionMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const json = await jsonRequest(`${apiUrl}/media/selections`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("media-selection"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify(body)
  }, "No pudimos crear la seleccion.");
  return json as MediaSelectionMutationResponse;
};

export const updateMediaSelection = async (
  token: string,
  selectionId: string,
  body: { name?: string | null; assetIds?: string[]; metadata?: Record<string, unknown> }
): Promise<MediaSelectionMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const json = await jsonRequest(`${apiUrl}/media/selections/${selectionId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("media-selection-update"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify(body)
  }, "No pudimos guardar la seleccion.");
  return json as MediaSelectionMutationResponse;
};

export const uploadGalleryAsset = async (
  token: string,
  businessId: string,
  file: PhotoUploadFile,
  sha256: string,
  workspaceId?: string
): Promise<GalleryMediaAsset> => {
  const { apiUrl } = getMobileConfig();
  const fileName = file.name || `foto-${Date.now()}.jpg`;
  let fileSize = file.fileSize;
  if (fileSize === undefined) {
    const source = await fetch(file.uri);
    if (!source.ok) throw new Error("No pudimos leer la foto seleccionada.");
    fileSize = (await source.blob()).size;
  }
  const intentJson = await jsonRequest(`${apiUrl}/media/upload-intent`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("media-upload-intent"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({
      businessId,
      sha256,
      bytes: fileSize,
      mime: file.contentType,
      originalName: fileName,
      width: file.width,
      height: file.height
    })
  }, "No pudimos preparar la foto para galeria.");
  if (intentJson.exists && intentJson.asset) return intentJson.asset as GalleryMediaAsset;
  if (!intentJson.uploadUrl || !intentJson.storagePath || !intentJson.assetId) {
    throw new Error("La galeria no regreso una URL de subida valida.");
  }

  await uploadToSignedStorage({
    uploadUrl: String(intentJson.uploadUrl),
    method: "PUT",
    headers: {},
    uri: file.uri,
    fileName,
    contentType: file.contentType
  });

  await jsonRequest(`${apiUrl}/media/upload-complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("media-upload-complete"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({
      assetId: intentJson.assetId,
      storagePath: intentJson.storagePath
    })
  }, "No pudimos confirmar la foto de galeria.");

  return {
    ...(intentJson.asset as GalleryMediaAsset),
    id: String(intentJson.assetId),
    status: "processing"
  };
};

export const generateBatchVariants = async (
  token: string,
  businessId: string,
  batchId: string,
  variantsPerPhoto: number,
  styleOverrides?: GenerateBatchStyleOverride[]
): Promise<GenerateBatchResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("generate-batch"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ variantsPerPhoto, ...(styleOverrides?.length ? { styleOverrides } : {}) })
  }, "No pudimos generar variantes.");
  return json as GenerateBatchResponse;
};

export const updateVariantCaption = async (
  token: string,
  businessId: string,
  batchId: string,
  variantId: string,
  caption: string
): Promise<VariantMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/variants/${variantId}/caption`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("variant-caption"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ caption })
  }, "No pudimos editar el caption.");
  return json as VariantMutationResponse;
};

export const approveVariant = async (
  token: string,
  businessId: string,
  batchId: string,
  variantId: string
): Promise<VariantMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/variants/${variantId}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("approve-variant"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  }, "No pudimos aprobar la variante.");
  return json as VariantMutationResponse;
};

export const rejectVariant = async (
  token: string,
  businessId: string,
  batchId: string,
  variantId: string
): Promise<VariantMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/variants/${variantId}/reject`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("reject-variant"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  }, "No pudimos rechazar la variante.");
  return json as VariantMutationResponse;
};

export const confirmCalendar = async (
  token: string,
  businessId: string,
  batchId: string,
  periodDays: 7 | 14 | 30
): Promise<ConfirmCalendarResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/calendar/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("confirm-calendar"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ periodDays })
  }, "No pudimos confirmar el calendario.");
  return json as ConfirmCalendarResponse;
};

export const listScheduledPosts = async (token: string, businessId: string): Promise<ScheduledPost[]> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/scheduled-posts`, {
    headers: {
      "x-request-id": `mobile-${Date.now()}`
    }
  }, "No pudimos leer el calendario.");
  return (json as ScheduledPostsResponse).scheduledPosts;
};

export const publishScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string
): Promise<ScheduledPostMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("publish-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  }, "No pudimos publicar ahora.");
  return json as ScheduledPostMutationResponse;
};

export const cancelScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string
): Promise<ScheduledPostMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("cancel-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  }, "No pudimos cancelar la publicacion.");
  return json as ScheduledPostMutationResponse;
};

export const updateScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string,
  scheduledFor: string
): Promise<ScheduledPostMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("update-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ scheduledFor })
  }, "No pudimos reprogramar la publicacion.");
  return json as ScheduledPostMutationResponse;
};

export const retryScheduledPost = async (
  token: string,
  businessId: string,
  batchId: string,
  scheduledPostId: string
): Promise<ScheduledPostMutationResponse> => {
  const json = await authorizedJsonRequest(token, `/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/retry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("retry-post"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  }, "No pudimos reintentar la publicacion.");
  return json as ScheduledPostMutationResponse;
};

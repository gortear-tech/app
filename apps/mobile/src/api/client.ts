import {
  BatchDetail,
  BatchSummary,
  BatchCaptionEvalResponse,
  BootstrapStatus,
  Business,
  BusinessDetailResponse,
  BusinessMutationResponse,
  BillingStatusResponse,
  ConfirmCostResponse,
  ConfirmCalendarResponse,
  EstimateCostResponse,
  GenerateBatchResponse,
  MetricsCollectResponse,
  MetaConnectResponse,
  MetaPage,
  MobileAuthSessionResponse,
  PerformanceResponse,
  ScheduledPost,
  ScheduledPostMutationResponse,
  ScheduledPostsResponse,
  VariantMutationResponse,
  WeeklyReportGenerateResponse,
  WeeklyReportResponse
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
  if (session.refreshToken && session.expiresAt && session.expiresAt - Math.floor(Date.now() / 1000) <= REFRESH_WINDOW_SECONDS) {
    try {
      const refreshed = await refreshStoredSession(session.refreshToken);
      return refreshed.accessToken;
    } catch {
      await clearStoredSession();
      return null;
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
  const response = await fetch(`${apiUrl}/auth/mobile/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.userMessage ?? json.error_description ?? json.msg ?? json.error ?? "No pudimos iniciar sesion.");
  }
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
  try {
    const token = await getStoredSessionToken();
    if (token) {
      await getBootstrapStatus(token);
      return token;
    }
  } catch {
    await clearStoredSession();
  }
  const session = await startAnonymousSession();
  return session.accessToken;
};

export const getBootstrapStatus = async (token: string): Promise<BootstrapStatus> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/auth/bootstrap-status`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.userMessage ?? "No pudimos iniciar FBmaniaco.");
  }
  return json as BootstrapStatus;
};

const idempotencyKey = (scope: string) => `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const connectMeta = async (token: string, flow: "oauth" | "device_login" = "oauth"): Promise<MetaConnectResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/auth/meta/connect`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("meta-connect"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ flow })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos conectar Facebook.");
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

export const updateBusinessAutonomy = async (
  token: string,
  businessId: string,
  autonomySettings: Business["autonomySettings"]
): Promise<BusinessMutationResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("business-autonomy"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ autonomySettings })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos actualizar la autonomia.");
  return json as BusinessMutationResponse;
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
  const source = await fetch(file.uri);
  if (!source.ok) throw new Error("No pudimos leer la foto seleccionada.");
  const blob = await source.blob();
  const fileSize = file.fileSize ?? blob.size;
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

  const uploadBody = new FormData();
  uploadBody.append("cacheControl", "3600");
  uploadBody.append("", {
    uri: file.uri,
    name: fileName,
    type: file.contentType
  } as unknown as Blob);
  const uploadResponse = await fetch(intentJson.upload.uploadUrl, {
    method: intentJson.upload.method,
    headers: intentJson.upload.headers ?? {},
    body: uploadBody
  });
  if (!uploadResponse.ok) throw new Error("No pudimos subir la foto al almacenamiento.");

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
  variantsPerPhoto: number
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
    body: JSON.stringify({ variantsPerPhoto })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos generar variantes.");
  return json as GenerateBatchResponse;
};

export const estimateBatchCost = async (
  token: string,
  businessId: string,
  batchId: string,
  variantsPerPhoto: number
): Promise<EstimateCostResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/estimate-cost`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ variantsPerPhoto })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos estimar el costo.");
  return json as EstimateCostResponse;
};

export const confirmBatchCost = async (
  token: string,
  businessId: string,
  batchId: string,
  variantsPerPhoto: number,
  priceVersion: string
): Promise<ConfirmCostResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/batches/${batchId}/confirm-cost`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("confirm-cost"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ variantsPerPhoto, priceVersion })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos confirmar el costo.");
  return json as ConfirmCostResponse;
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

export const collectMetrics = async (token: string, businessId: string): Promise<MetricsCollectResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/metrics/collect`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("collect-metrics"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ window: "7d" })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos recolectar metricas.");
  return json as MetricsCollectResponse;
};

export const getPerformance = async (token: string, businessId: string): Promise<PerformanceResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/performance`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer el aprendizaje.");
  return json as PerformanceResponse;
};

export const getWeeklyReport = async (token: string, businessId: string): Promise<WeeklyReportResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/reports/weekly`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer el reporte semanal.");
  return json as WeeklyReportResponse;
};

export const generateWeeklyReport = async (token: string, businessId: string): Promise<WeeklyReportGenerateResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/reports/weekly/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("weekly-report"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({})
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos generar el reporte semanal.");
  return json as WeeklyReportGenerateResponse;
};

export const runCaptionEval = async (
  token: string,
  businessId: string,
  candidateCaptionEditRate = 0.18
): Promise<BatchCaptionEvalResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/businesses/${businessId}/evals/caption`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("caption-eval"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ candidateCaptionEditRate })
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos iniciar la evaluacion.");
  return json as BatchCaptionEvalResponse;
};

export const getBillingStatus = async (token: string): Promise<BillingStatusResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/billing/status`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `mobile-${Date.now()}`
    }
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.userMessage ?? "No pudimos leer tu plan.");
  return json as BillingStatusResponse;
};

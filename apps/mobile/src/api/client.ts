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

const SESSION_TOKEN_KEY = "fbmaniaco.sessionToken";
let memorySessionToken: string | null = null;

const canUseSecureStore = async () => {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
};

export const getStoredSessionToken = async () => {
  if (await canUseSecureStore()) {
    return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  }
  return memorySessionToken;
};

export const storeSessionToken = async (token: string) => {
  memorySessionToken = token;
  if (await canUseSecureStore()) {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  }
};

export const clearStoredSession = async () => {
  memorySessionToken = null;
  if (await canUseSecureStore()) {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  }
};

type SupabaseAuthResponse = {
  access_token?: string;
  user?: { id?: string; email?: string };
  error?: string;
  error_description?: string;
  msg?: string;
};

const supabaseAuthRequest = async (path: string, body: Record<string, unknown>): Promise<SupabaseAuthResponse> => {
  const { supabaseUrl, supabaseAnonKey } = getMobileConfig();
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = (await response.json()) as SupabaseAuthResponse;
  if (!response.ok) {
    throw new Error(json.error_description ?? json.msg ?? json.error ?? "No pudimos iniciar sesion.");
  }
  return json;
};

export const signInWithPassword = async (email: string, password: string) => {
  const json = await supabaseAuthRequest("token?grant_type=password", { email: email.trim(), password });
  if (!json.access_token) throw new Error("Supabase no regreso una sesion valida.");
  await storeSessionToken(json.access_token);
  return json;
};

export const signUpWithPassword = async (email: string, password: string) => {
  const json = await supabaseAuthRequest("signup", { email: email.trim(), password });
  if (!json.access_token) {
    throw new Error("Cuenta creada. Confirma tu correo y despues inicia sesion.");
  }
  await storeSessionToken(json.access_token);
  return json;
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

export const connectMeta = async (token: string): Promise<MetaConnectResponse> => {
  const { apiUrl } = getMobileConfig();
  const response = await fetch(`${apiUrl}/auth/meta/connect`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey("meta-connect"),
      "x-request-id": `mobile-${Date.now()}`
    },
    body: JSON.stringify({ flow: "oauth" })
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

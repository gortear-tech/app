import type {
  BatchDetail,
  BatchSummary,
  BootstrapStatusResponse,
  BusinessDashboard,
  BusinessDetail,
  BusinessSummary,
  CompletePhotoUploadRequest,
  ConfirmCalendarResponse,
  CreateBusinessRequest,
  CreateVisualStyleRequest,
  MetaAutoConnectResponse,
  MetaTokenConnectionResponse,
  PreparePhotoUploadRequest,
  ScheduledPostSummary,
  VisualStyle,
  UpdateBusinessRequest,
  UpdateScheduledPostRequest,
  UpdateVisualStyleRequest,
  UpdateVariantCaptionRequest,
} from "@fbmaniaco/shared";

const jsonHeaders = {
  "Content-Type": "application/json",
};

export type PageSummary = {
  pageId: string;
  pageName: string;
  coverPhotoUrl?: string | null;
  pageAccessTokenStatus?: string;
  isSelected: boolean;
};

export function createApiClient(baseUrl: string) {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, init);
    } catch {
      throw new Error(
        `No se pudo conectar con la API en ${baseUrl}. Revisa que el servidor este encendido y que la app instalada en Android permita trafico HTTP.`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof body === "object" && body && "userMessage" in body ? String((body as { userMessage?: string }).userMessage) : `Request failed: ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  };

  return {
    bootstrapStatus: () => request<BootstrapStatusResponse>("/auth/bootstrap-status"),
    connectMetaToken: (token: string, source: "auto" | "manual" | "refresh" = "manual") =>
      request<MetaTokenConnectionResponse>("/auth/meta-token", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ token, source }),
      }),
    autoConnectMeta: () =>
      request<MetaAutoConnectResponse>("/auth/meta-token/auto", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
      }),
    listPages: () => request<PageSummary[]>("/meta/pages"),
    selectPage: (pageId: string) =>
      request<{ business: BusinessSummary; status: BootstrapStatusResponse }>("/meta/pages/select", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ pageId }),
      }),
    listStyles: () => request<VisualStyle[]>("/styles"),
    createStyle: (body: CreateVisualStyleRequest) =>
      request<VisualStyle>("/styles", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }),
    updateStyle: (styleId: string, body: UpdateVisualStyleRequest) =>
      request<VisualStyle>(`/styles/${styleId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }),
    deleteStyle: (styleId: string) =>
      request<{ deleted: boolean }>(`/styles/${styleId}`, {
        method: "DELETE",
      }),
    listBusinesses: () => request<BusinessSummary[]>("/businesses"),
    getBusiness: (businessId: string) => request<BusinessDetail>(`/businesses/${businessId}`),
    getDashboard: (businessId: string) => request<BusinessDashboard>(`/businesses/${businessId}/dashboard`),
    createBatch: (businessId: string) => request<BatchSummary>(`/businesses/${businessId}/batches`, { method: "POST" }),
    cancelBatch: (businessId: string, batchId: string) =>
      request<BatchSummary>(`/businesses/${businessId}/batches/${batchId}/cancel`, {
        method: "POST",
      }),
    getBatch: (businessId: string, batchId: string) => request<BatchDetail>(`/businesses/${businessId}/batches/${batchId}`),
    uploadIntent: (businessId: string, batchId: string, body: PreparePhotoUploadRequest) =>
      request<{ uploadUrl: string; storageKey: string }>(`/businesses/${businessId}/batches/${batchId}/photos/upload-intent`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }),
    completeUpload: (businessId: string, batchId: string, body: CompletePhotoUploadRequest) =>
      request<any>(`/businesses/${businessId}/batches/${batchId}/photos/complete-upload`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }),
    estimateCost: (businessId: string, batchId: string, variantsPerPhoto: number) =>
      request<{ estimatedCostUsd: number }>(`/businesses/${businessId}/batches/${batchId}/estimate-cost`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ variantsPerPhoto }),
      }),
    confirmCost: (businessId: string, batchId: string) =>
      request<BatchSummary>(`/businesses/${businessId}/batches/${batchId}/confirm-cost`, {
        method: "POST",
      }),
    generateVariants: (businessId: string, batchId: string, variantsPerPhoto: number) =>
      request<{ created: number; available?: number; blockedReason?: string | null }>(`/businesses/${businessId}/batches/${batchId}/generate`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ variantsPerPhoto }),
      }),
    changePhotoStyle: (businessId: string, batchId: string, photoId: string, styleId: string) =>
      request<unknown>(`/businesses/${businessId}/batches/${batchId}/photos/${photoId}/style`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ styleId }),
      }),
    listVariants: (businessId: string, batchId: string) =>
      request<any[]>(`/businesses/${businessId}/batches/${batchId}/variants`),
    approveVariant: (businessId: string, batchId: string, variantId: string) =>
      request<any>(`/businesses/${businessId}/batches/${batchId}/variants/${variantId}/approve`, { method: "POST" }),
    rejectVariant: (businessId: string, batchId: string, variantId: string) =>
      request<any>(`/businesses/${businessId}/batches/${batchId}/variants/${variantId}/reject`, { method: "POST" }),
    reopenVariantApproval: (businessId: string, batchId: string) =>
      request<BatchSummary>(`/businesses/${businessId}/batches/${batchId}/variants/reopen-approval`, { method: "POST" }),
    updateVariantCaption: (businessId: string, batchId: string, variantId: string, caption: string) =>
      request<any>(`/businesses/${businessId}/batches/${batchId}/variants/${variantId}/caption`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ caption } satisfies UpdateVariantCaptionRequest),
      }),
    confirmCalendar: (businessId: string, batchId: string, periodDays: 7 | 14 | 30) =>
      request<ConfirmCalendarResponse>(`/businesses/${businessId}/batches/${batchId}/calendar/confirm`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ periodDays }),
      }),
    listScheduledPosts: (businessId: string) => request<ScheduledPostSummary[]>(`/businesses/${businessId}/scheduled-posts`),
    updateScheduledPost: (businessId: string, batchId: string, scheduledPostId: string, scheduledFor: string) =>
      request<{ scheduledFor: string }>(`/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ scheduledFor } satisfies UpdateScheduledPostRequest),
      }),
    cancelScheduledPost: (businessId: string, batchId: string, scheduledPostId: string) =>
      request(`/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/cancel`, {
        method: "POST",
      }),
    retryScheduledPost: (businessId: string, batchId: string, scheduledPostId: string) =>
      request(`/businesses/${businessId}/batches/${batchId}/scheduled-posts/${scheduledPostId}/retry`, {
        method: "POST",
      }),
    updateBusiness: (businessId: string, body: UpdateBusinessRequest) =>
      request<BusinessDetail>(`/businesses/${businessId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }),
    createBusiness: (body: CreateBusinessRequest & { pageId?: string }) =>
      request<BusinessSummary>("/businesses", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

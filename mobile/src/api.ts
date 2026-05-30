import type {
  CalendarItem,
  Batch,
  Page,
  PageSettings,
  PendingPhotoUpload,
  Photo,
  PhotoMetadataUpdate,
  SmartScheduledVariant,
  StyleAssignment,
  StyleHistoryEntry,
  UserSettings,
} from '@cadencia/shared';

const productionApiBaseUrl = 'https://fbmaniaco-api.onrender.com';

function resolveApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (!configuredUrl) {
    return productionApiBaseUrl;
  }

  if (!__DEV__ && !configuredUrl.toLowerCase().startsWith('https://')) {
    return productionApiBaseUrl;
  }

  return configuredUrl.replace(/\/$/, '');
}

const apiBaseUrl = resolveApiBaseUrl();

type ApiEnvelope<T> = T & {
  source?: 'meta' | 'demo';
};

export type MetaLoginTarget = 'mobile' | 'web';

type BatchPreviewInput = {
  pageId: string;
  photoIds: string[];
  variantsPerPhoto: number;
  distributionDays: number;
};

export type MetaConnectionStatus = {
  configured: boolean;
  error?: {
    code?: number;
    message: string;
    subcode?: number;
    type?: string;
  };
  graphVersion: string;
  loginMode?: 'business_config' | 'classic_scopes';
  ok: boolean;
  pageCount?: number;
  tokenSource?: 'oauth';
  user?: {
    id: string;
    name: string;
  };
};

export type PhotoUpload = {
  base64: string;
  fileName?: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

export type PhotoUploadResult = {
  duplicateCount: number;
  photos: Photo[];
  uploadedCount: number;
};

export type PhotoContextUpdate = {
  context: string | null;
};

export type PhotoMetadataPatch = PhotoMetadataUpdate;

export type BatchPreview = {
  pageId: string;
  assignments: Array<
    StyleAssignment & {
      variantId: string;
      prompt: string;
    }
  >;
  schedule: CalendarItem[];
};

export type BatchCommitVariant = {
  generatedText: string;
  photoId: string;
  scheduledAt: string;
  style: string;
  variantIndex: number;
};

export type BatchCommitInput = {
  distributionDays: number;
  pageId: string;
  skipReview: boolean;
  variants: BatchCommitVariant[];
  variantsPerPhoto: number;
};

export type BatchCommitResult = {
  batchId: string;
  calendar: CalendarItem[];
  variantsCount: number;
};

export type BatchDraftInput = {
  batchId?: string;
  contextModeOverrides: Record<string, string>;
  pendingUploads: PendingPhotoUpload[];
  selectedPhotoIds: string[];
  skipReview: boolean;
  variantsPerPhoto: number;
};

export type BatchDetailResult = {
  batch: Batch;
  progress: number;
};

export type SchedulingSuggestionInput = {
  businessHours?: {
    end: string;
    start: string;
  };
  distributionDays?: number;
  occupiedSlots?: string[];
  pageId: string;
  variantIds: string[];
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly meta?: {
    code?: number;
    subcode?: number;
    type?: string;
  };

  constructor(message: string, options: { code: string; status: number; meta?: ApiError['meta'] }) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.meta = options.meta;
  }
}

export async function fetchPages(): Promise<Page[]> {
  const data = await request<ApiEnvelope<{ pages: Page[] }>>('/api/pages');
  return data.pages;
}

export async function fetchMetaStatus(): Promise<MetaConnectionStatus> {
  return request<MetaConnectionStatus>('/api/meta/status');
}

export async function fetchMetaLoginUrl(target: MetaLoginTarget = 'web'): Promise<string> {
  const query = target === 'mobile' ? '?target=mobile' : '';
  const data = await request<{ configured: boolean; url: string }>(
    `/api/auth/meta/login-url${query}`,
  );
  return data.url;
}

export async function disconnectMeta(): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/meta/disconnect', {
    method: 'POST',
  });
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const data = await request<ApiEnvelope<{ settings: UserSettings }>>('/api/user-settings');
  return data.settings;
}

export async function updateUserSettings(settings: UserSettings): Promise<UserSettings> {
  const data = await request<ApiEnvelope<{ settings: UserSettings }>>('/api/user-settings', {
    body: JSON.stringify(settings),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
  return data.settings;
}

export async function fetchPage(pageId: string): Promise<Page> {
  const data = await request<ApiEnvelope<{ page: Page }>>(
    `/api/pages/${encodeURIComponent(pageId)}`,
  );
  return data.page;
}

export async function updatePageSettings(pageId: string, settings: PageSettings): Promise<Page> {
  const data = await request<ApiEnvelope<{ page: Page }>>(
    `/api/pages/${encodeURIComponent(pageId)}/settings`,
    {
      body: JSON.stringify(settings),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    },
  );
  return data.page;
}

export async function disconnectPageMeta(pageId: string): Promise<Page> {
  const data = await request<ApiEnvelope<{ page: Page }>>(
    `/api/pages/${encodeURIComponent(pageId)}/meta/disconnect`,
    {
      method: 'POST',
    },
  );
  return data.page;
}

export async function deletePageFromCadencia(pageId: string): Promise<void> {
  await request<ApiEnvelope<{ ok: boolean }>>(`/api/pages/${encodeURIComponent(pageId)}`, {
    method: 'DELETE',
  });
}

export async function fetchPhotos(pageId: string): Promise<Photo[]> {
  const data = await request<ApiEnvelope<{ photos: Photo[] }>>(
    `/api/pages/${encodeURIComponent(pageId)}/photos`,
  );
  return data.photos;
}

export async function uploadPagePhotos(
  pageId: string,
  photos: PhotoUpload[],
): Promise<PhotoUploadResult> {
  const data = await request<ApiEnvelope<PhotoUploadResult>>(
    `/api/pages/${encodeURIComponent(pageId)}/photos`,
    {
      body: JSON.stringify({ photos }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  return {
    duplicateCount: data.duplicateCount ?? 0,
    photos: data.photos,
    uploadedCount: data.uploadedCount ?? data.photos.length,
  };
}

export async function updatePhotoContext(
  pageId: string,
  photoId: string,
  update: PhotoContextUpdate,
): Promise<Photo> {
  const data = await request<ApiEnvelope<{ photo: Photo }>>(
    `/api/pages/${encodeURIComponent(pageId)}/photos/${encodeURIComponent(photoId)}/context`,
    {
      body: JSON.stringify(update),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    },
  );
  return data.photo;
}

export async function updatePhotoMetadata(
  pageId: string,
  photoId: string,
  update: PhotoMetadataPatch,
): Promise<Photo> {
  const data = await request<ApiEnvelope<{ photo: Photo }>>(
    `/api/pages/${encodeURIComponent(pageId)}/photos/${encodeURIComponent(photoId)}`,
    {
      body: JSON.stringify(update),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    },
  );
  return data.photo;
}

export async function generatePhotoContext(pageId: string, photoId: string): Promise<Photo> {
  const data = await request<ApiEnvelope<{ photo: Photo }>>(
    `/api/pages/${encodeURIComponent(pageId)}/photos/${encodeURIComponent(photoId)}/context/ai`,
    {
      method: 'POST',
    },
  );
  return data.photo;
}

export async function fetchCalendar(pageId: string): Promise<CalendarItem[]> {
  const data = await request<ApiEnvelope<{ items: CalendarItem[] }>>(
    `/api/pages/${encodeURIComponent(pageId)}/calendar`,
  );
  return data.items;
}

export async function fetchStyleHistory(pageId: string): Promise<StyleHistoryEntry[]> {
  const data = await request<ApiEnvelope<{ items: StyleHistoryEntry[] }>>(
    `/api/pages/${encodeURIComponent(pageId)}/style-history`,
  );
  return data.items;
}

export async function fetchBatches(pageId: string): Promise<Batch[]> {
  const data = await request<ApiEnvelope<{ batches: Batch[] }>>(
    `/api/pages/${encodeURIComponent(pageId)}/batches`,
  );
  return data.batches;
}

export async function saveBatchDraft(pageId: string, input: BatchDraftInput): Promise<Batch> {
  const data = await request<ApiEnvelope<{ batch: Batch }>>(
    `/api/pages/${encodeURIComponent(pageId)}/batches/draft`,
    {
      body: JSON.stringify(input),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  return data.batch;
}

export async function archiveBatch(
  batchId: string,
  options: { cancelledByUser?: boolean } = {},
): Promise<Batch> {
  const data = await request<ApiEnvelope<{ batch: Batch }>>(
    `/api/batches/${encodeURIComponent(batchId)}/archive`,
    {
      body: JSON.stringify(options),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  return data.batch;
}

export async function fetchSchedulingSuggestion(
  input: SchedulingSuggestionInput,
): Promise<SmartScheduledVariant[]> {
  const data = await request<{ schedule: SmartScheduledVariant[] }>('/api/scheduling/suggest', {
    body: JSON.stringify({
      occupiedSlots: [],
      ...input,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  return data.schedule;
}

export async function fetchBatchPreview(input: BatchPreviewInput): Promise<BatchPreview> {
  return request<BatchPreview>('/api/batches/preview', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export async function commitPublicationBatch(input: BatchCommitInput): Promise<BatchCommitResult> {
  return request<BatchCommitResult>('/api/batches', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.meta?.code === 190 && error.meta.subcode === 463) {
      return 'La sesion de Meta necesita renovarse. Inicia sesion con Facebook otra vez.';
    }

    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'No pude conectar con el backend. Mostrando datos de muestra.';
}

export function isMetaAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.meta?.code === 190;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const body = await safeJson(response);

  if (!response.ok) {
    throw new ApiError(body.message ?? 'La conexion con el backend no respondio bien.', {
      code: body.error ?? 'api_error',
      status: response.status,
      meta: body.meta,
    });
  }

  return body as T;
}

async function safeJson(response: Response): Promise<Record<string, any>> {
  try {
    return (await response.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

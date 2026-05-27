import type {
  BootstrapStatus,
  Business,
  BusinessesResponse,
  GalleryMediaAsset,
  MediaAssetsResponse,
  MediaCategoriesResponse,
  MediaCategory,
  MediaSelection,
  MediaSelectionsResponse,
  MediaSelectionMutationResponse,
  MenuIngestResponse,
  MenuItem,
  MenuItemsResponse,
  MediaUploadCompleteResponse,
  MediaUploadIntentResponse,
  MobileAuthSessionResponse
} from "@fbmaniaco/shared";
import { getWebConfig } from "../config";

type UpdateMediaAssetBody = {
  displayName?: string;
  categoryId?: string | null;
  tags?: string[];
};

export class WebApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly userMessage?: string;

  constructor(input: { status: number; message: string; code?: string; userMessage?: string }) {
    super(input.message);
    this.status = input.status;
    if (input.code) this.code = input.code;
    if (input.userMessage) this.userMessage = input.userMessage;
  }
}

const requestId = (scope: string) => `web-${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const idempotencyKey = (scope: string) => `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const duplicateUploadResponse = (status: number, body: string) => status === 409 || /already exists|resource already exists|duplicate/i.test(body);

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
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

const apiFetch = async <T>(path: string, token: string | null, init: RequestInit = {}, fallback = "No pudimos completar la accion.") => {
  const { apiUrl } = getWebConfig();
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId(path.replace(/[^\w-]/g, "-")));
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  } catch (error) {
    throw new WebApiError({
      status: 0,
      code: "network_request_failed",
      userMessage: "No pudimos llegar al servidor.",
      message: error instanceof Error ? error.message : "Network request failed"
    });
  }

  const json = await readJson(response);
  if (!response.ok) {
    const userMessage = stringField(json, "userMessage");
    const errorInput: { status: number; message: string; code?: string; userMessage?: string } = {
      status: response.status,
      message: userMessage ?? stringField(json, "message") ?? stringField(json, "error") ?? fallback
    };
    const code = stringField(json, "code") ?? stringField(json, "error");
    if (code) errorInput.code = code;
    if (userMessage) errorInput.userMessage = userMessage;
    throw new WebApiError(errorInput);
  }
  return json as T;
};

export const createAnonymousSession = () =>
  apiFetch<MobileAuthSessionResponse>("/auth/mobile/anonymous", null, {
    method: "POST",
    body: JSON.stringify({})
  }, "No pudimos iniciar sesion web.");

export const refreshApiSession = (refreshToken: string) =>
  apiFetch<MobileAuthSessionResponse>("/auth/mobile/refresh", null, {
    method: "POST",
    body: JSON.stringify({ refreshToken })
  }, "No pudimos refrescar la sesion.");

export const getBootstrapStatus = (token: string) =>
  apiFetch<BootstrapStatus>("/auth/bootstrap-status", token, {}, "No pudimos abrir Maniaco.");

export const listBusinesses = async (token: string) => {
  const response = await apiFetch<BusinessesResponse>("/businesses", token, {}, "No pudimos leer las paginas.");
  return response.businesses;
};

export const listMediaAssets = (token: string, input: {
  workspaceId: string;
  categoryId?: string;
  search?: string;
  unused?: boolean;
  archived?: boolean;
  limit?: number;
  sort?: "recent" | "most_used" | "name";
}) => {
  const params = new URLSearchParams({ workspaceId: input.workspaceId });
  if (input.categoryId) params.set("categoryId", input.categoryId);
  if (input.search) params.set("search", input.search);
  if (input.unused !== undefined) params.set("unused", String(input.unused));
  if (input.archived !== undefined) params.set("archived", String(input.archived));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.sort) params.set("sort", input.sort);
  return apiFetch<MediaAssetsResponse>(`/media/assets?${params.toString()}`, token, {}, "No pudimos leer la galeria.");
};

export const listMediaCategories = async (token: string, workspaceId: string): Promise<MediaCategory[]> => {
  const params = new URLSearchParams({ workspaceId });
  const response = await apiFetch<MediaCategoriesResponse>(`/media/categories?${params.toString()}`, token, {}, "No pudimos leer categorias.");
  return response.categories;
};

export const createMediaCategory = async (
  token: string,
  body: { workspaceId: string; name: string; slug?: string; color?: string | null; sortOrder?: number }
) => {
  const response = await apiFetch<{ category: MediaCategory }>("/media/categories", token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-category") },
    body: JSON.stringify(body)
  }, "No pudimos crear la categoria.");
  return response.category;
};

export const ingestMenuText = (token: string, body: { workspaceId: string; businessId?: string; text: string }) =>
  apiFetch<MenuIngestResponse>("/menu/ingest", token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-menu-ingest") },
    body: JSON.stringify({
      workspaceId: body.workspaceId,
      ...(body.businessId ? { businessId: body.businessId } : {}),
      sourceType: "text",
      text: body.text
    })
  }, "No pudimos importar el menu.");

export const listMenuItems = async (token: string, workspaceId: string): Promise<MenuItem[]> => {
  const params = new URLSearchParams({ workspaceId });
  const response = await apiFetch<MenuItemsResponse>(`/menu/items?${params.toString()}`, token, {}, "No pudimos leer el menu.");
  return response.items;
};

export const updateMediaAsset = async (token: string, assetId: string, body: UpdateMediaAssetBody) => {
  const response = await apiFetch<{ asset: GalleryMediaAsset }>(`/media/assets/${assetId}`, token, {
    method: "PATCH",
    headers: { "idempotency-key": idempotencyKey("web-asset-update") },
    body: JSON.stringify(body)
  }, "No pudimos guardar la foto.");
  return response.asset;
};

export const archiveMediaAsset = async (token: string, assetId: string, archived: boolean) => {
  const response = await apiFetch<{ asset: GalleryMediaAsset }>(`/media/assets/${assetId}/${archived ? "archive" : "restore"}`, token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-asset-archive") },
    body: JSON.stringify({})
  }, archived ? "No pudimos archivar la foto." : "No pudimos restaurar la foto.");
  return response.asset;
};

export const listActiveSelections = async (token: string, workspaceId: string): Promise<MediaSelection[]> => {
  const params = new URLSearchParams({ workspaceId });
  const response = await apiFetch<MediaSelectionsResponse>(`/media/selections/active?${params.toString()}`, token, {}, "No pudimos leer la seleccion.");
  return response.selections;
};

export const createSelection = async (
  token: string,
  body: { workspaceId: string; name?: string | null; assetIds?: string[]; metadata?: Record<string, unknown> }
) =>
  apiFetch<MediaSelectionMutationResponse>("/media/selections", token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-selection") },
    body: JSON.stringify(body)
  }, "No pudimos crear la seleccion.");

export const updateSelection = async (
  token: string,
  selectionId: string,
  body: { name?: string | null; assetIds?: string[]; metadata?: Record<string, unknown> }
) =>
  apiFetch<MediaSelectionMutationResponse>(`/media/selections/${selectionId}`, token, {
    method: "PATCH",
    headers: { "idempotency-key": idempotencyKey("web-selection-update") },
    body: JSON.stringify(body)
  }, "No pudimos guardar la seleccion.");

export const consumeSelection = async (token: string, selectionId: string, businessId?: string) =>
  apiFetch<{ selection: MediaSelection; batch?: unknown }>(`/media/selections/${selectionId}/consume`, token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-selection-consume") },
    body: JSON.stringify({ ...(businessId ? { businessId } : {}) })
  }, "No pudimos convertir la seleccion en lote.");

export const uploadMediaAsset = async (token: string, input: {
  workspaceId: string;
  business?: Business | null;
  file: File;
  sha256: string;
  width?: number;
  height?: number;
  categoryId?: string | null;
}) => {
  const intent = await apiFetch<MediaUploadIntentResponse>("/media/upload-intent", token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-upload-intent") },
    body: JSON.stringify({
      ...(input.business ? { businessId: input.business.id } : {}),
      sha256: input.sha256,
      bytes: input.file.size,
      mime: input.file.type,
      originalName: input.file.name,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {})
    })
  }, "No pudimos preparar la subida.");

  if (intent.exists && intent.asset) return intent.asset;
  if (!intent.uploadUrl || !intent.storagePath || !intent.assetId) throw new Error("El servidor no regreso una subida valida.");

  if (!intent.uploadUrl.startsWith("local://")) {
    const uploadResponse = await fetch(intent.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": input.file.type || "application/octet-stream",
        "x-upsert": "false"
      },
      body: input.file
    });
    if (!uploadResponse.ok) {
      const text = await uploadResponse.text().catch(() => "");
      if (duplicateUploadResponse(uploadResponse.status, text)) {
        await apiFetch<MediaUploadCompleteResponse>("/media/upload-complete", token, {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey("web-upload-complete") },
          body: JSON.stringify({ assetId: intent.assetId, storagePath: intent.storagePath })
        }, "No pudimos confirmar la subida.");
        return {
          ...(intent.asset as GalleryMediaAsset),
          id: intent.assetId,
          status: "processing"
        };
      }
      throw new Error(`No pudimos subir el archivo al almacenamiento (${uploadResponse.status}${text ? `: ${text.slice(0, 120)}` : ""}).`);
    }
  }

  await apiFetch<MediaUploadCompleteResponse>("/media/upload-complete", token, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey("web-upload-complete") },
    body: JSON.stringify({ assetId: intent.assetId, storagePath: intent.storagePath })
  }, "No pudimos confirmar la subida.");

  return {
    ...(intent.asset as GalleryMediaAsset),
    id: intent.assetId,
    status: "processing"
  };
};

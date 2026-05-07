export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiRouteSpec<RequestBody = unknown, ResponseBody = unknown> {
  method: ApiMethod;
  path: string;
  requestBody?: RequestBody;
  responseBody?: ResponseBody;
}

export interface ApiRouteMap {
  "/health": ApiRouteSpec<void, { ok: true }>;
  "/auth/bootstrap-status": ApiRouteSpec<void, unknown>;
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

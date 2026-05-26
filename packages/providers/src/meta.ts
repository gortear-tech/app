import { AppError, FacebookTokenStatus, MetaPage } from "@fbmaniaco/shared";
import pRetry, { AbortError } from "p-retry";

export type NormalizedMetaAuthorization = {
  status: "valid" | "missing_scopes" | "error";
  grantedScopes: string[];
  declinedScopes: string[];
  missingRequiredScopes: string[];
  grantedPageIds: string[];
  graphApiVersion: string;
  tokenStatus: FacebookTokenStatus;
  appMode: "development" | "live" | "unknown";
  appReviewStatus: "development" | "review_required" | "approved" | "rejected" | "unknown";
  encryptedAccessTokenRef?: string;
};

export type MetaProviderPage = Omit<MetaPage, "id" | "workspaceId" | "isSelected" | "updatedAt"> & {
  pageAccessToken?: string;
};

export type CompleteAuthorizationResult = {
  authorization: NormalizedMetaAuthorization;
  pages: MetaProviderPage[];
};

export type MetaProvider = {
  mode: "mock" | "graph";
  buildAuthorizationUrl(input: { state: string; redirectUri?: string }): string;
  completeOAuth(input: { code: string; state: string; redirectUri?: string }): Promise<CompleteAuthorizationResult>;
  refreshAuthorization(): Promise<CompleteAuthorizationResult>;
};

export type MetaPublishResult = {
  facebookPostId: string;
  remotePostType: "photo" | "feed";
  remotePostUrl: string;
  providerTraceId?: string;
};

export type MetaPhotoUploadResult = {
  fbPhotoId: string;
  providerTraceId?: string;
};

export type MetaProviderConfig = {
  appId: string | undefined;
  appSecret: string | undefined;
  redirectUri: string | undefined;
  loginConfigurationId?: string | undefined;
  graphApiVersion: string;
  requiredScopes: string[];
};

type GraphMetaProviderConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  loginConfigurationId?: string | undefined;
  graphApiVersion: string;
  requiredScopes: string[];
};

class MetaGraphRequestError extends Error {
  readonly status: number;
  readonly metaCode?: number;
  readonly metaType?: string;
  readonly traceId?: string;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    status: number;
    metaCode?: number;
    metaType?: string;
    traceId?: string;
    retryAfterMs?: number;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = "MetaGraphRequestError";
    this.status = input.status;
    if (input.metaCode !== undefined) this.metaCode = input.metaCode;
    if (input.metaType !== undefined) this.metaType = input.metaType;
    if (input.traceId !== undefined) this.traceId = input.traceId;
    if (input.retryAfterMs !== undefined) this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (headers: Headers) => {
  const retryAfter = headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  const usage = headers.get("x-business-use-case-usage");
  let usageMs = 0;
  if (usage) {
    try {
      const parsed = JSON.parse(usage) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>;
      usageMs = Math.max(
        0,
        ...Object.values(parsed)
          .flat()
          .map((item) =>
            typeof item.estimated_time_to_regain_access === "number" ? item.estimated_time_to_regain_access * 1000 : 0
          )
      );
    } catch {
      usageMs = 0;
    }
  }
  const selected = Math.max(retryAfterMs, usageMs);
  return selected > 0 ? selected : undefined;
};

const retryableMetaCodes = new Set([1, 2, 4, 17, 32, 613]);
const nonRetryableMetaCodes = new Set([10, 100, 190, 200]);

const isRetryableGraphFailure = (status: number, code?: number) => {
  if (status === 429 || status === 408 || status === 425 || status >= 500) return true;
  if (code !== undefined && retryableMetaCodes.has(code)) return true;
  if (code !== undefined && nonRetryableMetaCodes.has(code)) return false;
  return status >= 500;
};

const toMetaPublishAppError = (error: unknown, code: string, fallbackMessage: string) => {
  if (error instanceof MetaGraphRequestError) {
    return new AppError({
      code,
      statusCode: error.retryable ? 502 : 409,
      message: error.message || fallbackMessage,
      userMessage: error.retryable
        ? "Facebook no pudo completar la publicacion. Vamos a reintentar."
        : "Facebook rechazo la publicacion. Revisa permisos y vuelve a conectar la pagina.",
      retryable: error.retryable,
      action: error.retryable ? "retry" : "reconnect",
      details: { metaCode: error.metaCode, metaType: error.metaType, traceId: error.traceId }
    });
  }
  if (error instanceof AppError) return error;
  return new AppError({
    code,
    statusCode: 502,
    message: error instanceof Error ? error.message : fallbackMessage,
    userMessage: "Facebook no pudo completar la publicacion. Vamos a reintentar.",
    retryable: true,
    action: "retry"
  });
};

const postGraphForm = async <T>(input: {
  graphApiVersion: string;
  pageId: string;
  endpoint: "feed" | "photos";
  body: () => URLSearchParams;
  missingResult: (json: T) => boolean;
  failureCode: string;
  failureMessage: string;
}) => {
  const requestUrl = new URL(`https://graph.facebook.com/${input.graphApiVersion}/${input.pageId}/${input.endpoint}`);
  try {
    return await pRetry(
      async () => {
        const response = await fetch(requestUrl, { method: "POST", body: input.body() });
        const traceId = response.headers.get("x-fb-trace-id") ?? response.headers.get("x-fb-rev") ?? undefined;
        const json = (await response.json().catch(() => ({}))) as T & {
          error?: { code?: number; message?: string; type?: string };
        };
        if (!response.ok || input.missingResult(json)) {
          const status = response.status || 502;
          const retryable = isRetryableGraphFailure(status, json.error?.code);
          const graphErrorInput: ConstructorParameters<typeof MetaGraphRequestError>[0] = {
            status,
            retryable,
            message: json.error?.message ?? input.failureMessage
          };
          if (json.error?.code !== undefined) graphErrorInput.metaCode = json.error.code;
          if (json.error?.type !== undefined) graphErrorInput.metaType = json.error.type;
          if (traceId !== undefined) graphErrorInput.traceId = traceId;
          const retryAfterMs = parseRetryAfterMs(response.headers);
          if (retryAfterMs !== undefined) graphErrorInput.retryAfterMs = retryAfterMs;
          const graphError = new MetaGraphRequestError(graphErrorInput);
          if (!retryable) throw new AbortError(graphError);
          throw graphError;
        }
        return { json, traceId };
      },
      {
        retries: 5,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 60000,
        randomize: true,
        shouldRetry: ({ error }) => error instanceof MetaGraphRequestError && error.retryable,
        onFailedAttempt: async ({ error, retryDelay }) => {
          if (error instanceof MetaGraphRequestError && error.retryAfterMs && error.retryAfterMs > retryDelay) {
            await sleep(Math.min(error.retryAfterMs, 60000));
          }
        }
      }
    );
  } catch (error) {
    throw toMetaPublishAppError(error instanceof AbortError ? error.originalError : error, input.failureCode, input.failureMessage);
  }
};

export const createMetaProvider = (config: MetaProviderConfig): MetaProvider => {
  if (config.appId && config.appSecret && config.redirectUri) {
    return new GraphMetaProvider({
      appId: config.appId,
      appSecret: config.appSecret,
      redirectUri: config.redirectUri,
      loginConfigurationId: config.loginConfigurationId,
      graphApiVersion: config.graphApiVersion,
      requiredScopes: config.requiredScopes
    });
  }
  return new MockMetaProvider(config);
};

export const loadMetaPagesFromUserAccessToken = async (
  config: MetaProviderConfig,
  accessToken: string
): Promise<CompleteAuthorizationResult> => {
  const input: Parameters<typeof loadPages>[0] = {
    graphApiVersion: config.graphApiVersion,
    requiredScopes: config.requiredScopes,
    accessToken
  };
  if (config.appId) input.appId = config.appId;
  if (config.appSecret) input.appSecret = config.appSecret;
  return loadPages(input);
};

class MockMetaProvider implements MetaProvider {
  public readonly mode = "mock" as const;
  private readonly config: MetaProviderConfig;

  constructor(config: MetaProviderConfig) {
    this.config = config;
  }

  buildAuthorizationUrl(input: { state: string }) {
    return `https://www.facebook.com/dialog/oauth?client_id=mock&state=${encodeURIComponent(input.state)}`;
  }

  async completeOAuth(): Promise<CompleteAuthorizationResult> {
    return this.mockResult();
  }

  async refreshAuthorization(): Promise<CompleteAuthorizationResult> {
    return this.mockResult();
  }

  private mockResult(): CompleteAuthorizationResult {
    const requiredScopes = this.config.requiredScopes;
    return {
      authorization: {
        status: "valid",
        grantedScopes: requiredScopes,
        declinedScopes: [],
        missingRequiredScopes: [],
        grantedPageIds: ["mock-page-1", "mock-page-2"],
        graphApiVersion: this.config.graphApiVersion,
        tokenStatus: "valido",
        appMode: "development",
        appReviewStatus: "development"
      },
      pages: [
        {
          metaPageId: "mock-page-1",
          pageName: "Maniaco Demo",
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
    };
  }
}

class GraphMetaProvider implements MetaProvider {
  public readonly mode = "graph" as const;
  private readonly config: GraphMetaProviderConfig;

  constructor(config: GraphMetaProviderConfig) {
    this.config = config;
  }

  buildAuthorizationUrl(input: { state: string; redirectUri?: string }) {
    const url = new URL("https://www.facebook.com/dialog/oauth");
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", input.redirectUri ?? this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("auth_type", "rerequest");
    url.searchParams.set("state", input.state);
    if (this.config.loginConfigurationId) {
      url.searchParams.set("config_id", this.config.loginConfigurationId);
      url.searchParams.set("override_default_response_type", "true");
    } else {
      url.searchParams.set("scope", this.config.requiredScopes.join(","));
    }
    return url.toString();
  }

  async completeOAuth(input: { code: string; redirectUri?: string }): Promise<CompleteAuthorizationResult> {
    const shortLived = await this.fetchJson<{ access_token?: string; error?: unknown }>(
      `https://graph.facebook.com/${this.config.graphApiVersion}/oauth/access_token`,
      {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        redirect_uri: input.redirectUri ?? this.config.redirectUri,
        code: input.code
      }
    );
    if (!shortLived.access_token) {
      throw this.metaError("meta_oauth_failed", "Meta OAuth did not return access token");
    }

    const longLived = await this.fetchJson<{ access_token?: string }>(
      `https://graph.facebook.com/${this.config.graphApiVersion}/oauth/access_token`,
      {
        grant_type: "fb_exchange_token",
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        fb_exchange_token: shortLived.access_token
      }
    );
    const accessToken = longLived.access_token ?? shortLived.access_token;
    return loadPages({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      graphApiVersion: this.config.graphApiVersion,
      requiredScopes: this.config.requiredScopes,
      accessToken
    });
  }

  async refreshAuthorization(): Promise<CompleteAuthorizationResult> {
    throw this.metaError("meta_refresh_requires_token", "Refresh requires stored token material");
  }

  private async fetchJson<T>(url: string, params: Record<string, string>) {
    const requestUrl = new URL(url);
    for (const [key, value] of Object.entries(params)) requestUrl.searchParams.set(key, value);
    const response = await fetch(requestUrl);
    const json = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw this.metaError("meta_graph_error", json.error?.message ?? "Meta Graph request failed");
    }
    return json;
  }

  private metaError(code: string, message: string) {
    return new AppError({
      code,
      statusCode: 502,
      message,
      userMessage: "Facebook no pudo completar la autorizacion. Intenta reconectar.",
      retryable: true,
      action: "reconnect"
    });
  }
}

export const publishFacebookPagePost = async (input: {
  graphApiVersion: string;
  pageId: string;
  pageAccessToken: string;
  caption: string;
  imageUrl?: string | null;
  attachedMediaFbid?: string | null;
  scheduledForUnix?: number | null;
}): Promise<MetaPublishResult> => {
  const hasAttachedPhoto = Boolean(input.attachedMediaFbid);
  const canPublishPhoto = Boolean(input.imageUrl && /^https:\/\//i.test(input.imageUrl));
  const isScheduled = typeof input.scheduledForUnix === "number" && Number.isFinite(input.scheduledForUnix);
  const endpoint = hasAttachedPhoto || !canPublishPhoto ? "feed" : "photos";
  const { json, traceId } = await postGraphForm<{ id?: string; post_id?: string }>({
    graphApiVersion: input.graphApiVersion,
    pageId: input.pageId,
    endpoint,
    missingResult: (json) => !json.id && !json.post_id,
    failureCode: "meta_publish_failed",
    failureMessage: "Meta Graph publish request failed",
    body: () => {
      const body = new URLSearchParams();
      body.set("access_token", input.pageAccessToken);
      if (hasAttachedPhoto) {
        body.set("message", input.caption);
        body.set("attached_media[0]", JSON.stringify({ media_fbid: input.attachedMediaFbid }));
        body.set("published", isScheduled ? "false" : "true");
      } else if (canPublishPhoto && input.imageUrl) {
        body.set("url", input.imageUrl);
        body.set("caption", input.caption);
        body.set("published", isScheduled ? "false" : "true");
      } else {
        body.set("message", input.caption);
        if (isScheduled) body.set("published", "false");
      }
      if (isScheduled) {
        body.set("scheduled_publish_time", String(Math.floor(input.scheduledForUnix!)));
      }
      return body;
    }
  });

  const facebookPostId = json.post_id ?? json.id ?? "";
  const result: MetaPublishResult = {
    facebookPostId,
    remotePostType: endpoint === "photos" ? "photo" : "feed",
    remotePostUrl: `https://www.facebook.com/${facebookPostId}`
  };
  if (traceId) result.providerTraceId = traceId;
  return result;
};

export const uploadUnpublishedFacebookPagePhoto = async (input: {
  graphApiVersion: string;
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
}): Promise<MetaPhotoUploadResult> => {
  const { json, traceId } = await postGraphForm<{ id?: string }>({
    graphApiVersion: input.graphApiVersion,
    pageId: input.pageId,
    endpoint: "photos",
    missingResult: (json) => !json.id,
    failureCode: "meta_photo_upload_failed",
    failureMessage: "Meta Graph unpublished photo upload failed",
    body: () => {
      const body = new URLSearchParams();
      body.set("access_token", input.pageAccessToken);
      body.set("url", input.imageUrl);
      body.set("published", "false");
      return body;
    }
  });

  const result: MetaPhotoUploadResult = { fbPhotoId: json.id ?? "" };
  if (traceId) result.providerTraceId = traceId;
  return result;
};

const loadPages = async (input: {
  appId?: string;
  appSecret?: string;
  graphApiVersion: string;
  requiredScopes: string[];
  accessToken: string;
}): Promise<CompleteAuthorizationResult> => {
  const fetchJson = async <T>(url: string, params: Record<string, string>) => {
    const requestUrl = new URL(url);
    for (const [key, value] of Object.entries(params)) requestUrl.searchParams.set(key, value);
    const response = await fetch(requestUrl);
    const json = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new AppError({
        code: "meta_graph_error",
        statusCode: 502,
        message: json.error?.message ?? "Meta Graph request failed",
        userMessage: "Facebook no pudo completar la autorizacion. Intenta reconectar.",
        retryable: true,
        action: "reconnect"
      });
    }
    return json;
  };

  let grantedScopes: string[] = [];
  let isValid: boolean | undefined;
  let granularScopes: Array<{ scope: string; target_ids?: string[] }> = [];
  if (input.appId && input.appSecret) {
    const debug = await fetchJson<{
      data?: {
        scopes?: string[];
        granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
        is_valid?: boolean;
      };
    }>(`https://graph.facebook.com/${input.graphApiVersion}/debug_token`, {
      input_token: input.accessToken,
      access_token: `${input.appId}|${input.appSecret}`
    });
    grantedScopes = debug.data?.scopes ?? [];
    granularScopes = debug.data?.granular_scopes ?? [];
    isValid = debug.data?.is_valid;
  } else {
    const permissions = await fetchJson<{
      data?: Array<{ permission: string; status: "granted" | "declined" | "expired" }>;
    }>(`https://graph.facebook.com/${input.graphApiVersion}/me/permissions`, {
      access_token: input.accessToken
    });
    grantedScopes = (permissions.data ?? []).filter((item) => item.status === "granted").map((item) => item.permission);
    isValid = true;
  }
  const missingRequiredScopes = input.requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  const grantedPageIds = new Set(granularScopes.flatMap((scope) => scope.target_ids ?? []));

  const accounts = await fetchJson<{
    data?: Array<{
      id: string;
      name: string;
      category?: string;
      tasks?: string[];
      access_token?: string;
      cover?: {
        source?: string | null;
      };
      picture?: {
        data?: {
          url?: string | null;
          is_silhouette?: boolean;
        };
      };
    }>;
  }>(`https://graph.facebook.com/${input.graphApiVersion}/me/accounts`, {
    fields: "id,name,category,tasks,access_token,cover{source},picture.type(large){url,is_silhouette}",
    access_token: input.accessToken
  });

  const pages: MetaProviderPage[] = (accounts.data ?? []).map((page) => {
    const tasks = page.tasks ?? [];
    const isGranted = grantedPageIds.size === 0 || grantedPageIds.has(page.id);
    const canPublish =
      isGranted && missingRequiredScopes.length === 0 && (tasks.length === 0 || tasks.includes("CREATE_CONTENT"));
    return {
      metaPageId: page.id,
      pageName: page.name,
      coverPhotoUrl: page.cover?.source ?? null,
      profilePhotoUrl: page.picture?.data?.is_silhouette ? null : (page.picture?.data?.url ?? null),
      category: page.category ?? null,
      tasks,
      isGranted,
      canPublish,
      pageAccessTokenStatus: canPublish ? "valido" : "error_permiso",
      grantedScopes,
      declinedScopes: missingRequiredScopes,
      ...(page.access_token ? { pageAccessToken: page.access_token } : {})
    };
  });

  return {
    authorization: {
      status: missingRequiredScopes.length === 0 ? "valid" : "missing_scopes",
      grantedScopes,
      declinedScopes: missingRequiredScopes,
      missingRequiredScopes,
      grantedPageIds: pages.filter((page) => page.isGranted).map((page) => page.metaPageId),
      graphApiVersion: input.graphApiVersion,
      tokenStatus: isValid === false ? "expirado" : "valido",
      appMode: "unknown",
      appReviewStatus: "unknown",
      encryptedAccessTokenRef: "server-only:meta-user-token"
    },
    pages
  };
};

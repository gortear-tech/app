import { AppError, FacebookTokenStatus, MetaPage } from "@fbmaniaco/shared";

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
  buildAuthorizationUrl(input: { state: string }): string;
  completeOAuth(input: { code: string; state: string }): Promise<CompleteAuthorizationResult>;
  refreshAuthorization(): Promise<CompleteAuthorizationResult>;
};

export type MetaPublishResult = {
  facebookPostId: string;
  remotePostType: "photo" | "feed";
  remotePostUrl: string;
  providerTraceId?: string;
};

export type MetaProviderConfig = {
  appId: string | undefined;
  appSecret: string | undefined;
  redirectUri: string | undefined;
  graphApiVersion: string;
  requiredScopes: string[];
};

type GraphMetaProviderConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphApiVersion: string;
  requiredScopes: string[];
};

export const createMetaProvider = (config: MetaProviderConfig): MetaProvider => {
  if (config.appId && config.appSecret && config.redirectUri) {
    return new GraphMetaProvider({
      appId: config.appId,
      appSecret: config.appSecret,
      redirectUri: config.redirectUri,
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
          pageName: "FBmaniaco Demo",
          coverPhotoUrl: null,
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
          coverPhotoUrl: null,
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

  buildAuthorizationUrl(input: { state: string }) {
    const url = new URL("https://www.facebook.com/dialog/oauth");
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("auth_type", "rerequest");
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", this.config.requiredScopes.join(","));
    return url.toString();
  }

  async completeOAuth(input: { code: string }): Promise<CompleteAuthorizationResult> {
    const shortLived = await this.fetchJson<{ access_token?: string; error?: unknown }>(
      `https://graph.facebook.com/${this.config.graphApiVersion}/oauth/access_token`,
      {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        redirect_uri: this.config.redirectUri,
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
}): Promise<MetaPublishResult> => {
  const canPublishPhoto = Boolean(input.imageUrl && /^https:\/\//i.test(input.imageUrl));
  const endpoint = canPublishPhoto ? "photos" : "feed";
  const requestUrl = new URL(`https://graph.facebook.com/${input.graphApiVersion}/${input.pageId}/${endpoint}`);
  const body = new URLSearchParams();
  body.set("access_token", input.pageAccessToken);
  if (canPublishPhoto && input.imageUrl) {
    body.set("url", input.imageUrl);
    body.set("caption", input.caption);
    body.set("published", "true");
  } else {
    body.set("message", input.caption);
  }

  const response = await fetch(requestUrl, { method: "POST", body });
  const traceId = response.headers.get("x-fb-trace-id") ?? response.headers.get("x-fb-rev") ?? undefined;
  const json = (await response.json()) as { id?: string; post_id?: string; error?: { code?: number; message?: string; type?: string } };
  if (!response.ok || (!json.id && !json.post_id)) {
    throw new AppError({
      code: "meta_publish_failed",
      statusCode: 502,
      message: json.error?.message ?? "Meta Graph publish request failed",
      userMessage: "Facebook no pudo publicar en esa pagina. Revisa permisos y vuelve a intentar.",
      retryable: true,
      action: "reconnect",
      details: { metaCode: json.error?.code, metaType: json.error?.type, traceId }
    });
  }

  const facebookPostId = json.post_id ?? json.id ?? "";
  const result: MetaPublishResult = {
    facebookPostId,
    remotePostType: canPublishPhoto ? "photo" : "feed",
    remotePostUrl: `https://www.facebook.com/${facebookPostId}`
  };
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
    }>;
  }>(`https://graph.facebook.com/${input.graphApiVersion}/me/accounts`, {
    fields: "id,name,category,tasks,access_token",
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
      coverPhotoUrl: null,
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

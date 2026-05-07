import type {
  FacebookMetricsData,
  FacebookPageConnection,
  MetaDeviceLoginResponse,
  PublishPostData,
  FacebookTokenStatus,
} from "@fbmaniaco/shared";
import { AppError } from "@fbmaniaco/shared";
import type { FacebookPublishingProvider, MetaAuthProvider } from "./contracts";

type MetaGraphClientOptions = {
  appId?: string;
  appSecret?: string;
  apiVersion: string;
  deviceLoginScopes: string[];
};

type GraphResponse<T> = {
  data?: T;
  access_token?: string;
  expires_in?: number;
  code?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
} & Record<string, unknown>;

const safeJson = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const isPendingDeviceLoginError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; statusCode?: number; details?: unknown };
  if (candidate.code === "device_login_pending" || candidate.code === "device_login_waiting") return true;
  if (candidate.statusCode === 409) return true;
  return Boolean(candidate.details);
};

export class MetaGraphAuthProvider implements MetaAuthProvider {
  private readonly pageAccessTokens = new Map<string, string>();

  constructor(private readonly options: MetaGraphClientOptions) {}

  private get hasAppCredentials(): boolean {
    return Boolean(this.options.appId?.trim() && this.options.appSecret?.trim());
  }

  seedPageAccessToken = (pageId: string, accessToken: string): void => {
    if (pageId.trim() && accessToken.trim()) {
      this.pageAccessTokens.set(pageId, accessToken);
    }
  };

  seedPageAccessTokens = (entries: Array<{ pageId: string; accessToken: string }>): void => {
    for (const entry of entries) {
      if (entry.pageId.trim() && entry.accessToken.trim()) {
        this.pageAccessTokens.set(entry.pageId, entry.accessToken);
      }
    }
  };

  private get apiBase(): string {
    return `https://graph.facebook.com/${this.options.apiVersion}`;
  }

  private get appAccessToken(): string {
    if (!this.hasAppCredentials) {
      return "";
    }
    return `${this.options.appId}|${this.options.appSecret}`;
  }

  private missingAppCredentialsError(): AppError {
    return new AppError({
      code: "meta_app_credentials_missing",
      statusCode: 409,
      message: "Meta app credentials missing",
      userMessage: "Faltan credenciales de la app de Meta para el acceso automatico. Usa el token manual o agrega el app id y secret.",
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, init);
    const body = (await response.json().catch(() => ({}))) as GraphResponse<T>;

    if (!response.ok || body.error) {
      const message = body.error?.message ?? `Meta Graph request failed (${response.status})`;
      throw new AppError({
        code: body.error?.code ? `meta_graph_${body.error.code}` : "meta_graph_error",
        statusCode: response.status,
        message,
        userMessage: "No se pudo completar la solicitud con Meta.",
        details: body.error ?? body,
      });
    }

    return body as T;
  }

  async isTokenValid(token: string): Promise<boolean> {
    if (!token.trim()) return false;
    try {
      if (this.hasAppCredentials) {
        const result = await this.request<{ data?: { is_valid?: boolean } }>(`/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(this.appAccessToken)}`);
        return Boolean(result.data?.is_valid);
      }

      const result = await this.request<{ data?: Array<{ id?: string }> }>(`/me/accounts?fields=id&limit=1&access_token=${encodeURIComponent(token)}`);
      return Array.isArray(result.data);
    } catch {
      return false;
    }
  }

  async refreshLongLivedToken(token: string): Promise<string> {
    const { appId, appSecret } = this.options;
    if (!appId?.trim() || !appSecret?.trim()) {
      return token;
    }

    const url = new URL(`${this.apiBase}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("client_secret", appSecret);
    url.searchParams.set("fb_exchange_token", token);
    const result = await this.request<{ access_token?: string }>(url.pathname + url.search);
    if (!result.access_token) {
      throw new AppError({
        code: "meta_refresh_failed",
        statusCode: 502,
        message: "Meta refresh token exchange failed",
        userMessage: "No se pudo renovar el token de Meta.",
      });
    }
    return result.access_token;
  }

  async startDeviceLogin(scopes: string[]): Promise<MetaDeviceLoginResponse> {
    if (!this.hasAppCredentials) {
      throw this.missingAppCredentialsError();
    }

    const body = new URLSearchParams();
    body.set("access_token", this.appAccessToken);
    body.set("scope", scopes.join(","));
    body.set("response_type", "device_code");
    const result = await this.request<{
      code: string;
      user_code: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in: number;
      interval?: number;
    }>("/device/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    return {
      deviceCode: result.code,
      userCode: result.user_code,
      verificationUri: result.verification_uri_complete ?? result.verification_uri ?? "https://www.facebook.com/device",
      expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString(),
      intervalSeconds: result.interval ?? 5,
    };
  }

  async exchangeDeviceCode(deviceCode: string): Promise<string> {
    if (!this.hasAppCredentials) {
      throw this.missingAppCredentialsError();
    }

    const body = new URLSearchParams();
    body.set("access_token", this.appAccessToken);
    body.set("code", deviceCode);

    const response = await fetch(`${this.apiBase}/device/login_status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const result = (await response.json().catch(() => ({}))) as GraphResponse<{ access_token?: string }>;
    if (!response.ok || result.error) {
      const code = result.error?.code;
      const subcode = result.error?.error_subcode;
      if (code === 1349172 || subcode === 1349172 || code === 1349174 || subcode === 1349174) {
        throw new AppError({
          code: "device_login_pending",
          statusCode: 409,
          message: "Device login pending",
          userMessage: "Falta aprobar el codigo en Facebook.",
          details: result.error ?? result,
        });
      }
      if (code === 1349152 || subcode === 1349152) {
        throw new AppError({
          code: "device_login_expired",
          statusCode: 410,
          message: "Device login expired",
          userMessage: "El codigo de acceso de dispositivo expiro.",
          details: result.error ?? result,
        });
      }
      throw new AppError({
        code: "device_login_failed",
        statusCode: 502,
        message: result.error?.message ?? "Device login failed",
        userMessage: "No se pudo obtener el token automatico de Meta.",
        details: result.error ?? result,
      });
    }

    if (!result.access_token) {
      throw new AppError({
        code: "device_login_pending",
        statusCode: 409,
        message: "Device login still pending",
        userMessage: "Falta aprobar el codigo en Facebook.",
      });
    }

    return result.access_token;
  }

  async listPages(token: string): Promise<FacebookPageConnection[]> {
    const result = await this.request<{
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        category?: string | null;
        category_list?: Array<{ id?: string; name?: string }> | null;
        tasks?: string[] | null;
        picture?: { data?: { url?: string } };
      }>;
    }>(`/me/accounts?fields=id,name,access_token,category,category_list,tasks,picture{url}&access_token=${encodeURIComponent(token)}`);

    const pages = result.data ?? [];
    return pages.map((page) => {
      if (page.access_token) {
        this.pageAccessTokens.set(page.id, page.access_token);
      }
        return {
          pageId: page.id,
          pageName: page.name,
          coverPhotoUrl: page.picture?.data?.url ?? null,
          isSelected: false,
          pageAccessTokenStatus: "valido" as FacebookTokenStatus,
          category: page.category ?? null,
          categoryList: page.category_list ?? null,
          tasks: page.tasks ?? null,
        };
      });
    }

  async getPageAccessToken(pageId: string): Promise<string> {
    return this.pageAccessTokens.get(pageId) ?? "";
  }
}

export class MetaGraphPublishingProvider implements FacebookPublishingProvider {
  constructor(private readonly auth: MetaAuthProvider, private readonly apiVersion: string) {}

  private get apiBase(): string {
    return `https://graph.facebook.com/${this.apiVersion}`;
  }

  private async publishPhoto(pageId: string, accessToken: string, data: PublishPostData): Promise<string> {
    const form = new FormData();
    form.set("access_token", accessToken);
    form.set("published", data.scheduledFor ? "false" : "true");
    form.set("message", data.message);
    if (data.scheduledFor) {
      form.set("scheduled_publish_time", String(Math.floor(new Date(data.scheduledFor).getTime() / 1000)));
    }

    if (data.imageUrl) {
      if (data.imageUrl.startsWith("http://") || data.imageUrl.startsWith("https://")) {
        form.set("url", data.imageUrl);
      } else if (data.imageUrl.startsWith("data:")) {
        const response = await fetch(data.imageUrl);
        const blob = await response.blob();
        form.set("source", blob, "image.jpg");
      } else {
        form.set("url", data.imageUrl);
      }
    }

    const response = await fetch(`${this.apiBase}/${encodeURIComponent(pageId)}/photos`, {
      method: "POST",
      body: form,
    });

    const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!response.ok || !json.id) {
      throw new AppError({
        code: "facebook_publish_failed",
        statusCode: 502,
        message: json.error?.message ?? "Facebook photo publish failed",
        userMessage: "No se pudo publicar la imagen en Facebook.",
        details: json,
      });
    }
    return json.id;
  }

  private async publishFeed(pageId: string, accessToken: string, data: PublishPostData): Promise<string> {
    const body = new URLSearchParams();
    body.set("access_token", accessToken);
    body.set("message", data.message);
    if (data.scheduledFor) {
      body.set("published", "false");
      body.set("scheduled_publish_time", String(Math.floor(new Date(data.scheduledFor).getTime() / 1000)));
    }
    const response = await fetch(`${this.apiBase}/${encodeURIComponent(pageId)}/feed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!response.ok || !json.id) {
      throw new AppError({
        code: "facebook_publish_failed",
        statusCode: 502,
        message: json.error?.message ?? "Facebook feed publish failed",
        userMessage: "No se pudo publicar el post en Facebook.",
        details: json,
      });
    }
    return json.id;
  }

  async publishPost(data: PublishPostData): Promise<{ postId: string }> {
    const accessToken = await this.auth.getPageAccessToken(data.pageId);
    if (!accessToken) {
      throw new AppError({
        code: "page_token_missing",
        statusCode: 409,
        message: "Missing page access token",
        userMessage: "No encontramos un token valido para la pagina.",
      });
    }

    const postId = data.imageUrl ? await this.publishPhoto(data.pageId, accessToken, data) : await this.publishFeed(data.pageId, accessToken, data);
    return { postId };
  }

  async getPageAccessToken(pageId: string): Promise<string> {
    return this.auth.getPageAccessToken(pageId);
  }

  async getPageMetrics(pageId: string, postId: string): Promise<FacebookMetricsData> {
    const accessToken = await this.auth.getPageAccessToken(pageId);
    if (!accessToken) {
      throw new AppError({
        code: "page_token_missing",
        statusCode: 409,
        message: "Missing page access token",
        userMessage: "No encontramos un token valido para la pagina.",
      });
    }

    const url = `${this.apiBase}/${encodeURIComponent(postId)}?fields=insights.metric(post_impressions,post_reactions_by_type_total,post_comments,post_shares,post_saved)&access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url);
    const json = (await response.json().catch(() => ({}))) as { insights?: { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> } };
    if (!response.ok) {
      throw new AppError({
        code: "facebook_metrics_failed",
        statusCode: 502,
        message: "Facebook metrics request failed",
        userMessage: "No se pudieron obtener las metricas de Facebook.",
        details: json,
      });
    }

    const dataPoints = json.insights?.data ?? [];
    const lookup = (metric: string): number => dataPoints.find((item) => item.name === metric)?.values?.[0]?.value ?? 0;
    return {
      reach: lookup("post_impressions"),
      reactions: lookup("post_reactions_by_type_total"),
      comments: lookup("post_comments"),
      shares: lookup("post_shares"),
      saves: lookup("post_saved"),
    };
  }
}

import {
  normalizePageSettings,
  type CalendarItem,
  type Page,
  type PageSettings,
  type Photo,
} from '@cadencia/shared';
import type { ServerEnv } from './env.js';
import {
  clearPersistentMetaSession,
  getPersistentMetaSession,
  isStoredMetaSessionExpired,
  savePersistentMetaSession,
  type StoredMetaSession,
} from './metaSession.js';

type GraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type GraphResponse<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
  error?: GraphErrorBody;
};

type MetaPageNode = {
  id?: string;
  name?: string;
  category?: string;
  access_token?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
  cover?: {
    source?: string;
  };
};

export type MetaConnectionStatus = {
  configured: boolean;
  ok: boolean;
  graphVersion: string;
  loginMode?: 'business_config' | 'classic_scopes';
  tokenSource?: 'oauth';
  user?: {
    id: string;
    name: string;
  };
  pageCount?: number;
  error?: {
    message: string;
    code?: number;
    subcode?: number;
    type?: string;
  };
};

export type MetaPageSnapshot = {
  page: Page;
  pageAccessToken?: string;
};

export class MetaGraphError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;

  constructor(message: string, options: { status: number; body?: GraphErrorBody }) {
    super(message);
    this.name = 'MetaGraphError';
    this.status = options.status;
    this.code = options.body?.code;
    this.subcode = options.body?.error_subcode;
    this.type = options.body?.type;
  }
}

export async function hasActiveMetaOAuthSession(env: ServerEnv): Promise<boolean> {
  return Boolean(await getActiveMetaCredential(env));
}

export function isMetaPageId(pageId: string): boolean {
  return pageId.startsWith('meta-');
}

export async function getMetaConnectionStatus(env: ServerEnv): Promise<MetaConnectionStatus> {
  const credential = await getActiveMetaCredential(env);

  if (!credential) {
    return {
      configured: canStartMetaOAuth(env),
      ok: false,
      graphVersion: env.metaGraphVersion,
      loginMode: metaLoginMode(env),
      error: {
        message: canStartMetaOAuth(env)
          ? 'Necesitas iniciar sesion con Facebook.'
          : 'Falta configurar META_APP_ID, META_APP_SECRET o META_OAUTH_REDIRECT_URI.',
      },
    };
  }

  try {
    const user = await graphFetchOne<{ id?: string; name?: string }>(env, '/me', credential.token, {
      fields: 'id,name',
    });
    const pages = await getMetaPages(env);

    return {
      configured: true,
      ok: true,
      graphVersion: env.metaGraphVersion,
      loginMode: metaLoginMode(env),
      tokenSource: credential.source,
      user: {
        id: user.id ?? 'unknown',
        name: user.name ?? 'Usuario de Meta',
      },
      pageCount: pages.length,
    };
  } catch (error) {
    if (error instanceof MetaGraphError) {
      return {
        configured: true,
        ok: false,
        graphVersion: env.metaGraphVersion,
        loginMode: metaLoginMode(env),
        tokenSource: credential.source,
        error: {
          message: error.message,
          code: error.code,
          subcode: error.subcode,
          type: error.type,
        },
      };
    }

    return {
      configured: true,
      ok: false,
      graphVersion: env.metaGraphVersion,
      loginMode: metaLoginMode(env),
      tokenSource: credential.source,
      error: {
        message: 'No pude validar la conexion con Meta.',
      },
    };
  }
}

export async function getMetaPages(env: ServerEnv): Promise<Page[]> {
  const snapshots = await getMetaPageSnapshots(env);
  return snapshots.map((snapshot) => snapshot.page);
}

export async function getMetaPageSnapshots(env: ServerEnv): Promise<MetaPageSnapshot[]> {
  const userToken = await requireUserToken(env);
  const nodes = await graphFetchAll<MetaPageNode>(env, '/me/accounts', userToken, {
    fields: 'id,name,category,access_token,picture{url},cover{source},tasks',
    limit: '100',
  });

  return nodes
    .filter((node): node is Required<Pick<MetaPageNode, 'id' | 'name'>> & MetaPageNode => {
      return Boolean(node.id && node.name);
    })
    .map((node) => {
      return {
        page: {
          id: pageIdFromFacebookId(node.id),
          userId: 'meta-user',
          fbPageId: node.id,
          name: node.name,
          category: node.category ?? 'Pagina de Facebook',
          coverUrl: node.cover?.source ?? placeholderImage(node.name, 'cover'),
          profileUrl: node.picture?.data?.url ?? placeholderImage(node.name, 'profile'),
          settings: defaultPageSettings(node),
        },
        pageAccessToken: node.access_token,
      };
    });
}

export function canStartMetaOAuth(env: ServerEnv): boolean {
  return Boolean(env.metaAppId && env.metaAppSecret && env.metaOAuthRedirectUri);
}

export function buildMetaOAuthUrl(env: ServerEnv, state: string): string {
  if (!canStartMetaOAuth(env) || !env.metaAppId) {
    const missing = [
      env.metaAppId ? undefined : 'META_APP_ID',
      env.metaAppSecret ? undefined : 'META_APP_SECRET',
    ].filter(Boolean);

    throw new MetaGraphError(`Falta ${missing.join(' y ')} para iniciar sesion con Facebook.`, {
      status: 503,
    });
  }

  const url = new URL(`https://www.facebook.com/${env.metaGraphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', env.metaAppId);
  url.searchParams.set('redirect_uri', env.metaOAuthRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('auth_type', 'rerequest');
  url.searchParams.set('state', state);

  if (env.metaLoginConfigId) {
    url.searchParams.set('config_id', env.metaLoginConfigId);
    url.searchParams.set('override_default_response_type', 'true');
  } else {
    url.searchParams.set('scope', metaClassicScopes().join(','));
  }

  return url.toString();
}

export async function connectMetaWithCode(
  env: ServerEnv,
  code: string,
): Promise<MetaConnectionStatus> {
  if (!env.metaAppId || !env.metaAppSecret) {
    throw new MetaGraphError(
      'Faltan META_APP_ID y META_APP_SECRET para completar el inicio de sesion.',
      {
        status: 503,
      },
    );
  }

  const shortLived = await exchangeCodeForToken(env, code);
  const longLived = await exchangeForLongLivedToken(env, shortLived.access_token);
  const expiresAt = longLived.expires_in
    ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
    : undefined;
  const user = await graphFetchOne<{ id?: string; name?: string }>(
    env,
    '/me',
    longLived.access_token,
    { fields: 'id,name' },
  );

  await savePersistentMetaSession(env, {
    connectedAt: new Date().toISOString(),
    expiresAt,
    longLivedUserToken: longLived.access_token,
    user: {
      id: user.id ?? 'unknown',
      name: user.name ?? 'Usuario de Meta',
    },
  });
  await getMetaPageSnapshots(env);

  return getMetaConnectionStatus(env);
}

export async function disconnectMetaSession(env: ServerEnv): Promise<void> {
  await clearPersistentMetaSession(env);
}

export async function getMetaPage(env: ServerEnv, pageId: string): Promise<Page | undefined> {
  const pages = await getMetaPages(env);
  return pages.find((page) => page.id === pageId);
}

export async function getMetaPhotos(_env: ServerEnv, _pageId: string): Promise<Photo[]> {
  return [];
}

export async function getMetaCalendar(_env: ServerEnv, _pageId: string): Promise<CalendarItem[]> {
  return [];
}

async function graphFetchAll<T>(
  env: ServerEnv,
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T[]> {
  const firstUrl = buildGraphUrl(env, path, accessToken, params);
  const results: T[] = [];
  let nextUrl: string | undefined = firstUrl.toString();
  let page = 0;

  while (nextUrl && page < 10) {
    const response = await fetch(nextUrl);
    const json = (await response.json()) as GraphResponse<T>;

    if (!response.ok || json.error) {
      throw new MetaGraphError(
        json.error?.message ?? 'Meta Graph API no respondio correctamente.',
        {
          status: response.status,
          body: json.error,
        },
      );
    }

    results.push(...(json.data ?? []));
    nextUrl = json.paging?.next;
    page += 1;
  }

  return results;
}

async function graphFetchOne<T>(
  env: ServerEnv,
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const url = buildGraphUrl(env, path, accessToken, params);
  const response = await fetch(url);
  const json = (await response.json()) as T & {
    error?: GraphErrorBody;
  };

  if (!response.ok || json.error) {
    throw new MetaGraphError(json.error?.message ?? 'Meta Graph API no respondio correctamente.', {
      status: response.status,
      body: json.error,
    });
  }

  return json;
}

function buildGraphUrl(
  env: ServerEnv,
  path: string,
  accessToken: string,
  params: Record<string, string>,
): URL {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`https://graph.facebook.com/${env.metaGraphVersion}${normalizedPath}`);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  url.searchParams.set('access_token', accessToken);

  return url;
}

async function requireUserToken(env: ServerEnv): Promise<string> {
  const credential = await getActiveMetaCredential(env);

  if (!credential) {
    throw new MetaGraphError('Inicia sesion con Facebook para sincronizar paginas.', {
      status: 503,
    });
  }

  return credential.token;
}

async function getActiveMetaCredential(
  env: ServerEnv,
): Promise<{ session: StoredMetaSession; source: 'oauth'; token: string } | undefined> {
  const session = await getPersistentMetaSession(env);

  if (session && isStoredMetaSessionExpired(session)) {
    await clearPersistentMetaSession(env);
  } else if (session?.longLivedUserToken) {
    return {
      session,
      source: 'oauth',
      token: session.longLivedUserToken,
    };
  }

  return undefined;
}

async function exchangeCodeForToken(
  env: ServerEnv,
  code: string,
): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  const url = new URL(`https://graph.facebook.com/${env.metaGraphVersion}/oauth/access_token`);
  url.searchParams.set('client_id', env.metaAppId as string);
  url.searchParams.set('client_secret', env.metaAppSecret as string);
  url.searchParams.set('code', code);
  url.searchParams.set('redirect_uri', env.metaOAuthRedirectUri);

  return graphTokenFetch(url);
}

async function exchangeForLongLivedToken(
  env: ServerEnv,
  shortLivedToken: string,
): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  const url = new URL(`https://graph.facebook.com/${env.metaGraphVersion}/oauth/access_token`);
  url.searchParams.set('client_id', env.metaAppId as string);
  url.searchParams.set('client_secret', env.metaAppSecret as string);
  url.searchParams.set('fb_exchange_token', shortLivedToken);
  url.searchParams.set('grant_type', 'fb_exchange_token');

  return graphTokenFetch(url);
}

async function graphTokenFetch<T extends { access_token?: string; error?: GraphErrorBody }>(
  url: URL,
): Promise<T & { access_token: string }> {
  const response = await fetch(url);
  const json = (await response.json()) as T;

  if (!response.ok || json.error || !json.access_token) {
    throw new MetaGraphError(
      json.error?.message ?? 'Meta no pudo completar el intercambio de token.',
      {
        status: response.status,
        body: json.error,
      },
    );
  }

  return json as T & { access_token: string };
}

function pageIdFromFacebookId(fbPageId: string): string {
  return `meta-${fbPageId}`;
}

function metaLoginMode(env: ServerEnv): 'business_config' | 'classic_scopes' {
  return env.metaLoginConfigId ? 'business_config' : 'classic_scopes';
}

function metaClassicScopes(): string[] {
  return ['public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
}

function defaultPageSettings(page: MetaPageNode): PageSettings {
  return normalizePageSettings({
    seoKeywords: keywordsFromPage(page),
    businessHours: {
      start: '09:00',
      end: '20:00',
    },
    preferredImageModels: ['gpt_image_2'],
    defaultContextMode: 'ai',
    skipReviewDefault: false,
  });
}

function keywordsFromPage(page: MetaPageNode): string[] {
  const words = `${page.name ?? ''} ${page.category ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

  return Array.from(new Set(words)).slice(0, 6);
}

function placeholderImage(name: string, type: 'cover' | 'profile'): string {
  const encoded = encodeURIComponent(name);

  if (type === 'profile') {
    return `https://placehold.co/400x400/e9ddff/25113f?text=${encoded}`;
  }

  return `https://placehold.co/1200x525/e9ddff/25113f?text=${encoded}`;
}

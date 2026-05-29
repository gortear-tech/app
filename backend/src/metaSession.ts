import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';
import type { ServerEnv } from './env.js';

export type StoredMetaSession = {
  connectedAt: string;
  expiresAt?: string;
  longLivedUserToken: string;
  user?: {
    id: string;
    name: string;
  };
};

const sessionPath = resolve(process.cwd(), '.tools', 'meta-session.json');
const sessionId = 'default-meta-session';

export function getStoredMetaSession(): StoredMetaSession | undefined {
  if (!existsSync(sessionPath)) {
    return undefined;
  }

  try {
    const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as Partial<StoredMetaSession>;

    if (!session.longLivedUserToken) {
      return undefined;
    }

    return session as StoredMetaSession;
  } catch {
    return undefined;
  }
}

export async function getPersistentMetaSession(env: ServerEnv): Promise<StoredMetaSession | undefined> {
  return (await getDatabaseMetaSession(env)) ?? getStoredMetaSession();
}

export async function savePersistentMetaSession(env: ServerEnv, session: StoredMetaSession): Promise<void> {
  saveStoredMetaSession(session);
  await saveDatabaseMetaSession(env, session);
}

export async function clearPersistentMetaSession(env: ServerEnv): Promise<void> {
  clearStoredMetaSession();
  await clearDatabaseMetaSession(env);
}

export function isStoredMetaSessionExpired(session: StoredMetaSession): boolean {
  return Boolean(session.expiresAt && Date.parse(session.expiresAt) <= Date.now());
}

function saveStoredMetaSession(session: StoredMetaSession): void {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(session, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function clearStoredMetaSession(): void {
  if (existsSync(sessionPath)) {
    rmSync(sessionPath);
  }
}

async function getDatabaseMetaSession(env: ServerEnv): Promise<StoredMetaSession | undefined> {
  if (!env.databaseUrl) {
    return undefined;
  }

  const client = new Client({ connectionString: env.databaseUrl });

  try {
    await client.connect();
    await ensureSessionTable(client);
    const result = await client.query<{
      connected_at: Date | string;
      expires_at: Date | string | null;
      long_lived_user_token: string;
      user_info: { id?: string; name?: string } | null;
    }>(
      `select long_lived_user_token, connected_at, expires_at, user_info
       from public.cadencia_meta_sessions
       where id = $1`,
      [sessionId],
    );
    const row = result.rows[0];

    if (!row) {
      return undefined;
    }

    return {
      connectedAt: toIsoString(row.connected_at),
      expiresAt: row.expires_at ? toIsoString(row.expires_at) : undefined,
      longLivedUserToken: row.long_lived_user_token,
      user: row.user_info?.id
        ? {
            id: row.user_info.id,
            name: row.user_info.name ?? 'Usuario de Meta',
          }
        : undefined,
    };
  } catch {
    return undefined;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function saveDatabaseMetaSession(env: ServerEnv, session: StoredMetaSession): Promise<void> {
  if (!env.databaseUrl) {
    return;
  }

  const client = new Client({ connectionString: env.databaseUrl });

  try {
    await client.connect();
    await ensureSessionTable(client);
    await client.query(
      `insert into public.cadencia_meta_sessions
        (id, long_lived_user_token, connected_at, expires_at, user_info, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (id)
       do update set
        long_lived_user_token = excluded.long_lived_user_token,
        connected_at = excluded.connected_at,
        expires_at = excluded.expires_at,
        user_info = excluded.user_info,
        updated_at = now()`,
      [
        sessionId,
        session.longLivedUserToken,
        session.connectedAt,
        session.expiresAt ?? null,
        JSON.stringify(session.user ?? {}),
      ],
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function clearDatabaseMetaSession(env: ServerEnv): Promise<void> {
  if (!env.databaseUrl) {
    return;
  }

  const client = new Client({ connectionString: env.databaseUrl });

  try {
    await client.connect();
    await ensureSessionTable(client);
    await client.query('delete from public.cadencia_meta_sessions where id = $1', [sessionId]);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureSessionTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists public.cadencia_meta_sessions (
      id text primary key,
      long_lived_user_token text not null,
      connected_at timestamptz not null default now(),
      expires_at timestamptz,
      user_info jsonb not null default jsonb_build_object(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

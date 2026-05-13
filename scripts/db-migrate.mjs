import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.cwd();
const requireFromApi = createRequire(join(root, "apps/api/package.json"));
const { Pool } = requireFromApi("pg");

const args = new Set(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL ?? "";
const migrationsDir = join(root, "apps/api/supabase/migrations");
const statusOnly = args.has("--status") || args.has("status");
const checkOnly = args.has("--check") || args.has("check");
const dryRun = args.has("--dry-run");

const fail = (message) => {
  console.error(`db migrate failed: ${message}`);
  process.exit(1);
};

if (!databaseUrl) {
  fail("DATABASE_URL is required");
}

if (!existsSync(migrationsDir)) {
  fail(`migrations directory not found: ${migrationsDir}`);
}

const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((filename) => {
    const sql = readFileSync(join(migrationsDir, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    return { filename, sql, checksum };
  });

if (migrations.length === 0) {
  fail("no SQL migrations found");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
});

const ensureLedger = async (client) => {
  await client.query(`
    create table if not exists public.fbmaniaco_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
};

const main = async () => {
  const client = await pool.connect();
  try {
    await ensureLedger(client);
    const appliedResult = await client.query("select filename, checksum, applied_at from public.fbmaniaco_schema_migrations");
    const applied = new Map(appliedResult.rows.map((row) => [row.filename, row]));

    const changed = migrations.filter((migration) => {
      const existing = applied.get(migration.filename);
      return existing && existing.checksum !== migration.checksum;
    });
    if (changed.length > 0) {
      fail(`applied migration checksum changed: ${changed.map((migration) => migration.filename).join(", ")}`);
    }

    const pending = migrations.filter((migration) => !applied.has(migration.filename));
    if (statusOnly || checkOnly) {
      console.log(`db migrations status: ${applied.size} applied, ${pending.length} pending`);
      for (const migration of pending) console.log(`pending ${migration.filename}`);
      if (checkOnly && pending.length > 0) process.exitCode = 1;
      return;
    }

    if (pending.length === 0) {
      console.log(`db migrations ok (${applied.size} applied, 0 pending)`);
      return;
    }

    if (dryRun) {
      await client.query("begin");
      try {
        for (const migration of pending) {
          console.log(`dry-run ${migration.filename}`);
          await client.query(migration.sql);
        }
      } finally {
        await client.query("rollback");
      }
      console.log(`db migrations dry-run ok (${pending.length} pending migrations validated)`);
      return;
    }

    for (const migration of pending) {
      await client.query("begin");
      try {
        console.log(`applying ${migration.filename}`);
        await client.query(migration.sql);
        await client.query(
          "insert into public.fbmaniaco_schema_migrations (filename, checksum, applied_at) values ($1, $2, now())",
          [migration.filename, migration.checksum]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    console.log(`db migrations ok (${applied.size + pending.length} applied, 0 pending)`);
  } finally {
    client.release();
  }
};

try {
  await main();
} finally {
  await pool.end();
}

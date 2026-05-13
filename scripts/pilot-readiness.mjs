import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const envExample = read(".env.example");
const renderYaml = read("render.yaml");
const packageJson = read("package.json");
const mobileConfig = read("apps/mobile/src/config.ts");
const apiDbFactory = read("apps/api/src/db/index.ts");
const supabaseStore = read("apps/api/src/db/supabase-store.ts");
const deploySmoke = read("scripts/deploy-smoke.mjs");
const dbMigrate = read("scripts/db-migrate.mjs");
const migrations = readdirSync(join(root, "apps/api/supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
const migrationContents = migrations.map((name) => [name, read(`apps/api/supabase/migrations/${name}`)]);

const requiredEnv = [
  "APP_ENV",
  "DATA_STORE_MODE",
  "ALLOW_LOCAL_DATASTORE",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE",
  "DATABASE_URL",
  "BILLING_WEBHOOK_SECRET",
  "FEATURE_META_PUBLISHING",
  "FEATURE_OPENAI_VISION",
  "FEATURE_OPENAI_IMAGE_GENERATION",
  "FEATURE_AUTONOMY"
];

for (const key of requiredEnv) {
  if (!envExample.includes(`${key}=`)) fail(`.env.example missing ${key}`);
}

if (!renderYaml.includes("DATA_STORE_MODE") || !renderYaml.includes("value: supabase")) {
  fail("render.yaml must force DATA_STORE_MODE=supabase for deployed services");
}

if (!renderYaml.includes("ALLOW_LOCAL_DATASTORE") || !renderYaml.includes('value: "false"')) {
  fail("render.yaml must disable local datastore for deployed services");
}

if (!packageJson.includes('"smoke:deploy"') || !deploySmoke.includes("/ready") || !deploySmoke.includes("worker")) {
  fail("deploy smoke script must verify deployed /ready including worker readiness");
}

if (
  !packageJson.includes('"db:migrate"') ||
  !packageJson.includes('"db:migrate:check"') ||
  !dbMigrate.includes("fbmaniaco_schema_migrations") ||
  !dbMigrate.includes("checksum")
) {
  fail("database migration runner must track applied SQL migrations with checksums");
}

if (!mobileConfig.includes("https://") || !mobileConfig.includes("appEnv !== \"development\"")) {
  fail("mobile config must require public HTTPS API outside development");
}

if (mobileConfig.includes("SERVICE_ROLE") || mobileConfig.includes("SUPABASE_SERVICE_ROLE")) {
  fail("mobile config references server-only service role");
}

if (!apiDbFactory.includes("createSupabaseDataStore") || !apiDbFactory.includes("DATABASE_URL is required")) {
  fail("API datastore factory must wire Supabase mode and require DATABASE_URL");
}

if (!apiDbFactory.includes("ALLOW_LOCAL_DATASTORE")) {
  fail("API datastore factory must refuse unsafe local datastore usage");
}

for (const method of [
  "upsertMetaAuthorization",
  "selectMetaPage",
  "createBatch",
  "createUploadIntent",
  "completeUpload",
  "completeAnalyzePhoto",
  "estimateBatchCost",
  "confirmBatchCost",
  "requestGenerateBatch",
  "completeGenerateVariant",
  "approveVariant",
  "confirmCalendar",
  "completeSchedulePosts",
  "publishScheduledPost",
  "publishScheduledPostNow",
  "requestCollectMetrics",
  "completeCollectMetrics",
  "requestWeeklyReport",
  "completeWeeklyReport",
  "evaluateBusinessAutonomy",
  "requestBatchCaptionEval",
  "completeBatchCaptionEval",
  "listAiEvaluations",
  "getBillingStatus",
  "createUpgradeIntent",
  "processBillingProviderEvent"
]) {
  if (!supabaseStore.includes(`async ${method}`)) fail(`Supabase datastore missing ${method}`);
}

const expectedMigrationPrefixes = [
  "0001_",
  "0002_",
  "0003_",
  "0004_",
  "0005_",
  "0006_",
  "0007_",
  "0008_",
  "0009_",
  "0010_",
  "0011_"
];

for (const prefix of expectedMigrationPrefixes) {
  if (!migrations.some((name) => name.startsWith(prefix))) fail(`missing migration ${prefix}*`);
}

for (const [name, content] of migrationContents) {
  if (/\b(workspace_id|business_id|scheduled_post_id)\s+uuid\b/i.test(content)) {
    fail(`${name} uses uuid tenant foreign keys; canonical IDs are text`);
  }
}

for (const path of ["apps/mobile/App.tsx", "apps/mobile/src/api/client.ts"]) {
  const content = read(path);
  if (/SUPABASE_SERVICE_ROLE|META_APP_SECRET|OPENAI_API_KEY|BILLING_WEBHOOK_SECRET/.test(content)) {
    fail(`${path} contains server-only secret reference`);
  }
}

if (!renderYaml.includes("REQUIRE_WORKER_HEARTBEAT")) warn("worker heartbeat readiness is not configured in render.yaml");
if (!envExample.includes("SENTRY_DSN=")) warn("SENTRY_DSN is missing from .env.example");

for (const message of warnings) console.warn(`warning: ${message}`);

if (failures.length > 0) {
  for (const message of failures) console.error(`failure: ${message}`);
  process.exit(1);
}

console.log(`pilot readiness ok (${migrations.length} migrations checked)`);

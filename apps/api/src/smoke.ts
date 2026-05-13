import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createDataStore } from "./db/index.js";
import { buildServer } from "./server.js";

const localDbPath = join(tmpdir(), `fbmaniaco-api-smoke-${Date.now()}.json`);
process.env.LOCAL_DB_PATH = localDbPath;
const config = loadConfig();
const store = createDataStore(config);
const app = await buildServer({ config, store });

const health = await app.inject({ method: "GET", url: "/health" });
const ready = await app.inject({ method: "GET", url: "/ready" });
const bootstrap = await app.inject({
  method: "GET",
  url: "/auth/bootstrap-status",
  headers: { authorization: "Bearer dev:smoke-user:smoke@example.com" }
});

if (health.statusCode !== 200) throw new Error(`health failed: ${health.statusCode}`);
if (ready.statusCode !== 200) throw new Error(`ready failed: ${ready.statusCode} ${ready.body}`);
if (bootstrap.statusCode !== 200) throw new Error(`bootstrap failed: ${bootstrap.statusCode} ${bootstrap.body}`);

const connect = await app.inject({
  method: "POST",
  url: "/auth/meta/connect",
  headers: {
    authorization: "Bearer dev:smoke-user:smoke@example.com",
    "idempotency-key": "smoke-connect-key"
  },
  payload: { flow: "oauth" }
});
if (connect.statusCode !== 200) throw new Error(`meta connect failed: ${connect.statusCode} ${connect.body}`);

const page = connect.json().pages.find((item: { canPublish: boolean }) => item.canPublish);
const select = await app.inject({
  method: "POST",
  url: "/meta/pages/select",
  headers: {
    authorization: "Bearer dev:smoke-user:smoke@example.com",
    "idempotency-key": "smoke-select-key"
  },
  payload: { pageId: page.id }
});
if (select.statusCode !== 200) throw new Error(`page select failed: ${select.statusCode} ${select.body}`);
const businessId = select.json().business.id as string;

const batch = await app.inject({
  method: "POST",
  url: `/businesses/${businessId}/batches`,
  headers: {
    authorization: "Bearer dev:smoke-user:smoke@example.com",
    "idempotency-key": "smoke-create-batch-key"
  }
});
if (batch.statusCode !== 200) throw new Error(`create batch failed: ${batch.statusCode} ${batch.body}`);
const batchId = batch.json().batch.id as string;

const uploadIntent = await app.inject({
  method: "POST",
  url: `/businesses/${businessId}/batches/${batchId}/photos/upload-intent`,
  headers: {
    authorization: "Bearer dev:smoke-user:smoke@example.com",
    "idempotency-key": "smoke-upload-intent-key"
  },
  payload: { originalFileName: "smoke.jpg", contentType: "image/jpeg", fileSize: 1024 }
});
if (uploadIntent.statusCode !== 200) {
  throw new Error(`upload intent failed: ${uploadIntent.statusCode} ${uploadIntent.body}`);
}

const completeUpload = await app.inject({
  method: "POST",
  url: `/businesses/${businessId}/batches/${batchId}/photos/complete-upload`,
  headers: {
    authorization: "Bearer dev:smoke-user:smoke@example.com",
    "idempotency-key": "smoke-complete-upload-key"
  },
  payload: {
    storageKey: uploadIntent.json().uploadIntent.storageKey,
    originalFileName: "smoke.jpg",
    contentType: "image/jpeg",
    fileSize: 1024
  }
});
if (completeUpload.statusCode !== 200) {
  throw new Error(`complete upload failed: ${completeUpload.statusCode} ${completeUpload.body}`);
}

console.log("api smoke ok");
await app.close();
await rm(localDbPath, { force: true });

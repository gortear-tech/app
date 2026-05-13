import { describe, expect, it } from "vitest";
import { ApiConfig } from "../config.js";
import { createDataStore } from "./index.js";

const makeConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  appEnv: "development",
  dataStoreMode: "local",
  allowLocalDataStore: true,
  host: "127.0.0.1",
  port: 0,
  corsOrigin: "*",
  localAuthEnabled: true,
  localDbPath: ".tmp/test-db.json",
  supabaseUrl: undefined,
  supabaseServiceRole: undefined,
  databaseUrl: undefined,
  metaAppId: undefined,
  metaAppSecret: undefined,
  metaRedirectUri: undefined,
  metaGraphApiVersion: "v23.0",
  metaRequiredScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  metaTestUserAccessToken: undefined,
  openaiApiKey: undefined,
  openaiBaseUrl: undefined,
  openaiVisionModel: "gpt-5.5",
  openaiVisionTimeoutMs: 30000,
  release: "test",
  workerHeartbeatMaxAgeMs: 120000,
  requireWorkerHeartbeat: false,
  billingWebhookSecret: undefined,
  featureFlags: {
    metaPublishing: false,
    openaiVision: false,
    openaiImageGeneration: false,
    remoteSchedule: false,
    autonomy: false
  },
  ...overrides
});

describe("datastore factory", () => {
  it("requires DATABASE_URL in Supabase mode", () => {
    expect(() => createDataStore(makeConfig({ dataStoreMode: "supabase", databaseUrl: undefined }))).toThrow(
      /DATABASE_URL is required/
    );
  });

  it("blocks local datastore when the environment does not explicitly allow it", () => {
    expect(() => createDataStore(makeConfig({ dataStoreMode: "local", allowLocalDataStore: false }))).toThrow(
      /Local DataStore is disabled/
    );
  });

  it("creates the Supabase datastore adapter when configured", () => {
    expect(() =>
      createDataStore(makeConfig({ dataStoreMode: "supabase", databaseUrl: "postgres://user:pass@localhost:5432/fbmaniaco" }))
    ).not.toThrow();
  });
});

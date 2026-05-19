import { afterEach, describe, expect, it } from "vitest";
import { getMobileConfig } from "./config";

const originalEnv = { ...process.env };
const originalDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
const productionUpdateManifestUrl =
  "https://guzohwqptoiagulxsard.supabase.co/storage/v1/object/public/app-downloads/fbmaniaco-android-update.json";

afterEach(() => {
  process.env = { ...originalEnv };
  if (originalDev === undefined) {
    delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
  } else {
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = originalDev;
  }
});

describe("mobile config", () => {
  it("defaults release builds to the production API", () => {
    delete process.env.EXPO_PUBLIC_APP_ENV;
    delete process.env.EXPO_PUBLIC_API_URL;
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

    expect(getMobileConfig()).toEqual({
      appEnv: "production",
      apiUrl: "https://fbmaniaco-api.onrender.com",
      updateManifestUrl: productionUpdateManifestUrl
    });
  });

  it("defaults development bundles to localhost", () => {
    delete process.env.EXPO_PUBLIC_APP_ENV;
    delete process.env.EXPO_PUBLIC_API_URL;
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

    expect(getMobileConfig()).toEqual({
      appEnv: "development",
      apiUrl: "http://localhost:4000",
      updateManifestUrl: productionUpdateManifestUrl
    });
  });

  it("blocks localhost in production builds", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000";

    expect(() => getMobileConfig()).toThrow(/public HTTPS API URL/);
  });

  it("blocks non-HTTPS staging builds", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "staging";
    process.env.EXPO_PUBLIC_API_URL = "http://api.example.com";

    expect(() => getMobileConfig()).toThrow(/public HTTPS API URL/);
  });

  it("allows localhost in development", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:4000";

    expect(getMobileConfig().apiUrl).toBe("http://localhost:4000");
  });

  it("does not require Supabase public keys in the mobile build", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    expect(getMobileConfig().apiUrl).toBe("https://api.example.com");
  });
});

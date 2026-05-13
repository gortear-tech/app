import { afterEach, describe, expect, it } from "vitest";
import { getMobileConfig } from "./config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("mobile config", () => {
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
});

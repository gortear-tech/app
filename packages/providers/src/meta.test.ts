import { describe, expect, it } from "vitest";
import { createMetaProvider } from "./meta.js";

describe("GraphMetaProvider authorization URL", () => {
  it("uses Login for Business config_id when configured", () => {
    const provider = createMetaProvider({
      appId: "app-1",
      appSecret: "secret-1",
      redirectUri: "https://api.example.com/auth/meta/callback",
      loginConfigurationId: "config-1",
      graphApiVersion: "v23.0",
      requiredScopes: ["pages_show_list", "pages_manage_posts"]
    });

    const url = new URL(provider.buildAuthorizationUrl({ state: "state-1" }));

    expect(url.searchParams.get("config_id")).toBe("config-1");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.example.com/auth/meta/callback");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaProvider, loadMetaPagesFromUserAccessToken } from "./meta.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("loads page cover and profile photos from Graph", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = input.toString();
        requests.push(url);
        if (url.includes("/debug_token")) {
          return new Response(
            JSON.stringify({
              data: {
                is_valid: true,
                scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
                granular_scopes: [{ scope: "pages_show_list", target_ids: ["page-1"] }]
              }
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "page-1",
                name: "Pagina Real",
                category: "Restaurant",
                tasks: ["CREATE_CONTENT"],
                access_token: "page-token",
                cover: { source: "https://cdn.example.com/cover.jpg" },
                picture: { data: { url: "https://cdn.example.com/profile.jpg", is_silhouette: false } }
              }
            ]
          }),
          { status: 200 }
        );
      })
    );

    const result = await loadMetaPagesFromUserAccessToken(
      {
        appId: "app-1",
        appSecret: "secret-1",
        redirectUri: "https://api.example.com/auth/meta/callback",
        graphApiVersion: "v23.0",
        requiredScopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"]
      },
      "user-token"
    );

    expect(requests[1]).toContain("cover%7Bsource%7D");
    expect(requests[1]).toContain("picture.type%28large%29%7Burl%2Cis_silhouette%7D");
    expect(result.pages[0]).toMatchObject({
      pageName: "Pagina Real",
      coverPhotoUrl: "https://cdn.example.com/cover.jpg",
      profilePhotoUrl: "https://cdn.example.com/profile.jpg"
    });
  });
});

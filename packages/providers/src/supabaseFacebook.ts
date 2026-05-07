import type {
  FacebookMetricsData,
  PublishPostData,
} from "@fbmaniaco/shared";
import type { FacebookPublishingProvider, MetaAuthProvider } from "./contracts";
import { MockFacebookPublishingProvider, MockMetaAuthProvider } from "./mocks";

export class SupabaseFacebookPublishingProvider implements FacebookPublishingProvider {
  constructor(
    private readonly fallback: FacebookPublishingProvider = new MockFacebookPublishingProvider(),
    private readonly auth: MetaAuthProvider = new MockMetaAuthProvider(),
  ) {}

  async publishPost(data: PublishPostData): Promise<{ postId: string }> {
    const accessToken = await this.auth.getPageAccessToken(data.pageId);
    if (!accessToken) {
      return this.fallback.publishPost(data);
    }

    const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(data.pageId)}/feed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: data.message,
        access_token: accessToken,
        link: data.imageUrl ?? undefined,
        published: data.scheduledFor ? "false" : "true",
      }),
    });

    if (!response.ok) {
      return this.fallback.publishPost(data);
    }

    const json = (await response.json()) as { id?: string };
    if (!json.id) {
      return this.fallback.publishPost(data);
    }

    return { postId: json.id };
  }

  async getPageAccessToken(pageId: string): Promise<string> {
    return this.auth.getPageAccessToken(pageId);
  }

  async getPageMetrics(pageId: string, postId: string): Promise<FacebookMetricsData> {
    const token = await this.auth.getPageAccessToken(pageId);
    if (!token) {
      return this.fallback.getPageMetrics(pageId, postId);
    }

    const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(postId)}?fields=insights.metric(post_impressions,post_reactions_by_type_total,post_comments,post_shares,post_saved)&access_token=${encodeURIComponent(token)}`);
    if (!response.ok) {
      return this.fallback.getPageMetrics(pageId, postId);
    }

    return this.fallback.getPageMetrics(pageId, postId);
  }
}

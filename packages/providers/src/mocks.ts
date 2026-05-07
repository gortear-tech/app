import type {
  FacebookMetricsData,
  FacebookTokenStatus,
  MetaDeviceLoginResponse,
  PublishPostData,
  VisionAnalysisResult,
} from "@fbmaniaco/shared";
import type {
  CaptionGenerationProvider,
  FacebookPublishingProvider,
  ImageGenerationProvider,
  MediaStorage,
  MetaAuthProvider,
  PushNotificationProvider,
  VisionAnalysisProvider,
} from "./contracts";

const demoVisionResult = (_imageUrl: string): VisionAnalysisResult => ({
  subject: {
    type: "producto",
    description: "Analisis de referencia",
    hasPerson: false,
  },
  composition: {
    framing: "primer_plano",
    angle: "frontal",
    backgroundType: "limpio",
    backgroundDescription: "Clean background",
    lighting: "natural",
  },
  palette: {
    dominantColors: ["#d97706", "#ffffff", "#111111"],
    temperature: "calida",
    saturation: 62,
    contrast: 58,
  },
  sensitiveElements: {
    priceVisible: false,
    logoVisible: false,
    personVisible: false,
    promotionVisible: false,
    textVisible: false,
    notes: [],
  },
  technicalQuality: {
    sharpness: 72,
    exposure: 64,
    noise: 12,
  },
  mood: {
    temperature: "calida",
    keywords: ["apetitoso", "limpio"],
    description: "Warm and appetizing",
  },
  summary: "Analisis de referencia",
});

export class MockVisionAnalysisProvider implements VisionAnalysisProvider {
  async analyze(imageUrl: string): Promise<VisionAnalysisResult> {
    return demoVisionResult(imageUrl);
  }
}

export class MockMediaStorage implements MediaStorage {
  async generateSignedUploadUrl(key: string): Promise<{ url: string; key: string }> {
    return {
      key,
      url: `https://storage.fbmaniaco.local/upload/${encodeURIComponent(key)}`,
    };
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    return `https://storage.fbmaniaco.local/download/${encodeURIComponent(key)}`;
  }
}

export class MockFacebookPublishingProvider implements FacebookPublishingProvider {
  async publishPost(_data: PublishPostData): Promise<{ postId: string }> {
    return { postId: `mock_${crypto.randomUUID()}` };
  }

  async getPageAccessToken(pageId: string): Promise<string> {
    return `mock_page_token_${pageId}`;
  }

  async getPageMetrics(_pageId: string, _postId: string): Promise<FacebookMetricsData> {
    return {
      reach: 1234,
      reactions: 98,
      comments: 18,
      shares: 12,
      saves: 8,
    };
  }
}

export class MockMetaAuthProvider implements MetaAuthProvider {
  async isTokenValid(token: string): Promise<boolean> {
    return Boolean(token && token.trim().length > 20);
  }

  async refreshLongLivedToken(token: string): Promise<string> {
    return `${token}_refreshed`;
  }

  async startDeviceLogin(scopes: string[]): Promise<MetaDeviceLoginResponse> {
    const now = Date.now();
    return {
      deviceCode: `mock_device_${scopes.join("_")}_${now}`,
      userCode: "FBMN-CODE",
      verificationUri: "https://www.facebook.com/device",
      expiresAt: new Date(now + 1000 * 60 * 15).toISOString(),
      intervalSeconds: 5,
    };
  }

  async exchangeDeviceCode(deviceCode: string): Promise<string> {
    return `token_from_${deviceCode}`;
  }

  async getPageAccessToken(pageId: string): Promise<string> {
    return `mock_page_token_${pageId}`;
  }

  async listPages(_token: string): Promise<Array<{
    pageId: string;
    pageName: string;
    coverPhotoUrl?: string | null;
    pageAccessTokenStatus?: FacebookTokenStatus;
  }>> {
    return [
      { pageId: "page_1", pageName: "FBmaniaco Principal", coverPhotoUrl: null, pageAccessTokenStatus: "valido" },
      { pageId: "page_2", pageName: "FBmaniaco Secundaria", coverPhotoUrl: null, pageAccessTokenStatus: "valido" },
    ];
  }
}

export class MockPushNotificationProvider implements PushNotificationProvider {
  async send(_input: {
    title: string;
    body: string;
    destination: string;
    businessId?: string | undefined;
  }): Promise<void> {
    return;
  }
}

export { MockImageGenerationProvider, MockCaptionGenerationProvider } from "./generationMocks";

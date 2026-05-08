import type {
  FacebookMetricsData,
  FacebookTokenStatus,
  MetaDeviceLoginResponse,
  PublishPostData,
  VisionAnalysisResult,
} from "@fbmaniaco/shared";

export interface VisionAnalysisProvider {
  analyze(imageUrl: string): Promise<VisionAnalysisResult>;
}

export interface MediaStorage {
  generateSignedUploadUrl(key: string): Promise<{ url: string; key: string }>;
  getPresignedDownloadUrl(key: string): Promise<string>;
}

export interface FacebookPublishingProvider {
  publishPost(data: PublishPostData): Promise<{ postId: string }>;
  getPageAccessToken(pageId: string): Promise<string>;
  getPageMetrics(pageId: string, postId: string): Promise<FacebookMetricsData>;
}

export interface MetaAuthProvider {
  isTokenValid(token: string): Promise<boolean>;
  refreshLongLivedToken(token: string): Promise<string>;
  startDeviceLogin(scopes: string[]): Promise<MetaDeviceLoginResponse>;
  exchangeDeviceCode(deviceCode: string): Promise<string>;
  getPageAccessToken(pageId: string): Promise<string>;
  listPages(token: string): Promise<Array<{
    pageId: string;
    pageName: string;
    coverPhotoUrl?: string | null;
    pageAccessTokenStatus?: FacebookTokenStatus;
    category?: string | null;
    categoryList?: Array<{ id?: string; name?: string }> | null;
    tasks?: string[] | null;
  }>>;
}

export interface PushNotificationProvider {
  send(input: {
    title: string;
    body: string;
    destination: string;
    businessId?: string;
  }): Promise<void>;
}

export interface ImageGenerationProvider {
  generateImage(input: {
    prompt: string;
    styleId: string;
    sourceImageUrl?: string | null;
  }): Promise<{ imageUrl: string }>;
  generateImages(input: {
    prompt: string;
    styleId: string;
    sourceImageUrl?: string | null;
    count: number;
  }): Promise<{ imageUrls: string[] }>;
}

export interface CaptionGenerationProvider {
  generateCaption(input: {
    prompt: string;
    styleName: string;
    subjectDescription: string;
    businessTone: string;
    facebookSeoKeywords?: string[];
    facebookSeoContext?: string | null;
    creativeAngle?: string | null;
    visualDirection?: string | null;
    variantIndex?: number | null;
    totalVariants?: number | null;
    avoidCaptions?: string[];
  }): Promise<{ caption: string }>;
}

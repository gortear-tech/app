import type { StyleName } from './styles.js';

export type Id = string;

export type ContextSource = 'ai' | 'manual';

export type AppLanguage = 'es' | 'en';

export type AppTheme = 'system' | 'light' | 'dark';

export type NotificationEventKey =
  | 'batch_completed'
  | 'batch_generation_completed'
  | 'batch_generation_failed_partial'
  | 'batch_generation_failed_total'
  | 'batch_scheduled'
  | 'draft_purge_warning'
  | 'variant_rejected'
  | 'publish_succeeded'
  | 'generation_error'
  | 'fb_token_expiring'
  | 'openai_quota_warning'
  | 'weekly_summary';

export type NotificationChannels = {
  push: boolean;
  email: boolean;
};

export type PageNotificationOverride = 'inherit' | 'enabled' | 'disabled';

export type QuietHours = {
  start: string;
  end: string;
} | null;

export type UserSettings = {
  userId: Id;
  displayName: string;
  email: string;
  language: AppLanguage;
  theme: AppTheme;
  region: string;
  defaultTimezone: string;
  notifications: Record<NotificationEventKey, NotificationChannels>;
  quietHours: QuietHours;
  betaFeatures: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type BrandVoice =
  | 'amigable'
  | 'formal'
  | 'entusiasta'
  | 'informativo'
  | 'humoristico'
  | 'inspirador';

export type PostingLanguage = AppLanguage | 'auto' | 'inherit';

export type DefaultContextMode = 'ai' | 'manual';

export type PageBrandSettings = {
  voice: BrandVoice;
  voiceCustom: string;
  defaultHashtags: string[];
  defaultMentions: string[];
  signature: string;
  brandColors: string[];
  logoUrl: string | null;
};

export type PageGenerationSettings = {
  defaultVariantsPerPhoto: number;
  skipReviewDefault: boolean;
  defaultContextMode: DefaultContextMode;
  imageModel: string;
  textModel: string;
  postingLanguage: PostingLanguage;
  seoKeywords: string[];
  promptSuffix: string;
};

export type PageStyleSettings = {
  active: string[];
  custom: Array<{
    id: string;
    name: string;
    prompt: string;
  }>;
};

export type WeekdayKey = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom';

export type PageSchedulingSettings = {
  timezone: string;
  businessHours: BusinessHours;
  activeDays: WeekdayKey[];
  minGapMinutes: number;
  maxPostsPerDay: number;
  startTodayOrTomorrow: 'today' | 'tomorrow';
  distributeEvenly: boolean;
};

export const DEFAULT_GALLERY_TAXONOMY = [
  'producto',
  'ambiente',
  'personas',
  'proceso',
  'exterior',
  'evento',
  'detalle',
  'behind_the_scenes',
  'promocional',
  'otro',
] as const;

export type GalleryCategory = (typeof DEFAULT_GALLERY_TAXONOMY)[number] | (string & {});

export type GalleryDuplicatePolicy = 'block' | 'warn_only';

export type GalleryNamingLanguage = 'es' | 'en';

export type GalleryQualityThresholds = {
  blur: number;
  exposureMin: number;
  exposureMax: number;
  minResolution: number;
};

export type GallerySettings = {
  autoArchiveAfterDays: number;
  defaultSort: 'recent' | 'oldest' | 'most_used';
  duplicatePolicy: GalleryDuplicatePolicy;
  namingLanguage: GalleryNamingLanguage;
  qualityThresholds: GalleryQualityThresholds;
  stackTimeWindowMinutes: number;
  taxonomy: string[];
};

export type BatchStatus =
  | 'draft'
  | 'queued'
  | 'generating'
  | 'awaiting_review'
  | 'scheduling'
  | 'publishing'
  | 'archived'
  | 'failed';

export type VariantStatus =
  | 'skipped'
  | 'pending'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'published'
  | 'failed';

export type VariantType = 'ai_image' | 'canva_image' | 'ai_video';

export type PageSettings = {
  brand: PageBrandSettings;
  generation: PageGenerationSettings;
  styles: PageStyleSettings;
  scheduling: PageSchedulingSettings;
  gallery: GallerySettings;
  notifications: Record<NotificationEventKey, PageNotificationOverride>;
  seoKeywords: string[];
  businessHours: BusinessHours;
  preferredImageModels: string[];
  defaultContextMode: ContextSource;
  skipReviewDefault: boolean;
};

export type BusinessHours = {
  start: string;
  end: string;
};

export type User = {
  id: Id;
  fbUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type Page = {
  id: Id;
  userId: Id;
  fbPageId: string;
  name: string;
  category: string;
  coverUrl: string;
  profileUrl: string;
  hasPageAccessToken?: boolean;
  metaDisconnectedAt?: string | null;
  settings: PageSettings;
};

export type Photo = {
  id: Id;
  pageId: Id;
  storagePath: string;
  thumbnailUrl: string;
  fileHash: string | null;
  perceptualHash: string | null;
  name: string;
  nameSource: ContextSource;
  description: string | null;
  altText: string | null;
  category: GalleryCategory;
  tags: string[];
  isFavorite: boolean;
  status: 'active' | 'archived' | 'trashed';
  trashedAt: string | null;
  qualityScore: {
    blur: number;
    exposure: number;
    resolution: number;
  };
  lowQuality: boolean;
  stackId: Id | null;
  stackIsPrimary: boolean;
  exif: Record<string, unknown>;
  takenAt: string;
  origin: 'app_gallery' | 'phone_gallery' | 'external';
  manualOverride: boolean;
  publicationCount?: number;
  context: string | null;
  contextSource: ContextSource | null;
  createdAt: string;
};

export type PhotoMetadataUpdate = {
  category?: GalleryCategory;
  description?: string | null;
  isFavorite?: boolean;
  name?: string;
  status?: Photo['status'];
  tags?: string[];
};

export type Batch = {
  id: Id;
  pageId: Id;
  status: BatchStatus;
  selectedPhotoIds: Id[];
  pendingUploads: PendingPhotoUpload[];
  contextModeOverrides: Record<Id, string>;
  variantsPerPhoto: number;
  distributionDays: number;
  skipReview: boolean;
  cancelledByUser: boolean;
  failedReason: string | null;
  shortLabel: string;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type Variant = {
  id: Id;
  batchId: Id;
  sourcePhotoId: Id;
  style: StyleName | string;
  variantType: VariantType;
  generatedImagePath: string | null;
  generatedText: string | null;
  userTextOverride: string | null;
  status: VariantStatus;
  scheduledAt: string | null;
  fbPostId: string | null;
  failedReason?: string | null;
};

export type PendingPhotoUpload = {
  localId: Id;
  fileName?: string;
  mimeType?: string;
  previewUri?: string;
  size?: number;
};

export type CalendarItem = {
  id: Id;
  pageId: Id;
  title: string;
  status: 'scheduled' | 'published';
  scheduledAt: string;
  variantId?: Id;
};

export type StyleHistoryEntry = {
  pageId: Id;
  style: string;
  batchId: Id;
  usedAt: string;
};

export type PhotoVariantRequest = {
  photoId: Id;
  variants: number;
};

export type StyleAssignment = {
  photoId: Id;
  variantIndex: number;
  style: string;
};

export type BatchPhase = 'prepare' | 'generating' | 'review_schedule' | 'done' | 'failed';

export type SchedulingHistoryEntry = {
  pageId: Id;
  dayOfWeek: number;
  hour: number;
  score: number;
  lastUpdated: string;
};

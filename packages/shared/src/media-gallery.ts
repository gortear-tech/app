import { Static, Type } from "@sinclair/typebox";

export const MediaAssetStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("processing"),
  Type.Literal("ready"),
  Type.Literal("error")
]);

export const MediaCategorySchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  name: Type.String(),
  slug: Type.String(),
  color: Type.Union([Type.String(), Type.Null()]),
  sortOrder: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const MediaTagSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  name: Type.String(),
  createdAt: Type.String()
});

export const GalleryMediaAssetSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.Optional(Type.String()),
  batchId: Type.Optional(Type.String()),
  photoId: Type.Optional(Type.String()),
  variantId: Type.Optional(Type.String()),
  kind: Type.String(),
  bucket: Type.String(),
  storageKey: Type.String(),
  mimeType: Type.String(),
  fileSize: Type.Number(),
  isPublic: Type.Boolean(),
  sha256: Type.Union([Type.String(), Type.Null()]),
  phash: Type.Union([Type.String(), Type.Null()]),
  displayName: Type.Union([Type.String(), Type.Null()]),
  originalName: Type.Union([Type.String(), Type.Null()]),
  categoryId: Type.Union([Type.String(), Type.Null()]),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
  bytes: Type.Union([Type.Number(), Type.Null()]),
  thumbPath: Type.Union([Type.String(), Type.Null()]),
  previewPath: Type.Union([Type.String(), Type.Null()]),
  fullPath: Type.Union([Type.String(), Type.Null()]),
  previewUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  thumbnailUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  usageCount: Type.Number(),
  lastUsedAt: Type.Union([Type.String(), Type.Null()]),
  archivedAt: Type.Union([Type.String(), Type.Null()]),
  status: MediaAssetStatusSchema,
  errorReason: Type.Union([Type.String(), Type.Null()]),
  processedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const MediaAssetFbUploadSchema = Type.Object({
  id: Type.String(),
  assetId: Type.String(),
  facebookPageId: Type.String(),
  fbPhotoId: Type.String(),
  uploadedAt: Type.String(),
  lastUsedAt: Type.Union([Type.String(), Type.Null()])
});

export const MediaAssetUsageSchema = Type.Object({
  id: Type.String(),
  assetId: Type.String(),
  scheduledPostId: Type.Union([Type.String(), Type.Null()]),
  variantId: Type.Union([Type.String(), Type.Null()]),
  facebookPageId: Type.Union([Type.String(), Type.Null()]),
  usedAt: Type.String()
});

export const MediaSelectionSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  userId: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  assetIds: Type.Array(Type.String()),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  status: Type.Union([Type.Literal("draft"), Type.Literal("consumed"), Type.Literal("discarded")]),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const MenuItemSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  categoryId: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  priceCents: Type.Union([Type.Number(), Type.Null()]),
  keywords: Type.Array(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const MenuIngestSourceTypeSchema = Type.Union([Type.Literal("text"), Type.Literal("pdf"), Type.Literal("image")]);

export const MenuIngestBodySchema = Type.Object({
  workspaceId: Type.Optional(Type.String()),
  businessId: Type.Optional(Type.String()),
  sourceType: MenuIngestSourceTypeSchema,
  text: Type.Optional(Type.String()),
  fileName: Type.Optional(Type.String()),
  mime: Type.Optional(Type.String()),
  dataBase64: Type.Optional(Type.String())
});

export const ParsedMenuItemSchema = Type.Object({
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  priceCents: Type.Union([Type.Number(), Type.Null()]),
  categoryName: Type.Union([Type.String(), Type.Null()]),
  keywords: Type.Array(Type.String())
});

export const MenuParseResultSchema = Type.Object({
  schemaVersion: Type.Literal("menu_parse_result.v1"),
  items: Type.Array(ParsedMenuItemSchema),
  categories: Type.Array(Type.String()),
  warnings: Type.Array(Type.String())
});

export const MenuIngestResponseSchema = Type.Object({
  schemaVersion: Type.Literal("menu_ingest.v1"),
  jobId: Type.String(),
  status: Type.Literal("queued"),
  requestId: Type.String()
});

export const MenuItemsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("menu_items.v1"),
  items: Type.Array(MenuItemSchema),
  requestId: Type.String()
});

export const SimilarMediaAssetSchema = Type.Object({
  asset: GalleryMediaAssetSchema,
  distance: Type.Number()
});

export const SimilarMediaAssetsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_asset_similar.v1"),
  assetId: Type.String(),
  threshold: Type.Number(),
  items: Type.Array(SimilarMediaAssetSchema),
  requestId: Type.String()
});

export const MediaUploadIntentBodySchema = Type.Object({
  businessId: Type.Optional(Type.String()),
  sha256: Type.String({ minLength: 64, maxLength: 64 }),
  bytes: Type.Number({ minimum: 1 }),
  mime: Type.String(),
  originalName: Type.String(),
  width: Type.Optional(Type.Number({ minimum: 1 })),
  height: Type.Optional(Type.Number({ minimum: 1 })),
  categoryId: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});

export const MediaUploadIntentResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_upload_intent.v1"),
  exists: Type.Boolean(),
  assetId: Type.String(),
  asset: Type.Optional(GalleryMediaAssetSchema),
  uploadUrl: Type.Optional(Type.String()),
  storagePath: Type.Optional(Type.String()),
  expiresAt: Type.Optional(Type.String()),
  requestId: Type.String()
});

export const MediaUploadCompleteBodySchema = Type.Object({
  assetId: Type.String(),
  storagePath: Type.String()
});

export const MediaUploadCompleteResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_upload_complete.v1"),
  assetId: Type.String(),
  status: Type.Literal("processing"),
  jobId: Type.String(),
  requestId: Type.String()
});

export const MediaAssetsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_assets.v1"),
  items: Type.Array(GalleryMediaAssetSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  total: Type.Optional(Type.Number()),
  requestId: Type.String()
});

export const UpdateMediaAssetBodySchema = Type.Object({
  displayName: Type.Optional(Type.String()),
  categoryId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  tags: Type.Optional(Type.Array(Type.String()))
});

export const MediaAssetMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_asset_mutation.v1"),
  asset: GalleryMediaAssetSchema,
  requestId: Type.String()
});

export const CreateMediaCategoryBodySchema = Type.Object({
  workspaceId: Type.Optional(Type.String()),
  name: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sortOrder: Type.Optional(Type.Number())
});

export const MediaCategoriesResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_categories.v1"),
  categories: Type.Array(MediaCategorySchema),
  requestId: Type.String()
});

export const MediaCategoryMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_category_mutation.v1"),
  category: MediaCategorySchema,
  requestId: Type.String()
});

export const CreateMediaSelectionBodySchema = Type.Object({
  workspaceId: Type.Optional(Type.String()),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  assetIds: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
});

export const UpdateMediaSelectionBodySchema = Type.Object({
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  assetIds: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
});

export const MediaSelectionsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_selections.v1"),
  selections: Type.Array(MediaSelectionSchema),
  requestId: Type.String()
});

export const MediaSelectionMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("media_selection_mutation.v1"),
  selection: MediaSelectionSchema,
  requestId: Type.String()
});

export const FacebookPhotoReuseStatsSchema = Type.Object({
  schemaVersion: Type.Literal("facebook_photo_reuse_stats.v1"),
  businessId: Type.String(),
  facebookPageId: Type.String(),
  uniqueUploads: Type.Number(),
  totalUsages: Type.Number(),
  uploadsSaved: Type.Number(),
  requestId: Type.String()
});

export type MediaAssetStatus = Static<typeof MediaAssetStatusSchema>;
export type MediaCategory = Static<typeof MediaCategorySchema>;
export type MediaTag = Static<typeof MediaTagSchema>;
export type GalleryMediaAsset = Static<typeof GalleryMediaAssetSchema>;
export type MediaAssetFbUpload = Static<typeof MediaAssetFbUploadSchema>;
export type MediaAssetUsage = Static<typeof MediaAssetUsageSchema>;
export type MediaSelection = Static<typeof MediaSelectionSchema>;
export type MenuItem = Static<typeof MenuItemSchema>;
export type MenuIngestSourceType = Static<typeof MenuIngestSourceTypeSchema>;
export type ParsedMenuItem = Static<typeof ParsedMenuItemSchema>;
export type MenuParseResult = Static<typeof MenuParseResultSchema>;
export type MenuIngestResponse = Static<typeof MenuIngestResponseSchema>;
export type MenuItemsResponse = Static<typeof MenuItemsResponseSchema>;
export type SimilarMediaAsset = Static<typeof SimilarMediaAssetSchema>;
export type SimilarMediaAssetsResponse = Static<typeof SimilarMediaAssetsResponseSchema>;
export type MediaUploadIntentResponse = Static<typeof MediaUploadIntentResponseSchema>;
export type MediaUploadCompleteResponse = Static<typeof MediaUploadCompleteResponseSchema>;
export type MediaAssetsResponse = Static<typeof MediaAssetsResponseSchema>;
export type MediaCategoriesResponse = Static<typeof MediaCategoriesResponseSchema>;
export type MediaSelectionsResponse = Static<typeof MediaSelectionsResponseSchema>;
export type MediaSelectionMutationResponse = Static<typeof MediaSelectionMutationResponseSchema>;
export type FacebookPhotoReuseStats = Static<typeof FacebookPhotoReuseStatsSchema>;

export const hammingDistanceHex64 = (left: string | null | undefined, right: string | null | undefined) => {
  if (!left || !right || !/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < 16; index += 1) {
    let value = Number.parseInt(left.charAt(index), 16) ^ Number.parseInt(right.charAt(index), 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
};

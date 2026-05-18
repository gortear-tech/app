import { Static, Type } from "@sinclair/typebox";
import { BatchStatus, PhotoStatus } from "./states.js";
import { JobSummarySchema } from "./jobs.js";
import { VariantSchema } from "./variants.js";

export const BatchSummarySchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  status: BatchStatus,
  photosCount: Type.Number(),
  variantsCount: Type.Number(),
  variantsPerPhoto: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  lastActivityAt: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const PhotoSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  batchId: Type.String(),
  fileName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  storageKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  originalAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  thumbnailAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  visionInputAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mediaUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  thumbnailUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contentHash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  mimeType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  width: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  status: PhotoStatus,
  visionAnalysis: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const BatchDetailSchema = Type.Object({
  schemaVersion: Type.Literal("batch_detail.v1"),
  batch: BatchSummarySchema,
  photos: Type.Array(PhotoSchema),
  variants: Type.Array(VariantSchema),
  jobs: Type.Array(JobSummarySchema),
  requestId: Type.String()
});

export const BatchesResponseSchema = Type.Object({
  schemaVersion: Type.Literal("batches.v1"),
  batches: Type.Array(BatchSummarySchema),
  requestId: Type.String()
});

export const CreateBatchResponseSchema = Type.Object({
  schemaVersion: Type.Literal("create_batch.v1"),
  batch: BatchSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const BatchMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("batch_mutation.v1"),
  batch: BatchSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type BatchSummary = Static<typeof BatchSummarySchema>;
export type Photo = Static<typeof PhotoSchema>;
export type BatchDetail = Static<typeof BatchDetailSchema>;
export type BatchMutationResponse = Static<typeof BatchMutationResponseSchema>;

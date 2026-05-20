import { Static, Type } from "@sinclair/typebox";
import { PhotoSchema } from "./batches.js";
import { JobSummarySchema } from "./jobs.js";

export const UploadIntentBodySchema = Type.Object({
  originalFileName: Type.String(),
  contentType: Type.String(),
  fileSize: Type.Number({ minimum: 1 })
});

export const UploadIntentSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  batchId: Type.String(),
  bucket: Type.String(),
  storageKey: Type.String(),
  allowedMimeTypes: Type.Array(Type.String()),
  maxBytes: Type.Number(),
  status: Type.Union([Type.Literal("created"), Type.Literal("completed"), Type.Literal("expired"), Type.Literal("cancelled")]),
  expiresAt: Type.String(),
  createdAt: Type.String()
});

export const UploadIntentResponseSchema = Type.Object({
  schemaVersion: Type.Literal("upload_intent.v1"),
  uploadIntent: UploadIntentSchema,
  upload: Type.Object({
    uploadUrl: Type.String(),
    method: Type.Literal("PUT"),
    headers: Type.Record(Type.String(), Type.String()),
    expiresAt: Type.String()
  }),
  requestId: Type.String()
});

export const CompleteUploadBodySchema = Type.Object({
  storageKey: Type.String(),
  originalFileName: Type.String(),
  contentType: Type.String(),
  fileSize: Type.Number({ minimum: 1 }),
  checksum: Type.Optional(Type.String()),
  width: Type.Optional(Type.Number({ minimum: 1 })),
  height: Type.Optional(Type.Number({ minimum: 1 }))
});

export const CompleteUploadResponseSchema = Type.Object({
  schemaVersion: Type.Literal("complete_upload.v1"),
  photo: PhotoSchema,
  job: Type.Union([Type.Null(), JobSummarySchema]),
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type UploadIntent = Static<typeof UploadIntentSchema>;

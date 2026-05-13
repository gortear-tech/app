import { Static, Type } from "@sinclair/typebox";
import { JobSummarySchema } from "./jobs.js";
import { ScheduledPostStatus } from "./states.js";

export const ScheduledPostRemoteStatusSchema = Type.Union([
  Type.Literal("no_enviado"),
  Type.Literal("confirmado_meta"),
  Type.Literal("actualizacion_pendiente"),
  Type.Literal("cancelacion_pendiente"),
  Type.Literal("incierto")
]);

export const DeliveryModeSchema = Type.Union([
  Type.Literal("local_due_publish"),
  Type.Literal("remote_schedule"),
  Type.Literal("publish_now")
]);

export const ScheduledPostSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  batchId: Type.String(),
  variantId: Type.String(),
  pageId: Type.String(),
  scheduledFor: Type.String(),
  facebookPostId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remotePostType: Type.Optional(Type.Union([
    Type.Literal("photo"),
    Type.Literal("feed"),
    Type.Literal("unknown"),
    Type.Null()
  ])),
  remotePostUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  deliveryMode: DeliveryModeSchema,
  graphApiVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  publishLeadSeconds: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  scheduledForUnix: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  status: ScheduledPostStatus,
  remoteStatus: ScheduledPostRemoteStatusSchema,
  retryCount: Type.Number(),
  lastRemoteSyncAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remoteErrorCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remoteTraceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  imageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  styleId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  styleName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const ConfirmCalendarBodySchema = Type.Object({
  periodDays: Type.Union([Type.Literal(7), Type.Literal(14), Type.Literal(30)])
});

export const UpdateScheduledPostBodySchema = Type.Object({
  scheduledFor: Type.String()
});

export const ScheduledPostsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("scheduled_posts.v1"),
  scheduledPosts: Type.Array(ScheduledPostSchema),
  requestId: Type.String()
});

export const ConfirmCalendarResponseSchema = Type.Object({
  schemaVersion: Type.Literal("calendar_confirm.v1"),
  scheduledPosts: Type.Array(ScheduledPostSchema),
  job: JobSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const ScheduledPostMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("scheduled_post_mutation.v1"),
  scheduledPost: ScheduledPostSchema,
  job: Type.Optional(Type.Union([JobSummarySchema, Type.Null()])),
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type ScheduledPostRemoteStatus = Static<typeof ScheduledPostRemoteStatusSchema>;
export type DeliveryMode = Static<typeof DeliveryModeSchema>;
export type ScheduledPost = Static<typeof ScheduledPostSchema>;
export type ConfirmCalendarResponse = Static<typeof ConfirmCalendarResponseSchema>;
export type ScheduledPostsResponse = Static<typeof ScheduledPostsResponseSchema>;
export type ScheduledPostMutationResponse = Static<typeof ScheduledPostMutationResponseSchema>;

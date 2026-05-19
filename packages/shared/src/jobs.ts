import { Static, Type } from "@sinclair/typebox";
import { JobStatus } from "./states.js";

export const JobType = Type.Union([
  Type.Literal("analyze_photo"),
  Type.Literal("generate_batch"),
  Type.Literal("generate_variant"),
  Type.Literal("schedule_posts"),
  Type.Literal("publish_post")
]);

export type JobType = Static<typeof JobType>;

export const JobSummarySchema = Type.Object({
  id: Type.String(),
  type: JobType,
  status: JobStatus,
  workspaceId: Type.String(),
  progress: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  userMessage: Type.Optional(Type.String()),
  lastError: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export type JobSummary = Static<typeof JobSummarySchema>;

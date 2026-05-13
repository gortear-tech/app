import { Static, Type } from "@sinclair/typebox";
import { BusinessSchema } from "./businesses.js";
import { JobSummarySchema } from "./jobs.js";

export const AutonomyActionSchema = Type.Union([
  Type.Literal("STYLE_ASSIGNMENT"),
  Type.Literal("VARIANT_COUNT"),
  Type.Literal("SCHEDULING"),
  Type.Literal("CAPTION_GENERATION"),
  Type.Literal("FACEBOOK_PUBLISH")
]);

export const AutonomyModeSchema = Type.Union([
  Type.Literal("human_approval"),
  Type.Literal("suggest_only"),
  Type.Literal("autonomous")
]);

export const ActionAutonomyStateSchema = Type.Object({
  action: AutonomyActionSchema,
  mode: AutonomyModeSchema,
  score: Type.Number(),
  approvals: Type.Number(),
  threshold: Type.Number(),
  paused: Type.Boolean(),
  consecutiveApprovals: Type.Number(),
  consecutiveRejections: Type.Number(),
  requiresExplicitOptIn: Type.Boolean(),
  explicitOptIn: Type.Boolean(),
  pauseReasons: Type.Array(Type.String()),
  updatedAt: Type.String()
});

export const BusinessAutonomySettingsSchema = Type.Object({
  schemaVersion: Type.Literal("business_autonomy.v1"),
  actions: Type.Record(Type.String(), ActionAutonomyStateSchema),
  updatedAt: Type.String()
});

export const AutonomyEvaluationSchema = Type.Object({
  schemaVersion: Type.Literal("autonomy_evaluation.v1"),
  businessId: Type.String(),
  canAutopublish: Type.Boolean(),
  blockingReasons: Type.Array(Type.String()),
  warnings: Type.Array(Type.String()),
  evaluatedAt: Type.String()
});

export const UpdateBusinessBodySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  autonomySettings: Type.Optional(BusinessAutonomySettingsSchema)
});

export const BusinessDetailResponseSchema = Type.Object({
  schemaVersion: Type.Literal("business_detail.v1"),
  business: BusinessSchema,
  autonomy: AutonomyEvaluationSchema,
  requestId: Type.String()
});

export const BusinessMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("business_mutation.v1"),
  business: BusinessSchema,
  autonomy: AutonomyEvaluationSchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const BatchCaptionEvalBodySchema = Type.Object({
  candidatePromptTemplateId: Type.Optional(Type.String()),
  baselinePromptTemplateId: Type.Optional(Type.String()),
  datasetId: Type.Optional(Type.String()),
  candidateCaptionEditRate: Type.Optional(Type.Number())
});

export const AiEvaluationSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  task: Type.Literal("caption"),
  datasetId: Type.String(),
  baselinePromptTemplateId: Type.String(),
  candidatePromptTemplateId: Type.String(),
  status: Type.Union([Type.Literal("passed"), Type.Literal("failed")]),
  metrics: Type.Record(Type.String(), Type.Number()),
  failedCriteria: Type.Array(Type.String()),
  rolloutRecommendation: Type.Union([Type.Literal("promote_canary"), Type.Literal("retain_baseline")]),
  usedBatchMode: Type.Boolean(),
  createdAt: Type.String()
});

export const BatchCaptionEvalResponseSchema = Type.Object({
  schemaVersion: Type.Literal("batch_caption_eval.v1"),
  job: JobSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const AiEvaluationsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("ai_evaluations.v1"),
  evaluations: Type.Array(AiEvaluationSchema),
  requestId: Type.String()
});

export type AutonomyAction = Static<typeof AutonomyActionSchema>;
export type AutonomyMode = Static<typeof AutonomyModeSchema>;
export type ActionAutonomyState = Static<typeof ActionAutonomyStateSchema>;
export type BusinessAutonomySettings = Static<typeof BusinessAutonomySettingsSchema>;
export type AutonomyEvaluation = Static<typeof AutonomyEvaluationSchema>;
export type BusinessDetailResponse = Static<typeof BusinessDetailResponseSchema>;
export type BusinessMutationResponse = Static<typeof BusinessMutationResponseSchema>;
export type AiEvaluation = Static<typeof AiEvaluationSchema>;
export type BatchCaptionEvalResponse = Static<typeof BatchCaptionEvalResponseSchema>;
export type AiEvaluationsResponse = Static<typeof AiEvaluationsResponseSchema>;

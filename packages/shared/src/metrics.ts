import { Static, Type } from "@sinclair/typebox";
import { JobSummarySchema } from "./jobs.js";

export const MetricProviderSchema = Type.Union([Type.Literal("fbmaniaco"), Type.Literal("meta")]);
export const CanonicalMetricSchema = Type.Union([
  Type.Literal("views"),
  Type.Literal("engagements"),
  Type.Literal("reactions"),
  Type.Literal("comments"),
  Type.Literal("shares"),
  Type.Literal("clicks"),
  Type.Literal("publish_success"),
  Type.Literal("publish_failure"),
  Type.Literal("approval_rate"),
  Type.Literal("caption_edit_rate"),
  Type.Literal("week_coverage")
]);
export const MetricDefinitionStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("deprecated"),
  Type.Literal("unavailable")
]);
export const MetricWindowSchema = Type.Union([
  Type.Literal("24h"),
  Type.Literal("72h"),
  Type.Literal("7d"),
  Type.Literal("lifetime")
]);
export const MetricCollectionStatusSchema = Type.Union([
  Type.Literal("ok"),
  Type.Literal("partial"),
  Type.Literal("unavailable"),
  Type.Literal("deprecated"),
  Type.Literal("permission_error")
]);
export const PerformanceConfidenceSchema = Type.Union([
  Type.Literal("exploratoria"),
  Type.Literal("media"),
  Type.Literal("alta")
]);
export const PerformanceScopeSchema = Type.Union([
  Type.Literal("business_week"),
  Type.Literal("style"),
  Type.Literal("time_slot"),
  Type.Literal("caption_pattern"),
  Type.Literal("content_type")
]);

export const MetricDefinitionSchema = Type.Object({
  id: Type.String(),
  provider: MetricProviderSchema,
  canonicalMetric: CanonicalMetricSchema,
  providerMetricName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  graphApiVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  valueType: Type.Union([Type.Literal("count"), Type.Literal("rate"), Type.Literal("duration"), Type.Literal("currency")]),
  status: MetricDefinitionStatusSchema,
  effectiveFrom: Type.String(),
  effectiveTo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});

export const PostMetricSnapshotSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  scheduledPostId: Type.String(),
  facebookPostId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  metricDefinitionId: Type.String(),
  provider: MetricProviderSchema,
  canonicalMetric: CanonicalMetricSchema,
  providerMetricName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  window: MetricWindowSchema,
  value: Type.Number(),
  collectedAt: Type.String(),
  observedUntil: Type.String(),
  collectionStatus: MetricCollectionStatusSchema,
  sourceVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  rawRef: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});

export const PerformanceSummarySchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  scope: PerformanceScopeSchema,
  scopeKey: Type.String(),
  periodStart: Type.String(),
  periodEnd: Type.String(),
  sampleSize: Type.Number(),
  metrics: Type.Record(Type.String(), Type.Number()),
  confidence: PerformanceConfidenceSchema,
  reasonCodes: Type.Array(Type.String()),
  generatedAt: Type.String()
});

export const WeeklyReportSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  periodStart: Type.String(),
  periodEnd: Type.String(),
  confidence: PerformanceConfidenceSchema,
  sampleSize: Type.Number(),
  sections: Type.Object({
    worked: Type.Array(Type.String()),
    didNotWork: Type.Array(Type.String()),
    styleAcceptance: Type.Array(Type.String()),
    captionEdits: Type.Array(Type.String()),
    recommendedTimes: Type.Array(Type.String()),
    metaHealth: Type.Array(Type.String()),
    calendarCoverage: Type.Array(Type.String()),
    aiCost: Type.Array(Type.String()),
    nextActions: Type.Array(Type.String())
  }),
  reasonCodes: Type.Array(Type.String()),
  generatedAt: Type.String()
});

export const CollectMetricsBodySchema = Type.Object({
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  window: Type.Optional(MetricWindowSchema)
});

export const GenerateWeeklyReportBodySchema = Type.Object({
  weekStart: Type.Optional(Type.String())
});

export const MetricsCollectResponseSchema = Type.Object({
  schemaVersion: Type.Literal("metrics_collect.v1"),
  job: JobSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const PerformanceResponseSchema = Type.Object({
  schemaVersion: Type.Literal("performance.v1"),
  summaries: Type.Array(PerformanceSummarySchema),
  metricDefinitions: Type.Array(MetricDefinitionSchema),
  requestId: Type.String()
});

export const WeeklyReportResponseSchema = Type.Object({
  schemaVersion: Type.Literal("weekly_report.v1"),
  report: Type.Union([WeeklyReportSchema, Type.Null()]),
  emptyReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  requestId: Type.String()
});

export const WeeklyReportGenerateResponseSchema = Type.Object({
  schemaVersion: Type.Literal("weekly_report_generate.v1"),
  job: JobSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type MetricProvider = Static<typeof MetricProviderSchema>;
export type CanonicalMetric = Static<typeof CanonicalMetricSchema>;
export type MetricDefinitionStatus = Static<typeof MetricDefinitionStatusSchema>;
export type MetricWindow = Static<typeof MetricWindowSchema>;
export type MetricCollectionStatus = Static<typeof MetricCollectionStatusSchema>;
export type PerformanceConfidence = Static<typeof PerformanceConfidenceSchema>;
export type PerformanceScope = Static<typeof PerformanceScopeSchema>;
export type MetricDefinition = Static<typeof MetricDefinitionSchema>;
export type PostMetricSnapshot = Static<typeof PostMetricSnapshotSchema>;
export type PerformanceSummary = Static<typeof PerformanceSummarySchema>;
export type WeeklyReport = Static<typeof WeeklyReportSchema>;
export type MetricsCollectResponse = Static<typeof MetricsCollectResponseSchema>;
export type PerformanceResponse = Static<typeof PerformanceResponseSchema>;
export type WeeklyReportResponse = Static<typeof WeeklyReportResponseSchema>;
export type WeeklyReportGenerateResponse = Static<typeof WeeklyReportGenerateResponseSchema>;

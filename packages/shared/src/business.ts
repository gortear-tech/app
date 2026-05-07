import type { ActionType, FacebookTokenStatus } from "./states";
import type { AssignedStyle, GenerationPlan, VisionAnalysisResult } from "./vision";
import type { BatchSummary } from "./batches";
import type { BusinessPerformanceSummary } from "./metrics";
import type { ScheduledPostSummary } from "./scheduling";

export interface BusinessSummary {
  id: string;
  name: string;
  industry: string;
  facebookPageId: string;
  timezone: string;
  tokenStatus: FacebookTokenStatus;
}

export interface BusinessDetail extends BusinessSummary {
  metadata: Record<string, unknown>;
  autonomySettings: Record<ActionType, number>;
}

export interface BusinessAlert {
  id: string;
  type: "facebook_token" | "post_failed" | "batch_abandoned" | "system";
  message: string;
  level: "info" | "warning" | "critical";
  createdAt: string;
  actionable: boolean;
  actionLabel?: string;
}

export interface BusinessDashboard {
  business: BusinessSummary;
  alerts: BusinessAlert[];
  activeBatch?: BatchSummary | null;
  batches: BatchSummary[];
  performance: BusinessPerformanceSummary | null;
  weeklyReport?: WeeklyReport | null;
}

export interface WeeklyReportSection {
  title: string;
  body: string[];
}

export interface WeeklyReport {
  weekLabel: string;
  sections: WeeklyReportSection[];
}

export interface OriginalPhotoSummary {
  id: string;
  status: string;
  imageUrl?: string | null;
  assignedStyle: AssignedStyle | null;
  visionAnalysis: VisionAnalysisResult | null;
  editingPrompt: string | null;
}

export interface GeneratedVariantSummary {
  id: string;
  photoId: string;
  status: string;
  styleId: string;
  caption?: string | null;
  imageUrl?: string | null;
  generationPlan: GenerationPlan;
}

export interface CreateBusinessRequest {
  name: string;
  industry: string;
  facebookPageId: string;
  timezone: string;
}

export interface UpdateBusinessRequest {
  name?: string;
  industry?: string;
  timezone?: string;
  autonomySettings?: Partial<Record<ActionType, number>>;
  metadata?: Record<string, unknown>;
}

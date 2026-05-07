import type { ScheduledPostStatus } from "./states";

export interface ScheduledPostSummary {
  id: string;
  variantId: string;
  negocioId: string;
  batchId: string;
  scheduledFor: string;
  facebookPostId?: string | null;
  status: ScheduledPostStatus;
  retryCount: number;
  caption?: string | null;
  imageUrl?: string | null;
  styleId?: string | null;
  styleName?: string | null;
}

export interface SuggestCalendarRequest {
  periodDays: 7 | 14 | 30;
}

export interface UpdateScheduledPostRequest {
  scheduledFor: string;
}

export interface ConfirmCalendarResponse {
  created: number;
}

export interface CancelScheduledPostResponse {
  cancelled: boolean;
}

export interface PublishScheduledPostResponse {
  published: boolean;
}

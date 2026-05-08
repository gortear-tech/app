import type { VariantStatus } from "./states";
import type { GenerationPlan } from "./vision";

export interface GeneratedVariant {
  id: string;
  batchId: string;
  originalPhotoId: string;
  styleId: string;
  generationPlan: GenerationPlan;
  promptUsed: string;
  imageUrl?: string | null;
  caption?: string | null;
  status: VariantStatus;
}

export interface VariantSummary {
  id: string;
  photoId: string;
  styleId: string;
  status: VariantStatus;
  caption?: string | null;
}

export interface UpdateVariantCaptionRequest {
  caption: string;
}

export interface GenerateBatchVariantsResponse {
  created: number;
  available?: number;
  blockedReason?: string | null;
}

export interface ApproveVariantResponse {
  approved: boolean;
}

export interface RejectVariantResponse {
  rejected: boolean;
}

import type { BatchStatus, PhotoStatus } from "./states";
import type { OriginalPhotoSummary, GeneratedVariantSummary } from "./business";

export interface BatchSummary {
  id: string;
  negocioId: string;
  status: BatchStatus;
  photosCount: number;
  variantsCount: number;
  estimatedCostUsd?: number | null;
  confirmedCostUsd?: number | null;
  lastActivityAt: string;
}

export interface BatchDetail extends BatchSummary {
  photos: OriginalPhotoSummary[];
  variants: GeneratedVariantSummary[];
}

export interface GetBatchResponse {
  batch: BatchDetail;
}

export interface PreparePhotoUploadRequest {
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface CompletePhotoUploadRequest {
  uploadKey: string;
  originalFileName: string;
  imageDataUrl?: string | null;
}

export interface PhotoUploadIntentResponse {
  uploadUrl: string;
  storageKey: string;
}

export interface PhotoProgressEvent {
  photoId: string;
  status: PhotoStatus;
  progressText: string;
}

import type {
  ConfidenceLevel,
  DisclosurePolicy,
  RiskLevel,
  VisualStyleIntensity,
  VisionAnalysisResult,
} from "@fbmaniaco/shared";
import { clamp } from "./utils";

export const AUTONOMY_THRESHOLDS: Record<string, number> = {
  STYLE_ASSIGNMENT: 60,
  VARIANT_COUNT: 65,
  SCHEDULING: 70,
  CAPTION_GENERATION: 75,
  FACEBOOK_PUBLISH: 85,
};

export const MIN_APPROVALS: Record<string, number> = {
  STYLE_ASSIGNMENT: 8,
  VARIANT_COUNT: 10,
  SCHEDULING: 12,
  CAPTION_GENERATION: 15,
  FACEBOOK_PUBLISH: 20,
};

export function resolveConfidenceLevel(postsMeasured: number): ConfidenceLevel {
  if (postsMeasured < 50) return "baja";
  if (postsMeasured < 150) return "media";
  return "alta";
}

export function resolveDisclosurePolicy(
  intensity: VisualStyleIntensity,
  changesCompositionOrBackground: boolean,
): DisclosurePolicy {
  if (changesCompositionOrBackground || intensity === "fuerte") return "obligatoria";
  if (intensity === "media") return "recomendada";
  return "no_requerida";
}

export function classifyRiskFromAnalysis(analysis: VisionAnalysisResult): RiskLevel {
  const sensitive = analysis.sensitiveElements;
  if (sensitive.priceVisible || sensitive.logoVisible || sensitive.personVisible || sensitive.promotionVisible) {
    return "riesgo_alto";
  }

  if (sensitive.textVisible || sensitive.notes.length > 0) {
    return "riesgo_medio";
  }

  const qualityPenalty =
    clamp(100 - analysis.technicalQuality.sharpness, 0, 100) +
    clamp(100 - analysis.technicalQuality.exposure, 0, 100);
  return qualityPenalty > 80 ? "riesgo_medio" : "riesgo_bajo";
}

export function isSensitiveAnalysis(analysis: VisionAnalysisResult): boolean {
  const { sensitiveElements } = analysis;
  return (
    sensitiveElements.priceVisible ||
    sensitiveElements.logoVisible ||
    sensitiveElements.personVisible ||
    sensitiveElements.promotionVisible
  );
}


import type { AssignedStyle, VisualStyle, VisionAnalysisResult } from "@fbmaniaco/shared";
import { INITIAL_VISUAL_STYLES } from "@fbmaniaco/shared";
import type { BusinessContext, DeepMemorySnapshot, StyleAssignmentInput } from "../types";
import { clamp, normalizeText } from "../utils";

const BASE_PARAMETERS: Record<string, { contrast: number; saturation: number; warmth: number; sharpness: number }> = {
  "lighting-correction": { contrast: 68, saturation: 50, warmth: 48, sharpness: 78 },
  "realistic-enhancement": { contrast: 60, saturation: 58, warmth: 50, sharpness: 74 },
  "food-appetite": { contrast: 66, saturation: 72, warmth: 62, sharpness: 68 },
  "clean-background": { contrast: 63, saturation: 54, warmth: 48, sharpness: 72 },
  "warm-style": { contrast: 58, saturation: 60, warmth: 74, sharpness: 66 },
  "premium-style": { contrast: 72, saturation: 56, warmth: 58, sharpness: 80 },
};

const includesNormalized = (source: readonly string[], needle: string): boolean => {
  const normalizedNeedle = normalizeText(needle);
  return source.some((entry) => normalizeText(entry).includes(normalizedNeedle));
};

const businessMatchesStyle = (business: BusinessContext, style: VisualStyle): boolean =>
  includesNormalized(style.recommendedIndustries, business.industry);

function styleLearningBonus(style: VisualStyle, memory?: DeepMemorySnapshot | null): number {
  if (!memory) return 0;

  const footprint = memory.businessFootprint.preferredStyles[style.id];
  let bonus = 0;
  if (footprint) {
    if (footprint.approvalRate >= 0.7) bonus += 35;
    else if (footprint.approvalRate >= 0.5) bonus += 20;
    else if (footprint.approvalRate <= 0.4) bonus -= 30;
  }

  for (const conclusion of memory.causalMap.conclusions) {
    const question = normalizeText(conclusion.question);
    const matchesStyle =
      question.includes(normalizeText(style.name)) || question.includes(normalizeText(style.id));
    if (!matchesStyle) continue;
    if (conclusion.confidence === "alta") bonus += 25;
    else if (conclusion.confidence === "media") bonus += 15;
    else bonus += 8;
  }

  return bonus;
}

function scoreStyle(
  business: BusinessContext,
  analysis: VisionAnalysisResult,
  style: VisualStyle,
  memory?: DeepMemorySnapshot | null,
): number {
  let score = 0;
  const subjectType = analysis.subject.type;
  const photoTypeMatch = includesNormalized(style.recommendedPhotoTypes, subjectType);
  if (photoTypeMatch) score += 40;

  if (businessMatchesStyle(business, style)) score += 30;

  const moodMatches =
    includesNormalized(style.description ? [style.description] : [], analysis.mood.description) ||
    includesNormalized(style.recommendedPhotoTypes, analysis.subject.type) ||
    (analysis.mood.temperature === "calida" &&
      (normalizeText(style.name).includes("calido") || normalizeText(style.name).includes("premium")));
  if (moodMatches) score += 20;

  const sensitive = analysis.sensitiveElements;
  if (style.intensity === "fuerte" && (sensitive.logoVisible || sensitive.personVisible || sensitive.priceVisible)) {
    score -= 15;
  }

  if (
    normalizeText(style.name).includes("ilumin") &&
    (analysis.technicalQuality.sharpness < 55 || analysis.technicalQuality.exposure < 55)
  ) {
    score += 25;
  }

  if (normalizeText(style.name).includes("fondo") && analysis.composition.backgroundType === "limpio") {
    score += 20;
  }

  if (analysis.palette.temperature === "calida") {
    if (normalizeText(style.name).includes("calido") || normalizeText(style.name).includes("premium")) {
      score += 15;
    }
  }

  score += styleLearningBonus(style, memory);
  return score;
}

function chooseBestStyle(
  business: BusinessContext,
  analysis: VisionAnalysisResult,
  styles: readonly VisualStyle[],
  memory?: DeepMemorySnapshot | null,
): { style: VisualStyle; score: number } | null {
  return styles.reduce<{ style: VisualStyle; score: number } | null>((best, style) => {
    const score = scoreStyle(business, analysis, style, memory);
    if (!best || score > best.score) return { style, score };
    return best;
  }, null);
}

function baseParameters(styleId: string): { contrast: number; saturation: number; warmth: number; sharpness: number } {
  return BASE_PARAMETERS[styleId] ?? { contrast: 60, saturation: 55, warmth: 55, sharpness: 70 };
}

function adjustParameters(
  base: { contrast: number; saturation: number; warmth: number; sharpness: number },
  analysis: VisionAnalysisResult,
): { contrast: number; saturation: number; warmth: number; sharpness: number } {
  let contrast = base.contrast;
  let saturation = base.saturation;
  let warmth = base.warmth;
  let sharpness = base.sharpness;

  if (analysis.palette.saturation >= 70) saturation += 10;
  if (analysis.palette.saturation <= 35) saturation -= 8;
  if (analysis.palette.temperature === "calida") warmth += 12;
  if (analysis.technicalQuality.sharpness >= 75) sharpness += 8;
  if (analysis.technicalQuality.sharpness <= 40) sharpness -= 10;
  if (analysis.technicalQuality.exposure <= 40) {
    contrast += 15;
    warmth += 10;
  }
  if (analysis.technicalQuality.exposure >= 80) {
    contrast -= 8;
    saturation -= 4;
  }
  if (analysis.subject.hasPerson) warmth += 4;

  return {
    contrast: clamp(contrast, 10, 95),
    saturation: clamp(saturation, 10, 95),
    warmth: clamp(warmth, 10, 95),
    sharpness: clamp(sharpness, 10, 95),
  };
}

export function assignStyle(input: StyleAssignmentInput): AssignedStyle {
  const availableStyles = input.styles.length > 0 ? input.styles : INITIAL_VISUAL_STYLES;
  const best = chooseBestStyle(input.business, input.analysis, availableStyles, input.memory ?? null);
  if (!best) {
    throw new Error("No hay estilos visuales configurados.");
  }
  const params = adjustParameters(baseParameters(best.style.id), input.analysis);

  return {
    styleId: best.style.id,
    styleName: best.style.name,
    intensity: best.style.intensity,
    contrast: params.contrast,
    saturation: params.saturation,
    warmth: params.warmth,
    sharpness: params.sharpness,
    lowConfidence: best.score < 40,
    manualOverride: false,
  };
}

export function assignInitialStylesForBatch(
  business: BusinessContext,
  photos: VisionAnalysisResult[],
  memory?: DeepMemorySnapshot | null,
): AssignedStyle[] {
  return photos.map((analysis) => assignStyle({ business, analysis, styles: INITIAL_VISUAL_STYLES, memory }));
}

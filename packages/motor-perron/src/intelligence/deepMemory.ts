import type { ConfidenceLevel } from "@fbmaniaco/shared";
import type {
  BusinessFootprint,
  CausalMap,
  DeepMemorySnapshot,
  LearningEvent,
  PerformanceCell,
} from "../types";
import { analyzeCausality } from "./causalAnalyzer";
import { dayOfWeek, groupBy, hourBucket, hourOfDay, mean, normalizeText, timeDecayWeight, variance } from "../utils";
import { resolveConfidenceLevel } from "../rules";

const captionTone = (captionPattern?: string): string => {
  const normalized = normalizeText(captionPattern ?? "");
  if (normalized.includes("?")) return "pregunta";
  if (normalized.includes("!") || normalized.includes("emocional")) return "emocional";
  if (normalized.includes("promo") || normalized.includes("oferta")) return "promocional";
  return "afirmacion";
};

const scoreOf = (event: LearningEvent): number | null =>
  typeof event.score === "number" && Number.isFinite(event.score) ? event.score : null;

function buildPerformanceModel(events: LearningEvent[]): PerformanceCell[] {
  const scored = events.filter((event) => scoreOf(event) !== null);
  const grouped = groupBy(scored, (event) => {
    const contentType = normalizeText(event.contentType ?? event.photoType ?? "desconocido");
    const styleId = normalizeText(event.styleId ?? "unknown");
    const day = event.dayOfWeek ?? dayOfWeek(event.scheduledFor ?? event.occurredAt);
    const hour = event.hourOfDay ?? hourOfDay(event.scheduledFor ?? event.occurredAt);
    return [contentType, styleId, day, hourBucket(hour), captionTone(event.captionPattern)].join("|");
  });

  const cells: PerformanceCell[] = [];
  for (const [key, group] of Object.entries(grouped)) {
    const values = group.map((event) => scoreOf(event) ?? 0);
    const weights = group.map((event) => timeDecayWeight(event.occurredAt));
    const weightedTotal = values.reduce((sum, value, index) => sum + value * weights[index], 0);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const averageScore = weightedTotal / totalWeight;
    const baseVariance = variance(values);
    const stdDev = Math.sqrt(baseVariance);
    const filtered = group.filter((event, index) => Math.abs((values[index] ?? 0) - averageScore) <= stdDev * 2.5);
    const filteredValues = filtered.map((event) => scoreOf(event) ?? 0);

    const refinedAverage = mean(filteredValues);
    cells.push({
      contentType: key.split("|")[0] ?? "desconocido",
      styleId: key.split("|")[1] ?? "unknown",
      dayOfWeek: Number(key.split("|")[2] ?? 0),
      hourBucket: key.split("|")[3] ?? "noche",
      captionTone: key.split("|")[4] ?? "afirmacion",
      sampleSize: filteredValues.length,
      averageScore: Number(refinedAverage.toFixed(2)),
      variance: Number(variance(filteredValues).toFixed(2)),
    });
  }

  return cells;
}

function buildBusinessFootprint(events: LearningEvent[]): BusinessFootprint {
  const styleStats: BusinessFootprint["preferredStyles"] = {};
  const contentStats: BusinessFootprint["preferredContentTypes"] = {};
  const hourStats: BusinessFootprint["preferredHours"] = {};

  const captionGenerated = events.filter((event) => event.type === "variante_generada").length || 0;
  const captionEdited = events.filter((event) => event.type === "caption_editado_por_usuario" || event.captionEdited).length;

  for (const event of events) {
    const score = scoreOf(event);
    if (score === null) continue;

    const contentType = normalizeText(event.contentType ?? event.photoType ?? "desconocido");
    const styleId = normalizeText(event.styleId ?? "unknown");
    const hour = hourBucket(event.hourOfDay ?? hourOfDay(event.scheduledFor ?? event.occurredAt));

    contentStats[contentType] ??= { count: 0, averageScore: 0 };
    contentStats[contentType].count += 1;
    contentStats[contentType].averageScore =
      (contentStats[contentType].averageScore * (contentStats[contentType].count - 1) + score) /
      contentStats[contentType].count;

    hourStats[hour] ??= { count: 0, averageScore: 0 };
    hourStats[hour].count += 1;
    hourStats[hour].averageScore = (hourStats[hour].averageScore * (hourStats[hour].count - 1) + score) / hourStats[hour].count;

    if (styleId !== "unknown") {
      styleStats[styleId] ??= { approvals: 0, rejections: 0, approvalRate: 0 };
      if (event.type === "variante_aprobada") styleStats[styleId].approvals += 1;
      if (event.type === "variante_rechazada") styleStats[styleId].rejections += 1;
      const total = styleStats[styleId].approvals + styleStats[styleId].rejections;
      styleStats[styleId].approvalRate = total > 0 ? styleStats[styleId].approvals / total : 0;
    }
  }

  return {
    preferredStyles: styleStats,
    preferredContentTypes: contentStats,
    preferredHours: hourStats,
    captionEditRate: captionGenerated > 0 ? captionEdited / captionGenerated : 0,
    totalPostsMeasured: events.filter((event) => event.type === "metricas_recolectadas" || event.type === "post_publicado").length,
  };
}

export function buildDeepMemory(events: LearningEvent[]): DeepMemorySnapshot {
  const performanceModel = buildPerformanceModel(events);
  const businessFootprint = buildBusinessFootprint(events);
  const causalMap = analyzeCausality({ events });
  const confidence = resolveConfidenceLevel(businessFootprint.totalPostsMeasured);

  return {
    performanceModel,
    businessFootprint,
    causalMap,
    confidence,
  };
}

export function emptyDeepMemory(): DeepMemorySnapshot {
  return {
    performanceModel: [],
    businessFootprint: {
      preferredStyles: {},
      preferredContentTypes: {},
      preferredHours: {},
      captionEditRate: 0,
      totalPostsMeasured: 0,
    },
    causalMap: { conclusions: [], pendingQuestions: [] },
    confidence: "baja",
  };
}


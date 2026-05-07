import type { BenchmarkResult, PerformancePredictorInput } from "../types";
import { mean } from "../utils";

export function predictPerformance(input: PerformancePredictorInput): { estimatedScore: number; confidence: "baja" | "media" | "alta" } {
  const exact = input.memory.performanceModel.find(
    (cell) =>
      cell.contentType === input.contentType &&
      cell.styleId === input.styleId &&
      cell.dayOfWeek === input.dayOfWeek &&
      cell.captionTone === input.captionTone,
  );

  const nearbyByStyle = input.memory.performanceModel.filter((cell) => cell.styleId === input.styleId);
  const styleAverage = nearbyByStyle.length > 0 ? mean(nearbyByStyle.map((cell) => cell.averageScore)) : 50;
  const baseScore = exact && exact.sampleSize >= 5 ? exact.averageScore : styleAverage;

  const benchmarkAdjustment = input.benchmarks
    ? Math.max(-10, Math.min(10, (input.benchmarks.averageEngagement - 50) / 5))
    : 0;

  const confidence =
    exact && exact.sampleSize >= 15 ? "alta" : exact && exact.sampleSize >= 5 ? "media" : "baja";

  return {
    estimatedScore: Number(Math.max(0, Math.min(100, baseScore + benchmarkAdjustment)).toFixed(2)),
    confidence,
  };
}


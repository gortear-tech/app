import type { WeeklyReporterInput } from "../types";
import { mean, normalizeText } from "../utils";

const weeksLabel = (businessName: string): string => businessName ? `Reporte semanal de ${businessName}` : "Reporte semanal";

export function generateWeeklyReport(input: WeeklyReporterInput) {
  const events = input.events ?? [];
  const measured = events.filter((event) => typeof event.score === "number");
  const totalReach = measured.reduce((sum, event) => sum + (event.score ?? 0), 0);
  const averageEngagement = measured.length > 0 ? mean(measured.map((event) => event.score ?? 0)) : 0;

  const bestEvent = [...measured].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const worstEvents = measured.filter((event) => (event.score ?? 0) < averageEngagement);
  const benchmarkText = input.benchmarks?.comparisonText ?? "No hay benchmark suficiente esta semana.";

  return {
    weekLabel: weeksLabel(input.business.name),
    sections: [
      {
        title: "Tres numeros",
        body: [
          `${Math.round(totalReach)} personas alcanzadas esta semana.`,
          `${averageEngagement.toFixed(1)} de rendimiento promedio por publicacion.`,
          `${measured.length} publicaciones con metricas recolectadas.`,
        ],
      },
      {
        title: "Lo que mas funciono",
        body: bestEvent
          ? [
              `La mejor publicacion fue del tipo ${normalizeText(bestEvent.contentType ?? bestEvent.photoType ?? "desconocido")}.`,
              `Funciono con un score de ${Number(bestEvent.score ?? 0).toFixed(1)}.`,
            ]
          : ["Todavia no hay publicaciones suficientes para identificar la mejor de la semana."],
      },
      {
        title: "Lo que no funciono",
        body:
          worstEvents.length > 0
            ? [`Varios posts quedaron por debajo del promedio y conviene revisar ese patron.`]
            : ["No hubo un patron claro de bajo rendimiento."],
      },
      {
        title: "Para la semana que viene",
        body: input.memory.causalMap.conclusions.length > 0
          ? input.memory.causalMap.conclusions.slice(0, 3).map((conclusion) => conclusion.question)
          : ["Sigue publicando con consistencia para ganar mas evidencia."],
      },
      {
        title: "Vs negocios similares",
        body: [benchmarkText],
      },
    ],
  };
}


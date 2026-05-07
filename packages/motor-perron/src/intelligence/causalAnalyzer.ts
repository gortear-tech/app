import type { CausalAnalysisInput, CausalConclusion, CausalMap, LearningEvent } from "../types";
import { dayOfWeek, hourBucket, hourOfDay, mean, normalizeText } from "../utils";

type QuestionSpec = {
  question: string;
  groupA: (event: LearningEvent) => boolean;
  groupALabel: string;
  groupBLabel: string;
};

const scoreOf = (event: LearningEvent): number | null =>
  typeof event.score === "number" && Number.isFinite(event.score) ? event.score : null;

const weightedScores = (events: LearningEvent[]): number[] =>
  events.map((event) => scoreOf(event)).filter((value): value is number => value !== null);

function evaluateQuestion(spec: QuestionSpec, events: LearningEvent[]): CausalConclusion | null {
  const scoredEvents = events.filter((event) => scoreOf(event) !== null);
  const groupAEvents = scoredEvents.filter(spec.groupA);
  const groupBEvents = scoredEvents.filter((event) => !spec.groupA(event));

  if (groupAEvents.length < 5 || groupBEvents.length < 5) {
    return null;
  }

  const scoresA = weightedScores(groupAEvents);
  const scoresB = weightedScores(groupBEvents);
  const averageA = mean(scoresA);
  const averageB = mean(scoresB);
  const diff = Math.abs(averageA - averageB);
  if (diff <= 15) {
    return null;
  }

  const minSamples = Math.min(groupAEvents.length, groupBEvents.length);
  const confidence: CausalConclusion["confidence"] =
    minSamples >= 25 ? "alta" : minSamples >= 10 ? "media" : "exploratoria";

  return {
    question: spec.question,
    groupA: spec.groupALabel,
    groupB: spec.groupBLabel,
    differencePoints: Number(diff.toFixed(2)),
    favorsA: averageA >= averageB,
    observationsA: groupAEvents.length,
    observationsB: groupBEvents.length,
    confidence,
    status: "activa",
  };
}

function captionTone(captionPattern?: string): string {
  if (!captionPattern) return "afirmacion";
  const normalized = normalizeText(captionPattern);
  if (normalized.includes("?")) return "pregunta";
  if (normalized.includes("!" )) return "emocional";
  if (normalized.includes("promo") || normalized.includes("oferta")) return "promocional";
  return "afirmacion";
}

const QUESTIONS: QuestionSpec[] = [
  {
    question: "Los captions con pregunta generan mas comentarios?",
    groupA: (event) => captionTone(event.captionPattern) === "pregunta",
    groupALabel: "captions con pregunta",
    groupBLabel: "captions sin pregunta",
  },
  {
    question: "Los posts del jueves por la tarde rinden mejor?",
    groupA: (event) => dayOfWeek(event.scheduledFor ?? event.occurredAt) === 4 && hourBucket(hourOfDay(event.scheduledFor ?? event.occurredAt)) === "tarde",
    groupALabel: "jueves por la tarde",
    groupBLabel: "resto de horarios",
  },
  {
    question: "Los posts con estilo premium rinden mejor?",
    groupA: (event) => normalizeText(event.styleName ?? event.styleId ?? "").includes("premium"),
    groupALabel: "estilo premium",
    groupBLabel: "otros estilos",
  },
  {
    question: "Los captions editados por el usuario rinden diferente?",
    groupA: (event) => Boolean(event.captionEdited),
    groupALabel: "captions editados",
    groupBLabel: "captions no editados",
  },
  {
    question: "Los contenidos de comida rinden mejor que el resto?",
    groupA: (event) => normalizeText(event.photoType ?? event.contentType ?? "").includes("comida"),
    groupALabel: "contenido de comida",
    groupBLabel: "otros contenidos",
  },
  {
    question: "Las publicaciones de noche rinden mejor?",
    groupA: (event) => hourBucket(event.hourOfDay ?? hourOfDay(event.scheduledFor ?? event.occurredAt)) === "noche",
    groupALabel: "publicaciones nocturnas",
    groupBLabel: "resto del dia",
  },
];

export function analyzeCausality(input: CausalAnalysisInput): CausalMap {
  const conclusions: CausalConclusion[] = [];
  const pendingQuestions: string[] = [];

  for (const question of QUESTIONS) {
    const conclusion = evaluateQuestion(question, input.events);
    if (conclusion) {
      conclusions.push(conclusion);
    } else {
      pendingQuestions.push(question.question);
    }
  }

  return {
    conclusions,
    pendingQuestions,
  };
}


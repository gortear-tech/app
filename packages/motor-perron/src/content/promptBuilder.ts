import type {
  AssignedStyle,
  DisclosurePolicy,
  GenerationPlan,
  VisionAnalysisResult,
} from "@fbmaniaco/shared";
import type { BusinessContext, GenerationPlanInput, PromptBuilderInput } from "../types";
import { classifyRiskFromAnalysis, resolveDisclosurePolicy } from "../rules";
import { normalizeText } from "../utils";

const listSensitivePreservations = (analysis: VisionAnalysisResult): string[] => {
  const items: string[] = ["Preservar el sujeto principal y la escena base"];
  const { sensitiveElements } = analysis;
  if (sensitiveElements.logoVisible) items.push("No modificar el logo");
  if (sensitiveElements.priceVisible) items.push("No cambiar el precio");
  if (sensitiveElements.personVisible) items.push("No deformar ni reemplazar a la persona");
  if (sensitiveElements.textVisible) items.push("No alterar el texto visible");
  if (sensitiveElements.promotionVisible) items.push("No borrar promociones visibles");
  return items;
};

const styleAllowedChanges = (style: AssignedStyle, analysis: VisionAnalysisResult): string[] => {
  const allowed = new Set<string>();
  allowed.add("Ajustar luz, contraste, saturacion y nitidez");
  if (normalizeText(style.styleName).includes("fondo")) {
    allowed.add("Simplificar el fondo si no altera la identidad");
  }
  if (normalizeText(style.styleName).includes("calido")) {
    allowed.add("Aplicar temperatura calida y atmosfera acogedora");
  }
  if (normalizeText(style.styleName).includes("premium")) {
    allowed.add("Elevar la presencia visual con look aspiracional");
  }
  if (analysis.palette.temperature === "calida") {
    allowed.add("Mantener el equilibrio de tonos calidos del original");
  }
  return [...allowed];
};

const disallowedChanges = (analysis: VisionAnalysisResult, style: AssignedStyle): string[] => {
  const disallowed = new Set<string>(style.manualOverride ? [] : []);
  const sensitive = analysis.sensitiveElements;
  if (sensitive.logoVisible) disallowed.add("Cambiar o ocultar el logo");
  if (sensitive.priceVisible) disallowed.add("Alterar el precio visible");
  if (sensitive.personVisible) disallowed.add("Cambiar identidad de personas");
  if (sensitive.textVisible) disallowed.add("Modificar texto visible");
  if (normalizeText(style.styleName).includes("premium")) disallowed.add("Inventar elementos de lujo no presentes");
  if (normalizeText(style.styleName).includes("fondo")) disallowed.add("Reemplazar el sujeto principal");
  return [...disallowed];
};

const buildPromptText = (params: {
  business: BusinessContext;
  analysis: VisionAnalysisResult;
  style: AssignedStyle;
  disclosure: DisclosurePolicy;
  riskLevel: "riesgo_bajo" | "riesgo_medio" | "riesgo_alto";
}): string => {
  const { business, analysis, style, disclosure, riskLevel } = params;
  const lines = [
    `Business tone: ${business.tone}`,
    `Subject: ${analysis.subject.description}`,
    `Style: ${style.styleName}`,
    `Preserve: ${listSensitivePreservations(analysis).join("; ")}`,
    `Allowed: ${styleAllowedChanges(style, analysis).join("; ")}`,
    `Forbidden: ${disallowedChanges(analysis, style).join("; ") || "No additional restrictions"}`,
    `Edit params: contrast ${style.contrast}%, saturation ${style.saturation}%, warmth ${style.warmth}%, sharpness ${style.sharpness}%`,
    `Disclosure: ${disclosure}`,
    `Risk: ${riskLevel}`,
  ];

  if (style.lowConfidence) {
    lines.push("Be conservative and avoid aggressive edits.");
  }

  lines.push(`Mood target: ${analysis.mood.description}`);
  return lines.join("\n");
};

export function buildGenerationPlan(input: GenerationPlanInput): GenerationPlan {
  const riskLevel = classifyRiskFromAnalysis(input.analysis);
  const disclosure = resolveDisclosurePolicy(
    input.style.intensity,
    normalizeText(input.style.styleName).includes("fondo") || input.style.intensity === "fuerte",
  );
  const promptFinal = buildPromptText({
    business: input.business,
    analysis: input.analysis,
    style: input.style,
    disclosure,
    riskLevel,
  });

  const canGenerate = riskLevel !== "riesgo_alto";
  const reason = canGenerate
    ? "Listo para generar con el estilo asignado"
    : "Hay elementos sensibles que requieren aprobacion humana";

  return {
    puedeGenerar: canGenerate,
    motivo: reason,
    sujetoPrincipal: input.analysis.subject.description,
    preservar: listSensitivePreservations(input.analysis),
    permitido: styleAllowedChanges(input.style, input.analysis),
    prohibido: disallowedChanges(input.analysis, input.style),
    riesgo:
      input.analysis.sensitiveElements.notes.length > 0
        ? input.analysis.sensitiveElements.notes
        : riskLevel === "riesgo_alto"
          ? ["Elementos sensibles visibles"]
          : [],
    nivelRiesgo: riskLevel,
    divulgacionIa: disclosure,
    promptFinal,
    promptVersion: "v1.0",
    planVersion: "v1.0",
  };
}

export function buildPromptOnly(input: PromptBuilderInput): string {
  return buildGenerationPlan({
    business: input.business,
    analysis: input.analysis,
    style: input.style,
    memory: { performanceModel: [], businessFootprint: { preferredStyles: {}, preferredContentTypes: {}, preferredHours: {}, captionEditRate: 0, totalPostsMeasured: 0 }, causalMap: { conclusions: [], pendingQuestions: [] }, confidence: "baja" },
  }).promptFinal;
}


import type { MotorDecision, DecisionContext } from "../types";
import { classifyRiskFromAnalysis, resolveConfidenceLevel } from "../rules";
import { canProceedAutonomously } from "./autonomyManager";

const blockedReasons = new Set([
  "pending_upload",
  "pendiente_confirmacion",
  "fallido",
  "cancelado",
  "abandonado",
]);

export function decide(params: DecisionContext): MotorDecision {
  const riskLevel = classifyRiskFromAnalysis({
    subject: {
      type: "objeto",
      description: params.business.name,
      hasPerson: params.sensitiveElements.personVisible,
    },
    composition: {
      framing: "primer_plano",
      angle: "frontal",
      backgroundType: "limpio",
      backgroundDescription: "",
      lighting: "natural",
    },
    palette: {
      dominantColors: [],
      temperature: "neutra",
      saturation: 0,
      contrast: 0,
    },
    sensitiveElements: {
      priceVisible: params.sensitiveElements.priceVisible,
      logoVisible: params.sensitiveElements.logoVisible,
      personVisible: params.sensitiveElements.personVisible,
      promotionVisible: params.sensitiveElements.promotionVisible,
      textVisible: params.sensitiveElements.textVisible,
      notes: [],
    },
    technicalQuality: {
      sharpness: 100,
      exposure: 100,
      noise: 0,
    },
    mood: {
      temperature: "neutra",
      keywords: [],
      description: "",
    },
    summary: "",
  });

  if (blockedReasons.has(params.batchStatus)) {
    return {
      negocioId: params.business.businessId,
      taskType: params.taskType,
      mode: "sin_ia",
      outcome: "bloqueado",
      confidenceLevel: resolveConfidenceLevel(params.postsMeasured),
      riskLevel,
      reason: "El lote no esta en un estado valido para continuar",
      requiresHumanApproval: true,
      recommendedActions: ["Revisar el estado del lote antes de continuar"],
    };
  }

  if (!params.costConfirmed) {
    return {
      negocioId: params.business.businessId,
      taskType: params.taskType,
      mode: "sin_ia",
      outcome: "bloqueado",
      confidenceLevel: resolveConfidenceLevel(params.postsMeasured),
      riskLevel,
      reason: "El costo todavia no fue confirmado",
      requiresHumanApproval: true,
      recommendedActions: ["Confirmar el costo del lote"],
    };
  }

  if (!params.providerSupportsTask) {
    return {
      negocioId: params.business.businessId,
      taskType: params.taskType,
      mode: "sin_ia",
      outcome: "bloqueado",
      confidenceLevel: resolveConfidenceLevel(params.postsMeasured),
      riskLevel,
      reason: "El proveedor no soporta esta tarea",
      requiresHumanApproval: true,
      recommendedActions: ["Cambiar de proveedor o de tarea"],
    };
  }

  if (params.estimatedCostUsd > params.budgetUsd) {
    return {
      negocioId: params.business.businessId,
      taskType: params.taskType,
      mode: "sin_ia",
      outcome: "bloqueado",
      confidenceLevel: resolveConfidenceLevel(params.postsMeasured),
      riskLevel,
      reason: "El costo supera el presupuesto disponible",
      requiresHumanApproval: true,
      recommendedActions: ["Reducir el numero de variantes o ajustar el presupuesto"],
    };
  }

  const autonomy = canProceedAutonomously({
    state: params.autonomyState,
    actionType: params.actionType,
    sensitiveAnalysis: riskLevel === "riesgo_alto",
    hasEnoughHistory: params.memory.confidence !== "baja",
  });

  const mode = riskLevel === "riesgo_bajo" ? "ia_ligera" : "ia_avanzada";
  const recommendedActions: string[] = [];
  if (riskLevel === "riesgo_alto") {
    recommendedActions.push("Revisar manualmente elementos sensibles");
  }
  if (!autonomy.autonomous) {
    recommendedActions.push("Pasar por swipe de aprobacion");
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push("Continuar con la ejecucion automatica");
  }

  return {
    negocioId: params.business.businessId,
    taskType: params.taskType,
    mode,
    outcome: autonomy.autonomous ? "puede_continuar_autonomo" : "puede_continuar_swipe",
    confidenceLevel: params.memory.confidence,
    riskLevel,
    reason: autonomy.reason,
    requiresHumanApproval: !autonomy.autonomous,
    recommendedActions,
  };
}


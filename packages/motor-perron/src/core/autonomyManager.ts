import type { ActionType } from "@fbmaniaco/shared";
import type { AutonomyActionState, AutonomyState } from "../types";
import { AUTONOMY_THRESHOLDS, MIN_APPROVALS, isSensitiveAnalysis } from "../rules";

const createActionState = (threshold: number): AutonomyActionState => ({
  score: 0,
  approvals: 0,
  threshold,
  paused: false,
  consecutiveApprovals: 0,
  consecutiveRejections: 0,
});

export function createDefaultAutonomyState(
  overrides: Partial<Record<ActionType, number>> = {},
): AutonomyState {
  return {
    STYLE_ASSIGNMENT: createActionState(overrides.STYLE_ASSIGNMENT ?? AUTONOMY_THRESHOLDS.STYLE_ASSIGNMENT),
    VARIANT_COUNT: createActionState(overrides.VARIANT_COUNT ?? AUTONOMY_THRESHOLDS.VARIANT_COUNT),
    SCHEDULING: createActionState(overrides.SCHEDULING ?? AUTONOMY_THRESHOLDS.SCHEDULING),
    CAPTION_GENERATION: createActionState(overrides.CAPTION_GENERATION ?? AUTONOMY_THRESHOLDS.CAPTION_GENERATION),
    FACEBOOK_PUBLISH: createActionState(overrides.FACEBOOK_PUBLISH ?? AUTONOMY_THRESHOLDS.FACEBOOK_PUBLISH),
  };
}

const cloneState = (state: AutonomyState): AutonomyState =>
  JSON.parse(JSON.stringify(state)) as AutonomyState;

export function recordApproval(state: AutonomyState, actionType: ActionType, measuredPositive = false): AutonomyState {
  const next = cloneState(state);
  const action = next[actionType];
  action.approvals += 1;
  action.consecutiveApprovals += 1;
  action.consecutiveRejections = 0;
  const bonus = measuredPositive ? 6 : 4;
  const streakBonus = Math.max(0, action.consecutiveApprovals - 1);
  action.score = Math.min(100, action.score + bonus + Math.min(streakBonus, 3));
  return next;
}

export function recordRejection(state: AutonomyState, actionType: ActionType): AutonomyState {
  const next = cloneState(state);
  const action = next[actionType];
  action.consecutiveRejections += 1;
  action.consecutiveApprovals = 0;
  const penalty = action.consecutiveRejections > 1 ? 12 : 8;
  action.score = Math.max(0, action.score - penalty);
  return next;
}

export function resetAction(state: AutonomyState, actionType: ActionType): AutonomyState {
  const next = cloneState(state);
  next[actionType] = createActionState(next[actionType].threshold);
  return next;
}

export function applyPerformanceDropProtection(state: AutonomyState): AutonomyState {
  const next = cloneState(state);
  next.SCHEDULING.paused = true;
  next.FACEBOOK_PUBLISH.paused = true;
  return next;
}

export function resumeAction(state: AutonomyState, actionType: ActionType): AutonomyState {
  const next = cloneState(state);
  next[actionType].paused = false;
  return next;
}

export function canProceedAutonomously(params: {
  state: AutonomyState;
  actionType: ActionType;
  hasEnoughHistory?: boolean;
  sensitiveAnalysis?: boolean;
}): {
  autonomous: boolean;
  requiresSwipe: boolean;
  score: number;
  threshold: number;
  reason: string;
} {
  const { state, actionType, hasEnoughHistory = true, sensitiveAnalysis = false } = params;
  const action = state[actionType];
  const minApprovals = MIN_APPROVALS[actionType];

  if (sensitiveAnalysis || action.paused) {
    return {
      autonomous: false,
      requiresSwipe: true,
      score: action.score,
      threshold: action.threshold,
      reason: sensitiveAnalysis
        ? "Elementos sensibles requieren aprobacion humana"
        : "La accion esta pausada por seguridad",
    };
  }

  if (!hasEnoughHistory || action.approvals < minApprovals) {
    return {
      autonomous: false,
      requiresSwipe: true,
      score: action.score,
      threshold: action.threshold,
      reason: "Aun no existe suficiente historial para actuar solo",
    };
  }

  if (action.score >= action.threshold) {
    return {
      autonomous: true,
      requiresSwipe: false,
      score: action.score,
      threshold: action.threshold,
      reason: "La confianza supera el umbral configurado",
    };
  }

  return {
    autonomous: false,
    requiresSwipe: true,
    score: action.score,
    threshold: action.threshold,
    reason: "La confianza todavia no alcanza el umbral",
  };
}

export function defaultActionLabel(actionType: ActionType): string {
  switch (actionType) {
    case "STYLE_ASSIGNMENT":
      return "Asignar estilo";
    case "VARIANT_COUNT":
      return "Decidir variantes";
    case "SCHEDULING":
      return "Elegir horario";
    case "CAPTION_GENERATION":
      return "Generar caption";
    case "FACEBOOK_PUBLISH":
      return "Publicar en Facebook";
    default:
      return actionType;
  }
}

export function isSensitiveActionBlocked(sensitiveAnalysis: boolean): boolean {
  return sensitiveAnalysis;
}


import type { DisclosurePolicy } from "./states";

export type VisionSubjectType =
  | "producto"
  | "persona"
  | "comida"
  | "lugar"
  | "animal"
  | "objeto";

export type VisionFraming = "primer_plano" | "plano_medio" | "plano_general" | "detalle" | "cenital";
export type VisionAngle = "frontal" | "picado" | "contrapicado" | "lateral" | "cenital";
export type VisionBackgroundType = "limpio" | "natural" | "urbano" | "interior" | "exterior" | "abstracto";
export type VisionLighting = "natural" | "artificial" | "mixta" | "baja_luz" | "contraluz";
export type VisionMoodTemperature = "calida" | "neutra" | "fria" | "vibrante" | "oscura";

export interface VisionAnalysisSubject {
  type: VisionSubjectType;
  description: string;
  hasPerson: boolean;
}

export interface VisionAnalysisComposition {
  framing: VisionFraming;
  angle: VisionAngle;
  backgroundType: VisionBackgroundType;
  backgroundDescription: string;
  lighting: VisionLighting;
}

export interface VisionAnalysisPalette {
  dominantColors: string[];
  temperature: VisionMoodTemperature;
  saturation: number;
  contrast: number;
}

export interface VisionAnalysisSensitiveElements {
  priceVisible: boolean;
  logoVisible: boolean;
  personVisible: boolean;
  promotionVisible: boolean;
  textVisible: boolean;
  notes: string[];
}

export interface VisionAnalysisTechnicalQuality {
  sharpness: number;
  exposure: number;
  noise: number;
}

export interface VisionAnalysisMood {
  temperature: VisionMoodTemperature;
  keywords: string[];
  description: string;
}

export interface VisionAnalysisResult {
  subject: VisionAnalysisSubject;
  composition: VisionAnalysisComposition;
  palette: VisionAnalysisPalette;
  sensitiveElements: VisionAnalysisSensitiveElements;
  technicalQuality: VisionAnalysisTechnicalQuality;
  mood: VisionAnalysisMood;
  summary: string;
}

export interface AssignedStyle {
  styleId: string;
  styleName: string;
  intensity: "ligera" | "media" | "fuerte";
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  lowConfidence: boolean;
  manualOverride: boolean;
}

export interface GenerationPlan {
  puedeGenerar: boolean;
  motivo: string;
  sujetoPrincipal: string;
  preservar: string[];
  permitido: string[];
  prohibido: string[];
  riesgo: string[];
  nivelRiesgo: "riesgo_bajo" | "riesgo_medio" | "riesgo_alto";
  divulgacionIa: DisclosurePolicy;
  promptFinal: string;
  promptVersion: string;
  planVersion: string;
}

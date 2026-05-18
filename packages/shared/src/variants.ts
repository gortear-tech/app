import { Static, Type } from "@sinclair/typebox";
import { JobSummarySchema } from "./jobs.js";
import { VariantStatus } from "./states.js";

export const AssignedStyleSchema = Type.Object({
  styleId: Type.String(),
  styleName: Type.String(),
  intensity: Type.Union([Type.Literal("ligera"), Type.Literal("media"), Type.Literal("fuerte")]),
  contrast: Type.Number(),
  saturation: Type.Number(),
  warmth: Type.Number(),
  sharpness: Type.Number(),
  lowConfidence: Type.Boolean(),
  manualOverride: Type.Boolean()
});

export const GenerationPlanSchema = Type.Object({
  schemaVersion: Type.Literal("generation_plan.v1"),
  puedeGenerar: Type.Boolean(),
  motivo: Type.String(),
  sujetoPrincipal: Type.String(),
  preservar: Type.Array(Type.String()),
  permitido: Type.Array(Type.String()),
  prohibido: Type.Array(Type.String()),
  riesgo: Type.Array(Type.String()),
  nivelRiesgo: Type.Union([
    Type.Literal("riesgo_bajo"),
    Type.Literal("riesgo_medio"),
    Type.Literal("riesgo_alto")
  ]),
  divulgacionIa: Type.Union([
    Type.Literal("no_requerida"),
    Type.Literal("recomendada"),
    Type.Literal("obligatoria")
  ]),
  identityPolicy: Type.Union([Type.Literal("preservar"), Type.Literal("no_aplica"), Type.Literal("bloquear")]),
  textPolicy: Type.Union([
    Type.Literal("preservar_texto_visible"),
    Type.Literal("evitar_texto_nuevo"),
    Type.Literal("no_aplica")
  ]),
  brandPolicy: Type.Union([Type.Literal("preservar_logos"), Type.Literal("sin_logos"), Type.Literal("no_aplica")]),
  commercialClaimPolicy: Type.Union([
    Type.Literal("no_inventar_claims"),
    Type.Literal("claims_permitidos_por_negocio")
  ]),
  requiresHumanReview: Type.Boolean(),
  promptFinal: Type.String(),
  promptVersion: Type.String(),
  planVersion: Type.String()
});

export const AiQualityCheckSchema = Type.Object({
  schemaVersion: Type.Literal("ai_quality_check.v1"),
  status: Type.Union([Type.Literal("pass"), Type.Literal("warn"), Type.Literal("block")]),
  score: Type.Number({ minimum: 0, maximum: 1 }),
  warnings: Type.Array(Type.String()),
  blockingReasons: Type.Array(Type.String()),
  requiresHumanReview: Type.Boolean()
});

export const CaptionResultSchema = Type.Object({
  schemaVersion: Type.Literal("caption.v1"),
  promptVersion: Type.String(),
  caption: Type.String({ minLength: 1, maxLength: 2200 }),
  seoTermsUsed: Type.Array(Type.String()),
  warnings: Type.Array(Type.String())
});

export const VariantSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  batchId: Type.String(),
  photoId: Type.String(),
  variantIndex: Type.Number(),
  styleId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  assignedStyle: Type.Optional(Type.Union([AssignedStyleSchema, Type.Null()])),
  generationPlan: Type.Optional(Type.Union([GenerationPlanSchema, Type.Null()])),
  qualityCheck: Type.Optional(Type.Union([AiQualityCheckSchema, Type.Null()])),
  captionResult: Type.Optional(Type.Union([CaptionResultSchema, Type.Null()])),
  modelProfileId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  promptTemplateId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  promptVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  aiRunId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  qualityCheckId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  qualityStatus: Type.Optional(Type.Union([
    Type.Literal("pass"),
    Type.Literal("warn"),
    Type.Literal("block"),
    Type.Null()
  ])),
  qualityScore: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  qualityWarnings: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  imageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  generatedAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  publishableAssetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: VariantStatus,
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const GenerateBatchStyleOverrideSchema = Type.Object({
  photoId: Type.String(),
  styleId: Type.String({ minLength: 1, maxLength: 64 }),
  styleName: Type.String({ minLength: 1, maxLength: 80 }),
  intensity: Type.Number({ minimum: 0, maximum: 100 })
});

export const GenerateBatchBodySchema = Type.Object({
  variantsPerPhoto: Type.Number({ minimum: 1, maximum: 5 }),
  styleOverrides: Type.Optional(Type.Array(GenerateBatchStyleOverrideSchema, { maxItems: 10 }))
});

export const GenerateBatchResponseSchema = Type.Object({
  schemaVersion: Type.Literal("generate_batch.v1"),
  created: Type.Number(),
  available: Type.Number(),
  blockedReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  job: Type.Optional(Type.Union([JobSummarySchema, Type.Null()])),
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const VariantsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("variants.v1"),
  variants: Type.Array(VariantSchema),
  requestId: Type.String()
});

export const UpdateCaptionBodySchema = Type.Object({
  caption: Type.String({ minLength: 0, maxLength: 2200 })
});

export const VariantMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("variant_mutation.v1"),
  variant: VariantSchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type AssignedStyle = Static<typeof AssignedStyleSchema>;
export type GenerationPlan = Static<typeof GenerationPlanSchema>;
export type AiQualityCheck = Static<typeof AiQualityCheckSchema>;
export type CaptionResult = Static<typeof CaptionResultSchema>;
export type Variant = Static<typeof VariantSchema>;
export type GenerateBatchStyleOverride = Static<typeof GenerateBatchStyleOverrideSchema>;
export type GenerateBatchResponse = Static<typeof GenerateBatchResponseSchema>;
export type VariantsResponse = Static<typeof VariantsResponseSchema>;
export type VariantMutationResponse = Static<typeof VariantMutationResponseSchema>;

export const VARIANT_STYLE_PRESETS = [
  { styleId: "atardecer", styleName: "Atardecer", warmth: 0.28, saturation: 0.22 },
  { styleId: "marmol", styleName: "Mármol", warmth: 0.02, saturation: 0.08 },
  { styleId: "madera", styleName: "Madera", warmth: 0.2, saturation: 0.14 },
  { styleId: "jardin", styleName: "Jardín", warmth: 0.1, saturation: 0.24 },
  { styleId: "playa", styleName: "Playa", warmth: 0.18, saturation: 0.18 },
  { styleId: "estudio", styleName: "Estudio", warmth: 0.04, saturation: 0.1 },
  { styleId: "nocturno", styleName: "Nocturno", warmth: -0.04, saturation: 0.16 },
  { styleId: "bambu", styleName: "Bambú", warmth: 0.12, saturation: 0.2 }
] as const;

export const variantStylePresetForIndex = (variantIndex: number, startStyleId?: string | null) => {
  const startIndex = Math.max(0, VARIANT_STYLE_PRESETS.findIndex((item) => item.styleId === startStyleId));
  return VARIANT_STYLE_PRESETS[(startIndex + Math.max(1, variantIndex) - 1) % VARIANT_STYLE_PRESETS.length]!;
};

export const variantEditPromptForStyle = (styleName: string) =>
  `Corrige la iluminación y los colores. Cambia el fondo. ${styleName}.`;

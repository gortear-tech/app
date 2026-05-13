import { Static, Type } from "@sinclair/typebox";

export const VisionAnalysisSchema = Type.Object({
  schemaVersion: Type.Literal("vision_analysis.v1"),
  promptVersion: Type.String(),
  subject: Type.Object({
    type: Type.Union([Type.Literal("product"), Type.Literal("person"), Type.Literal("space"), Type.Literal("food"), Type.Literal("unknown")]),
    description: Type.String()
  }),
  composition: Type.Object({
    framing: Type.String(),
    angle: Type.Optional(Type.String()),
    background: Type.String(),
    lighting: Type.String()
  }),
  palette: Type.Object({
    dominantColors: Type.Array(Type.String()),
    temperature: Type.Union([Type.Literal("warm"), Type.Literal("neutral"), Type.Literal("cool"), Type.Literal("unknown")]),
    saturation: Type.String(),
    contrast: Type.String()
  }),
  sensitiveElements: Type.Object({
    personVisible: Type.Boolean(),
    priceVisible: Type.Boolean(),
    logoVisible: Type.Boolean(),
    promotionVisible: Type.Boolean(),
    textVisible: Type.Boolean(),
    notes: Type.Array(Type.String())
  }),
  quality: Type.Object({
    sharpness: Type.String(),
    exposure: Type.String(),
    noise: Type.String()
  }),
  mood: Type.Object({
    temperature: Type.String(),
    keywords: Type.Array(Type.String()),
    description: Type.String()
  }),
  summary: Type.String()
});

export const ModelProfileSchema = Type.Object({
  id: Type.String(),
  task: Type.Union([Type.Literal("vision"), Type.Literal("caption"), Type.Literal("generation_plan"), Type.Literal("image_generation")]),
  provider: Type.Literal("openai"),
  primaryModel: Type.String(),
  fallbackModel: Type.Optional(Type.String()),
  reasoningEffort: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
  textVerbosity: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
  schemaVersion: Type.String(),
  timeoutMs: Type.Number()
});

export const PromptTemplateSchema = Type.Object({
  id: Type.String(),
  task: Type.String(),
  promptVersion: Type.String(),
  stableInstructions: Type.String(),
  schemaVersion: Type.String(),
  status: Type.Union([Type.Literal("draft"), Type.Literal("canary"), Type.Literal("active"), Type.Literal("retired")])
});

export type VisionAnalysis = Static<typeof VisionAnalysisSchema>;
export type ModelProfile = Static<typeof ModelProfileSchema>;
export type PromptTemplate = Static<typeof PromptTemplateSchema>;

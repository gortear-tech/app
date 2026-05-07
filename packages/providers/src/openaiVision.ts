import { AppError, type VisionAnalysisResult } from "@fbmaniaco/shared";
import type { VisionAnalysisProvider } from "./contracts";

const getApiKey = (): string => process.env.OPENAI_API_KEY?.trim() ?? "";

const extractOutputText = (payload: unknown): string | null => {
  const record = payload as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
      }>;
    }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  for (const item of record.output ?? []) {
    for (const contentItem of item.content ?? []) {
      if (typeof contentItem.text === "string" && contentItem.text.trim()) {
        return contentItem.text.trim();
      }
    }
  }

  return null;
};

export class OpenAIVisionAnalysisProvider implements VisionAnalysisProvider {
  constructor(private readonly model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o") {}

  async analyze(imageUrl: string): Promise<VisionAnalysisResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new AppError({
        code: "openai_api_key_missing",
        statusCode: 500,
        message: "OPENAI_API_KEY missing",
        userMessage: "Falta OPENAI_API_KEY para analizar la foto.",
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Analyze this business photo and return a structured JSON object." },
              { type: "input_image", image_url: imageUrl },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "vision_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                subject: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: {
                      type: "string",
                      enum: ["producto", "persona", "comida", "lugar", "animal", "objeto"],
                    },
                    description: {
                      type: "string",
                    },
                    hasPerson: {
                      type: "boolean",
                    },
                  },
                  required: ["type", "description", "hasPerson"],
                },
                composition: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    framing: {
                      type: "string",
                      enum: ["primer_plano", "plano_medio", "plano_general", "detalle", "cenital"],
                    },
                    angle: {
                      type: "string",
                      enum: ["frontal", "picado", "contrapicado", "lateral", "cenital"],
                    },
                    backgroundType: {
                      type: "string",
                      enum: ["limpio", "natural", "urbano", "interior", "exterior", "abstracto"],
                    },
                    backgroundDescription: {
                      type: "string",
                    },
                    lighting: {
                      type: "string",
                      enum: ["natural", "artificial", "mixta", "baja_luz", "contraluz"],
                    },
                  },
                  required: ["framing", "angle", "backgroundType", "backgroundDescription", "lighting"],
                },
                palette: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    dominantColors: {
                      type: "array",
                      items: { type: "string" },
                    },
                    temperature: {
                      type: "string",
                      enum: ["calida", "neutra", "fria", "vibrante", "oscura"],
                    },
                    saturation: {
                      type: "number",
                    },
                    contrast: {
                      type: "number",
                    },
                  },
                  required: ["dominantColors", "temperature", "saturation", "contrast"],
                },
                sensitiveElements: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    priceVisible: { type: "boolean" },
                    logoVisible: { type: "boolean" },
                    personVisible: { type: "boolean" },
                    promotionVisible: { type: "boolean" },
                    textVisible: { type: "boolean" },
                    notes: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["priceVisible", "logoVisible", "personVisible", "promotionVisible", "textVisible", "notes"],
                },
                technicalQuality: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    sharpness: { type: "number" },
                    exposure: { type: "number" },
                    noise: { type: "number" },
                  },
                  required: ["sharpness", "exposure", "noise"],
                },
                mood: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    temperature: {
                      type: "string",
                      enum: ["calida", "neutra", "fria", "vibrante", "oscura"],
                    },
                    keywords: {
                      type: "array",
                      items: { type: "string" },
                    },
                    description: {
                      type: "string",
                    },
                  },
                  required: ["temperature", "keywords", "description"],
                },
                summary: {
                  type: "string",
                },
              },
              required: ["subject", "composition", "palette", "sensitiveElements", "technicalQuality", "mood", "summary"],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AppError({
        code: "openai_vision_failed",
        statusCode: response.status,
        message: text || `OpenAI vision request failed (${response.status})`,
        userMessage: "No se pudo analizar la foto con OpenAI.",
      });
    }

    const data = await response.json().catch(() => ({}));
    const text = extractOutputText(data);
    if (!text) {
      throw new AppError({
        code: "openai_vision_invalid_response",
        statusCode: 502,
        message: "OpenAI vision response missing output text",
        userMessage: "OpenAI devolvio una respuesta de analisis invalida.",
      });
    }

    try {
      return JSON.parse(text) as VisionAnalysisResult;
    } catch {
      throw new AppError({
        code: "openai_vision_invalid_response",
        statusCode: 502,
        message: "OpenAI vision response could not be parsed",
        userMessage: "OpenAI devolvio una respuesta de analisis invalida.",
      });
    }
  }
}

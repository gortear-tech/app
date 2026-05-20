import { Blob } from "node:buffer";
import { CaptionResult, VisionAnalysis, VisionAnalysisSchema } from "@fbmaniaco/shared";

export type OpenAiMode = "mock" | "responses";
export type ImageEditMode = "mock" | "images";

export type VisionInput = {
  imageUrl: string;
  mimeType: string;
  requestId: string;
  operationKey: string;
  promptVersion: string;
};

export type VisionProviderResult = {
  analysis: VisionAnalysis;
  responseId: string | null;
  model: string;
  usage: Record<string, unknown> | null;
  latencyMs: number;
};

export type VisionAnalysisProvider = {
  mode: OpenAiMode;
  analyze(input: VisionInput): Promise<VisionProviderResult>;
};

export type CaptionInput = {
  pageName: string;
  businessName: string;
  category?: string | null;
  styleName: string;
  variantIndex: number;
  fileName?: string | null;
  visionAnalysis: VisionAnalysis;
  requestId: string;
  operationKey: string;
  promptVersion: string;
};

export type CaptionProviderResult = {
  result: CaptionResult;
  responseId: string | null;
  model: string;
  usage: Record<string, unknown> | null;
  latencyMs: number;
};

export type CaptionGenerationProvider = {
  mode: OpenAiMode;
  generate(input: CaptionInput): Promise<CaptionProviderResult>;
};

export type ImageEditInput = {
  imageUrl: string;
  mimeType: string;
  prompt: string;
  requestId: string;
  operationKey: string;
  size?: string;
  quality?: "auto" | "low" | "medium" | "high";
};

export type ImageEditProviderResult = {
  imageBytes: Uint8Array;
  mimeType: string;
  responseId: string | null;
  model: string;
  usage: Record<string, unknown> | null;
  latencyMs: number;
};

export type ImageEditProvider = {
  mode: ImageEditMode;
  edit(input: ImageEditInput): Promise<ImageEditProviderResult>;
};

export type OpenAiProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  visionModel?: string;
  captionModel?: string;
  imageEditModel?: string;
  timeoutMs?: number;
};

const defaultVisionModel = "gpt-5.5";
const defaultImageEditModel = "gpt-image-2";
const defaultPromptVersion = "vision-analysis-v1";
const defaultCaptionPromptVersion = "caption-page-context-v1";
const supportsReasoningEffort = (model: string) => /^(gpt-5|o[1-9]|o\d)/i.test(model);
const captionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "promptVersion", "caption", "seoTermsUsed", "warnings"],
  properties: {
    schemaVersion: { type: "string", enum: ["caption.v1"] },
    promptVersion: { type: "string" },
    caption: { type: "string", minLength: 1, maxLength: 2200 },
    seoTermsUsed: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }
  }
};

const mockAnalysis = (promptVersion = defaultPromptVersion): VisionAnalysis => ({
  schemaVersion: "vision_analysis.v1",
  promptVersion,
  subject: {
    type: "unknown",
    description: "Foto subida por el usuario"
  },
  composition: {
    framing: "unknown",
    angle: "unknown",
    background: "unknown",
    lighting: "unknown"
  },
  palette: {
    dominantColors: [],
    temperature: "unknown",
    saturation: "unknown",
    contrast: "unknown"
  },
  sensitiveElements: {
    personVisible: false,
    priceVisible: false,
    logoVisible: false,
    promotionVisible: false,
    textVisible: false,
    notes: []
  },
  quality: {
    sharpness: "unknown",
    exposure: "unknown",
    noise: "unknown"
  },
  mood: {
    temperature: "unknown",
    keywords: [],
    description: "Analisis local pendiente de proveedor IA real"
  },
  summary: "Foto validada con proveedor mock local."
});

const extractOutputText = (response: unknown): string => {
  const output = (response as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }).output ?? [];
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  const outputText = (response as { output_text?: unknown }).output_text;
  if (typeof outputText === "string") return outputText;
  throw new Error("OpenAI response did not include output text");
};

const cleanHashtag = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 32);

const fallbackCaption = (input: CaptionInput): CaptionResult => {
  const pageName = input.pageName.trim() || input.businessName.trim() || "tu pagina";
  const category = input.category?.trim() || "negocio local";
  const subject = input.visionAnalysis.subject.description || input.visionAnalysis.summary || "esta imagen";
  const moodKeywords = input.visionAnalysis.mood.keywords.slice(0, 3).filter(Boolean);
  const mood = moodKeywords.length > 0 ? ` Con un tono ${moodKeywords.join(", ")}.` : "";
  const localTag = cleanHashtag(pageName);
  const categoryTag = cleanHashtag(category);
  const hashtagLine = [localTag ? `#${localTag}` : null, categoryTag ? `#${categoryTag}` : null]
    .filter(Boolean)
    .join(" ");
  return {
    schemaVersion: "caption.v1",
    promptVersion: input.promptVersion || defaultCaptionPromptVersion,
    caption:
      `${pageName}: ${subject}.\n\n` +
      `Una publicacion pensada para ${category}, con estilo ${input.styleName}.${mood}\n\n` +
      `${hashtagLine || "#NegocioLocal"}`,
    seoTermsUsed: [pageName, category, ...moodKeywords].filter(Boolean),
    warnings: ["caption_generado_con_contexto_de_pagina", "no_inventa_precios_ni_promociones"]
  };
};

const isVisionAnalysis = (value: unknown): value is VisionAnalysis => {
  const item = value as Partial<VisionAnalysis> | null;
  return Boolean(
    item &&
      item.schemaVersion === "vision_analysis.v1" &&
      typeof item.promptVersion === "string" &&
      item.subject &&
      typeof item.subject.description === "string" &&
      item.composition &&
      item.sensitiveElements &&
      item.quality &&
      item.mood &&
      typeof item.summary === "string"
  );
};

const isCaptionResult = (value: unknown): value is CaptionResult => {
  const item = value as Partial<CaptionResult> | null;
  return Boolean(
    item &&
      item.schemaVersion === "caption.v1" &&
      typeof item.promptVersion === "string" &&
      typeof item.caption === "string" &&
      item.caption.length > 0 &&
      item.caption.length <= 2200 &&
      Array.isArray(item.seoTermsUsed) &&
      Array.isArray(item.warnings)
  );
};

const jsonFromResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text } };
  }
};

const imageEditErrorMessage = (status: number, json: unknown) => {
  const message = (json as { error?: { message?: string } }).error?.message ?? "OpenAI image edit request failed";
  const accessPattern = /(verify|verification|organization|org|access|permission|not authorized|unauthorized|forbidden)/i;
  if (status === 401 || status === 403 || accessPattern.test(message)) {
    return `OpenAI image edit access/organization verification error: ${message}`;
  }
  return message;
};

const imageFileNameForMime = (mimeType: string) => {
  if (mimeType === "image/png") return "source-image.png";
  if (mimeType === "image/webp") return "source-image.webp";
  return "source-image.jpg";
};

export const createVisionAnalysisProvider = (config: OpenAiProviderConfig): VisionAnalysisProvider => {
  if (!config.apiKey) {
    return {
      mode: "mock",
      analyze: async (input) => ({
        analysis: mockAnalysis(input.promptVersion),
        responseId: null,
        model: "mock-vision",
        usage: null,
        latencyMs: 0
      })
    };
  }

  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const model = config.visionModel ?? defaultVisionModel;
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    mode: "responses",
    analyze: async (input) => {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const payload = {
          model,
          prompt_cache_key: `fbmaniaco:${input.promptVersion}`,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text:
                    "Analiza la imagen para Maniaco. Devuelve solo datos observables y evita inferir claims comerciales, precios o promociones no visibles."
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Version de prompt: ${input.promptVersion}. OperationKey: ${input.operationKey}.`
                },
                {
                  type: "input_image",
                  image_url: input.imageUrl
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "vision_analysis",
              strict: true,
              schema: VisionAnalysisSchema
            }
          },
          ...(supportsReasoningEffort(model) ? { reasoning: { effort: "low" } } : {})
        };

        const response = await fetch(`${baseUrl}/responses`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "x-request-id": input.requestId
          },
          body: JSON.stringify(payload)
        });
        const json = (await response.json()) as unknown;
        if (!response.ok) {
          const message = (json as { error?: { message?: string } }).error?.message ?? "OpenAI vision request failed";
          throw new Error(message);
        }
        const parsed = JSON.parse(extractOutputText(json)) as unknown;
        if (!isVisionAnalysis(parsed)) {
          throw new Error("OpenAI vision output did not match schema");
        }
        return {
          analysis: parsed,
          responseId: (json as { id?: string }).id ?? null,
          model,
          usage: ((json as { usage?: Record<string, unknown> }).usage ?? null),
          latencyMs: Date.now() - started
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
};

export const createCaptionGenerationProvider = (config: OpenAiProviderConfig): CaptionGenerationProvider => {
  if (!config.apiKey) {
    return {
      mode: "mock",
      generate: async (input) => ({
        result: fallbackCaption(input),
        responseId: null,
        model: "mock-caption",
        usage: null,
        latencyMs: 0
      })
    };
  }

  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const model = config.captionModel ?? config.visionModel ?? defaultVisionModel;
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    mode: "responses",
    generate: async (input) => {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const payload = {
          model,
          prompt_cache_key: `fbmaniaco:${input.promptVersion}`,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text:
                    "Eres especialista en copy para paginas de Facebook de negocios locales. " +
                    "Genera un caption en espanol de Mexico para UNA sola pagina usando solo el contexto recibido. " +
                    "No uses informacion de otras paginas, no inventes precios, promociones, disponibilidad, ubicacion ni claims no observables. " +
                    "Debe sonar natural, breve, accionable y listo para revision humana."
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    promptVersion: input.promptVersion,
                    operationKey: input.operationKey,
                    page: {
                      name: input.pageName,
                      businessName: input.businessName,
                      category: input.category ?? "Facebook Page"
                    },
                    creative: {
                      styleName: input.styleName,
                      variantIndex: input.variantIndex,
                      fileName: input.fileName ?? null
                    },
                    imageAnalysis: input.visionAnalysis,
                    outputRules: [
                      "caption maximo 650 caracteres salvo que la imagen necesite contexto",
                      "incluye 1 llamada suave a interactuar o visitar la pagina cuando sea natural",
                      "usa 1 a 4 hashtags relevantes derivados de la pagina o categoria",
                      "no menciones que fue hecho con IA"
                    ]
                  })
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "caption_result",
              strict: true,
              schema: captionResultSchema
            }
          },
          ...(supportsReasoningEffort(model) ? { reasoning: { effort: "low" } } : {})
        };

        const response = await fetch(`${baseUrl}/responses`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "x-request-id": input.requestId
          },
          body: JSON.stringify(payload)
        });
        const json = (await response.json()) as unknown;
        if (!response.ok) {
          const message = (json as { error?: { message?: string } }).error?.message ?? "OpenAI caption request failed";
          throw new Error(message);
        }
        const parsed = JSON.parse(extractOutputText(json)) as unknown;
        if (!isCaptionResult(parsed)) {
          throw new Error("OpenAI caption output did not match schema");
        }
        return {
          result: parsed,
          responseId: (json as { id?: string }).id ?? null,
          model,
          usage: (json as { usage?: Record<string, unknown> }).usage ?? null,
          latencyMs: Date.now() - started
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
};

export const createImageEditProvider = (config: OpenAiProviderConfig): ImageEditProvider => {
  if (!config.apiKey) {
    return {
      mode: "mock",
      edit: async (input) => ({
        imageBytes: Buffer.from(`mock-edited-image:${input.operationKey}`),
        mimeType: "image/jpeg",
        responseId: null,
        model: "mock-image-edit",
        usage: null,
        latencyMs: 0
      })
    };
  }

  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const model = config.imageEditModel ?? defaultImageEditModel;
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    mode: "images",
    edit: async (input) => {
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const source = await fetch(input.imageUrl, { signal: controller.signal });
        if (!source.ok) {
          throw new Error(`Could not fetch source image for edit: ${source.status} ${source.statusText}`);
        }
        const sourceBytes = new Uint8Array(await source.arrayBuffer());
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", input.prompt);
        form.append("size", input.size ?? "1024x1024");
        form.append("quality", input.quality ?? "medium");
        form.append("output_format", "jpeg");
        form.append("image", new Blob([sourceBytes], { type: input.mimeType }), imageFileNameForMime(input.mimeType));

        const response = await fetch(`${baseUrl}/images/edits`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "x-request-id": input.requestId
          },
          body: form
        });
        const json = await jsonFromResponse(response);
        if (!response.ok) {
          throw new Error(imageEditErrorMessage(response.status, json));
        }
        const imageBase64 = (json as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json;
        if (!imageBase64) {
          throw new Error("OpenAI image edit response did not include b64_json");
        }
        return {
          imageBytes: Buffer.from(imageBase64, "base64"),
          mimeType: "image/jpeg",
          responseId: (json as { id?: string }).id ?? null,
          model,
          usage: (json as { usage?: Record<string, unknown> }).usage ?? null,
          latencyMs: Date.now() - started
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
};

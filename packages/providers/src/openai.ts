import { VisionAnalysis, VisionAnalysisSchema } from "@fbmaniaco/shared";

export type OpenAiMode = "mock" | "responses";

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

export type OpenAiProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  visionModel?: string;
  timeoutMs?: number;
};

const defaultVisionModel = "gpt-5.5";
const defaultPromptVersion = "vision-analysis-v1";
const supportsReasoningEffort = (model: string) => /^(gpt-5|o[1-9]|o\d)/i.test(model);

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
                    "Analiza la imagen para FBmaniaco. Devuelve solo datos observables y evita inferir claims comerciales, precios o promociones no visibles."
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

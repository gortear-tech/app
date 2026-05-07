import { AppError } from "@fbmaniaco/shared";
import type { ImageGenerationProvider } from "./contracts";

const getApiKey = (): string => process.env.OPENAI_API_KEY?.trim() ?? "";

const readNumber = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fallbackImageModels = ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
const defaultImageTimeoutMs = readNumber("OPENAI_IMAGE_TIMEOUT_MS", 120000);

const shouldFallbackToNextModel = (statusCode: number, message: string): boolean => {
  if (![400, 401, 403, 404].includes(statusCode)) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("verified organization") ||
    normalizedMessage.includes("organization must be verified") ||
    normalizedMessage.includes("not available") ||
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("unsupported") ||
    normalizedMessage.includes("does not exist") ||
    normalizedMessage.includes("permission") ||
    normalizedMessage.includes("access") ||
    normalizedMessage.includes("disabled")
  );
};

const readBase64Image = (payload: unknown): string | null => {
  const record = payload as {
    data?: Array<{
      b64_json?: unknown;
    }>;
  };

  for (const item of record.data ?? []) {
    if (typeof item.b64_json === "string" && item.b64_json.trim()) {
      return item.b64_json.trim();
    }
  }

  return null;
};

const isAbortError = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError");

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutUserMessage: string,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new AppError({
        code: "openai_image_timeout",
        statusCode: 504,
        message: `OpenAI image request timed out after ${timeoutMs}ms`,
        userMessage: timeoutUserMessage,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export class OpenAIImageGenerationProvider implements ImageGenerationProvider {
  constructor(
    private readonly model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5",
    private readonly size = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024",
    private readonly timeoutMs = defaultImageTimeoutMs,
  ) {}

  private resolveModelCandidates(): string[] {
    return [...new Set([this.model, ...fallbackImageModels].map((entry) => entry.trim()).filter(Boolean))];
  }

  private async fetchSourceBlob(sourceImageUrl: string): Promise<Blob> {
    const sourceResponse = await fetchWithTimeout(
      sourceImageUrl,
      {},
      Math.min(this.timeoutMs, 30000),
      "No se pudo leer la foto original a tiempo. Intenta con una imagen mas ligera.",
    );
    if (!sourceResponse.ok) {
      const text = await sourceResponse.text().catch(() => "");
      throw new AppError({
        code: "openai_image_source_fetch_failed",
        statusCode: sourceResponse.status,
        message: text || `Failed to fetch source image (${sourceResponse.status})`,
        userMessage: "No se pudo leer la foto original para generar la variante.",
      });
    }

    return sourceResponse.blob();
  }

  private async generateWithModel(input: {
    model: string;
    prompt: string;
    sourceBlob: Blob | null;
  }): Promise<{ imageUrl: string }> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new AppError({
        code: "openai_api_key_missing",
        statusCode: 500,
        message: "OPENAI_API_KEY missing",
        userMessage: "Falta OPENAI_API_KEY para generar la imagen.",
      });
    }

    const form = new FormData();
    form.set("model", input.model);
    form.set("prompt", input.prompt);
    form.set("size", this.size);

    const endpoint = input.sourceBlob ? "https://api.openai.com/v1/images/edits" : "https://api.openai.com/v1/images/generations";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };

    if (input.sourceBlob) {
      form.set("image[]", input.sourceBlob, "source-image.png");
    } else {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers,
        body: input.sourceBlob
          ? form
          : JSON.stringify({
              model: input.model,
              prompt: input.prompt,
              size: this.size,
            }),
      },
      this.timeoutMs,
      "OpenAI tardó demasiado generando una imagen. Intenta de nuevo con menos fotos o fotos mas ligeras.",
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AppError({
        code: "openai_image_generation_failed",
        statusCode: response.status,
        message: text || `OpenAI image generation failed (${response.status})`,
        userMessage: input.sourceBlob ? "No se pudo generar la variante con OpenAI." : "No se pudo generar la imagen con OpenAI.",
        details: { model: input.model },
      });
    }

    const data = await response.json().catch(() => ({}));
    const b64 = readBase64Image(data);
    if (!b64) {
      throw new AppError({
        code: "openai_image_invalid_response",
        statusCode: 502,
        message: "OpenAI image response missing image data",
        userMessage: "OpenAI devolvio una imagen invalida.",
        details: { model: input.model },
      });
    }

    return { imageUrl: `data:image/png;base64,${b64}` };
  }

  async generateImage(input: {
    prompt: string;
    styleId: string;
    sourceImageUrl?: string | null;
  }): Promise<{ imageUrl: string }> {
    const sourceImageUrl = input.sourceImageUrl?.trim() ?? "";
    const sourceBlob = sourceImageUrl ? await this.fetchSourceBlob(sourceImageUrl) : null;
    const attemptedModels = this.resolveModelCandidates();
    let lastError: AppError | null = null;

    for (const model of attemptedModels) {
      try {
        return await this.generateWithModel({
          model,
          prompt: input.prompt,
          sourceBlob,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "openai_image_generation_failed" && shouldFallbackToNextModel(error.statusCode, error.message)) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new AppError({
      code: "openai_image_generation_failed",
      statusCode: 502,
      message: "OpenAI image generation failed for all fallback models",
      userMessage: sourceBlob ? "No se pudo generar la variante con OpenAI." : "No se pudo generar la imagen con OpenAI.",
    });
  }
}

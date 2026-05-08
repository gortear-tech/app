import { AppError } from "@fbmaniaco/shared";
import type { CaptionGenerationProvider } from "./contracts";

const getApiKey = (): string => process.env.OPENAI_API_KEY?.trim() ?? "";

const readNumber = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const defaultCaptionTimeoutMs = readNumber("OPENAI_CAPTION_TIMEOUT_MS", 60000);

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

const isAbortError = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError");

export class OpenAICaptionGenerationProvider implements CaptionGenerationProvider {
  constructor(
    private readonly model = process.env.OPENAI_CAPTION_MODEL ?? "gpt-5.4-mini",
    private readonly timeoutMs = defaultCaptionTimeoutMs,
  ) {}

  async generateCaption(input: {
    prompt: string;
    styleName: string;
    subjectDescription: string;
    businessTone: string;
    facebookSeoKeywords?: string[];
    facebookSeoContext?: string | null;
    creativeAngle?: string | null;
    visualDirection?: string | null;
    variantIndex?: number | null;
    totalVariants?: number | null;
    avoidCaptions?: string[];
  }): Promise<{ caption: string }> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new AppError({
        code: "openai_api_key_missing",
        statusCode: 500,
        message: "OPENAI_API_KEY missing",
        userMessage: "Falta OPENAI_API_KEY para generar el caption.",
      });
    }

    const seoLines =
      input.facebookSeoKeywords?.length
        ? [
            "SEO Facebook: integra de forma natural estas palabras clave, sin repetirlas de forma forzada:",
            input.facebookSeoKeywords.join(", "),
            "Especializa el texto para busqueda y descubrimiento dentro de Facebook: intencion local, frases que la gente buscaria y 1-3 hashtags utiles solo si encajan.",
            "Evita keyword stuffing, promesas exageradas, emojis excesivos y hashtags genericos sin valor.",
          ]
        : [
            "SEO Facebook: optimiza para busqueda y descubrimiento dentro de Facebook con lenguaje natural, intencion local y 1-2 hashtags utiles solo si encajan.",
          ];
    const customSeoContext = input.facebookSeoContext?.trim()
      ? [`Contexto SEO adicional del negocio: ${input.facebookSeoContext.trim()}`]
      : [];
    const creativeLines = [
      input.variantIndex && input.totalVariants
        ? `Esta es la variante ${input.variantIndex} de ${input.totalVariants}; debe sentirse distinta de las otras.`
        : "Haz que esta variante tenga un angulo creativo claro y distinto.",
      input.creativeAngle?.trim() ? `Angulo de copy: ${input.creativeAngle.trim()}` : null,
      input.visualDirection?.trim() ? `Direccion visual de la imagen: ${input.visualDirection.trim()}` : null,
      "Evita empezar siempre con las mismas palabras. Alterna entre beneficio, antojo, ocasion, ingrediente principal, cercania local o llamado a la accion.",
      "Evita frases repetidas como 'disfruta una propuesta', 'ideal para quienes buscan' y 'presentada con estilo' salvo que realmente sean la mejor opcion.",
      input.avoidCaptions?.length
        ? `No repitas estructura, palabras iniciales ni cierre de estos captions recientes: ${input.avoidCaptions.slice(-6).join(" | ")}`
        : null,
    ].filter((line): line is string => Boolean(line));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          instructions:
            "Eres un copywriter para Facebook. Devuelve solo JSON valido y nada mas. No incluyas markdown, explicaciones ni bloques de codigo.",
          input: [
            {
                      role: "user",
                      content: [
                        {
                          type: "input_text",
                          text: [
                            `Genero un caption en espanol para un negocio con tono ${input.businessTone}.`,
                            `Estilo: ${input.styleName}.`,
                            `Descripcion del sujeto: ${input.subjectDescription}.`,
                            `Prompt base: ${input.prompt}.`,
                            ...creativeLines,
                            ...seoLines,
                            ...customSeoContext,
                            "Devuelve una o dos frases maximo, claras, comerciales y naturales para Facebook. Usa como maximo 2 hashtags, y solo si aportan descubrimiento.",
                          ].join("\n"),
                        },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "caption_generation",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  caption: {
                    type: "string",
                  },
                },
                required: ["caption"],
              },
            },
          },
        }),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AppError({
          code: "openai_caption_timeout",
          statusCode: 504,
          message: `OpenAI caption request timed out after ${this.timeoutMs}ms`,
          userMessage: "OpenAI tardó demasiado generando el caption.",
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new AppError({
        code: "openai_caption_generation_failed",
        statusCode: response.status,
        message: text || `OpenAI caption request failed (${response.status})`,
        userMessage: "No se pudo generar el caption con OpenAI.",
      });
    }

    const data = await response.json().catch(() => ({}));
    const text = extractOutputText(data);
    if (!text) {
      throw new AppError({
        code: "openai_caption_invalid_response",
        statusCode: 502,
        message: "OpenAI caption response missing output text",
        userMessage: "OpenAI devolvio un caption invalido.",
      });
    }

    try {
      const parsed = JSON.parse(text) as { caption?: unknown };
      if (typeof parsed.caption !== "string" || !parsed.caption.trim()) {
        throw new Error("Caption missing in structured output");
      }

      return { caption: parsed.caption.trim() };
    } catch {
      throw new AppError({
        code: "openai_caption_invalid_response",
        statusCode: 502,
        message: "OpenAI caption response could not be parsed",
        userMessage: "OpenAI devolvio un caption invalido.",
      });
    }
  }
}

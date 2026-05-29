import type { Page, Photo } from '@cadencia/shared';
import type { ServerEnv } from './env.js';

type OpenAiResponseBody = {
  error?: {
    message?: string;
  };
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
};

type GeneratePhotoContextInput = {
  page: Page;
  photo: Photo;
};

const openAiResponsesUrl = 'https://api.openai.com/v1/responses';
const defaultVisionModel = 'gpt-4.1-mini';
const maxContextLength = 520;

export class OpenAiContextError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'OpenAiContextError';
    this.status = status;
  }
}

export function hasOpenAiContext(env: ServerEnv): boolean {
  return Boolean(env.openAiApiKey);
}

export async function generatePhotoContext(
  env: ServerEnv,
  { page, photo }: GeneratePhotoContextInput,
): Promise<string> {
  if (!env.openAiApiKey) {
    throw new OpenAiContextError('Falta OPENAI_API_KEY para generar contexto.', 503);
  }

  const response = await fetch(openAiResponsesUrl, {
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: buildContextPrompt(page),
              type: 'input_text',
            },
            {
              detail: 'low',
              image_url: photo.thumbnailUrl,
              type: 'input_image',
            },
          ],
          role: 'user',
        },
      ],
      max_output_tokens: 180,
      model: process.env.OPENAI_VISION_MODEL ?? defaultVisionModel,
    }),
    headers: {
      Authorization: `Bearer ${env.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const body = (await response.json().catch(() => ({}))) as OpenAiResponseBody;

  if (!response.ok) {
    throw new OpenAiContextError(
      body.error?.message ?? 'OpenAI no pudo generar el contexto de la foto.',
      response.status >= 500 ? 502 : response.status,
    );
  }

  const context = normalizeContext(extractOutputText(body));

  if (!context) {
    throw new OpenAiContextError('OpenAI respondio sin contexto util para la foto.');
  }

  return context;
}

function buildContextPrompt(page: Page): string {
  const keywords =
    page.settings.generation.seoKeywords.length > 0
      ? page.settings.generation.seoKeywords.join(', ')
      : 'sin palabras SEO';
  const brandVoice = page.settings.brand.voiceCustom
    ? `${page.settings.brand.voice}. ${page.settings.brand.voiceCustom}`
    : page.settings.brand.voice;

  return [
    'Describe la imagen para usarla como contexto interno de una app que crea publicaciones de Facebook.',
    'Responde solo en espanol, con una descripcion concreta de 1 a 2 frases.',
    'Incluye objetos visibles, comida/producto/ambiente y posible intencion comercial si es evidente.',
    'No inventes precios, descuentos, eventos, ubicaciones exactas, ingredientes no visibles ni promesas.',
    'Si algo no se distingue bien, dilo con cautela.',
    '',
    `Pagina: ${page.name}`,
    `Categoria: ${page.category}`,
    `Voz de marca: ${brandVoice}`,
    `Palabras SEO de referencia: ${keywords}`,
  ].join('\n');
}

function extractOutputText(body: OpenAiResponseBody): string {
  if (body.output_text) {
    return body.output_text;
  }

  return (
    body.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? '')
      .join('\n') ?? ''
  );
}

function normalizeContext(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxContextLength);
}

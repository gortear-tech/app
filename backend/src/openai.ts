import { buildImagePrompt } from '@cadencia/shared';
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

type GenerateImageVariantInput = {
  image: Buffer;
  mimeType: string;
  page: Page;
  photo: Photo;
  style: string;
};

type GeneratePublicationTextInput = {
  page: Page;
  photo: Photo;
  style: string;
};

type OpenAiImageResponseBody = {
  data?: Array<{
    b64_json?: string;
  }>;
  error?: {
    message?: string;
  };
};

const openAiResponsesUrl = 'https://api.openai.com/v1/responses';
const openAiImageEditsUrl = 'https://api.openai.com/v1/images/edits';
const defaultVisionModel = 'gpt-4.1-mini';
const defaultImageModel = 'gpt-image-2';
const defaultTextModel = 'gpt-4o-mini';
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

export async function generateImageVariant(
  env: ServerEnv,
  { image, mimeType, page, photo, style }: GenerateImageVariantInput,
): Promise<{ buffer: Buffer; mimeType: 'image/png'; prompt: string }> {
  if (!env.openAiApiKey) {
    throw new OpenAiContextError('Falta OPENAI_API_KEY para generar imagenes.', 503);
  }

  const prompt = buildImagePrompt(style);
  const form = new FormData();
  const imageBlob = new Blob([new Uint8Array(image)], {
    type: supportedInputImageMimeType(mimeType),
  });

  form.set('model', normalizeOpenAiModelName(process.env.OPENAI_IMAGE_MODEL, page.settings.generation.imageModel, defaultImageModel));
  form.set('prompt', prompt);
  form.set('image', imageBlob, fileNameForMimeType(photo.id, mimeType));
  form.set('size', '1024x1024');
  form.set('quality', 'low');

  const response = await fetch(openAiImageEditsUrl, {
    body: form,
    headers: {
      Authorization: `Bearer ${env.openAiApiKey}`,
    },
    method: 'POST',
  });
  const body = (await response.json().catch(() => ({}))) as OpenAiImageResponseBody;

  if (!response.ok) {
    throw new OpenAiContextError(
      body.error?.message ?? 'OpenAI no pudo generar la variante de imagen.',
      response.status >= 500 ? 502 : response.status,
    );
  }

  const imageBase64 = body.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new OpenAiContextError('OpenAI respondio sin imagen generada.');
  }

  return {
    buffer: Buffer.from(imageBase64, 'base64'),
    mimeType: 'image/png',
    prompt,
  };
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
      model: normalizeOpenAiModelName(process.env.OPENAI_VISION_MODEL, defaultVisionModel),
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

export async function generatePublicationText(
  env: ServerEnv,
  { page, photo, style }: GeneratePublicationTextInput,
): Promise<string> {
  if (!env.openAiApiKey) {
    throw new OpenAiContextError('Falta OPENAI_API_KEY para generar texto.', 503);
  }

  const response = await fetch(openAiResponsesUrl, {
    body: JSON.stringify({
      input: buildPublicationTextPrompt(page, photo, style),
      max_output_tokens: 260,
      model: normalizeOpenAiModelName(
        process.env.OPENAI_CAPTION_MODEL,
        page.settings.generation.textModel,
        defaultTextModel,
      ),
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
      body.error?.message ?? 'OpenAI no pudo generar el texto de publicacion.',
      response.status >= 500 ? 502 : response.status,
    );
  }

  const text = normalizeCaption(extractOutputText(body));

  if (!text) {
    throw new OpenAiContextError('OpenAI respondio sin texto util para la publicacion.');
  }

  return text;
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

function buildPublicationTextPrompt(page: Page, photo: Photo, style: string): string {
  const settings = page.settings;
  const voice = settings.brand.voiceCustom
    ? `${settings.brand.voice}. ${settings.brand.voiceCustom}`
    : settings.brand.voice;
  const keywords =
    settings.generation.seoKeywords.length > 0
      ? settings.generation.seoKeywords.join(', ')
      : 'sin palabras SEO obligatorias';
  const hashtags =
    settings.brand.defaultHashtags.length > 0
      ? settings.brand.defaultHashtags.join(' ')
      : 'sin hashtags obligatorios';
  const mentions =
    settings.brand.defaultMentions.length > 0
      ? settings.brand.defaultMentions.join(' ')
      : 'sin menciones obligatorias';
  const suffix = settings.generation.promptSuffix
    ? `Instruccion adicional: ${settings.generation.promptSuffix}`
    : 'Sin instruccion adicional.';

  return [
    'Escribe el texto final de una publicacion de Facebook para la pagina indicada.',
    'Responde solo con el copy final, sin comillas, sin explicaciones y sin lista.',
    'Debe sonar natural en espanol de Mexico, ser breve y publicable.',
    'No inventes descuentos, precios, promociones, horarios, entregas ni datos no proporcionados.',
    'Si el contexto no alcanza, mantente general y enfocate en antojo/presentacion/ambiente.',
    '',
    `Pagina: ${page.name}`,
    `Categoria: ${page.category}`,
    `Tono: ${voice}`,
    `Contexto de la foto: ${photo.context ?? photo.description ?? photo.name}`,
    `Estilo visual aplicado: ${style}`,
    `Palabras SEO: ${keywords}`,
    `Hashtags permitidos: ${hashtags}`,
    `Menciones permitidas: ${mentions}`,
    `Firma: ${settings.brand.signature || 'sin firma'}`,
    suffix,
    'Maximo 600 caracteres.',
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

function normalizeCaption(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2200);
}

function normalizeContext(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxContextLength);
}

function normalizeOpenAiModelName(...values: Array<string | undefined>): string {
  const value = values.find((item) => item?.trim());
  return (value ?? defaultTextModel).trim().replace(/_/g, '-');
}

function supportedInputImageMimeType(mimeType: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType;
  }

  return 'image/jpeg';
}

function fileNameForMimeType(photoId: string, mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${photoId}.${extension}`;
}

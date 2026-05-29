import {
  DEFAULT_PAGE_SETTINGS,
  normalizePageSettings,
  type CalendarItem,
  type Page,
  type Photo,
  type StyleHistoryEntry,
} from '@cadencia/shared';

const now = new Date();

export const demoPages: Page[] = [
  {
    id: 'page-sushi-vida',
    userId: 'demo-user',
    fbPageId: '100000000001',
    name: 'Sushi Vida Tapalpa',
    category: 'Restaurante',
    coverUrl:
      'https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=1200&q=80',
    profileUrl:
      'https://images.unsplash.com/photo-1611143669185-af224c5e3252?auto=format&fit=crop&w=400&q=80',
    settings: normalizePageSettings({
      ...DEFAULT_PAGE_SETTINGS,
      brand: {
        ...DEFAULT_PAGE_SETTINGS.brand,
        defaultHashtags: ['#SushiVidaTapalpa', '#Tapalpa'],
        signature: 'Tapalpa, Jalisco',
        voiceCustom: 'Usa modismos mexicanos cuando se sienta natural.',
      },
      generation: {
        ...DEFAULT_PAGE_SETTINGS.generation,
        seoKeywords: ['sushi', 'tapalpa', 'rollos'],
      },
    }),
  },
  {
    id: 'page-cafe-bruma',
    userId: 'demo-user',
    fbPageId: '100000000002',
    name: 'Cafe Bruma',
    category: 'Cafeteria',
    coverUrl:
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80',
    profileUrl:
      'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80',
    settings: normalizePageSettings({
      ...DEFAULT_PAGE_SETTINGS,
      brand: {
        ...DEFAULT_PAGE_SETTINGS.brand,
        defaultHashtags: ['#CafeBruma', '#Tapalpa'],
        signature: 'Cafe Bruma',
      },
      generation: {
        ...DEFAULT_PAGE_SETTINGS.generation,
        seoKeywords: ['cafe', 'postres', 'tapalpa'],
        skipReviewDefault: true,
      },
      scheduling: {
        ...DEFAULT_PAGE_SETTINGS.scheduling,
        businessHours: {
          start: '08:00',
          end: '19:00',
        },
      },
    }),
  },
];

export const demoPhotos: Photo[] = [
  createDemoPhoto({
    id: 'photo-sushi-1',
    pageId: 'page-sushi-vida',
    storagePath: 'demo/sushi/roll-spicy.jpg',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?auto=format&fit=crop&w=600&q=80',
    name: 'Roll spicy sobre madera',
    description:
      'Roll de salmon con salsa picante sobre una tabla de madera, listo para promocion de cena.',
    altText: 'Roll de sushi con salsa picante sobre tabla de madera.',
    category: 'producto',
    tags: ['sushi', 'salmon', 'madera', 'cena'],
    isFavorite: true,
    context: 'Roll de salmon con salsa picante y presentacion premium para promocion de cena.',
    contextSource: 'ai',
    createdAt: daysAgo(1),
    publicationCount: 3,
    stackId: 'stack-sushi-rolls',
    stackIsPrimary: true,
  }),
  createDemoPhoto({
    id: 'photo-sushi-2',
    pageId: 'page-sushi-vida',
    storagePath: 'demo/sushi/nigiri.jpg',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?auto=format&fit=crop&w=600&q=80',
    name: 'Nigiris frescos variados',
    description: 'Nigiris variados con pescado fresco y acabado artesanal para contenido de menu.',
    altText: 'Charola con nigiris variados.',
    category: 'producto',
    tags: ['nigiri', 'pescado', 'menu'],
    context: 'Nigiris variados con enfoque fresco y artesanal.',
    contextSource: 'manual',
    createdAt: daysAgo(2),
    nameSource: 'manual',
    qualityScore: {
      blur: 0.73,
      exposure: 0.68,
      resolution: 2400000,
    },
  }),
  createDemoPhoto({
    id: 'photo-sushi-3',
    pageId: 'page-sushi-vida',
    storagePath: 'demo/sushi/platter.jpg',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1617196035154-1e7e6e28b0db?auto=format&fit=crop&w=600&q=80',
    name: 'Tabla familiar de sushi',
    description:
      'Tabla amplia de sushi para compartir, con variedad de rollos y presentacion abundante.',
    altText: 'Tabla grande con rollos de sushi variados.',
    category: 'evento',
    tags: ['sushi', 'compartir', 'familia', 'rollos'],
    lowQuality: true,
    qualityScore: {
      blur: 0.31,
      exposure: 0.76,
      resolution: 980000,
    },
    context: null,
    contextSource: null,
    createdAt: daysAgo(4),
  }),
  createDemoPhoto({
    id: 'photo-cafe-1',
    pageId: 'page-cafe-bruma',
    storagePath: 'demo/cafe/latte.jpg',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=600&q=80',
    name: 'Latte con arte crema',
    description:
      'Latte con arte en taza blanca, fotografiado con luz suave para publicaciones de apertura.',
    altText: 'Taza de latte con arte en la espuma.',
    category: 'producto',
    tags: ['latte', 'cafe', 'manana'],
    isFavorite: true,
    context: 'Latte con arte en taza, ideal para apertura de manana.',
    contextSource: 'ai',
    createdAt: daysAgo(1),
    publicationCount: 1,
  }),
  createDemoPhoto({
    id: 'photo-cafe-2',
    pageId: 'page-cafe-bruma',
    storagePath: 'demo/cafe/pastry.jpg',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80',
    name: 'Pan dulce y cafe',
    description: 'Pan dulce recien horneado junto a cafe filtrado en una mesa clara.',
    altText: 'Pan dulce junto a una taza de cafe.',
    category: 'detalle',
    tags: ['pan dulce', 'cafe', 'horno'],
    context: 'Pan dulce recien horneado junto a cafe filtrado.',
    contextSource: 'manual',
    createdAt: daysAgo(3),
    nameSource: 'manual',
  }),
];

export const demoCalendar: CalendarItem[] = [
  {
    id: 'cal-1',
    pageId: 'page-sushi-vida',
    title: 'Roll de temporada',
    status: 'scheduled',
    scheduledAt: addHours(now, 5),
  },
  {
    id: 'cal-2',
    pageId: 'page-sushi-vida',
    title: 'Cena para dos',
    status: 'published',
    scheduledAt: daysAgo(1),
  },
  {
    id: 'cal-3',
    pageId: 'page-cafe-bruma',
    title: 'Latte de la casa',
    status: 'scheduled',
    scheduledAt: addHours(now, 8),
  },
];

export const demoStyleHistory: StyleHistoryEntry[] = [
  {
    pageId: 'page-sushi-vida',
    style: 'Mercado nocturno de Tokio',
    batchId: 'batch-demo-1',
    usedAt: daysAgo(1),
  },
  {
    pageId: 'page-sushi-vida',
    style: 'Restaurante',
    batchId: 'batch-demo-1',
    usedAt: daysAgo(2),
  },
  {
    pageId: 'page-cafe-bruma',
    style: 'Atardecer',
    batchId: 'batch-demo-2',
    usedAt: daysAgo(1),
  },
];

export function findPage(pageId: string): Page | undefined {
  return demoPages.find((page) => page.id === pageId);
}

export function photosForPage(pageId: string): Photo[] {
  return demoPhotos.filter((photo) => photo.pageId === pageId);
}

export function calendarForPage(pageId: string): CalendarItem[] {
  return demoCalendar.filter((item) => item.pageId === pageId);
}

export function styleHistoryForPage(pageId: string): StyleHistoryEntry[] {
  return demoStyleHistory.filter((item) => item.pageId === pageId);
}

function daysAgo(days: number): string {
  const date = new Date(now);
  date.setDate(now.getDate() - days);
  return date.toISOString();
}

function addHours(value: Date, hours: number): string {
  const date = new Date(value);
  date.setHours(value.getHours() + hours);
  return date.toISOString();
}

type DemoPhotoInput = Omit<
  Photo,
  | 'altText'
  | 'category'
  | 'description'
  | 'exif'
  | 'fileHash'
  | 'isFavorite'
  | 'lowQuality'
  | 'manualOverride'
  | 'name'
  | 'nameSource'
  | 'origin'
  | 'perceptualHash'
  | 'qualityScore'
  | 'stackId'
  | 'stackIsPrimary'
  | 'status'
  | 'tags'
  | 'takenAt'
  | 'trashedAt'
> &
  Partial<
    Pick<
      Photo,
      | 'altText'
      | 'category'
      | 'description'
      | 'exif'
      | 'fileHash'
      | 'isFavorite'
      | 'lowQuality'
      | 'manualOverride'
      | 'name'
      | 'nameSource'
      | 'origin'
      | 'perceptualHash'
      | 'qualityScore'
      | 'stackId'
      | 'stackIsPrimary'
      | 'status'
      | 'tags'
      | 'takenAt'
      | 'trashedAt'
    >
  >;

function createDemoPhoto(input: DemoPhotoInput): Photo {
  return {
    altText: input.altText ?? input.description ?? input.context ?? 'Foto de galeria',
    category: input.category ?? 'otro',
    description: input.description ?? input.context,
    exif: input.exif ?? {
      device: 'iPhone 15 Pro',
    },
    fileHash: input.fileHash ?? null,
    id: input.id,
    isFavorite: input.isFavorite ?? false,
    lowQuality: input.lowQuality ?? false,
    manualOverride: input.manualOverride ?? false,
    name: input.name ?? `Foto del ${new Date(input.createdAt).toLocaleDateString('es-MX')}`,
    nameSource: input.nameSource ?? 'ai',
    origin: input.origin ?? 'phone_gallery',
    pageId: input.pageId,
    perceptualHash: input.perceptualHash ?? null,
    qualityScore: input.qualityScore ?? {
      blur: 0.82,
      exposure: 0.7,
      resolution: 2600000,
    },
    stackId: input.stackId ?? null,
    stackIsPrimary: input.stackIsPrimary ?? true,
    status: input.status ?? 'active',
    storagePath: input.storagePath,
    tags: input.tags ?? [],
    takenAt: input.takenAt ?? input.createdAt,
    thumbnailUrl: input.thumbnailUrl,
    trashedAt: input.trashedAt ?? null,
    context: input.context,
    contextSource: input.contextSource,
    createdAt: input.createdAt,
    publicationCount: input.publicationCount,
  };
}

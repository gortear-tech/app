export const IMAGE_PROMPT_TEMPLATE = 'Corrige la iluminación y los colores. Cambia el fondo a {estilo}';

export const STYLE_CATALOG = [
  'Atardecer',
  'Pueblo',
  'Amanecer en la playa',
  'Feria',
  'Jungla',
  'Fiesta',
  'Fiesta mexicana',
  'Feria del pueblo',
  'Restaurante',
  'Restaurante de montaña',
  'Picnic en el río',
  'Día de campo',
  'Cabaña junto al fuego',
  'Terraza en la sierra',
  'Mercado nocturno de Tokio',
  'Bosque con neblina',
  'Cantina vintage',
  'Jardín japonés',
  'Viñedo en cosecha',
  'Muelle al amanecer',
  'Pueblo nevado',
  'Carretera entre nubes',
  'Patio colonial',
  'Templo zen con bambú',
  'Azotea con luces cálidas',
  'Tianguis de barrio',
  'Hoguera nocturna',
  'Calle empedrada',
  'Glamping estrellado',
  'Tatami con cerezos',
] as const;

export type StyleName = (typeof STYLE_CATALOG)[number];

export const STYLE_CATALOG_ITEMS = STYLE_CATALOG.map((name, index) => ({
  id: String(index + 1),
  name,
  group:
    index < 6
      ? 'Naturaleza'
      : index < 14
        ? 'Cultural mexicano'
        : index < 22
          ? 'Urbano y gastronomico'
          : 'Escenografico',
}));

export function buildImagePrompt(style: string): string {
  return IMAGE_PROMPT_TEMPLATE.replace('{estilo}', style);
}

import { activeStyleNames } from './settings.js';
import { STYLE_CATALOG } from './styles.js';
import type { PageSettings } from './types.js';
import type { PhotoVariantRequest, StyleAssignment, StyleHistoryEntry } from './types.js';
import type { RandomSource } from './random.js';
import { groupedShuffle } from './random.js';

export type AssignStylesInput = {
  activeStyles?: string[];
  pageSettings?: PageSettings;
  photos: PhotoVariantRequest[];
  recentHistory?: StyleHistoryEntry[];
  random?: RandomSource;
};

export function assignStylesToVariants({
  activeStyles,
  pageSettings,
  photos,
  recentHistory = [],
  random = Math.random,
}: AssignStylesInput): StyleAssignment[] {
  const recentScore = buildRecentScore(recentHistory);
  const catalog = resolveCatalog(activeStyles, pageSettings);
  const assignments: StyleAssignment[] = [];
  let lotUsed = new Set<string>();

  for (const photo of photos) {
    if (photo.variants < 1 || photo.variants > 10) {
      throw new RangeError('Cada foto debe pedir entre 1 y 10 variantes.');
    }

    const photoUsed = new Set<string>();

    for (let variantIndex = 0; variantIndex < photo.variants; variantIndex += 1) {
      let candidates = orderedCandidates(catalog, recentScore, random).filter((style) => {
        return !photoUsed.has(style) && !lotUsed.has(style);
      });

      if (candidates.length === 0) {
        lotUsed = new Set<string>();
        candidates = orderedCandidates(catalog, recentScore, random).filter(
          (style) => !photoUsed.has(style),
        );
      }

      const style = candidates[0];

      if (!style) {
        throw new Error('No hay estilos disponibles para asignar.');
      }

      photoUsed.add(style);
      lotUsed.add(style);
      assignments.push({
        photoId: photo.photoId,
        variantIndex,
        style,
      });
    }
  }

  return assignments;
}

function orderedCandidates(
  catalog: string[],
  recentScore: Map<string, number>,
  random: RandomSource,
): string[] {
  return groupedShuffle(
    catalog,
    (style) => recentScore.get(style) ?? 0,
    random,
  );
}

function resolveCatalog(activeStyles: string[] | undefined, pageSettings: PageSettings | undefined): string[] {
  const catalog = pageSettings
    ? activeStyleNames(pageSettings)
    : activeStyles && activeStyles.length > 0
      ? activeStyles
      : [...STYLE_CATALOG];

  if (catalog.length < 5) {
    throw new RangeError('Se necesitan al menos 5 estilos activos para asignar variantes.');
  }

  return catalog;
}

function buildRecentScore(history: StyleHistoryEntry[]): Map<string, number> {
  const score = new Map<string, number>();

  history.forEach((entry, index) => {
    const recencyWeight = history.length - index;
    score.set(entry.style, (score.get(entry.style) ?? 0) + recencyWeight);
  });

  return score;
}

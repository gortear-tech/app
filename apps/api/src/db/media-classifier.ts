import type { GalleryMediaAsset, MediaCategory, MenuItem } from "@fbmaniaco/shared";

type ClassifiableAsset = Pick<GalleryMediaAsset, "displayName" | "originalName" | "storageKey" | "categoryId">;
type ClassifiableMenuItem = Pick<MenuItem, "categoryId" | "name" | "description" | "keywords">;
type ClassifiableCategory = Pick<MediaCategory, "id" | "name" | "slug">;

export type MediaCategoryMatch = {
  categoryId: string;
  score: number;
  confidence: number;
  margin: number;
  reason: string;
};

const stopWords = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "sin",
  "un",
  "una",
  "y"
]);

export const normalizeCatalogText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokensFor = (value: string) =>
  normalizeCatalogText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopWords.has(token));

const uniqueNormalized = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map(normalizeCatalogText).filter((value) => value.length >= 2)));

const containsPhrase = (haystack: string, phrase: string) => {
  if (!haystack || !phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
};

const scoreKeyword = (keyword: string, strongText: string, storageText: string, strongTokens: Set<string>, allTokens: Set<string>) => {
  const normalized = normalizeCatalogText(keyword);
  if (!normalized) return 0;
  const keywordTokens = tokensFor(normalized);
  if (keywordTokens.length >= 2) {
    if (containsPhrase(strongText, normalized)) return 28;
    if (containsPhrase(storageText, normalized)) return 10;
    const overlap = keywordTokens.filter((token) => strongTokens.has(token)).length;
    if (overlap === keywordTokens.length) return 22;
    return overlap * 7;
  }
  const [token] = keywordTokens;
  if (!token) return 0;
  if (strongTokens.has(token)) return 12;
  if (allTokens.has(token)) return 4;
  return 0;
};

const scoreMenuItem = (input: {
  item: ClassifiableMenuItem;
  category: ClassifiableCategory;
  strongText: string;
  storageText: string;
  strongTokens: Set<string>;
  allTokens: Set<string>;
}) => {
  const itemName = normalizeCatalogText(input.item.name);
  const itemNameTokens = tokensFor(itemName);
  let score = 0;
  const reasons: string[] = [];

  if (containsPhrase(input.strongText, itemName)) {
    score += 120;
    reasons.push("nombre exacto");
  } else if (containsPhrase(input.storageText, itemName)) {
    score += 45;
    reasons.push("nombre en ruta");
  }

  if (itemNameTokens.length >= 2) {
    const strongOverlap = itemNameTokens.filter((token) => input.strongTokens.has(token)).length;
    const allOverlap = itemNameTokens.filter((token) => input.allTokens.has(token)).length;
    if (strongOverlap === itemNameTokens.length) {
      score += 70;
      reasons.push("tokens completos");
    } else if (allOverlap === itemNameTokens.length) {
      score += 35;
      reasons.push("tokens completos debiles");
    } else if (strongOverlap > 0) {
      score += strongOverlap * 12;
      reasons.push("tokens parciales");
    }
  }

  for (const keyword of uniqueNormalized([input.item.name, input.item.description, ...input.item.keywords])) {
    const keywordScore = scoreKeyword(keyword, input.strongText, input.storageText, input.strongTokens, input.allTokens);
    if (keywordScore > 0) {
      score += keywordScore;
      reasons.push(`keyword:${keyword}`);
    }
  }

  const categoryName = normalizeCatalogText(input.category.name);
  if (containsPhrase(input.strongText, categoryName)) {
    score += 18;
    reasons.push("categoria");
  }

  return { score, reason: reasons.slice(0, 3).join(", ") || "sin coincidencias" };
};

export const classifyMediaAssetCategory = (input: {
  asset: ClassifiableAsset;
  menuItems: ClassifiableMenuItem[];
  categories: ClassifiableCategory[];
  minScore?: number;
  minMargin?: number;
}): MediaCategoryMatch | null => {
  if (input.asset.categoryId) return null;

  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  if (categoryById.size === 0 || input.menuItems.length === 0) return null;

  const strongText = normalizeCatalogText([input.asset.displayName, input.asset.originalName].filter(Boolean).join(" "));
  const storageText = normalizeCatalogText(input.asset.storageKey);
  const allText = normalizeCatalogText([strongText, storageText].filter(Boolean).join(" "));
  const strongTokens = new Set(tokensFor(strongText));
  const allTokens = new Set(tokensFor(allText));
  if (strongTokens.size === 0 && allTokens.size === 0) return null;

  const byCategory = new Map<string, { score: number; reason: string }>();
  for (const item of input.menuItems) {
    if (!item.categoryId) continue;
    const category = categoryById.get(item.categoryId);
    if (!category) continue;
    const scored = scoreMenuItem({ item, category, strongText, storageText, strongTokens, allTokens });
    const current = byCategory.get(item.categoryId);
    if (!current || scored.score > current.score) {
      byCategory.set(item.categoryId, scored);
    }
  }

  const ranked = Array.from(byCategory.entries())
    .map(([categoryId, scored]) => ({ categoryId, ...scored }))
    .sort((left, right) => right.score - left.score || left.categoryId.localeCompare(right.categoryId));
  const best = ranked[0];
  if (!best) return null;

  const secondScore = ranked[1]?.score ?? 0;
  const margin = best.score - secondScore;
  const minScore = input.minScore ?? 40;
  const minMargin = input.minMargin ?? 18;
  if (best.score < minScore || margin < minMargin) return null;

  return {
    categoryId: best.categoryId,
    score: best.score,
    confidence: Math.min(0.99, Number((best.score / (best.score + Math.max(10, secondScore))).toFixed(2))),
    margin,
    reason: best.reason
  };
};

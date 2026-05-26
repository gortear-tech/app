import type { GalleryMediaAsset, MediaCategory, MediaSelection } from "@fbmaniaco/shared";

export type GalleryFilters = {
  search: string;
  categoryId: string | null;
  unused: boolean;
  archived: boolean;
  sort: "recent" | "most_used" | "name";
};

export const emptyFilters = (): GalleryFilters => ({
  search: "",
  categoryId: null,
  unused: false,
  archived: false,
  sort: "recent"
});

export const categoryName = (categories: MediaCategory[], categoryId: string | null | undefined) =>
  categories.find((category) => category.id === categoryId)?.name ?? "Sin categoria";

export const selectedAssetIds = (selection: MediaSelection | null | undefined) => selection?.assetIds ?? [];

export const nextSelectionAssetIds = (selection: MediaSelection | null | undefined, asset: GalleryMediaAsset) => {
  const current = selectedAssetIds(selection);
  return current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id];
};

export const filterAssetsLocally = (assets: GalleryMediaAsset[], filters: GalleryFilters) => {
  const term = filters.search.trim().toLocaleLowerCase("es-MX");
  const filtered = assets.filter((asset) => {
    if (filters.categoryId && asset.categoryId !== filters.categoryId) return false;
    if (filters.unused && asset.lastUsedAt) return false;
    if (!filters.archived && asset.archivedAt) return false;
    if (filters.archived && !asset.archivedAt) return false;
    if (!term) return true;
    return [asset.displayName, asset.originalName, asset.storageKey]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLocaleLowerCase("es-MX").includes(term));
  });
  return filtered.sort((a, b) => {
    if (filters.sort === "name") return (a.displayName ?? a.originalName ?? "").localeCompare(b.displayName ?? b.originalName ?? "");
    if (filters.sort === "most_used") return b.usageCount - a.usageCount;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
};

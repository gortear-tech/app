import type { GalleryMediaAsset, MediaCategory, MediaSelection } from "@fbmaniaco/shared";
import {
  createMediaSelection,
  listMediaAssets,
  listMediaCategories,
  listMediaSelections,
  updateMediaSelection
} from "../../api/client";
import { readGalleryCache, writeGalleryCache } from "../gallery/cache";

export type GalleryLoadResult = {
  assets: GalleryMediaAsset[];
  categories: MediaCategory[];
  selections: MediaSelection[];
  source: "network" | "cache";
};

export const loadGalleryOfflineFirst = async (input: {
  token: string;
  workspaceId: string;
  search?: string;
  categoryId?: string | null;
  unused?: boolean;
}): Promise<GalleryLoadResult> => {
  try {
    const filters: Parameters<typeof listMediaAssets>[1] = {
      workspaceId: input.workspaceId,
      limit: 120
    };
    if (input.search) filters.search = input.search;
    if (input.categoryId) filters.categoryId = input.categoryId;
    if (input.unused !== undefined) filters.unused = input.unused;
    const [assetsResponse, categories, selections] = await Promise.all([
      listMediaAssets(input.token, filters),
      listMediaCategories(input.token, input.workspaceId),
      listMediaSelections(input.token, input.workspaceId)
    ]);
    await writeGalleryCache(input.workspaceId, {
      assets: assetsResponse.items,
      categories,
      selections
    });
    return {
      assets: assetsResponse.items,
      categories,
      selections,
      source: "network"
    };
  } catch (error) {
    const cache = await readGalleryCache(input.workspaceId);
    const term = input.search?.trim().toLocaleLowerCase("es-MX");
    const filtered = cache.assets.filter((asset) => {
      if (input.categoryId && asset.categoryId !== input.categoryId) return false;
      if (input.unused && asset.lastUsedAt) return false;
      if (!term) return true;
      return [asset.displayName, asset.originalName, asset.storageKey]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLocaleLowerCase("es-MX").includes(term));
    });
    return {
      assets: filtered,
      categories: cache.categories,
      selections: cache.selections,
      source: "cache"
    };
  }
};

export const saveGallerySelectionOfflineFirst = async (input: {
  token: string;
  workspaceId: string;
  selection: MediaSelection | null;
  assetIds: string[];
}) => {
  const result = input.selection
    ? await updateMediaSelection(input.token, input.selection.id, { assetIds: input.assetIds })
    : await createMediaSelection(input.token, {
        workspaceId: input.workspaceId,
        name: "Seleccion movil",
        assetIds: input.assetIds
      });
  const cache = await readGalleryCache(input.workspaceId);
  const nextSelections = [
    result.selection,
    ...cache.selections.filter((selection) => selection.id !== result.selection.id)
  ];
  await writeGalleryCache(input.workspaceId, { selections: nextSelections });
  return result.selection;
};

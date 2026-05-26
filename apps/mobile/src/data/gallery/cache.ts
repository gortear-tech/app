import type { GalleryMediaAsset, MediaCategory, MediaSelection } from "@fbmaniaco/shared";
import * as FileSystem from "expo-file-system";

type GalleryCachePayload = {
  assets: GalleryMediaAsset[];
  categories: MediaCategory[];
  selections: MediaSelection[];
  updatedAt: string;
};

const cacheRoot = `${FileSystem.documentDirectory ?? ""}maniaco-gallery-cache`;
const emptyPayload = (): GalleryCachePayload => ({
  assets: [],
  categories: [],
  selections: [],
  updatedAt: new Date(0).toISOString()
});

const cachePath = (workspaceId: string) => `${cacheRoot}/${workspaceId}.json`;

const ensureCacheRoot = async () => {
  if (!FileSystem.documentDirectory) return false;
  const info = await FileSystem.getInfoAsync(cacheRoot);
  if (!info.exists) await FileSystem.makeDirectoryAsync(cacheRoot, { intermediates: true });
  return true;
};

export const readGalleryCache = async (workspaceId: string): Promise<GalleryCachePayload> => {
  if (!(await ensureCacheRoot())) return emptyPayload();
  try {
    const path = cachePath(workspaceId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return emptyPayload();
    return JSON.parse(await FileSystem.readAsStringAsync(path)) as GalleryCachePayload;
  } catch {
    return emptyPayload();
  }
};

export const writeGalleryCache = async (workspaceId: string, patch: Partial<Omit<GalleryCachePayload, "updatedAt">>) => {
  if (!(await ensureCacheRoot())) return;
  const current = await readGalleryCache(workspaceId);
  const next: GalleryCachePayload = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await FileSystem.writeAsStringAsync(cachePath(workspaceId), JSON.stringify(next));
};

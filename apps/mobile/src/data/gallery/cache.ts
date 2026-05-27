import type { GalleryMediaAsset, MediaCategory, MediaSelection } from "@fbmaniaco/shared";
import * as FileSystem from "expo-file-system";

export type CachedGalleryMediaAsset = GalleryMediaAsset & {
  localThumbnailUrl?: string | null;
  localPreviewUrl?: string | null;
  imageCacheKey?: string | null;
};

type GalleryCachePayload = {
  assets: CachedGalleryMediaAsset[];
  categories: MediaCategory[];
  selections: MediaSelection[];
  updatedAt: string;
};

const cacheRoot = `${FileSystem.documentDirectory ?? ""}maniaco-gallery-cache`;
const mediaRoot = `${FileSystem.documentDirectory ?? ""}maniaco-gallery-media`;
const emptyPayload = (): GalleryCachePayload => ({
  assets: [],
  categories: [],
  selections: [],
  updatedAt: new Date(0).toISOString()
});

const cachePath = (workspaceId: string) => `${cacheRoot}/${workspaceId}.json`;
const mediaDirectory = (workspaceId: string) => `${mediaRoot}/${encodeURIComponent(workspaceId)}`;
const imageCacheKey = (asset: GalleryMediaAsset) =>
  [asset.id, asset.status, asset.updatedAt, asset.processedAt ?? "", asset.thumbPath ?? "", asset.previewPath ?? ""].join(":");
const fileSafeKey = (asset: GalleryMediaAsset) => encodeURIComponent(imageCacheKey(asset)).replace(/%/g, "");
const imagePath = (workspaceId: string, asset: GalleryMediaAsset, kind: "thumb" | "preview") =>
  `${mediaDirectory(workspaceId)}/${encodeURIComponent(asset.id)}-${kind}-${fileSafeKey(asset)}.webp`;
const imageFileName = (workspaceId: string, asset: GalleryMediaAsset, kind: "thumb" | "preview") =>
  imagePath(workspaceId, asset, kind).split("/").pop() ?? "";

const ensureCacheRoot = async () => {
  if (!FileSystem.documentDirectory) return false;
  const info = await FileSystem.getInfoAsync(cacheRoot);
  if (!info.exists) await FileSystem.makeDirectoryAsync(cacheRoot, { intermediates: true });
  return true;
};

const ensureMediaRoot = async (workspaceId: string) => {
  if (!FileSystem.documentDirectory) return false;
  const rootInfo = await FileSystem.getInfoAsync(mediaRoot);
  if (!rootInfo.exists) await FileSystem.makeDirectoryAsync(mediaRoot, { intermediates: true });
  const directory = mediaDirectory(workspaceId);
  const directoryInfo = await FileSystem.getInfoAsync(directory);
  if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return true;
};

const existingFileUri = async (path: string) => {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
};

const downloadImageIfNeeded = async (uri: string | null | undefined, path: string) => {
  if (!uri?.startsWith("http")) return existingFileUri(path);
  const existing = await existingFileUri(path);
  if (existing) return existing;
  try {
    const downloaded = await FileSystem.downloadAsync(uri, path);
    return downloaded.status >= 200 && downloaded.status < 300 ? downloaded.uri : null;
  } catch {
    return null;
  }
};

const hydrateGalleryAssetsFromDisk = async (workspaceId: string, assets: GalleryMediaAsset[]) => {
  if (!(await ensureMediaRoot(workspaceId))) return assets as CachedGalleryMediaAsset[];
  const hydrateAsset = async (asset: GalleryMediaAsset): Promise<CachedGalleryMediaAsset> => {
    const key = imageCacheKey(asset);
    if (asset.status !== "ready") {
      return { ...asset, imageCacheKey: key, localThumbnailUrl: null, localPreviewUrl: null };
    }
    const thumbPath = imagePath(workspaceId, asset, "thumb");
    const previewPath = imagePath(workspaceId, asset, "preview");
    const [localThumbnailUrl, localPreviewUrl] = await Promise.all([existingFileUri(thumbPath), existingFileUri(previewPath)]);
    return {
      ...asset,
      imageCacheKey: key,
      localThumbnailUrl,
      localPreviewUrl
    };
  };
  const hydrated: CachedGalleryMediaAsset[] = [];
  for (let index = 0; index < assets.length; index += 6) {
    hydrated.push(...(await Promise.all(assets.slice(index, index + 6).map(hydrateAsset))));
  }
  return hydrated;
};

export const prefetchGalleryThumbnails = async (workspaceId: string, assets: GalleryMediaAsset[]) => {
  if (!(await ensureMediaRoot(workspaceId))) return;
  const directory = mediaDirectory(workspaceId);
  const keep = new Set(assets.flatMap((asset) => [imageFileName(workspaceId, asset, "thumb"), imageFileName(workspaceId, asset, "preview")]));
  const existing = await FileSystem.readDirectoryAsync(directory).catch(() => []);
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".webp") && !keep.has(name))
      .slice(0, 50)
      .map((name) => FileSystem.deleteAsync(`${directory}/${name}`, { idempotent: true }).catch(() => undefined))
  );
  const readyAssets = assets.filter((asset) => asset.status === "ready");
  for (let index = 0; index < readyAssets.length; index += 4) {
    await Promise.all(
      readyAssets.slice(index, index + 4).map(async (asset) => {
        const thumbPath = imagePath(workspaceId, asset, "thumb");
        await downloadImageIfNeeded(asset.thumbnailUrl ?? asset.previewUrl, thumbPath);
      })
    );
  }
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

export const prepareGalleryAssetsForPhone = async (workspaceId: string, assets: GalleryMediaAsset[]) =>
  hydrateGalleryAssetsFromDisk(workspaceId, assets);

export const readGalleryAssetsForPhone = async (workspaceId: string, assets: GalleryMediaAsset[]) =>
  hydrateGalleryAssetsFromDisk(workspaceId, assets);

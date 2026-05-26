import { describe, expect, it } from "vitest";
import type { GalleryMediaAsset, MediaSelection } from "@fbmaniaco/shared";
import { filterAssetsLocally, nextSelectionAssetIds } from "./gallery";

const asset = (patch: Partial<GalleryMediaAsset>): GalleryMediaAsset => ({
  id: patch.id ?? "asset-1",
  workspaceId: "workspace-1",
  kind: "original",
  bucket: "business-media",
  storageKey: patch.storageKey ?? "workspace/assets/a/full.jpg",
  mimeType: "image/jpeg",
  fileSize: 1,
  isPublic: false,
  sha256: null,
  phash: null,
  displayName: patch.displayName ?? null,
  originalName: patch.originalName ?? null,
  categoryId: patch.categoryId ?? null,
  width: null,
  height: null,
  bytes: null,
  thumbPath: null,
  previewPath: null,
  fullPath: null,
  usageCount: patch.usageCount ?? 0,
  lastUsedAt: patch.lastUsedAt ?? null,
  archivedAt: patch.archivedAt ?? null,
  status: patch.status ?? "ready",
  errorReason: null,
  processedAt: null,
  createdAt: patch.createdAt ?? "2026-05-01T00:00:00.000Z",
  updatedAt: patch.updatedAt ?? "2026-05-01T00:00:00.000Z"
});

describe("gallery helpers", () => {
  it("toggles asset ids without duplicating the selection", () => {
    const selection = { assetIds: ["a", "b"] } as MediaSelection;
    expect(nextSelectionAssetIds(selection, asset({ id: "c" }))).toEqual(["a", "b", "c"]);
    expect(nextSelectionAssetIds(selection, asset({ id: "a" }))).toEqual(["b"]);
  });

  it("filters assets by search, usage and archived state", () => {
    const assets = [
      asset({ id: "a", displayName: "Charola mayo", lastUsedAt: null }),
      asset({ id: "b", displayName: "Sushi noche", lastUsedAt: "2026-05-02T00:00:00.000Z" }),
      asset({ id: "c", displayName: "Charola vieja", archivedAt: "2026-05-03T00:00:00.000Z" })
    ];
    expect(filterAssetsLocally(assets, { search: "charola", categoryId: null, unused: true, archived: false, sort: "recent" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterAssetsLocally(assets, { search: "", categoryId: null, unused: false, archived: true, sort: "recent" }).map((item) => item.id)).toEqual(["c"]);
  });
});

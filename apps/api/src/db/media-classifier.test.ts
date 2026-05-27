import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { GalleryMediaAsset, MediaCategory, MenuItem } from "@fbmaniaco/shared";
import { LocalDataStore } from "./local-store.js";
import { classifyMediaAssetCategory } from "./media-classifier.js";

const category = (id: string, name: string, sortOrder: number): MediaCategory => ({
  id,
  workspaceId: "workspace-sushi",
  name,
  slug: name.toLowerCase(),
  color: null,
  sortOrder,
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z"
});

const categories = [
  category("extras", "Extras", 0),
  category("esferas", "Esferas", 1),
  category("especiales", "Especiales", 2),
  category("onigiris", "Onigiris", 3),
  category("platillos", "Platillos", 4),
  category("sushi", "Sushi", 5)
];

const item = (categoryId: string, name: string, keywords: string[]): MenuItem => ({
  id: `${categoryId}-${name}`,
  workspaceId: "workspace-sushi",
  categoryId,
  name,
  description: null,
  priceCents: null,
  keywords,
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z"
});

const menuItems = [
  item("extras", "Extra Camaron", ["extra", "camaron"]),
  item("esferas", "Esfera California de camaron", ["esfera", "california", "camaron"]),
  item("esferas", "Esfera empanizada de surimi", ["esfera", "empanizado", "surimi"]),
  item("especiales", "Sushi grenudo", ["sushi", "grenudo", "especial"]),
  item("onigiris", "Onigiri empanizado de surimi", ["onigiri", "empanizado", "surimi"]),
  item("platillos", "Yakimeshi de camaron", ["yakimeshi", "camaron", "platillo"]),
  item("sushi", "Sushi California de camaron", ["sushi", "california", "camaron"]),
  item("sushi", "Sushi empanizado de surimi", ["sushi", "empanizado", "surimi"])
];

const asset = (name: string): GalleryMediaAsset => ({
  id: `asset-${name}`,
  workspaceId: "workspace-sushi",
  kind: "original",
  bucket: "business-media",
  storageKey: `workspace-sushi/assets/${name}/full.jpg`,
  mimeType: "image/jpeg",
  fileSize: 1000,
  isPublic: false,
  sha256: null,
  phash: null,
  displayName: null,
  originalName: name,
  categoryId: null,
  width: 1200,
  height: 900,
  bytes: 1000,
  thumbPath: null,
  previewPath: null,
  fullPath: null,
  usageCount: 0,
  lastUsedAt: null,
  archivedAt: null,
  status: "ready",
  errorReason: null,
  processedAt: "2026-05-26T00:00:00.000Z",
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z"
});

const classify = (name: string) =>
  classifyMediaAssetCategory({
    asset: asset(name),
    menuItems,
    categories
  })?.categoryId ?? null;

describe("media classifier", () => {
  it("classifies specific Sushi Vida product filenames into the right menu categories", () => {
    expect(classify("sushi-california-camaron.jpg")).toBe("sushi");
    expect(classify("yakimeshi-camaron.jpg")).toBe("platillos");
    expect(classify("onigiri-empanizado-surimi.jpg")).toBe("onigiris");
    expect(classify("sushi-grenudo.jpg")).toBe("especiales");
    expect(classify("extra-camaron.jpg")).toBe("extras");
  });

  it("leaves ambiguous filenames uncategorized instead of guessing", () => {
    expect(classify("camaron.jpg")).toBeNull();
    expect(classify("california-camaron.jpg")).toBeNull();
    expect(classify("empanizado-surimi.jpg")).toBeNull();
  });

  it("does not overwrite manually categorized assets", () => {
    const result = classifyMediaAssetCategory({
      asset: { ...asset("yakimeshi-camaron.jpg"), categoryId: "sushi" },
      menuItems,
      categories
    });
    expect(result).toBeNull();
  });

  it("keeps batch-uploaded base photos classifiable in the gallery", async () => {
    const path = join(tmpdir(), `fbmaniaco-batch-classifier-${Date.now()}.json`);
    const store = new LocalDataStore(path);
    await store.upsertLocalUser({ userId: "batch-classifier-user", email: "batch-classifier@example.com" });
    const { workspace } = await store.ensureDefaultWorkspace("batch-classifier-user");
    await store.upsertMockMetaAuthorization({ workspaceId: workspace.id, actorId: "batch-classifier-user" });
    const page = (await store.listMetaPages(workspace.id)).find((item) => item.canPublish);
    if (!page) throw new Error("Missing selectable mock page");
    const business = await store.selectMetaPage({
      workspaceId: workspace.id,
      actorId: "batch-classifier-user",
      pageId: page.id,
      requestId: "batch-classifier-page"
    });

    await store.completeMenuIngest({
      jobId: "batch-classifier-menu",
      workspaceId: workspace.id,
      result: {
        schemaVersion: "menu_parse_result.v1",
        categories: ["Sushi", "Platillos"],
        warnings: [],
        items: [
          {
            name: "Sushi California de camaron",
            description: null,
            priceCents: 9000,
            categoryName: "Sushi",
            keywords: ["sushi", "california", "camaron"]
          },
          {
            name: "Yakimeshi de camaron",
            description: null,
            priceCents: 10000,
            categoryName: "Platillos",
            keywords: ["yakimeshi", "camaron"]
          }
        ]
      }
    });

    const batch = await store.createBatch({
      workspaceId: workspace.id,
      businessId: business.id,
      actorId: "batch-classifier-user",
      requestId: "batch-classifier-create"
    });
    const intent = await store.createUploadIntent({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      originalFileName: "sushi-california-camaron.jpg",
      contentType: "image/jpeg",
      fileSize: 1234
    });
    const completed = await store.completeUpload({
      workspaceId: workspace.id,
      businessId: business.id,
      batchId: batch.id,
      storageKey: intent.storageKey,
      originalFileName: "sushi-california-camaron.jpg",
      contentType: "image/jpeg",
      fileSize: 1234,
      actorId: "batch-classifier-user",
      requestId: "batch-classifier-complete"
    });

    const categories = await store.listMediaCategories({ workspaceId: workspace.id });
    const sushi = categories.find((item) => item.name === "Sushi");
    const originalAssetId = completed.photo.originalAssetId;
    if (!originalAssetId) throw new Error("Batch upload did not link an original asset");
    const originalAsset = await store.getMediaAsset({ assetId: originalAssetId });
    const listed = await store.listMediaAssets({ workspaceId: workspace.id });

    expect(originalAsset?.originalName).toBe("sushi-california-camaron.jpg");
    expect(originalAsset?.displayName).toMatch(/^sushi_\d{4}-\d{2}_001\.jpg$/);
    expect(originalAsset?.categoryId).toBe(sushi?.id);
    expect(listed.items.find((item) => item.id === originalAssetId)?.categoryId).toBe(sushi?.id);

    await rm(path, { force: true });
  });
});

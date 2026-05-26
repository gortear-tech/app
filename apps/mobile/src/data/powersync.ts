import { column, PowerSyncDatabase, Schema, Table, type PowerSyncBackendConnector } from "@powersync/react-native";
import { OPSqliteOpenFactory } from "@powersync/op-sqlite";
import { getStoredSessionToken } from "../api/client";

export const galleryPowerSyncSchema = new Schema({
  media_assets: new Table(
    {
      workspace_id: column.text,
      business_id: column.text,
      kind: column.text,
      bucket: column.text,
      storage_key: column.text,
      mime_type: column.text,
      file_size: column.integer,
      sha256: column.text,
      display_name: column.text,
      original_name: column.text,
      category_id: column.text,
      thumb_path: column.text,
      preview_path: column.text,
      full_path: column.text,
      usage_count: column.integer,
      last_used_at: column.text,
      archived_at: column.text,
      status: column.text,
      updated_at: column.text,
      created_at: column.text
    },
    { indexes: { workspaceStatus: ["workspace_id", "status"], category: ["category_id"], recent: ["updated_at"] } }
  ),
  media_categories: new Table(
    {
      workspace_id: column.text,
      name: column.text,
      slug: column.text,
      color: column.text,
      sort_order: column.integer,
      updated_at: column.text,
      created_at: column.text
    },
    { indexes: { workspaceSlug: ["workspace_id", "slug"] } }
  ),
  media_selections: new Table(
    {
      workspace_id: column.text,
      user_id: column.text,
      name: column.text,
      asset_ids: column.text,
      metadata: column.text,
      status: column.text,
      updated_at: column.text,
      created_at: column.text
    },
    { indexes: { workspaceUser: ["workspace_id", "user_id"], status: ["status"] } }
  ),
  media_tags: new Table(
    {
      workspace_id: column.text,
      name: column.text,
      created_at: column.text
    },
    { indexes: { workspaceName: ["workspace_id", "name"] } }
  ),
  media_asset_tags: new Table(
    {
      asset_id: column.text,
      tag_id: column.text
    },
    { indexes: { asset: ["asset_id"], tag: ["tag_id"] } }
  )
});

export const isPowerSyncConfigured = () => Boolean(process.env.EXPO_PUBLIC_POWERSYNC_URL);

export const createGalleryPowerSyncDatabase = () =>
  new PowerSyncDatabase({
    schema: galleryPowerSyncSchema,
    database: new OPSqliteOpenFactory({ dbFilename: "maniaco-gallery.sqlite" })
  });

export const createGalleryPowerSyncConnector = (): PowerSyncBackendConnector => ({
  fetchCredentials: async () => {
    const endpoint = process.env.EXPO_PUBLIC_POWERSYNC_URL;
    const token = await getStoredSessionToken();
    if (!endpoint || !token) return null;
    return { endpoint, token };
  },
  uploadData: async () => {
    // Fase 2 conserva las escrituras por REST para upload-intent/complete-upload.
    // Cuando activemos PowerSync Cloud, este metodo subira cambios CRUD locales.
  }
});

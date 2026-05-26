import { column, PowerSyncDatabase, Schema, Table, type PowerSyncBackendConnector } from "@powersync/web";
import { getWebConfig } from "../config";
import { ensureFreshWebSession, readWebSession, saveWebSession } from "../auth/session";

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
  ),
  media_asset_fb_uploads: new Table(
    {
      asset_id: column.text,
      facebook_page_id: column.text,
      fb_photo_id: column.text,
      uploaded_at: column.text,
      last_used_at: column.text
    },
    { indexes: { asset: ["asset_id"], page: ["facebook_page_id"] } }
  )
});

let db: PowerSyncDatabase | null = null;
let didConnect = false;

export const isPowerSyncConfigured = () => Boolean(getWebConfig().powerSyncUrl);

export const getGalleryPowerSyncDatabase = () => {
  if (!db) {
    db = new PowerSyncDatabase({
      schema: galleryPowerSyncSchema,
      database: { dbFilename: "maniaco-web-gallery.sqlite" },
      flags: { enableMultiTabs: typeof SharedWorker !== "undefined" }
    });
  }
  return db;
};

export const createGalleryPowerSyncConnector = (): PowerSyncBackendConnector => ({
  fetchCredentials: async () => {
    const endpoint = getWebConfig().powerSyncUrl;
    const session = readWebSession();
    if (!endpoint || !session) return null;
    const fresh = await ensureFreshWebSession(session);
    saveWebSession(fresh);
    return { endpoint, token: fresh.accessToken };
  },
  uploadData: async () => {
    // Fase 4 mantiene escrituras de galeria por REST; PowerSync queda como replica local/reactiva.
  }
});

export const connectGalleryPowerSync = async () => {
  if (!isPowerSyncConfigured() || didConnect) return false;
  await getGalleryPowerSyncDatabase().connect(createGalleryPowerSyncConnector());
  didConnect = true;
  return true;
};

import { ApiConfig } from "../config.js";
import { LocalDataStore } from "./local-store.js";
import { createSupabaseDataStore } from "./supabase-store.js";
import { DataStore } from "./types.js";

export const createDataStore = (config: ApiConfig): DataStore => {
  if (config.dataStoreMode === "supabase") {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required when DATA_STORE_MODE=supabase.");
    }
    return createSupabaseDataStore(config.databaseUrl);
  }
  if (!config.allowLocalDataStore) {
    throw new Error("Local DataStore is disabled for this environment. Set ALLOW_LOCAL_DATASTORE=true only for controlled mocks.");
  }
  return new LocalDataStore(config.localDbPath);
};

export * from "./types.js";

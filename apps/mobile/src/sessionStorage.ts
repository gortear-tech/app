import { mobileRuntimeConfig } from "./mobileRuntimeConfig";

const STORAGE_NAMESPACE = mobileRuntimeConfig.storageNamespace;
const META_TOKEN_KEY = `${STORAGE_NAMESPACE}.metaToken`;
const SELECTED_PAGE_KEY = `${STORAGE_NAMESPACE}.selectedPageId`;
const SELECTED_BUSINESS_KEY = `${STORAGE_NAMESPACE}.selectedBusinessId`;
const SEEN_WELCOME_PREFIX = `${STORAGE_NAMESPACE}.seenWelcome.`;

const memoryFallback = new Map<string, string>();
const isWeb = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
let secureStoreModule: typeof import("expo-secure-store") | null = null;

async function getSecureStore() {
  if (secureStoreModule) {
    return secureStoreModule;
  }
  secureStoreModule = await import("expo-secure-store");
  return secureStoreModule;
}

async function read(key: string): Promise<string | null> {
  if (isWeb) {
    return globalThis.localStorage?.getItem(key) ?? memoryFallback.get(key) ?? null;
  }

  try {
    const SecureStore = await getSecureStore();
    return await SecureStore.getItemAsync(key);
  } catch {
    return memoryFallback.get(key) ?? globalThis.localStorage?.getItem(key) ?? null;
  }
}

async function write(key: string, value: string | null): Promise<void> {
  if (isWeb) {
    if (value === null) {
      memoryFallback.delete(key);
      globalThis.localStorage?.removeItem(key);
    } else {
      memoryFallback.set(key, value);
      globalThis.localStorage?.setItem(key, value);
    }
    return;
  }

  try {
    const SecureStore = await getSecureStore();
    if (value === null) {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    if (value === null) {
      memoryFallback.delete(key);
      globalThis.localStorage?.removeItem(key);
    } else {
      memoryFallback.set(key, value);
      globalThis.localStorage?.setItem(key, value);
    }
  }
}

export const sessionStorage = {
  getMetaToken: () => read(META_TOKEN_KEY),
  setMetaToken: (value: string | null) => write(META_TOKEN_KEY, value),
  getSelectedPageId: () => read(SELECTED_PAGE_KEY),
  setSelectedPageId: (value: string | null) => write(SELECTED_PAGE_KEY, value),
  getSelectedBusinessId: () => read(SELECTED_BUSINESS_KEY),
  setSelectedBusinessId: (value: string | null) => write(SELECTED_BUSINESS_KEY, value),
  hasSeenWelcome: (businessId: string) => read(`${SEEN_WELCOME_PREFIX}${businessId}`).then((value) => value === "1"),
  markWelcomeSeen: (businessId: string) => write(`${SEEN_WELCOME_PREFIX}${businessId}`, "1"),
  clearAll: async () => {
    await Promise.all([
      write(META_TOKEN_KEY, null),
      write(SELECTED_PAGE_KEY, null),
      write(SELECTED_BUSINESS_KEY, null),
    ]);
  },
};

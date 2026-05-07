import Constants from "expo-constants";

type AppExtra = {
  apiUrl?: string;
  bootstrapToken?: string;
  allowTestBootstrap?: boolean;
  buildVariant?: string;
  runtimeChannel?: string;
  storageNamespace?: string;
};

function readExtra(): AppExtra {
  const extra = Constants.expoConfig?.extra;
  if (!extra || typeof extra !== "object") {
    return {};
  }
  return extra as AppExtra;
}

const extra = readExtra();

export const mobileRuntimeConfig = {
  apiUrl: extra.apiUrl ?? "http://localhost:4101",
  bootstrapToken: extra.bootstrapToken ?? "",
  allowTestBootstrap: extra.allowTestBootstrap ?? false,
  buildVariant: extra.buildVariant ?? "development",
  runtimeChannel: extra.runtimeChannel ?? "test",
  storageNamespace: extra.storageNamespace ?? "fbmaniaco.test",
};

import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system";
import { uploadGalleryAsset } from "../api/client";
import { sha256OfFile } from "../data/gallery/hash";
import { createUploadQueue, OfflineUploadFile, OfflineUploadJob, UploadQueueStorage } from "./uploadQueueCore";

const queueRoot = `${FileSystem.documentDirectory ?? ""}maniaco-upload-queue`;

const queuePath = (workspaceId: string) => `${queueRoot}/${workspaceId}.json`;

const ensureQueueRoot = async () => {
  if (!FileSystem.documentDirectory) return false;
  const info = await FileSystem.getInfoAsync(queueRoot);
  if (!info.exists) await FileSystem.makeDirectoryAsync(queueRoot, { intermediates: true });
  return true;
};

const workspaceStorage = (workspaceId: string): UploadQueueStorage => ({
  list: async () => {
    if (!(await ensureQueueRoot())) return [];
    try {
      const path = queuePath(workspaceId);
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return [];
      return JSON.parse(await FileSystem.readAsStringAsync(path)) as OfflineUploadJob[];
    } catch {
      return [];
    }
  },
  save: async (jobs) => {
    if (!(await ensureQueueRoot())) return;
    await FileSystem.writeAsStringAsync(queuePath(workspaceId), JSON.stringify(jobs));
  }
});

const persistUploadFile = async (workspaceId: string, file: OfflineUploadFile, index: number): Promise<OfflineUploadFile> => {
  if (!FileSystem.documentDirectory) return file;
  const directory = `${queueRoot}/${workspaceId}-files`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
  const target = `${directory}/${Date.now()}-${index}${extension}`;
  await FileSystem.copyAsync({ from: file.uri, to: target });
  return { ...file, uri: target };
};

const removePersistedUploadFile = async (uri: string) => {
  if (!uri.startsWith(queueRoot)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
};

export const enqueueGalleryUploads = async (input: {
  token: string;
  workspaceId: string;
  businessId: string;
  files: OfflineUploadFile[];
  onProgress?: (done: number, total: number) => void;
}) => {
  const persisted: OfflineUploadFile[] = [];
  for (const [index, file] of input.files.entries()) {
    persisted.push(await persistUploadFile(input.workspaceId, file, index));
  }
  const storage = workspaceStorage(input.workspaceId);
  const queue = createUploadQueue(storage, {
    isOnline: async () => {
      const state = await NetInfo.fetch();
      return state.isConnected !== false && state.isInternetReachable !== false;
    },
    hash: (file) => sha256OfFile(file.uri),
    upload: async (file, sha256) => {
      await uploadGalleryAsset(input.token, input.businessId, file, sha256, input.workspaceId);
      await removePersistedUploadFile(file.uri);
      const queued = await storage.list();
      const done = queued.filter((job) => job.status === "done").length + 1;
      input.onProgress?.(done, Math.max(queued.length, input.files.length));
    }
  });
  const jobs = await queue.enqueue({ workspaceId: input.workspaceId, businessId: input.businessId, files: persisted });
  const result = await queue.drain();
  return { jobs, result };
};

export const drainGalleryUploadQueue = async (input: {
  token: string;
  workspaceId: string;
  businessId: string;
}) => {
  const storage = workspaceStorage(input.workspaceId);
  const queue = createUploadQueue(storage, {
    isOnline: async () => {
      const state = await NetInfo.fetch();
      return state.isConnected !== false && state.isInternetReachable !== false;
    },
    hash: (file) => sha256OfFile(file.uri),
    upload: async (file, sha256) => {
      await uploadGalleryAsset(input.token, input.businessId, file, sha256, input.workspaceId);
      await removePersistedUploadFile(file.uri);
    }
  });
  return queue.drain();
};

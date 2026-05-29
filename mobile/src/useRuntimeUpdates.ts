import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

const updateCheckIntervalMs = 30 * 60 * 1000;

export function useRuntimeUpdates() {
  useEffect(() => {
    if (Platform.OS === 'web' || !Updates.isEnabled) {
      return undefined;
    }

    let cancelled = false;
    let running = false;
    let lastCheckedAt = 0;

    async function checkForRuntimeUpdate() {
      const now = Date.now();

      if (running || now - lastCheckedAt < updateCheckIntervalMs) {
        return;
      }

      running = true;
      lastCheckedAt = now;

      try {
        const update = await Updates.checkForUpdateAsync();

        if (!cancelled && update.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();

          if (!cancelled && fetched.isNew) {
            await Updates.reloadAsync();
          }
        }
      } catch {
        // Updates are opportunistic; the embedded bundle must stay usable offline.
      } finally {
        running = false;
      }
    }

    void checkForRuntimeUpdate();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void checkForRuntimeUpdate();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}

import * as Sentry from "@sentry/react-native";
import { getMobileConfig } from "./config";

let initialized = false;

export const initMobileSentry = () => {
  if (initialized) return;
  initialized = true;
  const config = getMobileConfig();
  if (!config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.appEnv,
    enableNative: true,
    tracesSampleRate: config.appEnv === "production" ? 0.1 : 0
  });
};

export const captureMobileException = (error: unknown, context?: Record<string, unknown>) => {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
};

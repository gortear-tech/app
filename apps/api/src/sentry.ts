import * as Sentry from "@sentry/node";

let initialized = false;

export const initSentry = (input: { dsn?: string | undefined; environment: string; release: string; service: string }) => {
  if (!input.dsn || initialized) return false;
  Sentry.init({
    dsn: input.dsn,
    environment: input.environment,
    release: input.release,
    serverName: input.service,
    tracesSampleRate: 0.05
  });
  initialized = true;
  return true;
};

export const captureException = (error: unknown, context?: Record<string, unknown>) => {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) scope.setContext("fbmaniaco", context);
    Sentry.captureException(error);
  });
};

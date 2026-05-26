import { loadConfig } from "./config.js";
import { createDataStore } from "./db/index.js";
import { buildServer } from "./server.js";
import { initSentry } from "./sentry.js";

const config = loadConfig();
initSentry({ dsn: process.env.SENTRY_DSN, environment: config.appEnv, release: config.release, service: "api" });
const store = createDataStore(config);
const app = await buildServer({ config, store });

await app.listen({ host: config.host, port: config.port });

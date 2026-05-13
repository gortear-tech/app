import { loadConfig } from "./config.js";
import { createDataStore } from "./db/index.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const store = createDataStore(config);
const app = await buildServer({ config, store });

await app.listen({ host: config.host, port: config.port });

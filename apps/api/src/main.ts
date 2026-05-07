import { buildApp } from "./app";
import { config } from "./config";

const start = async () => {
  const app = buildApp();
  await app.listen({ host: config.host, port: config.port });
};

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


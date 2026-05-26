import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@powersync/web"]
  },
  worker: {
    format: "es"
  },
  server: {
    port: 4174
  },
  preview: {
    port: 4175
  },
  test: {
    environment: "node",
    globals: true
  }
});

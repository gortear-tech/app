import * as Sentry from "@sentry/browser";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getWebConfig } from "./config";
import "./styles.css";

const config = getWebConfig();

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    tracesSampleRate: 0.1
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

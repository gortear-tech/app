import type { BootstrapStatusResponse } from "@fbmaniaco/shared";

export type ScreenKey =
  | "boot"
  | "token"
  | "pages"
  | "welcome"
  | "home"
  | "batch"
  | "calendar"
  | "settings"
  | "styles"
  | "report"
  | "reconnect";

export function resolveInitialScreen(status: BootstrapStatusResponse | null): ScreenKey {
  if (!status) return "boot";
  if (status.nextStep === "connect_meta" || status.nextStep === "recover_meta") return "token";
  if (status.nextStep === "select_page") return "pages";
  return "home";
}

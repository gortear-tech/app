import { sessionStorage } from "./sessionStorage";

export const businessSettingsStorage = {
  getSelectedPageId: sessionStorage.getSelectedPageId,
  setSelectedPageId: sessionStorage.setSelectedPageId,
  getSelectedBusinessId: sessionStorage.getSelectedBusinessId,
  setSelectedBusinessId: sessionStorage.setSelectedBusinessId,
};

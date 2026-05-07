import { sessionStorage } from "./sessionStorage";

export async function saveMetaToken(token: string): Promise<void> {
  await sessionStorage.setMetaToken(token);
}

export async function clearMetaToken(): Promise<void> {
  await sessionStorage.setMetaToken(null);
}

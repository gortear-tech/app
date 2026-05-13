import { randomUUID } from "node:crypto";

const safeRequestId = /^[a-zA-Z0-9_.:-]{8,80}$/;

export const getRequestId = (incoming: unknown) => {
  if (typeof incoming === "string" && safeRequestId.test(incoming)) return incoming;
  return randomUUID();
};

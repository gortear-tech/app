import type { FacebookPageConnection } from "./facebook";
import type { FacebookTokenStatus, UserStatus } from "./states";

export interface PublicUser {
  id: string;
  email: string;
  status: UserStatus;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sessionId: string;
}

export interface BootstrapStatusResponse {
  hasUsers: boolean;
  hasActiveSession: boolean;
  hasSelectedBusiness: boolean;
  facebookTokenStatus: FacebookTokenStatus | null;
  canAutoConnectMeta: boolean;
  requiresManualToken: boolean;
  nextStep: "connect_meta" | "select_page" | "home" | "recover_meta";
}

export interface MeResponse {
  user: PublicUser;
}

export interface MetaTokenPayload {
  token: string;
  source: "auto" | "manual" | "refresh";
}

export interface MetaDeviceLoginResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface MetaTokenConnectionResponse {
  token: string;
  status: BootstrapStatusResponse;
  pages: FacebookPageConnection[];
}

export interface MetaAutoConnectResponse extends MetaTokenConnectionResponse {
  pendingDeviceLogin?: MetaDeviceLoginResponse | null;
  message?: string | null;
}

import { Static, Type } from "@sinclair/typebox";
import { MemberStatus, WorkspaceRole, WorkspaceStatus } from "./states.js";

export const UserSchema = Type.Object({
  id: Type.String(),
  email: Type.String(),
  displayName: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal("activo"), Type.Literal("bloqueado"), Type.Literal("eliminado")]),
  createdAt: Type.String(),
  lastLoginAt: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});

export const WorkspaceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  ownerUserId: Type.String(),
  status: WorkspaceStatus,
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const WorkspaceMemberSchema = Type.Object({
  workspaceId: Type.String(),
  userId: Type.String(),
  role: WorkspaceRole,
  status: MemberStatus,
  createdAt: Type.String()
});

export const BootstrapStatusSchema = Type.Object({
  schemaVersion: Type.Literal("bootstrap.v1"),
  authenticated: Type.Boolean(),
  nextStep: Type.Union([
    Type.Literal("sign_in"),
    Type.Literal("connect_meta"),
    Type.Literal("recover_meta"),
    Type.Literal("select_page"),
    Type.Literal("home")
  ]),
  user: Type.Optional(UserSchema),
  workspace: Type.Optional(WorkspaceSchema),
  membership: Type.Optional(WorkspaceMemberSchema),
  selectedBusinessId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  selectedPageId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  facebookTokenStatus: Type.Optional(
    Type.Union([
      Type.Literal("valido"),
      Type.Literal("por_vencer"),
      Type.Literal("expirado"),
      Type.Literal("requiere_reconexion"),
      Type.Literal("error_permiso"),
      Type.Literal("error_desconocido"),
      Type.Null()
    ])
  ),
  canStartMetaAuthorization: Type.Optional(Type.Boolean()),
  requiresManualToken: Type.Optional(Type.Boolean()),
  grantedScopes: Type.Optional(Type.Array(Type.String())),
  declinedScopes: Type.Optional(Type.Array(Type.String())),
  missingRequiredScopes: Type.Optional(Type.Array(Type.String())),
  metaAuthorizationStatus: Type.Optional(
    Type.Union([
      Type.Literal("none"),
      Type.Literal("pending"),
      Type.Literal("valid"),
      Type.Literal("missing_scopes"),
      Type.Literal("requires_review"),
      Type.Literal("expired"),
      Type.Literal("revoked"),
      Type.Literal("error")
    ])
  ),
  appReviewStatus: Type.Optional(
    Type.Union([
      Type.Literal("development"),
      Type.Literal("review_required"),
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("unknown")
    ])
  ),
  graphApiVersion: Type.Optional(Type.String()),
  requestId: Type.String()
});

export const MobileAuthSessionResponseSchema = Type.Object({
  schemaVersion: Type.Literal("mobile_auth_session.v1"),
  accessToken: Type.String(),
  refreshToken: Type.Optional(Type.String()),
  expiresAt: Type.Optional(Type.Number()),
  tokenType: Type.Optional(Type.String()),
  user: Type.Optional(
    Type.Object({
      id: Type.Optional(Type.String()),
      email: Type.Optional(Type.String())
    })
  ),
  requestId: Type.String()
});

export type User = Static<typeof UserSchema>;
export type Workspace = Static<typeof WorkspaceSchema>;
export type WorkspaceMember = Static<typeof WorkspaceMemberSchema>;
export type BootstrapStatus = Static<typeof BootstrapStatusSchema>;
export type MobileAuthSessionResponse = Static<typeof MobileAuthSessionResponseSchema>;

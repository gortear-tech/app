import { Static, Type } from "@sinclair/typebox";
import { BootstrapStatusSchema } from "./auth.js";

export const FacebookTokenStatus = Type.Union([
  Type.Literal("valido"),
  Type.Literal("por_vencer"),
  Type.Literal("expirado"),
  Type.Literal("requiere_reconexion"),
  Type.Literal("error_permiso"),
  Type.Literal("error_desconocido")
]);

export const MetaAuthorizationStatus = Type.Union([
  Type.Literal("none"),
  Type.Literal("pending"),
  Type.Literal("valid"),
  Type.Literal("missing_scopes"),
  Type.Literal("requires_review"),
  Type.Literal("expired"),
  Type.Literal("revoked"),
  Type.Literal("error")
]);

export const MetaPageSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  metaPageId: Type.String(),
  pageName: Type.String(),
  coverPhotoUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  profilePhotoUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  category: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  tasks: Type.Array(Type.String()),
  isGranted: Type.Boolean(),
  isSelected: Type.Boolean(),
  canPublish: Type.Boolean(),
  pageAccessTokenStatus: FacebookTokenStatus,
  grantedScopes: Type.Array(Type.String()),
  declinedScopes: Type.Array(Type.String()),
  updatedAt: Type.String()
});

export const MetaConnectResponseSchema = Type.Object({
  schemaVersion: Type.Literal("meta_connect.v1"),
  bootstrap: BootstrapStatusSchema,
  pages: Type.Array(MetaPageSchema),
  authorizationUrl: Type.Optional(Type.String()),
  pendingDeviceLogin: Type.Optional(
    Type.Object({
      verificationUri: Type.String(),
      userCode: Type.String(),
      expiresAt: Type.String(),
      message: Type.String()
    })
  ),
  requestId: Type.String()
});

export const MetaPagesResponseSchema = Type.Object({
  schemaVersion: Type.Literal("meta_pages.v1"),
  pages: Type.Array(MetaPageSchema),
  requestId: Type.String()
});

export type FacebookTokenStatus = Static<typeof FacebookTokenStatus>;
export type MetaAuthorizationStatus = Static<typeof MetaAuthorizationStatus>;
export type MetaPage = Static<typeof MetaPageSchema>;
export type MetaConnectResponse = Static<typeof MetaConnectResponseSchema>;

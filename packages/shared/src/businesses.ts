import { Static, Type } from "@sinclair/typebox";
import { FacebookTokenStatus } from "./meta.js";
import { BootstrapStatusSchema } from "./auth.js";

export const BusinessSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  facebookPageId: Type.String(),
  name: Type.String(),
  timezone: Type.String(),
  tokenStatus: FacebookTokenStatus,
  metadata: Type.Record(Type.String(), Type.Unknown()),
  autonomySettings: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const SelectPageBodySchema = Type.Object({
  pageId: Type.String()
});

export const SelectPageResponseSchema = Type.Object({
  schemaVersion: Type.Literal("select_page.v1"),
  business: BusinessSchema,
  bootstrap: BootstrapStatusSchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  nextStep: Type.Literal("home"),
  requestId: Type.String()
});

export const BusinessesResponseSchema = Type.Object({
  schemaVersion: Type.Literal("businesses.v1"),
  businesses: Type.Array(BusinessSchema),
  requestId: Type.String()
});

export type Business = Static<typeof BusinessSchema>;
export type SelectPageResponse = Static<typeof SelectPageResponseSchema>;

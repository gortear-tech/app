import { Static, Type } from "@sinclair/typebox";
import { BillingStatus } from "./states.js";
import { WorkspaceSchema } from "./auth.js";

export const CommercialPlanSchema = Type.Union([
  Type.Literal("piloto"),
  Type.Literal("starter"),
  Type.Literal("pro"),
  Type.Literal("agency")
]);

export const BillingProviderSchema = Type.Union([
  Type.Literal("manual"),
  Type.Literal("stripe"),
  Type.Literal("mercado_pago")
]);

export const PlanEntitlementsSchema = Type.Object({
  maxBusinesses: Type.Number(),
  monthlyPhotoUploads: Type.Number(),
  monthlyGeneratedVariants: Type.Number(),
  monthlyScheduledPosts: Type.Number(),
  monthlyAiBudgetUsd: Type.Number(),
  includedAiCreditsUsd: Type.Number(),
  overagePolicy: Type.Union([Type.Literal("block"), Type.Literal("allow")]),
  canUseAutopublish: Type.Boolean()
});

export const BillingAccountSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  provider: BillingProviderSchema,
  providerCustomerId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  providerSubscriptionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  providerSubscriptionItemId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  providerPriceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan: CommercialPlanSchema,
  billingStatus: BillingStatus,
  currentPeriodStart: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  currentPeriodEnd: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const BillingProviderEventSchema = Type.Object({
  id: Type.String(),
  provider: Type.Union([Type.Literal("stripe"), Type.Literal("mercado_pago"), Type.Literal("manual")]),
  providerEventId: Type.String(),
  workspaceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.String(),
  status: Type.Union([Type.Literal("received"), Type.Literal("processed"), Type.Literal("ignored"), Type.Literal("failed")]),
  receivedAt: Type.String(),
  processedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  lastError: Type.Optional(Type.Union([Type.String(), Type.Null()]))
});

export const BillingStatusResponseSchema = Type.Object({
  schemaVersion: Type.Literal("billing_status.v1"),
  workspace: WorkspaceSchema,
  billingAccount: Type.Union([BillingAccountSchema, Type.Null()]),
  plans: Type.Record(Type.String(), PlanEntitlementsSchema),
  upgrade: Type.Object({
    canUpgrade: Type.Boolean(),
    provider: BillingProviderSchema,
    message: Type.String()
  }),
  requestId: Type.String()
});

export const UpgradeIntentBodySchema = Type.Object({
  plan: CommercialPlanSchema,
  provider: Type.Optional(BillingProviderSchema)
});

export const UpgradeIntentResponseSchema = Type.Object({
  schemaVersion: Type.Literal("upgrade_intent.v1"),
  provider: BillingProviderSchema,
  targetPlan: CommercialPlanSchema,
  checkoutUrl: Type.Union([Type.String(), Type.Null()]),
  message: Type.String(),
  requestId: Type.String()
});

export const BillingWebhookBodySchema = Type.Object({
  providerEventId: Type.String(),
  type: Type.String(),
  workspaceId: Type.Optional(Type.String()),
  plan: Type.Optional(CommercialPlanSchema),
  billingStatus: Type.Optional(BillingStatus)
});

export const BillingWebhookResponseSchema = Type.Object({
  schemaVersion: Type.Literal("billing_webhook.v1"),
  event: BillingProviderEventSchema,
  duplicate: Type.Boolean(),
  requestId: Type.String()
});

export const PlansResponseSchema = Type.Object({
  schemaVersion: Type.Literal("plans.v1"),
  plans: Type.Record(Type.String(), PlanEntitlementsSchema),
  requestId: Type.String()
});

export type CommercialPlan = Static<typeof CommercialPlanSchema>;
export type BillingProvider = Static<typeof BillingProviderSchema>;
export type PlanEntitlements = Static<typeof PlanEntitlementsSchema>;
export type BillingAccount = Static<typeof BillingAccountSchema>;
export type BillingProviderEvent = Static<typeof BillingProviderEventSchema>;
export type BillingStatusResponse = Static<typeof BillingStatusResponseSchema>;
export type UpgradeIntentResponse = Static<typeof UpgradeIntentResponseSchema>;
export type BillingWebhookResponse = Static<typeof BillingWebhookResponseSchema>;
export type PlansResponse = Static<typeof PlansResponseSchema>;

export const PLAN_ENTITLEMENTS: Record<CommercialPlan, PlanEntitlements> = {
  piloto: {
    maxBusinesses: 1,
    monthlyPhotoUploads: 50,
    monthlyGeneratedVariants: 100,
    monthlyScheduledPosts: 60,
    monthlyAiBudgetUsd: 20,
    includedAiCreditsUsd: 20,
    overagePolicy: "block",
    canUseAutopublish: false
  },
  starter: {
    maxBusinesses: 1,
    monthlyPhotoUploads: 120,
    monthlyGeneratedVariants: 240,
    monthlyScheduledPosts: 120,
    monthlyAiBudgetUsd: 35,
    includedAiCreditsUsd: 25,
    overagePolicy: "block",
    canUseAutopublish: false
  },
  pro: {
    maxBusinesses: 3,
    monthlyPhotoUploads: 400,
    monthlyGeneratedVariants: 900,
    monthlyScheduledPosts: 450,
    monthlyAiBudgetUsd: 120,
    includedAiCreditsUsd: 80,
    overagePolicy: "block",
    canUseAutopublish: true
  },
  agency: {
    maxBusinesses: 15,
    monthlyPhotoUploads: 2000,
    monthlyGeneratedVariants: 5000,
    monthlyScheduledPosts: 2500,
    monthlyAiBudgetUsd: 600,
    includedAiCreditsUsd: 300,
    overagePolicy: "allow",
    canUseAutopublish: true
  }
};

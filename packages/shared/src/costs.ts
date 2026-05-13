import { Static, Type } from "@sinclair/typebox";
import { BatchSummarySchema } from "./batches.js";

export const EstimateCostBodySchema = Type.Object({
  variantsPerPhoto: Type.Number({ minimum: 1, maximum: 5 })
});

export const ConfirmCostBodySchema = Type.Object({
  variantsPerPhoto: Type.Number({ minimum: 1, maximum: 5 }),
  priceVersion: Type.String({ minLength: 1 })
});

export const CostBreakdownLineSchema = Type.Object({
  operation: Type.String(),
  provider: Type.String(),
  model: Type.String(),
  unitType: Type.String(),
  quantity: Type.Number(),
  unitPriceUsd: Type.Number(),
  estimatedCostUsd: Type.Number(),
  priceVersion: Type.String()
});

export const UsageBudgetSchema = Type.Object({
  metric: Type.String(),
  limitValue: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  usedValue: Type.Number(),
  reservedValue: Type.Number(),
  availableValue: Type.Optional(Type.Union([Type.Number(), Type.Null()]))
});

export const EstimateCostResponseSchema = Type.Object({
  schemaVersion: Type.Literal("cost_estimate.v1"),
  batchId: Type.String(),
  variantsPerPhoto: Type.Number(),
  photoCount: Type.Number(),
  variantCount: Type.Number(),
  priceVersion: Type.String(),
  estimatedCostUsd: Type.Number(),
  estimatedProviderCostUsd: Type.Number(),
  breakdown: Type.Array(CostBreakdownLineSchema),
  canConfirm: Type.Boolean(),
  blockedReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  usage: Type.Array(UsageBudgetSchema),
  requestId: Type.String()
});

export const ConfirmCostResponseSchema = Type.Object({
  schemaVersion: Type.Literal("confirm_cost.v1"),
  batch: BatchSummarySchema,
  reserved: Type.Object({
    variantCount: Type.Number(),
    customerCostUsd: Type.Number(),
    providerCostUsd: Type.Number(),
    priceVersion: Type.String()
  }),
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type EstimateCostResponse = Static<typeof EstimateCostResponseSchema>;
export type ConfirmCostResponse = Static<typeof ConfirmCostResponseSchema>;

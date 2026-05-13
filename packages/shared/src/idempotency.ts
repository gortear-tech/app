import { Static, Type } from "@sinclair/typebox";

export const IdempotencyRecordStatus = Type.Union([
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("conflict")
]);

export const IdempotencyConflictSchema = Type.Object({
  code: Type.Literal("idempotency_conflict"),
  message: Type.String(),
  userMessage: Type.String(),
  retryable: Type.Literal(false),
  action: Type.Literal("none"),
  requestId: Type.String()
});

export type IdempotencyRecordStatus = Static<typeof IdempotencyRecordStatus>;

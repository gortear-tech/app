import { Type } from "@sinclair/typebox";

export const HealthSchema = Type.Object({
  ok: Type.Boolean(),
  service: Type.Optional(Type.String()),
  environment: Type.Optional(Type.String()),
  release: Type.Optional(Type.String())
});

export const ReadySchema = Type.Object({
  ok: Type.Boolean(),
  checks: Type.Object({
    config: Type.Boolean(),
    db: Type.Boolean(),
    queue: Type.Boolean(),
    worker: Type.Optional(Type.Boolean())
  })
});

export const RequestIdHeaderSchema = Type.Object({
  "x-request-id": Type.Optional(Type.String({ minLength: 8, maxLength: 80 }))
});

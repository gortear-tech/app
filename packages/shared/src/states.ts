import { Type } from "@sinclair/typebox";

export const WorkspaceStatus = Type.Union([
  Type.Literal("activo"),
  Type.Literal("pausado"),
  Type.Literal("eliminado")
]);

export const BillingStatus = Type.Union([
  Type.Literal("trial"),
  Type.Literal("active"),
  Type.Literal("past_due"),
  Type.Literal("paused"),
  Type.Literal("cancelled")
]);

export const WorkspaceRole = Type.Union([
  Type.Literal("owner"),
  Type.Literal("admin"),
  Type.Literal("operator"),
  Type.Literal("viewer")
]);

export const MemberStatus = Type.Union([
  Type.Literal("active"),
  Type.Literal("invited"),
  Type.Literal("disabled")
]);

export const BatchStatus = Type.Union([
  Type.Literal("pending_upload"),
  Type.Literal("pendiente_confirmacion"),
  Type.Literal("confirmado"),
  Type.Literal("generando"),
  Type.Literal("generado_parcial"),
  Type.Literal("completado"),
  Type.Literal("cancelado"),
  Type.Literal("abandonado"),
  Type.Literal("ready_to_generate"),
  Type.Literal("generating"),
  Type.Literal("ready_for_review"),
  Type.Literal("scheduled"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
  Type.Literal("abandoned")
]);

export const PhotoStatus = Type.Union([
  Type.Literal("uploading"),
  Type.Literal("uploaded"),
  Type.Literal("analyzing"),
  Type.Literal("validated"),
  Type.Literal("validada"),
  Type.Literal("eliminada"),
  Type.Literal("rejected"),
  Type.Literal("failed")
]);

export const VariantStatus = Type.Union([
  Type.Literal("pendiente"),
  Type.Literal("generando"),
  Type.Literal("generada"),
  Type.Literal("aprobada"),
  Type.Literal("rechazada"),
  Type.Literal("bloqueada_por_calidad"),
  Type.Literal("fallida"),
  Type.Literal("programada"),
  Type.Literal("publicada"),
  Type.Literal("eliminada"),
  Type.Literal("queued"),
  Type.Literal("generating"),
  Type.Literal("generated"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("blocked"),
  Type.Literal("failed")
]);

export const ScheduledPostStatus = Type.Union([
  Type.Literal("pendiente"),
  Type.Literal("programada"),
  Type.Literal("publicacion_en_proceso"),
  Type.Literal("publicada"),
  Type.Literal("fallida"),
  Type.Literal("cancelada"),
  Type.Literal("draft"),
  Type.Literal("scheduled"),
  Type.Literal("publishing"),
  Type.Literal("published"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("estado_incierto"),
  Type.Literal("pausada_por_token"),
  Type.Literal("needs_user_action")
]);

export const JobStatus = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("blocked"),
  Type.Literal("needs_user_action"),
  Type.Literal("ambiguous")
]);

export type WorkspaceRole = "owner" | "admin" | "operator" | "viewer";
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked"
  | "needs_user_action"
  | "ambiguous";

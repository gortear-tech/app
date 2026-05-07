export const USER_STATUSES = ["activo", "bloqueado", "eliminado"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const FACEBOOK_TOKEN_STATUSES = [
  "valido",
  "por_vencer",
  "expirado",
  "requiere_reconexion",
  "error_permiso",
  "error_desconocido",
] as const;
export type FacebookTokenStatus = (typeof FACEBOOK_TOKEN_STATUSES)[number];

export const BATCH_STATUSES = [
  "pending_upload",
  "pendiente_confirmacion",
  "confirmado",
  "generando",
  "generado_parcial",
  "completado",
  "fallido",
  "cancelado",
  "abandonado",
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const PHOTO_STATUSES = [
  "subida",
  "analizando",
  "validada",
  "optimizada",
  "clasificada",
  "descartada",
  "usada",
  "eliminada",
] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const VARIANT_STATUSES = [
  "pendiente",
  "generando",
  "generada",
  "fallida",
  "aprobada",
  "rechazada",
  "programada",
  "publicada",
  "eliminada",
] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const SCHEDULED_POST_STATUSES = [
  "pendiente",
  "programada",
  "publicacion_en_proceso",
  "publicada",
  "estado_incierto",
  "fallida",
  "pausada_por_token",
  "cancelada",
] as const;
export type ScheduledPostStatus = (typeof SCHEDULED_POST_STATUSES)[number];

export const AI_TASK_TYPES = [
  "style_assignment",
  "variant_count",
  "scheduling",
  "caption_generation",
  "facebook_publish",
  "batch_generation",
] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const ACTION_TYPES = [
  "STYLE_ASSIGNMENT",
  "VARIANT_COUNT",
  "SCHEDULING",
  "CAPTION_GENERATION",
  "FACEBOOK_PUBLISH",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const CONFIDENCE_LEVELS = ["baja", "media", "alta"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const RISK_LEVELS = ["riesgo_bajo", "riesgo_medio", "riesgo_alto"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const BUSINESS_LEARNING_EVENT_TYPES = [
  "variante_generada",
  "variante_aprobada",
  "variante_rechazada",
  "estilo_cambiado_por_usuario",
  "caption_editado_por_usuario",
  "post_publicado",
  "post_fallido",
  "metricas_recolectadas",
  "accion_aprobada_en_swipe_autonomia",
  "accion_rechazada_en_swipe_autonomia",
  "batch_abandoned",
] as const;
export type BusinessLearningEventType = (typeof BUSINESS_LEARNING_EVENT_TYPES)[number];

export const VISUAL_STYLE_INTENSITIES = ["ligera", "media", "fuerte"] as const;
export type VisualStyleIntensity = (typeof VISUAL_STYLE_INTENSITIES)[number];

export const DISCLOSURE_POLICIES = [
  "no_requerida",
  "recomendada",
  "obligatoria",
] as const;
export type DisclosurePolicy = (typeof DISCLOSURE_POLICIES)[number];

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  PanResponder,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  StyleProp,
  ViewStyle,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  BatchDetail,
  BatchStatus,
  BusinessDashboard,
  BusinessDetail,
  BusinessAlert,
  BusinessSummary,
  MetaDeviceLoginResponse,
  MetaTokenConnectionResponse,
  OriginalPhotoSummary,
  GeneratedVariantSummary,
  ScheduledPostSummary,
  VisualStyle,
  CreateVisualStyleRequest,
  UpdateVisualStyleRequest,
} from "@fbmaniaco/shared";
import { createApiClient, type PageSummary } from "./apiClient";
import { businessSettingsStorage } from "./businessSettingsStorage";
import { resolveInitialScreen, type ScreenKey } from "./authFlow";
import { clearMetaToken, saveMetaToken } from "./facebookReconnect";
import { mobileRuntimeConfig } from "./mobileRuntimeConfig";
import { sessionStorage } from "./sessionStorage";
import { theme } from "./theme";

const API_URL = mobileRuntimeConfig.apiUrl;
const DEFAULT_META_TOKEN = mobileRuntimeConfig.allowTestBootstrap ? mobileRuntimeConfig.bootstrapToken : "";
const api = createApiClient(API_URL);

async function blobToDataUrl(blob: Blob, contentType: string): Promise<string> {
  if (typeof FileReader !== "undefined") {
    const result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : "");
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("No se pudo leer la foto seleccionada"));
      };
      reader.readAsDataURL(blob);
    });
    if (result.startsWith("data:application/octet-stream") || result.startsWith("data:;base64")) {
      const commaIndex = result.indexOf(",");
      return commaIndex >= 0 ? `data:${contentType};base64,${result.slice(commaIndex + 1)}` : result;
    }
    return result;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function uriToUploadPayload(uri: string): Promise<{ imageDataUrl: string; contentType: string; fileSize: number }> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const contentType = blob.type || "image/jpeg";
  return {
    imageDataUrl: await blobToDataUrl(blob, contentType),
    contentType,
    fileSize: blob.size,
  };
}

type BatchState = {
  businessId: string | null;
  batchId: string | null;
  photos: Array<{ uri: string; name: string; mimeType?: string | null }>;
  variantsPerPhoto: number;
};

type CaptionDraftMap = Record<string, string>;
type BatchFlowStep = "upload" | "review" | "detail" | "variants" | "generating" | "swipe" | "summary";
type SwipeDecision = "aprobada" | "rechazada";
type SwipeDecisionMap = Record<string, SwipeDecision>;
type AnalysisBannerState = { done: number; total: number; ready: boolean };
type StylePickerState = { photoId: string; visible: boolean };
type CancelBatchPromptState = { visible: boolean };
type StyleEditorMode = "create" | "edit";
type StyleDraft = {
  name: string;
  description: string;
  promptTemplate: string;
  recommendedIndustries: string;
  recommendedPhotoTypes: string;
  intensity: VisualStyle["intensity"];
  aiDisclosureRequired: boolean;
  restrictions: string;
};
type StyleEditorState = {
  visible: boolean;
  mode: StyleEditorMode;
  styleId: string | null;
  draft: StyleDraft;
};

const emptyBatchState: BatchState = {
  businessId: null,
  batchId: null,
  photos: [],
  variantsPerPhoto: 2,
};

 function SectionCard(props: { title: string; subtitle?: string; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return (
    <View style={[styles.card, props.style]}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      {props.subtitle ? <Text style={styles.cardSubtitle}>{props.subtitle}</Text> : null}
      {props.children}
    </View>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.primaryButton, props.disabled && styles.disabled]}>
      <Text style={styles.primaryButtonText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.secondaryButton, props.disabled && styles.disabled]}>
      <Text style={styles.secondaryButtonText}>{props.label}</Text>
    </Pressable>
  );
}

function DangerButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [styles.dangerButton, pressed && !props.disabled && styles.dangerButtonPressed, props.disabled && styles.disabled]}
    >
      <Text style={styles.dangerButtonText}>{props.label}</Text>
    </Pressable>
  );
}

function BackButton(props: { onPress: () => void; disabled?: boolean; label?: string; compact?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        styles.backButton,
        props.compact && styles.backButtonCompact,
        props.disabled && styles.backButtonDisabled,
        pressed && !props.disabled && styles.backButtonPressed,
      ]}
    >
      <Text style={[styles.backButtonText, props.compact && styles.backButtonTextCompact]}>{props.label ?? "← Volver"}</Text>
    </Pressable>
  );
}

function CancelBatchPrompt(props: {
  businessName: string;
  batchStatus: BatchStatus | null;
  loading: boolean;
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const statusNarrative = props.batchStatus ? getBatchStatusNarrative(props.batchStatus).toLowerCase() : "en proceso";
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={props.loading ? undefined : props.onClose} />
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Cancelar lote</Text>
          <Text style={styles.bodyMuted}>
            Se cancelara el lote de {props.businessName} que esta {statusNarrative}. Se conservara el historial, pero ya no podras seguir generando ni
            programando desde este lote.
          </Text>
          <View style={styles.confirmDialogActions}>
            <SecondaryButton label="Seguir trabajando" onPress={props.onClose} disabled={props.loading} />
            <DangerButton label={props.loading ? "Cancelando..." : "Cancelar lote"} onPress={props.onConfirm} disabled={props.loading} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

type CalendarDraft = {
  date: string;
  time: string;
};

type CalendarGridCell = {
  key: string;
  date: Date;
  inMonth: boolean;
  posts: ScheduledPostSummary[];
};

const WEEKDAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

const STATUS_LABELS: Record<ScheduledPostSummary["status"], string> = {
  pendiente: "⏳ Pendiente",
  programada: "📅 Programada",
  publicacion_en_proceso: "🚀 Publicando",
  publicada: "✅ Publicada",
  estado_incierto: "❔ Estado incierto",
  fallida: "⚠️ Fallida",
  pausada_por_token: "⛔ Pausada por token",
  cancelada: "🗑️ Cancelada",
};

const STATUS_COLORS: Record<ScheduledPostSummary["status"], string> = {
  pendiente: theme.colors.muted,
  programada: theme.colors.accent,
  publicacion_en_proceso: "#f59e0b",
  publicada: theme.colors.success,
  estado_incierto: "#94a3b8",
  fallida: theme.colors.danger,
  pausada_por_token: "#94a3b8",
  cancelada: "#6b7280",
};

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "Sin fecha";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toCalendarDraft(iso: string | null | undefined): CalendarDraft {
  const parsed = iso ? new Date(iso) : new Date();
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  const hour = String(safeDate.getHours()).padStart(2, "0");
  const minute = String(safeDate.getMinutes()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
  };
}

function buildScheduledDateTime(draft: CalendarDraft): string {
  const parsed = new Date(`${draft.date}T${draft.time.length === 5 ? `${draft.time}:00` : draft.time}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Fecha u hora invalida");
  }
  return parsed.toISOString();
}

function buildCalendarGrid(anchor: Date, scheduledPosts: ScheduledPostSummary[]): CalendarGridCell[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const weekdayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - weekdayOffset);
  const postsByDay = new Map<string, ScheduledPostSummary[]>();

  for (const post of scheduledPosts) {
    const key = formatDateKey(new Date(post.scheduledFor));
    const current = postsByDay.get(key) ?? [];
    current.push(post);
    postsByDay.set(key, current);
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = formatDateKey(date);
    return {
      key,
      date,
      inMonth: date.getMonth() === month,
      posts: (postsByDay.get(key) ?? []).sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)),
    };
  });
}

function chunkCalendarGrid(cells: CalendarGridCell[], columns = 7): CalendarGridCell[][] {
  const rows: CalendarGridCell[][] = [];
  for (let index = 0; index < cells.length; index += columns) {
    rows.push(cells.slice(index, index + columns));
  }
  return rows;
}

function getStatusLabel(status: ScheduledPostSummary["status"]): string {
  return STATUS_LABELS[status] ?? status;
}

function getStatusColor(status: ScheduledPostSummary["status"]): string {
  return STATUS_COLORS[status] ?? theme.colors.muted;
}

function formatPercent(value: number): any {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-MX", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function humanizeEnumLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (match) => match.toLocaleUpperCase("es-MX"));
}

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBatchFlowStep(batch: BatchDetail | null | undefined): BatchFlowStep {
  if (!batch) return "upload";
  if (batch.photos.length === 0) return "upload";
  if (batch.variants.length === 0) return "review";
  if (batch.variants.some((variant) => variant.status === "generada")) return "swipe";
  if (batch.variants.some((variant) => variant.status === "aprobada" || variant.status === "rechazada")) return "summary";
  return "review";
}

function getBatchProgress(batchStatus: BatchStatus | null | undefined): number {
  switch (batchStatus) {
    case "pending_upload":
      return 14;
    case "pendiente_confirmacion":
      return 34;
    case "confirmado":
      return 52;
    case "generando":
      return 70;
    case "generado_parcial":
      return 84;
    case "completado":
      return 100;
    case "fallido":
    case "cancelado":
    case "abandonado":
      return 100;
    default:
      return 14;
  }
}

function getBatchStepNumber(batchStatus: BatchStatus | null | undefined): number {
  switch (batchStatus) {
    case "pending_upload":
      return 1;
    case "pendiente_confirmacion":
      return 2;
    case "confirmado":
      return 3;
    case "generando":
      return 4;
    case "generado_parcial":
      return 5;
    case "completado":
      return 5;
    default:
      return 1;
  }
}

function getBatchStatusNarrative(batchStatus: BatchStatus | null | undefined): string {
  switch (batchStatus) {
    case "pending_upload":
      return "Esperando que subas las fotos";
    case "pendiente_confirmacion":
      return "Analizando y preparando variantes";
    case "confirmado":
      return "Fotos listas para generar variantes";
    case "generando":
      return "Creando variantes y captions";
    case "generado_parcial":
      return "Esperando que apruebes las variantes";
    case "completado":
      return "Publicaciones programadas y en cola";
    case "fallido":
      return "Hubo un problema y requiere atención";
    case "cancelado":
      return "Lote cancelado";
    case "abandonado":
      return "Lote abandonado";
    default:
      return "Continuar el flujo de publicaciones";
  }
}

function getAutonomyLabel(threshold: number): string {
  return threshold >= 75 ? "Autónomo" : "Requiere confirmación";
}

function getAutonomyTone(threshold: number): "autonomous" | "manual" {
  return threshold >= 75 ? "autonomous" : "manual";
}

function getTokenStatusLabel(status: string | null): string {
  if (status === "valido") return "Conectado";
  if (status === "por_vencer") return "Por vencer";
  if (status === "expirado" || status === "requiere_reconexion") return "Expirado";
  return "Desconocido";
}

function getBusinessContentTypes(metadata: Record<string, unknown> | null | undefined): string[] {
  const raw = metadata?.contentTypes;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function getBusinessFacebookSeoKeywords(metadata: Record<string, unknown> | null | undefined): string[] {
  const raw = metadata?.facebookSeoKeywords;
  const items = typeof raw === "string" ? raw.split(/[\n,;]/) : Array.isArray(raw) ? raw : [];
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  );
}

function normalizeContentType(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length ? normalized : null;
}

function splitSeoKeywordList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]/)
        .map((item) => item.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  );
}

function splitStyleList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function styleToDraft(style: VisualStyle | null | undefined): StyleDraft {
  return {
    name: style?.name ?? "",
    description: style?.description ?? "",
    promptTemplate: style?.promptTemplate ?? "",
    recommendedIndustries: style?.recommendedIndustries.join(", ") ?? "",
    recommendedPhotoTypes: style?.recommendedPhotoTypes.join(", ") ?? "",
    intensity: style?.intensity ?? "media",
    aiDisclosureRequired: style?.aiDisclosureRequired ?? false,
    restrictions: style?.restrictions.join("\n") ?? "",
  };
}

function draftToCreateStyleRequest(draft: StyleDraft): CreateVisualStyleRequest {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    promptTemplate: draft.promptTemplate.trim(),
    recommendedIndustries: splitStyleList(draft.recommendedIndustries),
    recommendedPhotoTypes: splitStyleList(draft.recommendedPhotoTypes),
    intensity: draft.intensity,
    aiDisclosureRequired: draft.aiDisclosureRequired,
    restrictions: splitStyleList(draft.restrictions),
  };
}

function draftToUpdateStyleRequest(draft: StyleDraft): UpdateVisualStyleRequest {
  return draftToCreateStyleRequest(draft);
}

function getStyleIntensityLabel(intensity: VisualStyle["intensity"]): string {
  switch (intensity) {
    case "ligera":
      return "Ligera";
    case "media":
      return "Media";
    case "fuerte":
      return "Fuerte";
    default:
      return intensity;
  }
}

function getStyleIntensityEmoji(intensity: VisualStyle["intensity"]): string {
  switch (intensity) {
    case "ligera":
      return "✨";
    case "media":
      return "🎛️";
    case "fuerte":
      return "🔥";
    default:
      return "🎨";
  }
}

function countByStatus<T extends { status: string }>(items: T[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

function StatusPill(props: { status: ScheduledPostSummary["status"] }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: getStatusColor(props.status) + "22" }]}>
      <Text style={[styles.statusPillText, { color: getStatusColor(props.status) }]}>{getStatusLabel(props.status)}</Text>
    </View>
  );
}

function CalendarScreen(props: {
  business: BusinessSummary | null;
  scheduledPosts: ScheduledPostSummary[];
  monthAnchor: Date;
  selectedDayKey: string | null;
  selectedPostId: string | null;
  detailEditing: boolean;
  detailDraft: CalendarDraft;
  loading: boolean;
  onBack: () => void;
  onOpenBatch: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDay: (dayKey: string | null) => void;
  onSelectPost: (postId: string) => void;
  onCloseDetail: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeDraftDate: (value: string) => void;
  onChangeDraftTime: (value: string) => void;
  onSaveSchedule: () => void;
  onCancelPost: () => void;
  onRetryPost: () => void;
  onOpenReport: () => void;
  onOpenSettings: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 430 || height < 760;
  const isTiny = width < 380 || height < 700;
  const monthLabel = props.monthAnchor.toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });
  const cells = useMemo(() => buildCalendarGrid(props.monthAnchor, props.scheduledPosts), [props.monthAnchor, props.scheduledPosts]);
  const calendarRows = useMemo(() => chunkCalendarGrid(cells), [cells]);
  const legendItems = [
    { label: "Programada", color: theme.colors.accent },
    { label: "Publicada", color: theme.colors.success },
    { label: "Fallida", color: theme.colors.danger },
    { label: "Pausada", color: "#94a3b8" },
  ];
  const postsByDay = useMemo(() => {
    const map = new Map<string, ScheduledPostSummary[]>();
    for (const post of props.scheduledPosts) {
      const key = formatDateKey(new Date(post.scheduledFor));
      const current = map.get(key) ?? [];
      current.push(post);
      map.set(key, current);
    }
    return map;
  }, [props.scheduledPosts]);
  const selectedDayPosts = props.selectedDayKey
    ? (postsByDay.get(props.selectedDayKey) ?? []).slice().sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))
    : [];
  const selectedPost = props.selectedPostId ? props.scheduledPosts.find((post) => post.id === props.selectedPostId) ?? null : null;
  const selectedPostCaption = selectedPost?.caption?.trim() || "Sin caption";
  const canEditSchedule = Boolean(selectedPost && selectedPost.status === "programada");
  const canRetry = Boolean(selectedPost && (selectedPost.status === "fallida" || selectedPost.status === "pausada_por_token"));
  const canCancel = Boolean(selectedPost && selectedPost.status !== "publicada" && selectedPost.status !== "cancelada");
  const headerLabels = isCompact
    ? { report: "📈", settings: "⚙️", back: "←" }
    : { report: "📈 Reporte", settings: "⚙️ Ajustes", back: "← Volver" };
  const toolbarLabels = isTiny
    ? { prev: "←", next: "→", today: "🗓️", batch: "🧾", refresh: "↻" }
    : isCompact
      ? { prev: "←", next: "→", today: "Hoy", batch: "Lote", refresh: "↻" }
    : { prev: "← Anterior", next: "Siguiente →", today: "🗓️ Hoy", batch: "🧾 Abrir lote", refresh: "🔄 Actualizar" };

  return (
    <View style={styles.screenRoot}>
      <View style={[styles.calendarScreen, isCompact && styles.calendarScreenCompact]}>
        <View style={styles.batchTopBar}>
          <View style={styles.batchTopText}>
            <Text style={styles.brandSmall}>Calendario</Text>
            <Text style={styles.h1} numberOfLines={1}>
              {props.business?.name ?? "Negocio"}
            </Text>
          </View>
          <View style={styles.calendarHeaderActions}>
            <SecondaryButton label={headerLabels.report} onPress={props.onOpenReport} />
            <SecondaryButton label={headerLabels.settings} onPress={props.onOpenSettings} />
            <SecondaryButton label={headerLabels.back} onPress={props.onBack} />
          </View>
        </View>

        <SectionCard title="🗓️ Mes" subtitle={isTiny ? undefined : "Programa real en Facebook"} style={[styles.calendarBoardCard, isTiny && styles.calendarBoardCardCompact]}>
          <View style={styles.calendarToolbar}>
            <SecondaryButton label={toolbarLabels.prev} onPress={props.onPrevMonth} />
            <Text style={[styles.calendarMonthLabel, isCompact && styles.calendarMonthLabelCompact]} numberOfLines={1}>
              {monthLabel}
            </Text>
            <SecondaryButton label={toolbarLabels.next} onPress={props.onNextMonth} />
          </View>
          <View style={styles.calendarToolbar}>
            <SecondaryButton label={toolbarLabels.today} onPress={props.onToday} />
            <SecondaryButton label={toolbarLabels.batch} onPress={props.onOpenBatch} />
            <PrimaryButton label={toolbarLabels.refresh} onPress={props.onRefresh} disabled={props.loading} />
          </View>

          <View style={styles.weekHeader}>
            {WEEKDAY_LABELS.map((label) => (
              <Text key={label} style={styles.weekHeaderLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.calendarLegend}>
            {legendItems.map((item) => (
              <View key={item.label} style={[styles.calendarLegendItem, isTiny && styles.calendarLegendItemCompact]}>
                <View style={[styles.calendarLegendDot, { backgroundColor: item.color }]} />
                {!isTiny ? <Text style={styles.calendarLegendText}>{item.label}</Text> : null}
              </View>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarRows.map((row) => (
              <View key={row[0]?.key ?? `row-${row.length}`} style={styles.calendarGridRow}>
                {row.map((cell) => {
                  const hasPosts = cell.posts.length > 0;
                  const dots = cell.posts.slice(0, 3);
                  return (
                    <Pressable
                      key={cell.key}
                      onPress={() => props.onSelectDay(cell.key)}
                      style={[
                        styles.calendarCell,
                        !cell.inMonth && styles.calendarCellMuted,
                        props.selectedDayKey === cell.key && styles.calendarCellSelected,
                      ]}
                    >
                      <Text style={[styles.calendarCellDay, !cell.inMonth && styles.calendarCellDayMuted]}>{cell.date.getDate()}</Text>
                      <View style={styles.calendarDots}>
                        {dots.map((post) => (
                          <View key={post.id} style={[styles.calendarDot, { backgroundColor: getStatusColor(post.status) }]} />
                        ))}
                        {cell.posts.length > 3 ? <Text style={styles.calendarDotMore}>+{cell.posts.length - 3}</Text> : null}
                      </View>
                      {hasPosts ? <Text style={styles.calendarCellCount}>{cell.posts.length}</Text> : <View style={styles.calendarCellSpacer} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          {!isTiny ? <Text style={styles.calendarFootnote}>Selecciona un día para ver, editar o reintentar sus publicaciones.</Text> : null}
        </SectionCard>
      </View>

      <Modal visible={Boolean(props.selectedDayKey)} transparent animationType="slide" onRequestClose={() => props.onSelectDay(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalScrim} onPress={() => props.onSelectDay(null)} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {props.selectedDayKey ? new Date(`${props.selectedDayKey}T12:00:00`).toLocaleDateString("es-MX", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
              }) : "📄 Publicaciones"}
              </Text>
              <SecondaryButton label="✕ Cerrar" onPress={() => props.onSelectDay(null)} />
            </View>
            {selectedDayPosts.length ? (
              <FlatList
                data={selectedDayPosts}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => props.onSelectPost(item.id)}
                    style={styles.sheetItem}
                  >
                    <View style={styles.sheetItemTopRow}>
                      <Text style={styles.listTitle}>{item.styleName ?? "Sin estilo"}</Text>
                      <StatusPill status={item.status} />
                    </View>
                    <Text style={styles.bodyMuted}>{formatLocalDateTime(item.scheduledFor)}</Text>
                    <Text style={styles.postRowCaption} numberOfLines={2}>
                      {item.caption?.trim() || "Sin caption"}
                    </Text>
                  </Pressable>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              />
            ) : (
          <Text style={styles.bodyMuted}>Ese día no tiene publicaciones.</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(selectedPost)} transparent animationType="slide" onRequestClose={props.onCloseDetail}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalScrim} onPress={props.onCloseDetail} />
          <View style={styles.detailSheet}>
            <ScrollView contentContainerStyle={styles.detailSheetContent}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>📄 Detalle de publicación</Text>
                <SecondaryButton label="✕ Cerrar" onPress={props.onCloseDetail} />
              </View>

              {selectedPost?.imageUrl ? (
                <Image source={{ uri: selectedPost.imageUrl }} style={styles.detailImage} />
              ) : (
                <View style={styles.detailImagePlaceholder}>
                  <Text style={styles.bodyMuted}>Sin imagen</Text>
                </View>
              )}

              {selectedPost ? (
                <>
                  <View style={styles.detailMetaRow}>
                    <StatusPill status={selectedPost.status} />
                    <Text style={styles.bodyMuted}>{selectedPost.styleName ?? "Sin estilo"}</Text>
                  </View>
                  <Text style={styles.bodyMuted}>{formatLocalDateTime(selectedPost.scheduledFor)}</Text>
                  <Text style={styles.detailCaption}>{selectedPostCaption}</Text>
                  <Text style={styles.bodyMuted}>Intentos: {selectedPost.retryCount}</Text>

                  {canEditSchedule ? (
                    props.detailEditing ? (
                      <View style={styles.detailEditCard}>
                        <Text style={styles.cardTitle}>Cambiar fecha y hora</Text>
                        <TextInput
                          value={props.detailDraft.date}
                          onChangeText={props.onChangeDraftDate}
                          placeholder="AAAA-MM-DD"
                          placeholderTextColor={theme.colors.muted}
                          style={styles.input}
                        />
                        <TextInput
                          value={props.detailDraft.time}
                          onChangeText={props.onChangeDraftTime}
                          placeholder="HH:MM"
                          placeholderTextColor={theme.colors.muted}
                          style={styles.input}
                        />
                        <View style={styles.buttonStack}>
                          <PrimaryButton label="💾 Guardar" onPress={props.onSaveSchedule} disabled={props.loading} />
                          <SecondaryButton label="Cancelar" onPress={props.onCancelEdit} disabled={props.loading} />
                        </View>
                      </View>
                    ) : (
                      <PrimaryButton label="Cambiar fecha y hora" onPress={props.onStartEdit} disabled={props.loading} />
                    )
                  ) : null}

                  {canRetry ? <PrimaryButton label="🔁 Reintentar" onPress={props.onRetryPost} disabled={props.loading} /> : null}
                  {canCancel ? <SecondaryButton label="Cancelar publicación" onPress={props.onCancelPost} disabled={props.loading} /> : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TokenScreen(props: {
  mode?: "connect" | "reconnect";
  token: string;
  setToken: (value: string) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
  pendingDeviceLogin: MetaDeviceLoginResponse | null;
  deviceMessage: string | null;
  onAutoConnect: () => void;
  onManualConnect: () => void;
  onOpenHelp: () => void;
}) {
  const reconnectMode = props.mode === "reconnect";
  return (
    <ScrollView contentContainerStyle={styles.screenWrap}>
      <View style={styles.tokenHero}>
        <Text style={styles.brand}>FBmaniaco</Text>
        <View style={styles.tokenTopRow}>
          <BackButton onPress={props.onBack} />
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>{reconnectMode ? "🔄 Reconectar Facebook" : "🔐 Conecta tu negocio"}</Text>
            <Text style={styles.bodyMuted}>
              {reconnectMode
                ? "Tu acceso a Facebook venció. Pega un nuevo token para reactivar las publicaciones."
                : "Si no hay token guardado, intentaremos obtenerlo automáticamente. Si falla, puedes pegarlo aquí."}
            </Text>
          </View>
          <Pressable onPress={props.onOpenHelp} style={styles.helpButton}>
            <Text style={styles.helpButtonText}>ℹ️</Text>
          </Pressable>
        </View>
      </View>

      {reconnectMode ? (
        <View style={styles.alertCard}>
          <Text style={styles.alertTitle}>⚠️ Facebook desconectado</Text>
            <Text style={styles.alertBody}>Las publicaciones programadas están pausadas hasta que reconectes.</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔑 Token de acceso de Meta</Text>
        <Text style={styles.cardSubtitle}>Pega aquí el token largo. No usamos usuario ni contraseña.</Text>
        <TextInput
          value={props.token}
          onChangeText={props.setToken}
          placeholder="Token de acceso de Meta"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[styles.input, styles.tokenInput]}
        />
        {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
        {props.deviceMessage ? <Text style={styles.bodyMuted}>{props.deviceMessage}</Text> : null}
        {props.pendingDeviceLogin ? (
          <View style={styles.deviceCard}>
            <Text style={styles.cardTitle}>Aprobar en Meta</Text>
            <Text style={styles.bodyMuted}>Abre {props.pendingDeviceLogin.verificationUri}</Text>
            <Text style={styles.deviceCode}>{props.pendingDeviceLogin.userCode}</Text>
            <Text style={styles.bodyMuted}>
              El código vence a las {new Date(props.pendingDeviceLogin.expiresAt).toLocaleTimeString()}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.buttonStack}>
        <PrimaryButton
          label={reconnectMode ? "🔄 Reconectar" : "🔁 Obtener automáticamente"}
          onPress={props.onAutoConnect}
          disabled={props.loading}
        />
        <SecondaryButton
          label={reconnectMode ? "✍️ Conectar token manual" : "✍️ Conectar manualmente"}
          onPress={props.onManualConnect}
          disabled={props.loading || !props.token.trim()}
        />
      </View>
      {props.loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
    </ScrollView>
  );
}

function PagesScreen(props: {
  pages: PageSummary[];
  onSelect: (pageId: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenWrap}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>🏬 Elige tu negocio</Text>
            <Text style={styles.bodyMuted}>Si solo hay una página, la seleccionaremos automáticamente.</Text>
          </View>
        </View>
      </View>
      <View style={styles.pageGrid}>
        {props.pages.map((page) => (
          <Pressable
            key={page.pageId}
            onPress={() => props.onSelect(page.pageId)}
            style={({ pressed }) => [
              styles.pageCard,
              page.isSelected && styles.pageCardSelected,
              pressed && styles.pageCardPressed,
            ]}
          >
            {page.coverPhotoUrl ? (
              <ImageBackground source={{ uri: page.coverPhotoUrl }} style={styles.pageThumb} imageStyle={styles.pageImage}>
                <View style={styles.pageOverlay} />
                <View style={styles.pageTitleWrap}>
                  <Text style={styles.pageName} numberOfLines={2}>
                    {page.pageName}
                  </Text>
                </View>
              </ImageBackground>
            ) : (
              <View style={[styles.pageThumb, styles.pagePlaceholder]}>
                <View style={styles.pageOverlay} />
                <View style={styles.pageTitleWrap}>
                  <Text style={styles.pageName} numberOfLines={2}>
                    {page.pageName}
                  </Text>
                </View>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function HomeScreen(props: {
  business: BusinessSummary | null;
  page: PageSummary | null;
  dashboard: BusinessDashboard | null;
  scheduledPosts: ScheduledPostSummary[];
  loading: boolean;
  onBack: () => void;
  onOpenBatch: (batchId?: string) => void;
  onCancelBatch: () => void;
  onOpenCalendar: () => void;
  onOpenSettings: () => void;
  onOpenReconnect: () => void;
  onRefresh: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 430 || height < 760;
  const isTiny = width < 380 || height < 700;
  const alerts = props.dashboard?.alerts ?? [];
  const tokenAlert = alerts.find((alert) => alert.type === "facebook_token");
  const failureAlerts = alerts.filter((alert) => alert.type === "post_failed");
  const visibleFailureAlerts = isCompact ? failureAlerts.slice(0, 1) : failureAlerts.slice(0, 2);
  const hiddenFailureCount = Math.max(0, failureAlerts.length - visibleFailureAlerts.length);
  const activeBatch = props.dashboard?.activeBatch ?? null;
  const activeBatchId = activeBatch?.id ?? null;
  const activeBatchStep = activeBatch ? getBatchStepNumber(activeBatch.status) : 0;
  const activeBatchNarrative = activeBatch ? getBatchStatusNarrative(activeBatch.status) : "";
  const calendarCells = buildCalendarGrid(new Date(), props.scheduledPosts);
  const calendarRows = useMemo(() => chunkCalendarGrid(calendarCells), [calendarCells]);
  const currentMonth = new Date();
  const monthLabel = currentMonth.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const mainActionLabel = isTiny
    ? props.dashboard?.activeBatch
      ? props.dashboard.activeBatch.photosCount === 0
        ? "📷"
        : "▶️"
      : "📷"
    : props.dashboard?.activeBatch
      ? props.dashboard.activeBatch.photosCount === 0
        ? "📷 Subir fotos"
        : "▶️ Continuar lote"
      : "📷 Subir fotos nuevas";
  const refreshLabel = isTiny ? "↻" : "🔄 Actualizar";
  const batchPrimaryLabel = isTiny ? "▶️" : "▶️ Continuar lote";
  const batchCancelLabel = isTiny ? "🛑" : "🛑 Cancelar lote";

  return (
    <View style={styles.screenRoot}>
      <View style={[styles.homeLayout, isCompact && styles.homeLayoutCompact]}>
        <View style={styles.homeTopBar}>
          <BackButton onPress={props.onBack} compact={isTiny} label={isTiny ? "←" : "← Volver"} />
          <View style={styles.homeIdentity}>
            {props.page?.coverPhotoUrl ? <Image source={{ uri: props.page.coverPhotoUrl }} style={styles.homeAvatar} /> : <View style={styles.homeAvatarFallback} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.brandSmall}>FBmaniaco</Text>
              <Text style={[styles.homeTitle, isTiny && styles.homeTitleCompact]} numberOfLines={1}>
                {props.business?.name ?? "Negocio"}
              </Text>
            </View>
          </View>
          <Pressable onPress={props.onOpenSettings} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>⚙️</Text>
          </Pressable>
        </View>

        <View style={styles.homeBody}>
          <View style={styles.homeSignalStack}>
            {tokenAlert ? (
              <Pressable style={styles.alertCard} onPress={props.onOpenReconnect}>
                <View style={styles.alertRow}>
                  <Text style={styles.alertTitle} numberOfLines={2}>
                    {tokenAlert.message}
                  </Text>
                  <Text style={styles.alertAction}>{tokenAlert.actionLabel ?? "Reconectar"} →</Text>
                </View>
                {!isTiny ? <Text style={styles.alertBody}>Las publicaciones están pausadas.</Text> : null}
              </Pressable>
            ) : null}

            {visibleFailureAlerts.map((alert) => (
              <Pressable key={alert.id} style={styles.alertCard} onPress={props.onOpenCalendar}>
                <View style={styles.alertRow}>
                  <Text style={styles.alertTitle} numberOfLines={2}>
                    {alert.message}
                  </Text>
                  <Text style={styles.alertAction}>Ver calendario →</Text>
                </View>
                {!isTiny ? <Text style={styles.alertBody}>Hay publicaciones fallidas que requieren atención.</Text> : null}
              </Pressable>
            ))}

            {hiddenFailureCount > 0 ? (
              <Pressable style={styles.alertCard} onPress={props.onOpenCalendar}>
                <View style={styles.alertRow}>
                  <Text style={styles.alertTitle} numberOfLines={1}>
                    +{hiddenFailureCount} alertas más
                  </Text>
                  <Text style={styles.alertAction}>Abrir calendario →</Text>
                </View>
                {!isTiny ? <Text style={styles.alertBody}>Se muestran aquí para ahorrar espacio.</Text> : null}
              </Pressable>
            ) : null}

            {activeBatch ? (
              <View style={[styles.activeBatchCard, isCompact && styles.activeBatchCardCompact]}>
                <Text style={styles.sectionLabel}>🟠 EN PROCESO</Text>
                <Text style={styles.activeBatchTitle}>🟠 Lote activo</Text>
                <Text style={styles.activeBatchBody} numberOfLines={isTiny ? 1 : isCompact ? 2 : 3}>
                  {activeBatchNarrative} · {activeBatch.photosCount} fotos · {activeBatch.variantsCount} variantes
                </Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${getBatchProgress(activeBatch.status)}%` }]} />
                </View>
                <View style={styles.activeBatchMetaRow}>
                  <Text style={styles.activeBatchMeta}>Paso {activeBatchStep} de 5</Text>
                  <Text style={styles.activeBatchMeta}>{getBatchProgress(activeBatch.status)}%</Text>
                </View>
                <View style={styles.activeBatchActions}>
                  <View style={styles.activeBatchAction}>
                    <PrimaryButton label={batchPrimaryLabel} onPress={() => props.onOpenBatch(activeBatch.id)} />
                  </View>
                  <View style={styles.activeBatchAction}>
                    <DangerButton label={batchCancelLabel} onPress={props.onCancelBatch} disabled={props.loading} />
                  </View>
                </View>
              </View>
            ) : (
              <View style={[styles.emptyHero, isCompact && styles.emptyHeroCompact]}>
                <Text style={styles.emptyHeroIcon}>📷</Text>
                <Text style={styles.emptyHeroTitle}>No hay nada aquí todavía</Text>
                <Text style={styles.bodyMuted} numberOfLines={isTiny ? 1 : 2}>
                  Sube tus fotos para empezar.
                </Text>
              </View>
            )}
          </View>

          <Pressable onPress={props.onOpenCalendar} style={({ pressed }) => [pressed && styles.calendarCardPressed, styles.homeCalendarPressable]}>
            <SectionCard
              title="🗓️ Calendario"
              subtitle={monthLabel}
              style={[styles.homeCalendarCard, isCompact && styles.homeCalendarCardCompact, isTiny && styles.homeCalendarCardTiny]}
            >
              {!isTiny ? (
                <Text style={styles.bodyMuted} numberOfLines={1}>
                  Toca esta tarjeta para abrir el calendario completo.
                </Text>
              ) : null}
              <View style={styles.homeCalendarGrid}>
                {calendarRows.map((row) => (
                  <View key={row[0]?.key ?? `row-${row.length}`} style={styles.homeCalendarRow}>
                    {row.map((cell) => {
                      const dots = cell.posts.slice(0, 3);
                      return (
                        <View key={cell.key} style={[styles.homeCalendarCell, !cell.inMonth && styles.homeCalendarCellMuted]}>
                          <Text style={styles.homeCalendarDay}>{cell.date.getDate()}</Text>
                          <View style={styles.homeCalendarDots}>
                            {dots.map((post) => (
                              <View key={post.id} style={[styles.calendarDot, { backgroundColor: getStatusColor(post.status) }]} />
                            ))}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </SectionCard>
          </Pressable>
        </View>

        <View style={styles.homeFooter}>
          <PrimaryButton label={mainActionLabel} onPress={() => props.onOpenBatch(activeBatchId ?? undefined)} />
          <SecondaryButton label={refreshLabel} onPress={props.onRefresh} />
        </View>
      </View>

      {props.loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

function BatchScreen(props: {
  business: BusinessSummary | null;
  batchId: string | null;
  batchDetail: BatchDetail | null;
  loading: boolean;
  step: BatchFlowStep;
  batchState: BatchState;
  setBatchState: React.Dispatch<React.SetStateAction<BatchState>>;
  captionDrafts: CaptionDraftMap;
  setCaptionDrafts: React.Dispatch<React.SetStateAction<CaptionDraftMap>>;
  stylesCatalog: VisualStyle[];
  selectedPhotoId: string | null;
  stylePickerPhotoId: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onPickPhotos: () => Promise<void>;
  onRemovePhoto: (uri: string) => void;
  onUploadPhotos: () => Promise<void>;
  onOpenPhotoDetail: (photoId: string) => void;
  onClosePhotoDetail: () => void;
  onOpenStylePicker: (photoId: string) => void;
  onCloseStylePicker: () => void;
  onChooseStyle: (photoId: string, styleId: string) => Promise<void>;
  onCancelBatch: () => void;
  onOpenVariantCount: () => void;
  onGenerateVariants: () => Promise<void>;
  onApproveSwipe: (variantId: string) => void;
  onRejectSwipe: (variantId: string) => void;
  onUndoSwipe: () => void;
  onCommitSwipeDecisions: (periodDays: 7 | 14 | 30) => Promise<void>;
  onReopenVariantApproval: () => Promise<void>;
  swipeIndex: number;
  swipeCurrentVariant: GeneratedVariantSummary | null;
  swipeApprovedCount: number;
  swipeRejectedCount: number;
  swipeDecisions: SwipeDecisionMap;
  summaryPeriod: 7 | 14 | 30 | null;
  setSummaryPeriod: React.Dispatch<React.SetStateAction<7 | 14 | 30 | null>>;
}) {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 430 || height < 760;
  const isTiny = width < 380 || height < 700;
  const batch = props.batchDetail;
  const selectedPhoto = batch?.photos.find((photo) => photo.id === props.selectedPhotoId) ?? null;
  const selectedSwipeDraft = props.swipeCurrentVariant ? props.captionDrafts[props.swipeCurrentVariant.id] ?? props.swipeCurrentVariant.caption ?? "" : "";
  const reviewPhotos = batch?.photos ?? [];
  const pendingPhotos = props.batchState.photos;
  const swipeDeck = batch?.variants.filter((variant) => variant.status === "generada") ?? [];
  const persistedApprovedCount =
    batch?.variants.filter((variant) => variant.status === "aprobada" || variant.status === "programada" || variant.status === "publicada").length ?? 0;
  const persistedRejectedCount = batch?.variants.filter((variant) => variant.status === "rechazada").length ?? 0;
  const summaryApprovedCount = Math.max(props.swipeApprovedCount, persistedApprovedCount);
  const summaryRejectedCount = Math.max(props.swipeRejectedCount, persistedRejectedCount);
  const totalVariants = Math.max(1, reviewPhotos.length || pendingPhotos.length) * props.batchState.variantsPerPhoto;
  const canReopenApproval = Boolean(
    batch &&
      batch.variants.length > 0 &&
      !batch.variants.some((variant) => variant.status === "publicada"),
  );
  const currentStep = props.step;
  const [swipeCaptionExpanded, setSwipeCaptionExpanded] = useState(false);
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeCardRotate = swipeTranslateX.interpolate({
    inputRange: [-280, 0, 280],
    outputRange: ["-8deg", "0deg", "8deg"],
    extrapolate: "clamp",
  });
  const swipeApproveTint = swipeTranslateX.interpolate({
    inputRange: [0, 180, 280],
    outputRange: [0, 0.14, 0.24],
    extrapolate: "clamp",
  });
  const swipeRejectTint = swipeTranslateX.interpolate({
    inputRange: [-280, -180, 0],
    outputRange: [0.24, 0.14, 0],
    extrapolate: "clamp",
  });
  const canCancelBatch = Boolean(batch && !["completado", "cancelado", "fallido", "abandonado"].includes(batch.status));
  const stepLabelMap: Record<BatchFlowStep, string> = {
    upload: "PASO 1 · 📷 SUBIR FOTOS",
    review: "PASO 2 · 🖼️ REVISAR THUMBNAILS",
    detail: "PASO 2 · 🔍 DETALLE DE FOTO",
    variants: "PASO 3 · 🔢 CANTIDAD DE VARIANTES",
    generating: "PASO 4 · ⚙️ GENERANDO",
    swipe: "PASO 5 · ✅ APROBACIÓN",
    summary: "PASO 6 · 📅 PROGRAMAR",
  };

  useEffect(() => {
    setSwipeCaptionExpanded(false);
    swipeTranslateX.setValue(0);
  }, [props.swipeCurrentVariant?.id]);

  const currentSwipePhotoIndex = useMemo(() => {
    if (!props.swipeCurrentVariant || !batch) return -1;
    return batch.photos.findIndex((photo) => photo.id === props.swipeCurrentVariant?.photoId);
  }, [batch, props.swipeCurrentVariant]);

  const currentSwipeVariants = useMemo(() => {
    if (!props.swipeCurrentVariant || !batch) return [] as GeneratedVariantSummary[];
    return batch.variants.filter((variant) => variant.photoId === props.swipeCurrentVariant?.photoId && variant.status === "generada");
  }, [batch, props.swipeCurrentVariant]);

  const currentSwipeVariantIndex = useMemo(() => {
    if (!props.swipeCurrentVariant) return 0;
    const index = currentSwipeVariants.findIndex((variant) => variant.id === props.swipeCurrentVariant?.id);
    return index >= 0 ? index + 1 : 1;
  }, [currentSwipeVariants, props.swipeCurrentVariant]);

  const swipeIndicatorLabel = props.swipeCurrentVariant && currentSwipePhotoIndex >= 0
    ? `F${currentSwipePhotoIndex + 1} · V${currentSwipeVariantIndex} de ${Math.max(1, currentSwipeVariants.length)}`
    : `V${props.swipeIndex + 1} de ${Math.max(1, swipeDeck.length)}`;

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
        onPanResponderMove: (_, gesture) => {
          swipeTranslateX.setValue(gesture.dx);
        },
        onPanResponderRelease: (_, gesture) => {
          const variant = props.swipeCurrentVariant;
          if (!variant) {
            swipeTranslateX.setValue(0);
            return;
          }
          const shouldApprove = gesture.dx > 120;
          const shouldReject = gesture.dx < -120;
          if (!shouldApprove && !shouldReject) {
            Animated.spring(swipeTranslateX, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 8,
            }).start();
            return;
          }
          Animated.timing(swipeTranslateX, {
            toValue: shouldApprove ? 420 : -420,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            if (shouldApprove) {
              props.onApproveSwipe(variant.id);
            } else {
              props.onRejectSwipe(variant.id);
            }
            swipeTranslateX.setValue(0);
          });
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        },
      }),
    [props.onApproveSwipe, props.onRejectSwipe, props.swipeCurrentVariant, swipeTranslateX],
  );

  const renderHeader = (title: string, subtitle?: string) => (
    <View style={styles.batchTopBar}>
      <BackButton onPress={props.onBack} compact={isTiny} label={isTiny ? "←" : "← Volver"} />
      <View style={styles.batchTopText}>
        <Text style={styles.sectionLabel}>{stepLabelMap[currentStep]}</Text>
        <Text style={[styles.h1, isTiny && styles.h1Compact]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && !isTiny ? <Text style={styles.bodyMuted}>{subtitle}</Text> : null}
      </View>
      <View style={styles.batchTopActions}>
        <DangerButton label={isTiny ? "🛑" : "🛑 Cancelar"} onPress={props.onCancelBatch} disabled={props.loading || !canCancelBatch} />
        <Pressable onPress={props.onRefresh} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>🔄</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderStylePicker = () => {
    const photo = batch?.photos.find((item) => item.id === props.stylePickerPhotoId) ?? null;
    return (
      <Modal visible={Boolean(props.stylePickerPhotoId)} transparent animationType="slide" onRequestClose={props.onCloseStylePicker}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalScrim} onPress={props.onCloseStylePicker} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Cambiar estilo</Text>
              <SecondaryButton label="✕ Cerrar" onPress={props.onCloseStylePicker} />
            </View>
            {photo ? <Text style={styles.bodyMuted}>{photo.assignedStyle?.styleName ?? "Sin estilo asignado"}</Text> : null}
            <ScrollView contentContainerStyle={styles.sheetBody}>
              {props.stylesCatalog.map((style) => {
                const active = photo?.assignedStyle?.styleId === style.id;
                return (
                  <Pressable key={style.id} onPress={() => props.onChooseStyle(props.stylePickerPhotoId ?? "", style.id)} style={[styles.styleRow, active && styles.styleRowActive]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listTitle}>{style.name}</Text>
                      <Text style={styles.bodyMuted}>{style.description}</Text>
                    </View>
                    {active ? <Text style={styles.styleChip}>Actual</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  if (currentStep === "upload") {
    return (
      <View style={styles.screenRoot}>
        {renderHeader("📷 Subir fotos", isTiny ? "Elige fotos para empezar." : "Toca para elegir fotos y empezar el análisis.")}
        <ScrollView
          contentContainerStyle={[
            styles.batchContent,
            isCompact && styles.batchContentCompact,
            isTiny && styles.batchContentTiny,
          ]}
        >
          <Pressable onPress={props.onPickPhotos} style={styles.uploadArea}>
            <Text style={styles.uploadIcon}>📤</Text>
            <Text style={styles.uploadTitle}>Toca para elegir fotos</Text>
            <Text style={styles.bodyMuted}>{isTiny ? "JPG · PNG · WEBP · hasta 10 fotos" : "JPG · PNG · WEBP · hasta 10 fotos · máx 12 MB"}</Text>
          </Pressable>
          {pendingPhotos.length ? (
            <View style={styles.uploadPreviewGrid}>
              {pendingPhotos.map((photo) => (
                <View key={`${photo.uri}-${photo.name}`} style={styles.uploadPreviewItem}>
                  <Image source={{ uri: photo.uri }} style={styles.uploadPreviewImage} />
                  <Pressable onPress={() => props.onRemovePhoto(photo.uri)} style={styles.removeBadge}>
                    <Text style={styles.removeBadgeText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.bodyMuted}>{pendingPhotos.length} fotos seleccionadas</Text>
          <View style={[styles.screenBottomSpacer, isTiny && styles.screenBottomSpacerCompact]} />
        </ScrollView>
        <View style={styles.fixedFooter}>
          <PrimaryButton label="Analizar fotos" onPress={props.onUploadPhotos} disabled={props.loading || pendingPhotos.length === 0 || !props.batchId} />
        </View>
        {renderStylePicker()}
      </View>
    );
  }

  if (currentStep === "review") {
    return (
      <View style={styles.screenRoot}>
        {renderHeader("🖼️ Thumbnails con estilos", isTiny ? `${reviewPhotos.length} fotos` : `${reviewPhotos.length} fotos analizadas`)}
        <ScrollView
          contentContainerStyle={[
            styles.batchContent,
            isCompact && styles.batchContentCompact,
            isTiny && styles.batchContentTiny,
          ]}
        >
          <View style={styles.infoCard}>
            <Text style={styles.sectionLabel}>REVISIÓN RÁPIDA</Text>
            <Text style={styles.bodyMuted}>
              {isTiny ? "Toca una foto para ver el detalle o cambiar el estilo." : "Toca una foto para ver el detalle o mantén presionado para cambiar el estilo."}
            </Text>
          </View>
          <View style={styles.reviewGrid}>
            {reviewPhotos.map((photo) => (
              <Pressable
                key={photo.id}
                onPress={() => props.onOpenPhotoDetail(photo.id)}
                onLongPress={() => props.onOpenStylePicker(photo.id)}
                style={({ pressed }) => [styles.reviewTile, pressed && styles.reviewTilePressed]}
              >
                {photo.imageUrl ? <Image source={{ uri: photo.imageUrl }} style={styles.reviewTileImage} /> : <View style={styles.reviewTileFallback} />}
                <View style={styles.reviewTileOverlay} />
                <View style={styles.reviewTileLabel}>
                  <Text style={styles.reviewTileLabelText} numberOfLines={1}>
                    {photo.assignedStyle?.styleName ?? "Pendiente"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          {reviewPhotos.length === 0 ? <Text style={styles.bodyMuted}>Aún no hay fotos analizadas.</Text> : null}
          <View style={[styles.screenBottomSpacer, isTiny && styles.screenBottomSpacerCompact]} />
        </ScrollView>
        <View style={styles.fixedFooter}>
          <PrimaryButton label="✨ Generar variantes" onPress={props.onOpenVariantCount} disabled={props.loading || reviewPhotos.length === 0} />
        </View>
        {renderStylePicker()}
      </View>
    );
  }

  if (currentStep === "detail") {
    const analysisChips = selectedPhoto?.visionAnalysis
      ? [
          `Sujeto: ${humanizeEnumLabel(selectedPhoto.visionAnalysis.subject.type)}`,
          `Encuadre: ${humanizeEnumLabel(selectedPhoto.visionAnalysis.composition.framing)}`,
          `Luz: ${humanizeEnumLabel(selectedPhoto.visionAnalysis.composition.lighting)}`,
          `Mood: ${humanizeEnumLabel(selectedPhoto.visionAnalysis.mood.temperature)}`,
          `Fondo: ${humanizeEnumLabel(selectedPhoto.visionAnalysis.composition.backgroundType)}`,
          `Calidad: ${formatPercent(selectedPhoto.visionAnalysis.technicalQuality.sharpness)}`,
        ]
      : [];
    const promptText = selectedPhoto?.editingPrompt?.trim() ?? "";
    const promptRefreshing = promptText.length === 0 || promptText === "Actualizando...";

    return (
      <View style={styles.screenRoot}>
        <View style={styles.detailHero}>
          {selectedPhoto?.imageUrl ? <Image source={{ uri: selectedPhoto.imageUrl }} style={styles.detailHeroImage} /> : <View style={styles.detailHeroFallback} />}
          <View style={styles.detailHeroScrim} />
          <Pressable onPress={props.onClosePhotoDetail} style={[styles.detailBackButton, isTiny && styles.detailBackButtonCompact]}>
            <Text style={[styles.detailBackButtonText, isTiny && styles.detailBackButtonTextCompact]}>← Volver</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.detailContent, isCompact && styles.detailContentCompact, isTiny && styles.detailContentTiny]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>ANÁLISIS IA</Text>
          </View>
          {analysisChips.length ? (
            <View style={styles.chipRow}>
              {analysisChips.map((chip) => (
                <View key={chip} style={styles.blueChip}>
                  <Text style={styles.blueChipText}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.bodyMuted} numberOfLines={isTiny ? 2 : undefined}>
            {selectedPhoto?.visionAnalysis?.summary ?? "Sin análisis disponible."}
          </Text>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>ESTILO ASIGNADO</Text>
          </View>
          {selectedPhoto?.assignedStyle ? (
            <View style={styles.assignedStyleCard}>
              <View style={styles.assignedStyleHeader}>
                <Text style={styles.assignedStylePill}>{selectedPhoto.assignedStyle.styleName}</Text>
                <Text style={styles.bodyMuted}>{selectedPhoto.assignedStyle.intensity}</Text>
              </View>
              <Text style={styles.assignedStyleBody} numberOfLines={isTiny ? 2 : undefined}>
                {selectedPhoto.visionAnalysis?.mood.description ?? "Estilo ajustado para esta foto."}
              </Text>
              <View style={styles.metricRow}><Text style={styles.metricLabel}>Contraste</Text><View style={styles.metricTrack}><View style={[styles.metricFill, { width: formatPercent(selectedPhoto.assignedStyle.contrast) }]} /></View></View>
              <View style={styles.metricRow}><Text style={styles.metricLabel}>Saturación</Text><View style={styles.metricTrack}><View style={[styles.metricFill, { width: formatPercent(selectedPhoto.assignedStyle.saturation) }]} /></View></View>
              <View style={styles.metricRow}><Text style={styles.metricLabel}>Calidez</Text><View style={styles.metricTrack}><View style={[styles.metricFill, { width: formatPercent(selectedPhoto.assignedStyle.warmth) }]} /></View></View>
              <View style={styles.metricRow}><Text style={styles.metricLabel}>Nitidez</Text><View style={styles.metricTrack}><View style={[styles.metricFill, { width: formatPercent(selectedPhoto.assignedStyle.sharpness) }]} /></View></View>
            </View>
          ) : null}

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>INSTRUCCION DE EDICION</Text>
          </View>
          <View style={styles.promptCard}>
            {promptRefreshing ? (
              <View style={styles.promptSkeleton}>
                <View style={styles.promptSkeletonLine} />
                <View style={styles.promptSkeletonLineShort} />
                <Text style={styles.promptSkeletonText}>Actualizando...</Text>
              </View>
            ) : (
              <Text style={styles.bodyMuted} numberOfLines={isTiny ? 3 : undefined}>{promptText}</Text>
            )}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (currentStep === "variants") {
    return (
      <View style={styles.screenRoot}>
        {renderHeader("❓ ¿Cuántas variantes?", isTiny ? "Cuántas por foto" : "Versiones que se generarán de cada foto")}
        <ScrollView
          contentContainerStyle={[
            styles.batchContent,
            isCompact && styles.batchContentCompact,
            isTiny && styles.batchContentTiny,
          ]}
        >
          <Text style={styles.bodyMuted}>{isTiny ? "Elige cuántas variantes por foto." : "Versiones que se generarán de cada foto"}</Text>
          <View style={styles.variantStepper}>
            <Pressable onPress={() => props.setBatchState((current) => ({ ...current, variantsPerPhoto: Math.max(1, current.variantsPerPhoto - 1) }))} style={styles.roundStepperButton}>
              <Text style={styles.roundStepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.variantStepperNumber}>{props.batchState.variantsPerPhoto}</Text>
            <Pressable onPress={() => props.setBatchState((current) => ({ ...current, variantsPerPhoto: Math.min(5, current.variantsPerPhoto + 1) }))} style={styles.roundStepperButton}>
              <Text style={styles.roundStepperButtonText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.variantTotal}>{totalVariants} variantes en total</Text>
          <Text style={styles.bodyMuted} numberOfLines={1}>
            {reviewPhotos.length || pendingPhotos.length} fotos × {props.batchState.variantsPerPhoto} variantes
          </Text>
          <View style={styles.infoCard}>
            <Text style={styles.bodyMuted}>
              {isTiny
                ? "Una variante es una versión alternativa lista para publicarse."
                : "Una variante es una versión alternativa de la foto con el estilo y caption ajustados para publicarse."}
            </Text>
          </View>
          <View style={[styles.screenBottomSpacer, isTiny && styles.screenBottomSpacerCompact]} />
        </ScrollView>
        <View style={styles.fixedFooter}>
          <PrimaryButton label="✨ Confirmar y generar" onPress={props.onGenerateVariants} disabled={props.loading || !props.batchId} />
        </View>
      </View>
    );
  }

  if (currentStep === "generating") {
    return (
      <View style={styles.screenRoot}>
        {renderHeader("⚙️ Generando", isTiny ? "Un momento..." : "Esto puede tardar unos minutos")}
        <View style={[styles.generatingCenter, isTiny && styles.generatingCenterCompact]}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
          <Text style={styles.generatingCounter}>{batch?.variants.length ?? 0} / {totalVariants}</Text>
          <Text style={styles.bodyMuted}>variantes generadas</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, ((batch?.variants.length ?? 0) / Math.max(1, totalVariants)) * 100)}%` }]} /></View>
          <View style={styles.messageStack}>
            <View style={styles.messageCard}><Text style={styles.messageText}>Aplicando estilo y generando captions...</Text></View>
            <View style={styles.messageCard}><Text style={styles.messageText}>Revisando elementos sensibles...</Text></View>
            <View style={styles.messageCard}><Text style={styles.messageText}>Preparando imágenes para swipes...</Text></View>
          </View>
        </View>
      </View>
    );
  }

  if (currentStep === "swipe") {
    return (
      <View style={styles.screenRoot}>
        <View style={[styles.swipeTopBar, isTiny && styles.swipeTopBarCompact]}>
          <View style={styles.swipeTopSpacer} />
          <Text style={styles.swipeIndicator}>{swipeIndicatorLabel}</Text>
          {props.swipeIndex > 0 ? (
            <Pressable onPress={props.onUndoSwipe} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>↩️</Text>
            </Pressable>
          ) : (
            <View style={styles.swipeTopSpacer} />
          )}
        </View>

        {props.swipeCurrentVariant ? (
          <Animated.View
            style={[
              styles.swipeCard,
              {
                transform: [{ translateX: swipeTranslateX }, { rotate: swipeCardRotate }],
              },
            ]}
            {...swipeResponder.panHandlers}
          >
            <View style={styles.swipeMediaFrame}>
              {props.swipeCurrentVariant.imageUrl ? (
                <Image source={{ uri: props.swipeCurrentVariant.imageUrl }} style={styles.swipeImage} resizeMode="contain" />
              ) : (
                <View style={styles.swipeImageFallback} />
              )}
            </View>
            <Animated.View pointerEvents="none" style={[styles.swipeTint, styles.swipeTintApprove, { opacity: swipeApproveTint }]} />
            <Animated.View pointerEvents="none" style={[styles.swipeTint, styles.swipeTintReject, { opacity: swipeRejectTint }]} />
            <View style={[styles.swipeCaptionCard, isTiny && styles.swipeCaptionCardCompact]}>
              <View style={styles.swipeCaptionHeader}>
                <Text style={styles.swipeCaptionLabel}>Caption</Text>
                <Pressable onPress={() => setSwipeCaptionExpanded((current) => !current)} style={styles.swipeCaptionToggle}>
                  <Text style={styles.swipeCaptionToggleText}>{swipeCaptionExpanded ? "Contraer" : "Ver más"}</Text>
                </Pressable>
              </View>
              {swipeCaptionExpanded ? (
                <TextInput
                  value={selectedSwipeDraft}
                  onChangeText={(text) =>
                    props.setCaptionDrafts((current) => ({
                      ...current,
                      [props.swipeCurrentVariant!.id]: text,
                    }))
                  }
                  multiline
                  style={[styles.swipeCaptionInput, styles.swipeCaptionInputExpanded, isTiny && styles.swipeCaptionInputExpandedCompact]}
                  placeholder="Escribe el caption"
                  placeholderTextColor={theme.colors.muted}
                  textAlignVertical="top"
                />
              ) : (
                <Pressable onPress={() => setSwipeCaptionExpanded(true)} style={styles.swipeCaptionPreview}>
                  <Text style={styles.swipeCaptionPreviewText} numberOfLines={4}>
                    {selectedSwipeDraft || "Toca para expandir y editar el caption de esta variante."}
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.swipeButtons, isTiny && styles.swipeButtonsCompact]}>
              <Pressable onPress={() => props.onRejectSwipe(props.swipeCurrentVariant!.id)} style={[styles.swipeReject, isTiny && styles.swipeRejectCompact]}>
                <Text style={styles.swipeButtonText}>✕</Text>
              </Pressable>
              <Pressable onPress={() => props.onApproveSwipe(props.swipeCurrentVariant!.id)} style={[styles.swipeApprove, isTiny && styles.swipeApproveCompact]}>
                <Text style={styles.swipeButtonText}>✓</Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : (
          <View style={styles.generatingCenter}>
            <Text style={styles.h1}>Sin variantes pendientes</Text>
          </View>
        )}
      </View>
    );
  }

  if (currentStep === "summary") {
    return (
      <View style={styles.screenRoot}>
        {renderHeader("📅 Resumen y periodo", undefined)}
        <ScrollView
          contentContainerStyle={[
            styles.batchContent,
            isCompact && styles.batchContentCompact,
            isTiny && styles.batchContentTiny,
          ]}
        >
          <View style={[styles.summaryHero, isTiny && styles.summaryHeroCompact]}>
            <Text style={[styles.summaryNumber, isTiny && styles.summaryNumberCompact]}>{summaryApprovedCount}</Text>
            <Text style={styles.h1}>variantes aprobadas</Text>
            <Text style={styles.bodyMuted}>{summaryRejectedCount} rechazadas</Text>
          </View>

          <Text style={styles.sectionLabel}>¿En cuánto tiempo las publicamos?</Text>
          <View style={styles.periodGrid}>
            {([7, 14, 30] as const).map((period) => (
              <Pressable
                key={period}
                onPress={() => props.setSummaryPeriod(period)}
                style={[styles.periodCard, props.summaryPeriod === period && styles.periodCardSelected]}
              >
                <Text style={styles.periodTitle}>{period} días</Text>
                <Text style={styles.bodyMuted}>
                  {period === 7 ? "1 publicación cada 1-2 días" : period === 14 ? "1 publicación cada 2-3 días" : "1 publicación por semana"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.bodyMuted}>
              {isTiny
                ? "Programamos y te llevamos al calendario."
                : "Las publicaciones se programan automáticamente y luego te llevamos al calendario."}
            </Text>
          </View>
          <View style={[styles.screenBottomSpacer, isTiny && styles.screenBottomSpacerCompact]} />
        </ScrollView>
        <View style={styles.fixedFooter}>
          <View style={styles.buttonStack}>
            <PrimaryButton
              label="📅 Programar publicaciones"
              onPress={() => props.summaryPeriod ? props.onCommitSwipeDecisions(props.summaryPeriod) : undefined}
              disabled={props.loading || !props.summaryPeriod}
            />
            {canReopenApproval ? (
              <SecondaryButton
                label="Volver a aprobacion"
                onPress={() => void props.onReopenVariantApproval()}
                disabled={props.loading || !props.batchId}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenRoot}>
      {renderHeader("🧾 Lote activo", props.batchId ? `ID ${props.batchId}` : "Aún no se crea")}
      <ScrollView
        contentContainerStyle={[
          styles.batchContent,
          isCompact && styles.batchContentCompact,
          isTiny && styles.batchContentTiny,
        ]}
      >
        <Text style={styles.bodyMuted} numberOfLines={1}>{batch ? `Estado: ${batch.status}` : "Sin detalle aún."}</Text>
        <Text style={styles.bodyMuted}>{batch ? `Costo estimado: ${batch.estimatedCostUsd ?? "pendiente"} USD` : ""}</Text>
        <SectionCard title="📤 Subida" subtitle="Selecciona fotos y manda el lote a análisis">
          <Text style={styles.bodyMuted}>Fotos seleccionadas: {props.batchState.photos.length}</Text>
          <View style={styles.buttonStack}>
            <PrimaryButton label="📷 Elegir fotos" onPress={props.onPickPhotos} disabled={props.loading} />
            <SecondaryButton label="🔍 Subir y analizar" onPress={props.onUploadPhotos} disabled={props.loading || props.batchState.photos.length === 0 || !props.batchId} />
          </View>
        </SectionCard>
      </ScrollView>
      {renderStylePicker()}
    </View>
  );
}

function SettingsScreen(props: {
  business: BusinessDetail | null;
  page: PageSummary | null;
  tokenStatus: string | null;
  loading: boolean;
  stylesCatalog: VisualStyle[];
  onReconnect: () => void;
  onOpenPages: () => void;
  onOpenStyles: () => void;
  onLogout: () => void;
  onBack: () => void;
  onResetAutonomy: (next: Record<"STYLE_ASSIGNMENT" | "VARIANT_COUNT" | "SCHEDULING" | "CAPTION_GENERATION" | "FACEBOOK_PUBLISH", number>) => void;
  onUpdateContentTypes: (next: string[]) => void;
  onUpdateSeoKeywords: (next: string[]) => void;
}) {
  const autonomy = props.business?.autonomySettings ?? {
    STYLE_ASSIGNMENT: 60,
    VARIANT_COUNT: 65,
    SCHEDULING: 70,
    CAPTION_GENERATION: 75,
    FACEBOOK_PUBLISH: 85,
  };
  const autonomyLabels: Record<keyof typeof autonomy, string> = {
    STYLE_ASSIGNMENT: "Asignar estilo a tus fotos",
    VARIANT_COUNT: "Decidir cuántas variantes generar",
    SCHEDULING: "Elegir horarios de publicación",
    CAPTION_GENERATION: "Generar captions",
    FACEBOOK_PUBLISH: "Publicar en Facebook",
  };
  const [contentTypeDraft, setContentTypeDraft] = useState("");
  const [seoKeywordDraft, setSeoKeywordDraft] = useState("");
  const contentTypes = useMemo(() => getBusinessContentTypes(props.business?.metadata), [props.business?.metadata]);
  const seoKeywords = useMemo(() => getBusinessFacebookSeoKeywords(props.business?.metadata), [props.business?.metadata]);
  const tokenStatus = getTokenStatusLabel(props.tokenStatus);

  const handleBusinessRowPress = () => {
    if (props.tokenStatus === "expirado" || props.tokenStatus === "requiere_reconexion") {
      props.onReconnect();
      return;
    }
    props.onOpenPages();
  };

  const handleAddContentType = async () => {
    const normalized = normalizeContentType(contentTypeDraft);
    if (!normalized) {
      return;
    }
    const next = Array.from(new Set([...contentTypes, normalized]));
    if (next.length === contentTypes.length) {
      setContentTypeDraft("");
      return;
    }
    await props.onUpdateContentTypes(next);
    setContentTypeDraft("");
  };

  const handleRemoveContentType = async (item: string) => {
    await props.onUpdateContentTypes(contentTypes.filter((contentType) => contentType !== item));
  };

  const handleAddSeoKeywords = async () => {
    const additions = splitSeoKeywordList(seoKeywordDraft);
    if (!additions.length) {
      return;
    }
    const next = Array.from(new Set([...seoKeywords, ...additions]));
    if (next.length === seoKeywords.length) {
      setSeoKeywordDraft("");
      return;
    }
    await props.onUpdateSeoKeywords(next);
    setSeoKeywordDraft("");
  };

  const handleRemoveSeoKeyword = async (item: string) => {
    await props.onUpdateSeoKeywords(seoKeywords.filter((keyword) => keyword !== item));
  };

  return (
    <ScrollView contentContainerStyle={styles.screenWrap}>
      <View style={styles.batchTopBar}>
        <BackButton onPress={props.onBack} />
        <View style={styles.batchTopText}>
          <Text style={styles.h1}>⚙️ Configuración</Text>
          <Text style={styles.bodyMuted}>Negocio, autonomía, contenido, estilos y cuenta</Text>
        </View>
      </View>

      <SectionCard title="Negocio" subtitle={props.business?.name ?? "Sin negocio"}>
        <Pressable
          onPress={handleBusinessRowPress}
          disabled={props.loading}
          style={({ pressed }) => [styles.configRow, styles.configRowInteractive, pressed && styles.configRowPressed]}
        >
          <View style={styles.configRowContent}>
            <Text style={styles.configRowLabel}>Página de Facebook conectada</Text>
            <Text style={styles.configRowValue} numberOfLines={1}>
              {props.page?.pageName ?? "No disponible"}
            </Text>
          </View>
          <View style={styles.configRowTrailing}>
            <View
              style={[
                styles.configStatusChip,
                props.tokenStatus === "expirado" || props.tokenStatus === "requiere_reconexion"
                  ? styles.configStatusChipDanger
                  : props.tokenStatus === "valido" || props.tokenStatus === "por_vencer"
                    ? styles.configStatusChipOk
                    : styles.configStatusChipMuted,
              ]}
            >
              <Text style={styles.configStatusChipText}>{tokenStatus}</Text>
            </View>
            <Text style={styles.configChevron}>›</Text>
          </View>
        </Pressable>

        <View style={styles.configRow}>
          <View style={styles.configRowContent}>
            <Text style={styles.configRowLabel}>Industria</Text>
            <Text style={styles.configRowValue}>{props.business?.industry ?? "Sin definir"}</Text>
          </View>
        </View>

        <View style={styles.configRow}>
          <View style={styles.configRowContent}>
            <Text style={styles.configRowLabel}>Zona horaria</Text>
            <Text style={styles.configRowValue}>{props.business?.timezone ?? "Sin definir"}</Text>
          </View>
        </View>
      </SectionCard>

      <SectionCard title="🤖 Autonomía" subtitle="Lo que el sistema ya hace solo">
        {(Object.keys(autonomy) as Array<keyof typeof autonomy>).map((key) => (
          <View key={key} style={styles.configRow}>
            <View style={styles.configRowContent}>
              <Text style={styles.configRowLabel}>{autonomyLabels[key]}</Text>
            </View>
            <View style={styles.configRowTrailing}>
              <View
                style={[
                  styles.autonomyStatePill,
                  getAutonomyTone(autonomy[key]) === "autonomous" ? styles.autonomyStatePillAuto : styles.autonomyStatePillManual,
                ]}
              >
                <Text style={styles.autonomyStateText}>
                  {getAutonomyTone(autonomy[key]) === "autonomous" ? "Autonomo" : "Requiere confirmacion"}
                </Text>
              </View>
              {getAutonomyTone(autonomy[key]) === "autonomous" ? (
                <Pressable
                  onPress={() => props.onResetAutonomy({ ...autonomy, [key]: 0 })}
                  disabled={props.loading}
                  style={({ pressed }) => [styles.configInlineAction, pressed && !props.loading && styles.configRowPressed]}
                >
                  <Text style={styles.configInlineActionText}>Resetear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="🎨 Estilos visuales" subtitle="Se abren en una pantalla aparte">
        <Text style={styles.bodyMuted}>Ver, editar y crear estilos en una vista dedicada para no ocupar tanto espacio aquí.</Text>
        <Pressable
          onPress={props.onOpenStyles}
          disabled={props.loading}
          style={({ pressed }) => [styles.configRow, styles.configRowInteractive, pressed && !props.loading && styles.configRowPressed]}
        >
          <View style={styles.configRowContent}>
            <Text style={styles.configRowLabel}>Abrir editor de estilos</Text>
            <Text style={styles.configRowValue} numberOfLines={1}>
              {props.stylesCatalog.length ? `${props.stylesCatalog.length} estilos guardados` : "Sin estilos todavía"}
            </Text>
          </View>
          <Text style={styles.configChevron}>›</Text>
        </Pressable>
      </SectionCard>

      <SectionCard title="📦 Contenido" subtitle="Tipos personalizados de publicaciones">
        {contentTypes.length ? (
          contentTypes.map((contentType) => (
            <Pressable
              key={contentType}
              onPress={() => void handleRemoveContentType(contentType)}
              disabled={props.loading}
              style={({ pressed }) => [styles.configRow, styles.configRowInteractive, pressed && !props.loading && styles.configRowPressed]}
            >
              <View style={styles.configRowContent}>
                <Text style={styles.configRowLabel}>{contentType}</Text>
              </View>
              <Text style={styles.configInlineActionText}>Eliminar</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.bodyMuted}>Aún no agregas tipos de contenido.</Text>
        )}

        <View style={styles.contentComposer}>
          <TextInput
            value={contentTypeDraft}
            onChangeText={setContentTypeDraft}
            placeholder="Nuevo tipo, ej. Promocion"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="words"
            autoCorrect={false}
            style={[styles.input, styles.contentInput]}
          />
          <SecondaryButton
            label="➕ Agregar"
            onPress={() => void handleAddContentType()}
            disabled={props.loading || !normalizeContentType(contentTypeDraft)}
          />
        </View>
      </SectionCard>

      <SectionCard title="SEO Facebook" subtitle="Keywords locales para los captions">
        <Text style={styles.bodyMuted}>
          Estas palabras se mandan a OpenAI cuando genera el texto, optimizadas para busqueda local dentro de Facebook.
        </Text>
        {seoKeywords.length ? (
          seoKeywords.map((keyword) => (
            <Pressable
              key={keyword}
              onPress={() => void handleRemoveSeoKeyword(keyword)}
              disabled={props.loading}
              style={({ pressed }) => [styles.configRow, styles.configRowInteractive, pressed && !props.loading && styles.configRowPressed]}
            >
              <View style={styles.configRowContent}>
                <Text style={styles.configRowLabel}>{keyword}</Text>
              </View>
              <Text style={styles.configInlineActionText}>Eliminar</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.bodyMuted}>Aun no agregas keywords SEO para Facebook.</Text>
        )}

        <View style={styles.contentComposer}>
          <TextInput
            value={seoKeywordDraft}
            onChangeText={setSeoKeywordDraft}
            placeholder="sushi Tapalpa, sushi en Tapalpa"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.contentInput]}
          />
          <SecondaryButton
            label="Agregar"
            onPress={() => void handleAddSeoKeywords()}
            disabled={props.loading || splitSeoKeywordList(seoKeywordDraft).length === 0}
          />
        </View>
      </SectionCard>

      <SectionCard title="👤 Cuenta" subtitle="Sesión local">
        <Pressable onPress={props.onLogout} style={styles.logoutRow}>
          <Text style={styles.logoutText}>🚪 Cerrar sesión</Text>
        </Pressable>
      </SectionCard>
    </ScrollView>
  );
}

function StyleEditorScreen(props: {
  stylesCatalog: VisualStyle[];
  loading: boolean;
  onBack: () => void;
  onCreateStyle: (body: CreateVisualStyleRequest) => Promise<void>;
  onUpdateStyle: (styleId: string, body: UpdateVisualStyleRequest) => Promise<void>;
  onDeleteStyle: (styleId: string) => Promise<void>;
}) {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 430 || height < 760;
  const isTiny = width < 380 || height < 700;
  const [styleEditor, setStyleEditor] = useState<StyleEditorState>({
    visible: false,
    mode: "create",
    styleId: null,
    draft: styleToDraft(null),
  });
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleDeleteTarget, setStyleDeleteTarget] = useState<VisualStyle | null>(null);

  const openCreateStyle = () => {
    setStyleError(null);
    setStyleEditor({
      visible: true,
      mode: "create",
      styleId: null,
      draft: styleToDraft(null),
    });
  };

  const openEditStyle = (style: VisualStyle) => {
    setStyleError(null);
    setStyleEditor({
      visible: true,
      mode: "edit",
      styleId: style.id,
      draft: styleToDraft(style),
    });
  };

  const closeStyleEditor = () => {
    if (styleSaving) {
      return;
    }
    setStyleError(null);
    setStyleEditor((current) => ({ ...current, visible: false }));
  };

  const handleSaveStyle = async () => {
    const draft = styleEditor.draft;
    const name = draft.name.trim();
    const description = draft.description.trim();
    const promptTemplate = draft.promptTemplate.trim();
    if (!name || !description || !promptTemplate) {
      setStyleError("Completa nombre, descripcion e instruccion antes de guardar.");
      return;
    }

    setStyleSaving(true);
    setStyleError(null);
    try {
      if (styleEditor.mode === "create") {
        await props.onCreateStyle(draftToCreateStyleRequest(draft));
      } else if (styleEditor.styleId) {
        await props.onUpdateStyle(styleEditor.styleId, draftToUpdateStyleRequest(draft));
      }
      setStyleEditor({
        visible: false,
        mode: "create",
        styleId: null,
        draft: styleToDraft(null),
      });
    } catch (err) {
      setStyleError(err instanceof Error ? err.message : "No se pudo guardar el estilo");
    } finally {
      setStyleSaving(false);
    }
  };

  const handleDeleteStyle = async () => {
    if (!styleDeleteTarget) {
      return;
    }

    setStyleSaving(true);
    setStyleError(null);
    try {
      await props.onDeleteStyle(styleDeleteTarget.id);
      setStyleDeleteTarget(null);
      if (styleEditor.styleId === styleDeleteTarget.id) {
        setStyleEditor({
          visible: false,
          mode: "create",
          styleId: null,
          draft: styleToDraft(null),
        });
      }
    } catch (err) {
      setStyleError(err instanceof Error ? err.message : "No se pudo eliminar el estilo");
    } finally {
      setStyleSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screenWrap,
        isCompact && styles.styleScreenWrapCompact,
        isTiny && styles.styleScreenWrapTiny,
      ]}
    >
      <View style={styles.batchTopBar}>
        <BackButton onPress={props.onBack} disabled={styleSaving} compact={isTiny} label={isTiny ? "←" : "← Volver"} />
        <View style={styles.batchTopText}>
          <Text style={styles.sectionLabel}>CATALOGO DE ESTILOS</Text>
          <Text style={[styles.h1, isTiny && styles.h1Compact]}>🎨 Estilos visuales</Text>
          {!isCompact ? <Text style={styles.bodyMuted}>Edita, borra o agrega estilos manualmente</Text> : null}
        </View>
      </View>

      <SectionCard title="Biblioteca" subtitle={isCompact ? undefined : "Se usan para analizar fotos y generar variantes"}>
        <Text style={styles.bodyMuted}>{props.stylesCatalog.length} estilos guardados.</Text>
        <View style={styles.sectionActionRow}>
          <PrimaryButton
            label={isCompact ? "➕ Nuevo" : "➕ Nuevo estilo"}
            onPress={openCreateStyle}
            disabled={props.loading || styleSaving}
          />
        </View>
        {props.stylesCatalog.length ? (
          props.stylesCatalog.map((style) => (
            <View key={style.id} style={[styles.styleCard, isCompact && styles.styleCardCompact, isTiny && styles.styleCardTiny]}>
              <View style={[styles.styleCardHeader, isTiny && styles.styleCardHeaderTiny]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle} numberOfLines={isCompact ? 1 : 2}>
                    {getStyleIntensityEmoji(style.intensity)} {style.name}
                  </Text>
                  {!isCompact ? <Text style={styles.bodyMuted}>{style.description}</Text> : null}
                </View>
                <View style={[styles.styleMetaPill, style.isCustom ? styles.styleMetaPillCustom : styles.styleMetaPillBase]}>
                  <Text style={styles.styleMetaPillText}>{style.isCustom ? "Personal" : "Base"}</Text>
                </View>
              </View>
              <Text style={styles.stylePrompt} numberOfLines={isTiny ? 2 : isCompact ? 2 : 3}>
                {style.promptTemplate}
              </Text>
              {!isCompact ? (
                <View style={styles.styleTagRow}>
                  <Text style={styles.styleTagText}>
                    🏷️ {style.recommendedIndustries.length ? style.recommendedIndustries.join(" · ") : "Sin industrias"}
                  </Text>
                  <Text style={styles.styleTagText}>
                    🖼️ {style.recommendedPhotoTypes.length ? style.recommendedPhotoTypes.join(" · ") : "Sin tipos"}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.styleCardActions, isCompact && styles.styleCardActionsCompact, isTiny && styles.styleCardActionsTiny]}>
                <SecondaryButton
                  label={isTiny ? "✏️" : isCompact ? "✏️ Editar" : "✏️ Modificar"}
                  onPress={() => openEditStyle(style)}
                  disabled={props.loading || styleSaving}
                />
                <DangerButton
                  label={isTiny ? "🗑️" : isCompact ? "🗑️ Borrar" : "🗑️ Eliminar"}
                  onPress={() => setStyleDeleteTarget(style)}
                  disabled={props.loading || styleSaving}
                />
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.bodyMuted}>No hay estilos guardados todavía.</Text>
        )}
      </SectionCard>

      <Modal visible={styleEditor.visible} transparent animationType="slide" onRequestClose={closeStyleEditor}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalScrim} onPress={styleSaving ? undefined : closeStyleEditor} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, (isCompact || isTiny) && styles.sheetTitleCompact]}>
                {styleEditor.mode === "create" ? "➕ Nuevo estilo" : "✏️ Modificar estilo"}
              </Text>
              <SecondaryButton label={isCompact ? "✕" : "✕ Cerrar"} onPress={closeStyleEditor} disabled={styleSaving} />
            </View>
            <ScrollView
              contentContainerStyle={[styles.sheetBody, isCompact && styles.sheetBodyCompact, isTiny && styles.sheetBodyTiny]}
            >
              {styleError ? <Text style={styles.errorText}>{styleError}</Text> : null}
              <Text style={styles.fieldLabel}>Nombre</Text>
              <TextInput
                value={styleEditor.draft.name}
                onChangeText={(value) => setStyleEditor((current) => ({ ...current, draft: { ...current.draft, name: value } }))}
                placeholder="Ej. Look gourmet"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Descripcion</Text>
              <TextInput
                value={styleEditor.draft.description}
                onChangeText={(value) => setStyleEditor((current) => ({ ...current, draft: { ...current.draft, description: value } }))}
                placeholder="Descripcion corta del estilo"
                placeholderTextColor={theme.colors.muted}
                style={[styles.input, styles.multilineInput]}
                multiline
              />
              <Text style={styles.fieldLabel}>Prompt base</Text>
              <TextInput
                value={styleEditor.draft.promptTemplate}
                onChangeText={(value) => setStyleEditor((current) => ({ ...current, draft: { ...current.draft, promptTemplate: value } }))}
                placeholder="Instruccion que usara la IA"
                placeholderTextColor={theme.colors.muted}
                style={[styles.input, styles.multilineInput]}
                multiline
              />
              <Text style={styles.fieldLabel}>Industria sugerida</Text>
              <TextInput
                value={styleEditor.draft.recommendedIndustries}
                onChangeText={(value) =>
                  setStyleEditor((current) => ({ ...current, draft: { ...current.draft, recommendedIndustries: value } }))
                }
                placeholder="restaurante, cafeteria, tienda"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Tipos de foto</Text>
              <TextInput
                value={styleEditor.draft.recommendedPhotoTypes}
                onChangeText={(value) =>
                  setStyleEditor((current) => ({ ...current, draft: { ...current.draft, recommendedPhotoTypes: value } }))
                }
                placeholder="producto, comida, persona"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Intensidad</Text>
              <View style={styles.segmentRow}>
                {(["ligera", "media", "fuerte"] as Array<StyleDraft["intensity"]>).map((intensity) => {
                  const active = styleEditor.draft.intensity === intensity;
                  return (
                    <Pressable
                      key={intensity}
                      onPress={() => setStyleEditor((current) => ({ ...current, draft: { ...current.draft, intensity } }))}
                      style={[styles.segmentButton, active && styles.segmentButtonActive]}
                    >
                      <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>
                        {getStyleIntensityEmoji(intensity)} {getStyleIntensityLabel(intensity)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Divulgacion IA</Text>
              <View style={styles.segmentRow}>
                {[
                  { label: "No", value: false },
                  { label: "Si", value: true },
                ].map((option) => {
                  const active = styleEditor.draft.aiDisclosureRequired === option.value;
                  return (
                    <Pressable
                      key={option.label}
                      onPress={() => setStyleEditor((current) => ({ ...current, draft: { ...current.draft, aiDisclosureRequired: option.value } }))}
                      style={[styles.segmentButton, active && styles.segmentButtonActive]}
                    >
                      <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>
                        {option.value ? "✅" : "✖️"} {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Restricciones</Text>
              <TextInput
                value={styleEditor.draft.restrictions}
                onChangeText={(value) => setStyleEditor((current) => ({ ...current, draft: { ...current.draft, restrictions: value } }))}
                placeholder="Una por linea o separadas por coma"
                placeholderTextColor={theme.colors.muted}
                style={[styles.input, styles.multilineInput]}
                multiline
              />
              {!isCompact ? (
                <Text style={styles.bodyMuted}>
                  Tip: puedes usar comas o saltos de linea para listas. El estilo se guardara en la app y se usara al generar fotos.
                </Text>
              ) : null}
              <View style={styles.confirmDialogActions}>
                <SecondaryButton label="Cancelar" onPress={closeStyleEditor} disabled={styleSaving} />
                <PrimaryButton label={styleSaving ? "Guardando..." : "Guardar estilo"} onPress={() => void handleSaveStyle()} disabled={styleSaving} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(styleDeleteTarget)} transparent animationType="slide" onRequestClose={() => setStyleDeleteTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalScrim} onPress={styleSaving ? undefined : () => setStyleDeleteTarget(null)} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>🗑️ Eliminar estilo</Text>
            <Text style={styles.bodyMuted}>
              {styleDeleteTarget
                ? isTiny
                  ? `Vas a eliminar "${styleDeleteTarget.name}".`
                  : `Vas a eliminar "${styleDeleteTarget.name}". Los elementos ya creados no se borran, pero este estilo dejará de aparecer para nuevas asignaciones.`
                : "Confirma si deseas eliminar este estilo."}
            </Text>
            <View style={styles.confirmDialogActions}>
              <SecondaryButton label="Mantenerlo" onPress={() => setStyleDeleteTarget(null)} disabled={styleSaving} />
              <DangerButton label={styleSaving ? "Eliminando..." : "Eliminar estilo"} onPress={() => void handleDeleteStyle()} disabled={styleSaving} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function WelcomeScreen(props: {
  business: BusinessSummary | null;
  page: PageSummary | null;
  onBack: () => void;
  onStart: () => void;
}) {
  return (
    <View style={styles.screenRoot}>
      <View style={styles.welcomeTopBar}>
        <BackButton onPress={props.onBack} />
      </View>
      <View style={styles.welcomeCenter}>
        {props.page?.coverPhotoUrl ? <Image source={{ uri: props.page.coverPhotoUrl }} style={styles.welcomeAvatar} /> : <View style={styles.welcomeAvatarFallback} />}
        <Text style={styles.h1}>👋 Hola, {props.business?.name ?? "negocio"}</Text>
        <Text style={styles.bodyMuted}>Tu negocio esta conectado y listo.</Text>
      </View>
      <View style={styles.fixedFooter}>
        <PrimaryButton label="Empezar" onPress={props.onStart} />
      </View>
    </View>
  );
}

function ReportScreen(props: {
  dashboard: BusinessDashboard | null;
  onBack: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 430 || height < 760;
  const isTiny = width < 380 || height < 700;
  const report = props.dashboard?.weeklyReport;
  const performance = props.dashboard?.performance ?? null;
  const reportMetrics = [
    {
      label: "Alcance",
      value: formatCompactNumber(performance?.reach),
      caption: "Semana actual",
      accent: theme.colors.accent,
    },
    {
      label: "Engagement",
      value: formatCompactNumber(performance?.engagement),
      caption: "Interacciones",
      accent: theme.colors.success,
    },
    {
      label: "Publicadas",
      value: formatCompactNumber(performance?.postsPublished),
      caption: "Posts activos",
      accent: theme.colors.info,
    },
  ];
  return (
    <ScrollView
      contentContainerStyle={[
        styles.screenWrap,
        styles.reportContent,
        isCompact && styles.reportContentCompact,
        isTiny && styles.reportContentTiny,
      ]}
    >
      <View style={styles.batchTopBar}>
        <BackButton onPress={props.onBack} compact={isTiny} label={isTiny ? "←" : "← Volver"} />
        <View style={styles.batchTopText}>
          <Text style={styles.sectionLabel}>RESUMEN SEMANAL</Text>
          <Text style={[styles.h1, isTiny && styles.h1Compact]} numberOfLines={1}>
            📈 Reporte semanal
          </Text>
          <Text style={styles.bodyMuted} numberOfLines={1}>
            {report?.weekLabel ?? "Sin periodo disponible"}
          </Text>
        </View>
      </View>
      {report ? (
        <>
          <View style={[styles.reportHero, isCompact && styles.reportHeroCompact, isTiny && styles.reportHeroTiny]}>
            <Text style={styles.reportHeroLabel}>Tu semana en una vista</Text>
            <Text style={[styles.reportHeroTitle, isCompact && styles.reportHeroTitleCompact]}>{report.weekLabel}</Text>
            {!isTiny ? (
              <Text style={[styles.reportHeroBody, isCompact && styles.reportHeroBodyCompact]}>
                Lo importante queda arriba y el detalle sigue abajo, sin perder contexto.
              </Text>
            ) : null}
          </View>

          <View style={[styles.reportMetricGrid, isCompact && styles.reportMetricGridCompact]}>
            {reportMetrics.map((metric) => (
              <View
                key={metric.label}
                style={[styles.reportMetricCard, isCompact && styles.reportMetricCardCompact, { borderTopColor: metric.accent }]}
              >
                <Text style={styles.reportMetricLabel}>{metric.label}</Text>
                <Text style={[styles.reportMetricValue, isCompact && styles.reportMetricValueCompact, { color: metric.accent }]}>{metric.value}</Text>
                <Text style={styles.reportMetricCaption}>{metric.caption}</Text>
              </View>
            ))}
          </View>

          {report.sections.map((section) => (
            <SectionCard key={section.title} title={section.title} style={isTiny ? styles.reportSectionCardTiny : undefined}>
              <View style={[styles.reportSectionList, isCompact && styles.reportSectionListCompact]}>
                {section.body.map((line) => (
                  <View key={line} style={styles.reportSectionRow}>
                    <View style={styles.reportSectionBullet} />
                    <Text style={[styles.reportSectionText, isCompact && styles.reportSectionTextCompact]}>{line}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>
          ))}
        </>
      ) : (
        <View style={styles.emptyHero}>
          <Text style={[styles.h1, isTiny && styles.h1Compact]}>Aún no hay reporte</Text>
          <Text style={styles.bodyMuted}>Cuando exista te mostraremos los resultados de la semana.</Text>
        </View>
      )}
    </ScrollView>
  );
}

function TokenHelpSheet(props: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.modalScrim} onPress={props.onClose} />
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>ℹ️ Cómo conseguir el token</Text>
            <SecondaryButton label="✕ Cerrar" onPress={props.onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.bodyMuted}>1. 🔐 Abre Meta desde otro dispositivo o el panel de desarrolladores.</Text>
            <Text style={styles.bodyMuted}>2. 🧩 Genera un token con permisos de páginas activas.</Text>
            <Text style={styles.bodyMuted}>3. 📋 Pega el token largo aquí y continúa.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AnalysisBanner(props: { state: AnalysisBannerState | null; onOpenBatch: () => void; onDismiss: () => void }) {
  if (!props.state) return null;
  return (
    <Pressable onPress={props.state.ready ? props.onOpenBatch : undefined} style={styles.analysisBanner}>
      <View style={styles.analysisBannerTop}>
        {props.state.ready ? <Text style={styles.analysisBannerIcon}>✅</Text> : <ActivityIndicator color={theme.colors.accent} size="small" />}
        <Text style={styles.analysisBannerText}>{props.state.ready ? "Lote listo" : `Analizando ${props.state.done} de ${props.state.total} fotos...`}</Text>
        {props.state.ready ? <Text style={styles.analysisBannerAction}>Ver fotos →</Text> : null}
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, (props.state.done / Math.max(1, props.state.total)) * 100)}%` }]} />
      </View>
    </Pressable>
  );
}

export default function AppShell() {
  const [screen, setScreen] = useState<ScreenKey>("boot");
  const [bootstrap, setBootstrap] = useState<any | null>(null);
  const [metaToken, setMetaToken] = useState(() => DEFAULT_META_TOKEN);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDeviceLogin, setPendingDeviceLogin] = useState<MetaDeviceLoginResponse | null>(null);
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [dashboard, setDashboard] = useState<BusinessDashboard | null>(null);
  const [businessDetail, setBusinessDetail] = useState<BusinessDetail | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [batchState, setBatchState] = useState<BatchState>(emptyBatchState);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [batchStep, setBatchStep] = useState<BatchFlowStep>("upload");
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [stylePickerPhotoId, setStylePickerPhotoId] = useState<string | null>(null);
  const [cancelBatchPromptVisible, setCancelBatchPromptVisible] = useState<CancelBatchPromptState["visible"]>(false);
  const [stylesCatalog, setStylesCatalog] = useState<VisualStyle[]>([]);
  const [analysisBanner, setAnalysisBanner] = useState<AnalysisBannerState | null>(null);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostSummary[]>([]);
  const [captionDrafts, setCaptionDrafts] = useState<CaptionDraftMap>({});
  const [swipeDecisions, setSwipeDecisions] = useState<SwipeDecisionMap>({});
  const [swipeHistory, setSwipeHistory] = useState<Array<{ variantId: string; decision: SwipeDecision }>>([]);
  const [swipeIndex, setSwipeIndex] = useState(0);
  const [summaryPeriod, setSummaryPeriod] = useState<7 | 14 | 30 | null>(null);
  const [tokenStatus, setTokenStatus] = useState<string | null>(null);
  const [calendarMonthAnchor, setCalendarMonthAnchor] = useState<Date>(() => new Date());
  const [calendarSelectedDayKey, setCalendarSelectedDayKey] = useState<string | null>(null);
  const [calendarSelectedPostId, setCalendarSelectedPostId] = useState<string | null>(null);
  const [calendarDetailEditing, setCalendarDetailEditing] = useState(false);
  const [calendarDetailDraft, setCalendarDetailDraft] = useState<CalendarDraft>(() => toCalendarDraft(null));
  const [selectedBusinessHasSeenWelcome, setSelectedBusinessHasSeenWelcome] = useState<boolean | null>(null);
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState<ScreenKey[]>([]);
  const screenRef = useRef<ScreenKey>("boot");

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const batchBelongsToActiveBusiness = batchState.businessId !== null && batchState.businessId === activeBusinessId;
  const currentBatchId = batchBelongsToActiveBusiness ? batchState.batchId : null;

  const resetBusinessScopedState = () => {
    setDashboard(null);
    setBusinessDetail(null);
    setBatchState(emptyBatchState);
    setBatchDetail(null);
    setBatchStep("upload");
    setSelectedPhotoId(null);
    setStylePickerPhotoId(null);
    setAnalysisBanner(null);
    setScheduledPosts([]);
    setCaptionDrafts({});
    setSwipeDecisions({});
    setSwipeHistory([]);
    setSwipeIndex(0);
    setSummaryPeriod(null);
    setCalendarMonthAnchor(new Date());
    setCalendarSelectedDayKey(null);
    setCalendarSelectedPostId(null);
    setCalendarDetailEditing(false);
    setCalendarDetailDraft(toCalendarDraft(null));
    setCancelBatchPromptVisible(false);
    setSelectedBusinessHasSeenWelcome(null);
  };

  const refreshBootstrap = async () => {
    const status = await api.bootstrapStatus();
    setBootstrap(status);
    replaceScreen(resolveInitialScreen(status));
    setTokenStatus(status.facebookTokenStatus);
  };

  const pushScreen = (next: ScreenKey) => {
    const current = screenRef.current;
    if (current === next) {
      return;
    }
    const bootFallback: Partial<Record<ScreenKey, ScreenKey>> = {
      pages: "token",
      welcome: "pages",
      home: "pages",
      batch: "home",
      calendar: "home",
      settings: "home",
      styles: "settings",
      report: "home",
      reconnect: "home",
    };
    const previous = current === "boot" ? bootFallback[next] : current;
    if (previous) {
      setNavigationHistory((history) => [...history, previous]);
    }
    setScreen(next);
  };

  const replaceScreen = (next: ScreenKey) => {
    setScreen(next);
  };

  const goBack = () => {
    if (!navigationHistory.length) {
      return;
    }
    const previous = navigationHistory[navigationHistory.length - 1];
    setNavigationHistory((history) => history.slice(0, -1));
    setScreen(previous);
  };

  const refreshScheduledPosts = async (businessId = activeBusinessId) => {
    if (!businessId) {
      return [] as ScheduledPostSummary[];
    }
    const posts = await api.listScheduledPosts(businessId);
    setScheduledPosts(posts);
    return posts;
  };

  const refreshStylesCatalog = async () => {
    const items = await api.listStyles();
    setStylesCatalog(items);
    return items;
  };

  const refreshBusinesses = async (preferredBusinessId: string | null = activeBusinessId): Promise<BusinessSummary | null> => {
    const items = await api.listBusinesses();
    setBusinesses(items);
    const storedSelectedId = await sessionStorage.getSelectedBusinessId();
    const storedSelectedPageId = await sessionStorage.getSelectedPageId();
    const preferredId = preferredBusinessId && items.some((business) => business.id === preferredBusinessId) ? preferredBusinessId : null;
    const storedBusinessId = storedSelectedId && items.some((business) => business.id === storedSelectedId) ? storedSelectedId : null;
    const storedPageBusinessId =
      storedSelectedPageId ? items.find((business) => business.facebookPageId === storedSelectedPageId)?.id ?? null : null;
    const resolvedBusinessId = preferredId ?? storedBusinessId ?? storedPageBusinessId ?? (items.length === 1 ? items[0]?.id ?? null : null);
    const existing = resolvedBusinessId ? items.find((business) => business.id === resolvedBusinessId) ?? null : null;
    if (existing) {
      if (existing.id !== activeBusinessId) {
        resetBusinessScopedState();
      }
      setActiveBusinessId(existing.id);
      if (storedSelectedId !== existing.id || storedSelectedPageId !== existing.facebookPageId) {
        await Promise.all([
          businessSettingsStorage.setSelectedBusinessId(existing.id),
          businessSettingsStorage.setSelectedPageId(existing.facebookPageId),
        ]);
      }
      const [dash, detail] = await Promise.all([api.getDashboard(existing.id), api.getBusiness(existing.id), refreshScheduledPosts(existing.id)]);
      setDashboard(dash);
      setBusinessDetail(detail);
      const seenWelcome = await sessionStorage.hasSeenWelcome(existing.id);
      setSelectedBusinessHasSeenWelcome(seenWelcome);
      if ((screen === "boot" || screen === "home") && !seenWelcome) {
        replaceScreen("welcome");
      }
      return existing;
    }
    setActiveBusinessId(null);
    resetBusinessScopedState();
    await Promise.all([
      businessSettingsStorage.setSelectedBusinessId(null),
      businessSettingsStorage.setSelectedPageId(null),
    ]);
    if (screen !== "pages" && screen !== "token") {
      replaceScreen("pages");
    }
    return null;
  };

  const refreshBatchData = async (businessId = activeBusinessId, batchId = currentBatchId) => {
    if (!businessId || !batchId) {
      return [] as ScheduledPostSummary[];
    }

    const [detail, posts, dash] = await Promise.all([api.getBatch(businessId, batchId), refreshScheduledPosts(businessId), api.getDashboard(businessId)]);
    setBatchDetail(detail);
    setBatchStep(getBatchFlowStep(detail));
    setCaptionDrafts(
      Object.fromEntries(detail.variants.map((variant) => [variant.id, variant.caption ?? ""])),
    );
    setDashboard(dash);
    return posts;
  };

  const applyConnectedSession = async (result: MetaTokenConnectionResponse, source: "auto" | "manual" | "refresh") => {
    await saveMetaToken(result.token);
    setMetaToken(result.token);
    setError(null);
    setPendingDeviceLogin(null);
    setDeviceMessage(null);
    setPages(result.pages);
    setBootstrap(result.status);
    setTokenStatus(result.status.facebookTokenStatus);

    if (result.status.nextStep === "select_page") {
      pushScreen("pages");
      return;
    }

    const resolvedBusiness = await refreshBusinesses();
    if (!resolvedBusiness) {
      pushScreen("pages");
      return;
    }
    const seenWelcome = await sessionStorage.hasSeenWelcome(resolvedBusiness.id);
    setSelectedBusinessHasSeenWelcome(seenWelcome);
    pushScreen(seenWelcome ? "home" : "welcome");
    void source;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initialStatus = await api.bootstrapStatus();
      if (cancelled) return;
      setBootstrap(initialStatus);
      setTokenStatus(initialStatus.facebookTokenStatus);

      const testBootstrapToken = DEFAULT_META_TOKEN.trim();
      if (!initialStatus.hasUsers && testBootstrapToken) {
        setMetaToken(testBootstrapToken);
        try {
          const result = await api.connectMetaToken(testBootstrapToken, "auto");
          if (cancelled) return;
          await applyConnectedSession(result, "auto");
          return;
        } catch {
          if (cancelled) return;
        }
      }

      const token = await sessionStorage.getMetaToken();
      if (token) {
        setMetaToken(token);
        try {
          const result = await api.connectMetaToken(token, "refresh");
          if (cancelled) return;
          await applyConnectedSession(result, "refresh");
          return;
        } catch {
          await clearMetaToken();
          if (cancelled) return;
          setMetaToken(testBootstrapToken);
        }
      }

      try {
        const result = await api.autoConnectMeta();
        if (cancelled) return;
        if (result.token) {
          await applyConnectedSession(result, "auto");
          return;
        }
        if (result.status.nextStep === "select_page") {
          setPendingDeviceLogin(null);
          setDeviceMessage(null);
          setPages(result.pages);
          setBootstrap(result.status);
          setTokenStatus(result.status.facebookTokenStatus);
          pushScreen("pages");
          return;
        }
        if (result.status.nextStep === "home") {
          setPendingDeviceLogin(null);
          setDeviceMessage(null);
          setPages(result.pages);
          setBootstrap(result.status);
          setTokenStatus(result.status.facebookTokenStatus);
          const resolvedBusiness = await refreshBusinesses();
          if (!resolvedBusiness) {
            pushScreen("pages");
            return;
          }
          const seenWelcome = await sessionStorage.hasSeenWelcome(resolvedBusiness.id);
          setSelectedBusinessHasSeenWelcome(seenWelcome);
          pushScreen(seenWelcome ? "home" : "welcome");
          return;
        }
        if (mobileRuntimeConfig.allowTestBootstrap && result.status.nextStep === "connect_meta" && result.pages.length > 0) {
          setPendingDeviceLogin(null);
          setDeviceMessage(null);
          setPages(result.pages);
          setBootstrap(result.status);
          setTokenStatus(result.status.facebookTokenStatus);
          const resolvedBusiness = await refreshBusinesses();
          if (!resolvedBusiness) {
            pushScreen("pages");
            return;
          }
          const seenWelcome = await sessionStorage.hasSeenWelcome(resolvedBusiness.id);
          setSelectedBusinessHasSeenWelcome(seenWelcome);
          pushScreen(seenWelcome ? "home" : "welcome");
          return;
        }
        if (result.pendingDeviceLogin) {
          setPendingDeviceLogin(result.pendingDeviceLogin);
          setDeviceMessage(result.message ?? "Aprueba el código en Meta para continuar.");
          setBootstrap(result.status);
          setPages(result.pages);
          setTokenStatus(result.status.facebookTokenStatus);
          replaceScreen("token");
          return;
        }
        replaceScreen("token");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Boot failed");
        replaceScreen("token");
      }
    })().catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "Boot failed");
      replaceScreen("token");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .listStyles()
      .then((items) => {
        if (cancelled) return;
        setStylesCatalog(items);
      })
      .catch(() => {
        if (cancelled) return;
        setStylesCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (screen === "home" && activeBusinessId) {
      api.getDashboard(activeBusinessId).then(setDashboard).catch((err) => setError(err.message));
      api.getBusiness(activeBusinessId).then(setBusinessDetail).catch(() => undefined);
    }
  }, [screen, activeBusinessId]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBusinessId) {
      setSelectedBusinessHasSeenWelcome(null);
      return undefined;
    }

    sessionStorage
      .hasSeenWelcome(activeBusinessId)
      .then((seen) => {
        if (cancelled) return;
        setSelectedBusinessHasSeenWelcome(seen);
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedBusinessHasSeenWelcome(true);
      });

    return () => {
      cancelled = true;
    };
  }, [activeBusinessId]);

  useEffect(() => {
    if (!pendingDeviceLogin) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const result = await api.autoConnectMeta();
        if (cancelled) return;
        if (result.token) {
          await applyConnectedSession(result, "auto");
          return;
        }
        if (result.pendingDeviceLogin) {
          setPendingDeviceLogin(result.pendingDeviceLogin);
          setDeviceMessage(result.message ?? "Esperando aprobacion de Meta...");
        }
      } catch (err) {
        if (cancelled) return;
        setPendingDeviceLogin(null);
        setDeviceMessage(null);
        setError(err instanceof Error ? err.message : "No se pudo verificar el código automáticamente");
      }
    };

    void poll();
    const intervalMs = Math.max(2500, pendingDeviceLogin.intervalSeconds * 1000);
    const timer = setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingDeviceLogin]);

  const handleManualConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.connectMetaToken(metaToken.trim(), "manual");
      await applyConnectedSession(result, "manual");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo conectar");
    } finally {
      setLoading(false);
    }
  };

  const handleAutoConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.autoConnectMeta();
      if (result.token) {
        await applyConnectedSession(result, "auto");
        return;
      }
      if (result.status.nextStep === "select_page") {
        setPendingDeviceLogin(null);
        setDeviceMessage(null);
        setPages(result.pages);
        setBootstrap(result.status);
        setTokenStatus(result.status.facebookTokenStatus);
        pushScreen("pages");
        return;
      }
      if (result.status.nextStep === "home") {
        setPendingDeviceLogin(null);
        setDeviceMessage(null);
        setPages(result.pages);
        setBootstrap(result.status);
        setTokenStatus(result.status.facebookTokenStatus);
        const resolvedBusiness = await refreshBusinesses();
        if (!resolvedBusiness) {
          pushScreen("pages");
          return;
        }
        const seenWelcome = await sessionStorage.hasSeenWelcome(resolvedBusiness.id);
        setSelectedBusinessHasSeenWelcome(seenWelcome);
        pushScreen(seenWelcome ? "home" : "welcome");
        return;
      }
      if (mobileRuntimeConfig.allowTestBootstrap && result.status.nextStep === "connect_meta" && result.pages.length > 0) {
        setPendingDeviceLogin(null);
        setDeviceMessage(null);
        setPages(result.pages);
        setBootstrap(result.status);
        setTokenStatus(result.status.facebookTokenStatus);
        const resolvedBusiness = await refreshBusinesses();
        if (!resolvedBusiness) {
          pushScreen("pages");
          return;
        }
        const seenWelcome = await sessionStorage.hasSeenWelcome(resolvedBusiness.id);
        setSelectedBusinessHasSeenWelcome(seenWelcome);
        pushScreen(seenWelcome ? "home" : "welcome");
        return;
      }
      if (result.pendingDeviceLogin) {
        setPendingDeviceLogin(result.pendingDeviceLogin);
          setDeviceMessage(result.message ?? "Aprueba el código en Meta para continuar.");
        setPages(result.pages);
        setBootstrap(result.status);
        setTokenStatus(result.status.facebookTokenStatus);
        pushScreen("token");
        return;
      }
      pushScreen("token");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo conectar automáticamente");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPage = async (pageId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.selectPage(pageId);
      await businessSettingsStorage.setSelectedPageId(pageId);
      await businessSettingsStorage.setSelectedBusinessId(result.business.id);
      setActiveBusinessId(result.business.id);
      resetBusinessScopedState();
      const business = await api.getBusiness(result.business.id);
      setBusinessDetail(business);
      setBootstrap(result.status);
      const seenWelcome = await sessionStorage.hasSeenWelcome(result.business.id);
      setSelectedBusinessHasSeenWelcome(seenWelcome);
      pushScreen(seenWelcome ? "home" : "welcome");
      await refreshBusinesses(result.business.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo elegir la página");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!activeBusinessId) return;
    setLoading(true);
    setError(null);
    try {
      const batch = await api.createBatch(activeBusinessId);
      setBatchState((current) => ({
        businessId: activeBusinessId,
        batchId: batch.id,
        photos: [],
        variantsPerPhoto: current.variantsPerPhoto,
      }));
      setBatchStep("upload");
      setSelectedPhotoId(null);
      setStylePickerPhotoId(null);
      setSwipeDecisions({});
      setSwipeHistory([]);
      setSwipeIndex(0);
      setSummaryPeriod(null);
      await refreshBatchData(activeBusinessId, batch.id);
      pushScreen("batch");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el lote");
    } finally {
      setLoading(false);
    }
  };

  const handlePickPhotos = async () => {
    const ImagePicker = await import("expo-image-picker");
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled) {
      setBatchState((current) => ({
        ...current,
        photos: [
        ...current.photos,
        ...result.assets.map((asset) => ({
          uri: asset.uri,
          name: asset.fileName ?? `photo-${Date.now()}`,
          mimeType: asset.mimeType ?? null,
        })),
      ].slice(0, 10),
      }));
    }
  };

  const handleRemoveSelectedPhoto = (uri: string) => {
    setBatchState((current) => ({
      ...current,
      photos: current.photos.filter((photo) => photo.uri !== uri),
    }));
  };

  const handleUploadPhotos = async () => {
    if (!activeBusinessId || !currentBatchId || batchState.photos.length === 0) return;
    const photosToUpload = [...batchState.photos];
    const photoCount = photosToUpload.length;
    setLoading(true);
    setError(null);
    try {
      setAnalysisBanner({ done: 0, total: photoCount, ready: false });
      for (const photo of photosToUpload) {
        const uploadedAsset = await uriToUploadPayload(photo.uri);
        const intent = await api.uploadIntent(activeBusinessId, currentBatchId, {
          fileName: photo.name,
          contentType: photo.mimeType ?? uploadedAsset.contentType,
          fileSize: uploadedAsset.fileSize,
        });
        await api.completeUpload(activeBusinessId, currentBatchId, {
          uploadKey: intent.storageKey,
          originalFileName: photo.name,
          imageDataUrl: uploadedAsset.imageDataUrl,
        });
        setAnalysisBanner((current) =>
          current ? { ...current, done: Math.min(current.total, current.done + 1) } : current,
        );
      }
      const posts = await refreshBatchData(activeBusinessId, currentBatchId);
      setBatchState((current) => ({ ...current, photos: [] }));
      setBatchStep("review");
      setAnalysisBanner({ done: photoCount, total: photoCount, ready: true });
      pushScreen("batch");
      void posts;
    } catch (err) {
      setAnalysisBanner(null);
      setError(err instanceof Error ? err.message : "No se pudieron analizar las fotos");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenVariantCount = async () => {
    if (!activeBusinessId || !currentBatchId) return;
    setBatchStep("variants");
  };

  const handleGenerateVariants = async () => {
    if (!activeBusinessId || !currentBatchId) return;
    setLoading(true);
    setError(null);
    try {
      setBatchStep("generating");
      await api.estimateCost(activeBusinessId, currentBatchId, batchState.variantsPerPhoto);
      await api.confirmCost(activeBusinessId, currentBatchId);
      const result = await api.generateVariants(activeBusinessId, currentBatchId, batchState.variantsPerPhoto);
      if ((result.available ?? result.created) === 0) {
        setBatchStep("variants");
        setError(result.blockedReason ?? "No se pudieron generar las variantes");
        return;
      }
      await refreshBatchData(activeBusinessId, currentBatchId);
      setSwipeDecisions({});
      setSwipeHistory([]);
      setSwipeIndex(0);
      setSummaryPeriod(null);
      setBatchStep("swipe");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron generar las variantes");
      setBatchStep("variants");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPhotoDetail = (photoId: string) => {
    setSelectedPhotoId(photoId);
    setBatchStep("detail");
  };

  const handleClosePhotoDetail = () => {
    setSelectedPhotoId(null);
    setBatchStep("review");
  };

  const handleOpenStylePicker = (photoId: string) => {
    setStylePickerPhotoId(photoId);
  };

  const handleCloseStylePicker = () => {
    setStylePickerPhotoId(null);
  };

  const handleChooseStyle = async (photoId: string, styleId: string) => {
    if (!activeBusinessId || !currentBatchId) return;
    setLoading(true);
    setError(null);
    try {
      await api.changePhotoStyle(activeBusinessId, currentBatchId, photoId, styleId);
      await refreshBatchData(activeBusinessId, currentBatchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estilo");
    } finally {
      setLoading(false);
      setStylePickerPhotoId(null);
    }
  };

  const handleConfirmCalendar = async (periodDays: 7 | 14 | 30) => {
    if (!activeBusinessId || !currentBatchId) return;
    setLoading(true);
    setError(null);
    try {
      await api.confirmCalendar(activeBusinessId, currentBatchId, periodDays);
      const posts = await refreshBatchData(activeBusinessId, currentBatchId);
      const batchPost = posts.find((post) => post.batchId === currentBatchId) ?? posts[0];
      const anchorSource = batchPost?.scheduledFor ?? new Date().toISOString();
      setCalendarMonthAnchor(new Date(anchorSource));
      setCalendarSelectedDayKey(null);
      setCalendarSelectedPostId(null);
      setCalendarDetailEditing(false);
      setCalendarDetailDraft(toCalendarDraft(anchorSource));
      pushScreen("calendar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el calendario");
    } finally {
      setLoading(false);
    }
  };

  const handleReopenVariantApproval = async () => {
    if (!activeBusinessId || !currentBatchId) return;
    setLoading(true);
    setError(null);
    try {
      await api.reopenVariantApproval(activeBusinessId, currentBatchId);
      await refreshBatchData(activeBusinessId, currentBatchId);
      setSwipeIndex(0);
      setSwipeDecisions({});
      setSwipeHistory([]);
      setSummaryPeriod(null);
      setCalendarSelectedDayKey(null);
      setCalendarSelectedPostId(null);
      setCalendarDetailEditing(false);
      setBatchStep("swipe");
      replaceScreen("batch");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo regresar a aprobacion");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBatch = async () => {
    const batchId = currentBatchId ?? dashboard?.activeBatch?.id ?? null;
    if (!activeBusinessId || !batchId) {
      return;
    }
    setCancelBatchPromptVisible(false);
    setLoading(true);
    setError(null);
    try {
      await api.cancelBatch(activeBusinessId, batchId);
      resetBusinessScopedState();
      await refreshBusinesses(activeBusinessId);
      setNavigationHistory([]);
      replaceScreen("home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar el lote");
    } finally {
      setLoading(false);
    }
  };

  const openCancelBatchPrompt = () => {
    const batchId = currentBatchId ?? dashboard?.activeBatch?.id ?? null;
    if (!activeBusinessId || !batchId) {
      return;
    }
    setCancelBatchPromptVisible(true);
  };

  const handleLogout = async () => {
    await clearMetaToken();
    await businessSettingsStorage.setSelectedBusinessId(null);
    await businessSettingsStorage.setSelectedPageId(null);
    resetBusinessScopedState();
    setNavigationHistory([]);
    replaceScreen("token");
    setMetaToken(DEFAULT_META_TOKEN);
    setBootstrap(null);
    setPages([]);
    setBusinesses([]);
    setActiveBusinessId(null);
    setStylesCatalog([]);
    setTokenStatus(null);
    setPendingDeviceLogin(null);
    setDeviceMessage(null);
    setSelectedBusinessHasSeenWelcome(null);
  };

  const batchScheduledPosts = useMemo(
    () => scheduledPosts.filter((post) => post.batchId === currentBatchId),
    [scheduledPosts, currentBatchId],
  );

  const activeBusiness = useMemo(
    () => businesses.find((business) => business.id === activeBusinessId) ?? null,
    [businesses, activeBusinessId],
  );

  const activePage = useMemo(() => {
    const businessPageId = activeBusiness?.facebookPageId ?? null;
    return pages.find((page) => page.pageId === businessPageId) ?? null;
  }, [pages, activeBusiness?.facebookPageId]);

  const selectedCalendarPost = useMemo(
    () => scheduledPosts.find((post) => post.id === calendarSelectedPostId) ?? null,
    [scheduledPosts, calendarSelectedPostId],
  );

  const handleOpenBatch = async (batchId?: string) => {
    const batchStateMatchesBusiness = batchState.businessId === activeBusinessId;
    const dashboardBatchId = dashboard?.activeBatch?.id ?? null;
    const activeBatchId = batchId ?? dashboardBatchId ?? (batchStateMatchesBusiness ? batchState.batchId ?? null : null);
    if (!activeBatchId) {
      await handleCreateBatch();
      return;
    }

    if (!batchStateMatchesBusiness || batchState.batchId !== activeBatchId) {
      setBatchState((current) => ({
        businessId: activeBusinessId,
        batchId: activeBatchId,
        photos: batchId && batchId !== currentBatchId ? [] : batchStateMatchesBusiness ? current.photos : [],
        variantsPerPhoto: batchId && batchId !== currentBatchId ? emptyBatchState.variantsPerPhoto : batchStateMatchesBusiness ? current.variantsPerPhoto : emptyBatchState.variantsPerPhoto,
      }));
    }

    const detail = batchDetail?.id === activeBatchId ? batchDetail : await api.getBatch(activeBusinessId ?? "", activeBatchId);
    setBatchDetail(detail);
    const batchPosts = scheduledPosts.filter((post) => post.batchId === activeBatchId);
    const hasPostsInMeta = batchPosts.some((post) => post.status === "publicada" || Boolean(post.facebookPostId));
    const hasActiveCalendarPosts = batchPosts.some((post) => post.status === "programada" || post.status === "publicacion_en_proceso" || post.status === "estado_incierto" || post.status === "pausada_por_token");
    if (hasPostsInMeta || hasActiveCalendarPosts) {
      setBatchStep("summary");
      pushScreen("calendar");
      return;
    }
    if (detail.variants.some((variant) => variant.status === "generada")) {
      setSwipeIndex(0);
      setSwipeDecisions({});
      setSwipeHistory([]);
      setBatchStep("swipe");
    } else if (detail.variants.length > 0) {
      setBatchStep("summary");
    } else if (detail.photos.length > 0) {
      setBatchStep("review");
    } else {
      setBatchStep("upload");
    }
    pushScreen("batch");
  };

  const handleOpenCalendar = async () => {
    if (!activeBusinessId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const posts = await refreshScheduledPosts(activeBusinessId);
      const anchorSource = posts.find((post) => post.status === "programada")?.scheduledFor ?? posts[0]?.scheduledFor ?? Date.now();
      setCalendarMonthAnchor(new Date(anchorSource));
      setCalendarSelectedDayKey(null);
      setCalendarSelectedPostId(null);
      setCalendarDetailEditing(false);
      setCalendarDetailDraft(toCalendarDraft(typeof anchorSource === "number" ? null : anchorSource));
      pushScreen("calendar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el calendario");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReport = () => {
    pushScreen("report");
  };

  const handleOpenSettings = async () => {
    if (activeBusinessId) {
      try {
        const detail = await api.getBusiness(activeBusinessId);
        setBusinessDetail(detail);
    } catch {
        // keep current detail if refresh fails
      }
    }
    pushScreen("settings");
  };

  const handleOpenPages = () => {
    pushScreen("pages");
  };

  const handleOpenStyles = () => {
    pushScreen("styles");
  };

  const handleUpdateContentTypes = async (nextContentTypes: string[]) => {
    if (!activeBusinessId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await api.updateBusiness(activeBusinessId, {
        metadata: {
          ...(businessDetail?.metadata ?? {}),
          contentTypes: nextContentTypes,
        },
      });
      setBusinessDetail(updated);
      await refreshBusinesses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el contenido");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSeoKeywords = async (nextSeoKeywords: string[]) => {
    if (!activeBusinessId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await api.updateBusiness(activeBusinessId, {
        metadata: {
          ...(businessDetail?.metadata ?? {}),
          facebookSeoKeywords: nextSeoKeywords,
        },
      });
      setBusinessDetail(updated);
      await refreshBusinesses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el SEO de Facebook");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStyle = async (body: CreateVisualStyleRequest) => {
    await api.createStyle(body);
    await refreshStylesCatalog();
  };

  const handleUpdateStyle = async (styleId: string, body: UpdateVisualStyleRequest) => {
    await api.updateStyle(styleId, body);
    await refreshStylesCatalog();
  };

  const handleDeleteStyle = async (styleId: string) => {
    await api.deleteStyle(styleId);
    await refreshStylesCatalog();
  };

  const handleOpenReconnect = () => {
    pushScreen("reconnect");
    setMetaToken(DEFAULT_META_TOKEN);
    setError(null);
    setPendingDeviceLogin(null);
    setDeviceMessage(null);
  };

  const handleWelcomeStart = async () => {
    if (activeBusinessId) {
      await sessionStorage.markWelcomeSeen(activeBusinessId);
      setSelectedBusinessHasSeenWelcome(true);
    }
    pushScreen("home");
  };

  const handleGoToToday = () => {
    const today = new Date();
    setCalendarMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    setCalendarSelectedDayKey(formatDateKey(today));
    setCalendarSelectedPostId(null);
    setCalendarDetailEditing(false);
    setCalendarDetailDraft(toCalendarDraft(today.toISOString()));
    pushScreen("calendar");
  };

  const handleSelectCalendarDay = (dayKey: string | null) => {
    setCalendarSelectedDayKey(dayKey);
    setCalendarSelectedPostId(null);
    setCalendarDetailEditing(false);
  };

  const handleSelectCalendarPost = (postId: string) => {
    const post = scheduledPosts.find((item) => item.id === postId);
    if (!post) {
      return;
    }
    setCalendarSelectedDayKey(null);
    setCalendarSelectedPostId(postId);
    setCalendarDetailEditing(false);
    setCalendarDetailDraft(toCalendarDraft(post.scheduledFor));
  };

  const handleCloseCalendarDetail = () => {
    setCalendarSelectedPostId(null);
    setCalendarDetailEditing(false);
    setCalendarDetailDraft(toCalendarDraft(null));
  };

  const handleStartCalendarEdit = () => {
    if (!selectedCalendarPost) return;
    setCalendarDetailDraft(toCalendarDraft(selectedCalendarPost.scheduledFor));
    setCalendarDetailEditing(true);
  };

  const handleCancelCalendarEdit = () => {
    if (!selectedCalendarPost) return;
    setCalendarDetailDraft(toCalendarDraft(selectedCalendarPost.scheduledFor));
    setCalendarDetailEditing(false);
  };

  const handleSaveCalendarSchedule = async () => {
    if (!activeBusinessId || !currentBatchId || !selectedCalendarPost) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const scheduledFor = buildScheduledDateTime(calendarDetailDraft);
      await api.updateScheduledPost(activeBusinessId, currentBatchId, selectedCalendarPost.id, scheduledFor);
      await refreshBatchData(activeBusinessId, currentBatchId);
      setCalendarMonthAnchor(new Date(scheduledFor));
      setCalendarSelectedPostId(null);
      setCalendarSelectedDayKey(null);
      setCalendarDetailEditing(false);
      setCalendarDetailDraft(toCalendarDraft(scheduledFor));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reprogramar la publicación");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelCalendarPost = async () => {
    if (!activeBusinessId || !currentBatchId || !selectedCalendarPost) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.cancelScheduledPost(activeBusinessId, currentBatchId, selectedCalendarPost.id);
      await refreshBatchData(activeBusinessId, currentBatchId);
      setCalendarSelectedPostId(null);
      setCalendarSelectedDayKey(null);
      setCalendarDetailEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar la publicación");
    } finally {
      setLoading(false);
    }
  };

  const handleRetryCalendarPost = async () => {
    if (!activeBusinessId || !currentBatchId || !selectedCalendarPost) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.retryScheduledPost(activeBusinessId, currentBatchId, selectedCalendarPost.id);
      await refreshBatchData(activeBusinessId, currentBatchId);
      setCalendarSelectedPostId(null);
      setCalendarSelectedDayKey(null);
      setCalendarDetailEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reintentar la publicación");
    } finally {
      setLoading(false);
    }
  };

  const pendingSwipeVariants = useMemo(
    () => (batchDetail?.variants ?? []).filter((variant) => variant.status === "generada"),
    [batchDetail],
  );

  const swipeCurrentVariant = pendingSwipeVariants[swipeIndex] ?? null;
  const swipeApprovedCount = useMemo(
    () => Object.values(swipeDecisions).filter((decision) => decision === "aprobada").length,
    [swipeDecisions],
  );
  const swipeRejectedCount = useMemo(
    () => Object.values(swipeDecisions).filter((decision) => decision === "rechazada").length,
    [swipeDecisions],
  );

  const handleSwipeDecision = (variantId: string, decision: SwipeDecision) => {
    setSwipeDecisions((current) => ({ ...current, [variantId]: decision }));
    setSwipeHistory((current) => [...current, { variantId, decision }]);
    setSwipeIndex((current) => {
      const nextIndex = Math.min(pendingSwipeVariants.length, current + 1);
      if (nextIndex >= pendingSwipeVariants.length) {
        setBatchStep("summary");
      }
      return nextIndex;
    });
  };

  const handleUndoSwipe = () => {
    setSwipeHistory((current) => {
      const next = current.slice(0, -1);
      const last = current[current.length - 1];
      if (last) {
        setSwipeDecisions((state) => {
          const clone = { ...state };
          delete clone[last.variantId];
          return clone;
        });
      }
      setSwipeIndex((currentIndex) => Math.max(0, currentIndex - 1));
      return next;
    });
  };

  const handleCommitSwipeDecisions = async (periodDays: 7 | 14 | 30) => {
    if (!activeBusinessId || !currentBatchId) return;
    setLoading(true);
    setError(null);
    try {
      for (const variant of pendingSwipeVariants) {
        const draftCaption = captionDrafts[variant.id];
        if (typeof draftCaption === "string" && draftCaption !== (variant.caption ?? "")) {
          await api.updateVariantCaption(activeBusinessId, currentBatchId, variant.id, draftCaption);
        }
        const decision = swipeDecisions[variant.id];
        if (decision === "aprobada") {
          await api.approveVariant(activeBusinessId, currentBatchId, variant.id);
        } else if (decision === "rechazada") {
          await api.rejectVariant(activeBusinessId, currentBatchId, variant.id);
        }
      }
      await api.confirmCalendar(activeBusinessId, currentBatchId, periodDays);
      const posts = await refreshBatchData(activeBusinessId, currentBatchId);
      const anchorSource = posts.find((post) => post.batchId === currentBatchId)?.scheduledFor ?? new Date().toISOString();
      setCalendarMonthAnchor(new Date(anchorSource));
      setCalendarSelectedDayKey(null);
      setCalendarSelectedPostId(null);
      setCalendarDetailEditing(false);
      setCalendarDetailDraft(toCalendarDraft(anchorSource));
      setSummaryPeriod(periodDays);
      setBatchStep("summary");
      pushScreen("calendar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo programar el calendario");
    } finally {
      setLoading(false);
    }
  };

  const body = (() => {
    if (screen === "boot") {
      return (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.bodyMuted}>Iniciando FBmaniaco...</Text>
        </View>
      );
    }

    if (screen === "token") {
      return (
        <TokenScreen
          mode="connect"
          token={metaToken}
          setToken={setMetaToken}
          onBack={goBack}
          loading={loading}
          error={error}
          pendingDeviceLogin={pendingDeviceLogin}
          deviceMessage={deviceMessage}
          onAutoConnect={handleAutoConnect}
          onManualConnect={handleManualConnect}
          onOpenHelp={() => setShowTokenHelp(true)}
        />
      );
    }

    if (screen === "reconnect") {
      return (
        <TokenScreen
          mode="reconnect"
          token={metaToken}
          setToken={setMetaToken}
          onBack={goBack}
          loading={loading}
          error={error}
          pendingDeviceLogin={pendingDeviceLogin}
          deviceMessage={deviceMessage}
          onAutoConnect={handleAutoConnect}
          onManualConnect={handleManualConnect}
          onOpenHelp={() => setShowTokenHelp(true)}
        />
      );
    }

    if (screen === "pages") {
      return <PagesScreen pages={pages} onSelect={handleSelectPage} />;
    }

    if (screen === "welcome") {
      return <WelcomeScreen business={activeBusiness} page={activePage} onBack={goBack} onStart={handleWelcomeStart} />;
    }

    if (screen === "styles") {
      return (
        <StyleEditorScreen
          stylesCatalog={stylesCatalog}
          loading={loading}
          onBack={goBack}
          onCreateStyle={handleCreateStyle}
          onUpdateStyle={handleUpdateStyle}
          onDeleteStyle={handleDeleteStyle}
        />
      );
    }

    if (screen === "report") {
      return <ReportScreen dashboard={dashboard} onBack={goBack} />;
    }

    if (screen === "settings") {
      return (
        <SettingsScreen
          business={businessDetail}
          page={activePage}
          tokenStatus={tokenStatus}
          loading={loading}
          stylesCatalog={stylesCatalog}
          onReconnect={handleOpenReconnect}
          onOpenPages={handleOpenPages}
          onOpenStyles={handleOpenStyles}
          onLogout={handleLogout}
          onBack={goBack}
          onUpdateContentTypes={handleUpdateContentTypes}
          onUpdateSeoKeywords={handleUpdateSeoKeywords}
          onResetAutonomy={async (next) => {
            if (!activeBusinessId) return;
            setLoading(true);
            try {
              const updated = await api.updateBusiness(activeBusinessId, { autonomySettings: next });
              setBusinessDetail((current) => (current ? { ...current, autonomySettings: updated.autonomySettings } : current));
              await refreshBusinesses();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo actualizar la autonomía");
            } finally {
              setLoading(false);
            }
          }}
        />
      );
    }

    if (screen === "batch") {
      return (
        <BatchScreen
          business={businesses.find((business) => business.id === activeBusinessId) ?? null}
          batchId={currentBatchId}
          batchDetail={batchDetail}
          loading={loading}
          step={batchStep}
          setBatchState={setBatchState}
          batchState={batchState}
          captionDrafts={captionDrafts}
          setCaptionDrafts={setCaptionDrafts}
          stylesCatalog={stylesCatalog}
          selectedPhotoId={selectedPhotoId}
          stylePickerPhotoId={stylePickerPhotoId}
          onBack={goBack}
          onRefresh={() => refreshBatchData()}
          onPickPhotos={handlePickPhotos}
          onRemovePhoto={handleRemoveSelectedPhoto}
          onUploadPhotos={handleUploadPhotos}
          onOpenPhotoDetail={handleOpenPhotoDetail}
          onClosePhotoDetail={handleClosePhotoDetail}
          onOpenStylePicker={handleOpenStylePicker}
          onCloseStylePicker={handleCloseStylePicker}
          onChooseStyle={handleChooseStyle}
          onCancelBatch={openCancelBatchPrompt}
          onOpenVariantCount={handleOpenVariantCount}
          onGenerateVariants={handleGenerateVariants}
          onApproveSwipe={(variantId) => handleSwipeDecision(variantId, "aprobada")}
          onRejectSwipe={(variantId) => handleSwipeDecision(variantId, "rechazada")}
          onUndoSwipe={handleUndoSwipe}
          onCommitSwipeDecisions={handleCommitSwipeDecisions}
          onReopenVariantApproval={handleReopenVariantApproval}
          swipeIndex={swipeIndex}
          swipeCurrentVariant={swipeCurrentVariant}
          swipeApprovedCount={swipeApprovedCount}
          swipeRejectedCount={swipeRejectedCount}
          swipeDecisions={swipeDecisions}
          summaryPeriod={summaryPeriod}
          setSummaryPeriod={setSummaryPeriod}
        />
      );
    }

    if (screen === "calendar") {
      return (
        <CalendarScreen
          business={activeBusiness}
          scheduledPosts={scheduledPosts}
          monthAnchor={calendarMonthAnchor}
          selectedDayKey={calendarSelectedDayKey}
          selectedPostId={calendarSelectedPostId}
          detailEditing={calendarDetailEditing}
          detailDraft={calendarDetailDraft}
          loading={loading}
          onBack={goBack}
          onOpenBatch={handleOpenBatch}
          onToday={handleGoToToday}
          onRefresh={handleOpenCalendar}
          onPrevMonth={() => setCalendarMonthAnchor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          onNextMonth={() => setCalendarMonthAnchor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          onSelectDay={handleSelectCalendarDay}
          onSelectPost={handleSelectCalendarPost}
          onCloseDetail={handleCloseCalendarDetail}
          onStartEdit={handleStartCalendarEdit}
          onCancelEdit={handleCancelCalendarEdit}
          onChangeDraftDate={(value) => setCalendarDetailDraft((current) => ({ ...current, date: value }))}
          onChangeDraftTime={(value) => setCalendarDetailDraft((current) => ({ ...current, time: value }))}
          onSaveSchedule={handleSaveCalendarSchedule}
          onCancelPost={handleCancelCalendarPost}
          onRetryPost={handleRetryCalendarPost}
          onOpenReport={handleOpenReport}
          onOpenSettings={handleOpenSettings}
        />
      );
    }

    return (
      <HomeScreen
        business={activeBusiness}
        page={activePage}
        dashboard={dashboard}
        scheduledPosts={scheduledPosts}
        loading={loading}
        onBack={goBack}
        onOpenBatch={handleOpenBatch}
        onCancelBatch={openCancelBatchPrompt}
        onOpenCalendar={handleOpenCalendar}
        onOpenSettings={handleOpenSettings}
        onOpenReconnect={handleOpenReconnect}
        onRefresh={refreshBusinesses}
      />
    );
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <CancelBatchPrompt
        visible={cancelBatchPromptVisible}
        businessName={activeBusiness?.name ?? "este negocio"}
        batchStatus={dashboard?.activeBatch?.status ?? null}
        loading={loading}
        onClose={() => setCancelBatchPromptVisible(false)}
        onConfirm={() => void handleCancelBatch()}
      />
      {body}
      <TokenHelpSheet visible={showTokenHelp} onClose={() => setShowTokenHelp(false)} />
      <AnalysisBanner
        state={analysisBanner}
        onOpenBatch={async () => {
          setAnalysisBanner(null);
          await handleOpenBatch();
        }}
        onDismiss={() => setAnalysisBanner(null)}
      />
      {error && screen !== "token" ? <Text style={styles.globalError}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  centerWrap: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
    gap: 16,
    backgroundColor: theme.colors.background,
  },
  pageWrap: {
    padding: 24,
    gap: 16,
    backgroundColor: theme.colors.background,
  },
  homeWrap: {
    padding: 20,
    gap: 16,
    backgroundColor: theme.colors.background,
  },
  brand: {
    color: theme.colors.accent,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  brandSmall: {
    color: theme.colors.accent,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  h1: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  h1Compact: {
    fontSize: 24,
  },
  body: {
    color: theme.colors.text,
    fontSize: 15,
  },
  bodyMuted: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  error: {
    color: theme.colors.danger,
    fontSize: 14,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 10,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  cardSubtitle: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#111111",
    fontWeight: "800",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: theme.colors.surfaceAlt,
  },
  secondaryButtonText: {
    color: theme.colors.text,
    fontWeight: "700",
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: "#7f1d1d",
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#2a1010",
  },
  dangerButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  dangerButtonText: {
    color: "#fecaca",
    fontWeight: "800",
  },
  buttonStack: {
    gap: 10,
  },
  disabled: {
    opacity: 0.45,
  },
  listItem: {
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  listTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  calendarToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  calendarMonthLabel: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
    textTransform: "capitalize",
    textAlign: "center",
    flex: 1,
  },
  calendarMonthLabelCompact: {
    fontSize: 16,
  },
  weekHeader: {
    flexDirection: "row",
    gap: 6,
  },
  weekHeaderLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
    width: "12.5%",
    textAlign: "center",
  },
  calendarLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  calendarLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  calendarLegendItemCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  calendarLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  calendarLegendText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  calendarGrid: {
    flex: 1,
    gap: 6,
    minHeight: 0,
  },
  calendarGridRow: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 0,
  },
  calendarCell: {
    flex: 1,
    minHeight: 0,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 4,
    alignItems: "center",
    justifyContent: "space-between",
  },
  calendarCellMuted: {
    opacity: 0.48,
  },
  calendarCellSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: "#2a1b10",
  },
  calendarCellDay: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  calendarCellDayMuted: {
    color: theme.colors.muted,
  },
  calendarDots: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 3,
    minHeight: 14,
  },
  calendarDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  calendarDotMore: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  calendarCellCount: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  calendarCellSpacer: {
    height: 10,
  },
  calendarBoardCard: {
    flex: 1,
    minHeight: 0,
  },
  calendarBoardCardCompact: {
    padding: 14,
    gap: 8,
  },
  calendarScreen: {
    flex: 1,
    padding: 18,
    gap: 14,
    backgroundColor: theme.colors.background,
  },
  calendarScreenCompact: {
    padding: 14,
    gap: 12,
  },
  calendarFootnote: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  confirmDialogActions: {
    gap: 12,
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.border,
    marginBottom: 10,
  },
  bottomSheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    maxHeight: "74%",
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 14,
  },
  detailSheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
    maxHeight: "92%",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  detailSheetContent: {
    gap: 14,
    paddingBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sheetTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
    flex: 1,
    textTransform: "capitalize",
  },
  sheetItem: {
    gap: 8,
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  sheetItemTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  postRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  postRowImage: {
    width: 68,
    height: 68,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  postRowPlaceholder: {
    width: 68,
    height: 68,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  postRowBody: {
    flex: 1,
    gap: 6,
  },
  postRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  postRowCaption: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  detailImage: {
    width: "100%",
    height: 260,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceAlt,
  },
  detailImagePlaceholder: {
    width: "100%",
    height: 260,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  detailMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  detailCaption: {
    color: theme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  detailEditCard: {
    gap: 10,
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  variantCard: {
    gap: 12,
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  variantImage: {
    width: "100%",
    height: 220,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  captionInput: {
    minHeight: 96,
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    textAlignVertical: "top",
  },
  deviceCode: {
    color: theme.colors.accent,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 2.5,
    textAlign: "center",
  },
  pageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  pageCard: {
    width: "48%",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 10,
  },
  pageCardSelected: {
    borderColor: theme.colors.accent,
  },
  pageThumb: {
    height: 120,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceAlt,
  },
  pageImage: {
    width: "100%",
    height: "100%",
  },
  pagePlaceholder: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
  },
  pageName: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  homeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  screenRoot: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  screenWrap: {
    flexGrow: 1,
    padding: 18,
    gap: 16,
    backgroundColor: theme.colors.background,
    paddingBottom: 28,
  },
  styleScreenWrapCompact: {
    padding: 14,
    gap: 12,
    paddingBottom: 22,
  },
  styleScreenWrapTiny: {
    padding: 12,
    gap: 10,
    paddingBottom: 18,
  },
  tokenHero: {
    gap: 18,
  },
  tokenTopRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  helpButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  helpButtonText: {
    color: theme.colors.accent,
    fontWeight: "800",
    fontSize: 18,
  },
  tokenInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  deviceCard: {
    gap: 10,
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  alertCard: {
    gap: 6,
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "#4a1414",
    backgroundColor: "#1b1111",
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.danger,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  alertTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "800",
    flex: 1,
  },
  alertBody: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  alertAction: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  pageHeader: {
    gap: 10,
  },
  pageHeaderTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  pageCardPressed: {
    transform: [{ scale: 0.96 }],
  },
  pageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  pageTitleWrap: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 12,
  },
  homeContent: {
    paddingBottom: 120,
  },
  homeLayout: {
    flex: 1,
    padding: 18,
    gap: 14,
    backgroundColor: theme.colors.background,
  },
  homeLayoutCompact: {
    padding: 14,
    gap: 12,
  },
  homeTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  homeBody: {
    flex: 1,
    gap: 12,
    minHeight: 0,
  },
  homeSignalStack: {
    gap: 10,
    flexShrink: 0,
  },
  homeIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  homeAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.colors.surfaceAlt,
  },
  homeAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  homeTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  homeTitleCompact: {
    fontSize: 18,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  iconButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  iconButtonDisabled: {
    opacity: 0.45,
  },
  iconButtonText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  backButton: {
    minWidth: 92,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  backButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  backButtonDisabled: {
    opacity: 0.45,
  },
  backButtonCompact: {
    minWidth: 0,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
  },
  backButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  backButtonTextCompact: {
    fontSize: 13,
  },
  activeBatchCard: {
    gap: 10,
    padding: 16,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.accent,
  },
  sectionLabel: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  activeBatchTitle: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  activeBatchBody: {
    color: theme.colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  activeBatchMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  activeBatchMeta: {
    color: theme.colors.tertiary,
    fontSize: 11,
    fontWeight: "700",
  },
  activeBatchActions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  activeBatchCardCompact: {
    padding: 14,
    gap: 8,
  },
  activeBatchAction: {
    flex: 1,
    minWidth: 120,
  },
  progressTrack: {
    width: "100%",
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  emptyHero: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 30,
  },
  emptyHeroCompact: {
    paddingVertical: 20,
    gap: 6,
  },
  emptyHeroIcon: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.accent,
    fontSize: 32,
    lineHeight: 68,
    textAlign: "center",
  },
  emptyHeroTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  reportHero: {
    gap: 8,
    padding: 16,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.accent,
  },
  reportHeroCompact: {
    padding: 14,
    gap: 6,
  },
  reportHeroTiny: {
    padding: 12,
    gap: 4,
  },
  reportHeroLabel: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  reportHeroTitle: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  reportHeroTitleCompact: {
    fontSize: 21,
  },
  reportHeroBody: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  reportHeroBodyCompact: {
    fontSize: 12,
    lineHeight: 17,
  },
  reportMetricGrid: {
    flexDirection: "row",
    gap: 10,
  },
  reportMetricGridCompact: {
    gap: 8,
  },
  reportMetricCard: {
    flex: 1,
    minHeight: 102,
    gap: 6,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderTopWidth: 3,
  },
  reportMetricCardCompact: {
    minHeight: 92,
    padding: 12,
  },
  reportMetricLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  reportMetricValue: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  reportMetricValueCompact: {
    fontSize: 22,
  },
  reportMetricCaption: {
    color: theme.colors.tertiary,
    fontSize: 11,
    fontWeight: "700",
  },
  reportSectionList: {
    gap: 10,
  },
  reportSectionListCompact: {
    gap: 8,
  },
  reportSectionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  reportSectionBullet: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 6,
    backgroundColor: theme.colors.accent,
  },
  reportSectionText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  reportSectionTextCompact: {
    fontSize: 12,
    lineHeight: 17,
  },
  reportSectionCardTiny: {
    padding: 14,
    gap: 8,
  },
  reportContent: {
    gap: 14,
  },
  reportContentCompact: {
    padding: 16,
    gap: 12,
    paddingBottom: 22,
  },
  reportContentTiny: {
    padding: 12,
    gap: 10,
    paddingBottom: 18,
  },
  homeCalendarGrid: {
    flex: 1,
    gap: 6,
    minHeight: 0,
  },
  homeCalendarPressable: {
    flex: 1,
    minHeight: 0,
  },
  homeCalendarCard: {
    flex: 1,
    minHeight: 0,
  },
  homeCalendarCardCompact: {
    padding: 14,
    gap: 8,
  },
  homeCalendarCardTiny: {
    padding: 12,
    gap: 6,
  },
  calendarCardPressed: {
    opacity: 0.88,
  },
  homeCalendarRow: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  homeCalendarCell: {
    flex: 1,
    minHeight: 0,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  homeCalendarCellMuted: {
    opacity: 0.36,
  },
  homeCalendarDay: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  homeCalendarDots: {
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 8,
  },
  homeFooter: {
    gap: 10,
    paddingTop: 2,
  },
  fixedFooter: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    gap: 10,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  batchTopBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  batchTopText: {
    flex: 1,
    gap: 6,
  },
  batchTopActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  calendarHeaderActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  batchContent: {
    padding: 18,
    gap: 16,
    paddingBottom: 140,
  },
  batchContentCompact: {
    padding: 14,
    gap: 12,
    paddingBottom: 120,
  },
  batchContentTiny: {
    padding: 12,
    gap: 10,
    paddingBottom: 108,
  },
  uploadArea: {
    minHeight: 230,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 12,
  },
  uploadIcon: {
    color: theme.colors.accent,
    fontSize: 42,
    fontWeight: "900",
  },
  uploadTitle: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  uploadPreviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  uploadPreviewItem: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceAlt,
  },
  uploadPreviewImage: {
    width: "100%",
    height: "100%",
  },
  removeBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeBadgeText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    marginTop: -1,
  },
  reviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  reviewTile: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reviewTilePressed: {
    transform: [{ scale: 0.97 }],
  },
  reviewTileImage: {
    width: "100%",
    height: "100%",
  },
  reviewTileFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.surfaceAlt,
  },
  reviewTileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  reviewTileLabel: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  reviewTileLabelText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  detailHero: {
    position: "relative",
    height: "40%",
    minHeight: 280,
    maxHeight: 380,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: "hidden",
    borderBottomLeftRadius: theme.radius.xl,
    borderBottomRightRadius: theme.radius.xl,
  },
  detailHeroImage: {
    width: "100%",
    height: "100%",
  },
  detailHeroFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.surfaceAlt,
  },
  detailHeroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  detailBackButton: {
    position: "absolute",
    top: 18,
    left: 18,
    minWidth: 112,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  detailBackButtonCompact: {
    top: 14,
    left: 14,
    minWidth: 90,
    height: 36,
  },
  detailBackButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
  },
  detailBackButtonTextCompact: {
    fontSize: 13,
  },
  detailContent: {
    gap: 16,
    padding: 18,
    paddingBottom: 24,
  },
  detailContentCompact: {
    gap: 14,
    padding: 14,
    paddingBottom: 20,
  },
  detailContentTiny: {
    gap: 12,
    padding: 12,
    paddingBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  blueChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#102033",
    borderWidth: 1,
    borderColor: "#17324b",
  },
  blueChipText: {
    color: "#cde5ff",
    fontSize: 12,
    fontWeight: "700",
  },
  assignedStyleCard: {
    gap: 10,
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  assignedStyleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  assignedStylePill: {
    color: theme.colors.text,
    backgroundColor: "#2a1508",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontWeight: "800",
    overflow: "hidden",
  },
  assignedStyleBody: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  metricRow: {
    gap: 6,
  },
  metricLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  metricTrack: {
    width: "100%",
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: "hidden",
  },
  metricFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  promptCard: {
    padding: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  promptSkeleton: {
    gap: 10,
  },
  promptSkeletonLine: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#2b2b2b",
  },
  promptSkeletonLineShort: {
    width: "72%",
  },
  promptSkeletonText: {
    color: theme.colors.tertiary,
    fontSize: 12,
    fontWeight: "700",
  },
  variantStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 10,
  },
  roundStepperButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  roundStepperButtonText: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    marginTop: -2,
  },
  variantStepperNumber: {
    color: theme.colors.accent,
    fontSize: 44,
    fontWeight: "900",
    minWidth: 72,
    textAlign: "center",
  },
  variantTotal: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  infoCard: {
    gap: 10,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  generatingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 120,
  },
  generatingCenterCompact: {
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 100,
  },
  generatingCounter: {
    color: theme.colors.accent,
    fontSize: 40,
    fontWeight: "900",
  },
  messageStack: {
    width: "100%",
    gap: 8,
    marginTop: 10,
  },
  messageCard: {
    padding: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.accent,
  },
  messageText: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  swipeTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 18,
  },
  swipeTopBarCompact: {
    padding: 14,
    gap: 8,
  },
  swipeTopSpacer: {
    width: 40,
    height: 40,
  },
  swipeIndicator: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
  },
  swipeCard: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 14,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 12,
  },
  swipeTint: {
    ...StyleSheet.absoluteFillObject,
  },
  swipeTintApprove: {
    backgroundColor: "rgba(34, 197, 94, 0.55)",
  },
  swipeTintReject: {
    backgroundColor: "rgba(239, 68, 68, 0.55)",
  },
  swipeMediaFrame: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#050505",
    alignItems: "center",
    justifyContent: "center",
  },
  swipeImage: {
    width: "100%",
    height: "100%",
  },
  swipeImageFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.surfaceAlt,
  },
  swipeGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  swipeCaptionWrap: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 96,
  },
  swipeCaptionCard: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flex: 1,
    minHeight: 132,
  },
  swipeCaptionCardCompact: {
    padding: 12,
    gap: 8,
  },
  swipeCaptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  swipeCaptionLabel: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  swipeCaptionToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  swipeCaptionToggleText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  swipeCaptionPreview: {
    minHeight: 86,
    justifyContent: "center",
    flex: 1,
  },
  swipeCaptionPreviewText: {
    color: theme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  swipeCaptionInput: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 22,
    borderRadius: 16,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  swipeCaptionInputExpanded: {
    minHeight: 128,
  },
  swipeCaptionInputExpandedCompact: {
    minHeight: 104,
  },
  swipeButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  swipeButtonsCompact: {
    marginTop: -2,
  },
  swipeReject: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.35)",
  },
  swipeRejectCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  swipeApprove: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.35)",
  },
  swipeApproveCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  swipeButtonText: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  summaryHero: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  summaryHeroCompact: {
    paddingVertical: 8,
    gap: 6,
  },
  summaryNumber: {
    color: theme.colors.accent,
    fontSize: 68,
    fontWeight: "900",
    lineHeight: 70,
  },
  summaryNumberCompact: {
    fontSize: 56,
    lineHeight: 58,
  },
  periodGrid: {
    gap: 12,
  },
  periodCard: {
    gap: 8,
    padding: 16,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  periodCardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  periodTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingVertical: 10,
  },
  configRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: 12,
  },
  configRowInteractive: {
    borderRadius: theme.radius.md,
  },
  configRowPressed: {
    opacity: 0.7,
  },
  configRowContent: {
    flex: 1,
    gap: 4,
  },
  configRowLabel: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  configRowValue: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  configRowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  configStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  configStatusChipDanger: {
    backgroundColor: "#4a1414",
  },
  configStatusChipOk: {
    backgroundColor: "#17311f",
  },
  configStatusChipMuted: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  configStatusChipText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  configChevron: {
    color: theme.colors.muted,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: "700",
  },
  configInlineAction: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.surfaceAlt,
  },
  configInlineActionText: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "800",
  },
  sectionActionRow: {
    marginTop: 6,
    marginBottom: 4,
  },
  styleCard: {
    gap: 10,
    padding: 14,
    marginTop: 10,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  styleCardCompact: {
    padding: 12,
    gap: 8,
  },
  styleCardTiny: {
    padding: 10,
    gap: 8,
  },
  styleCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  styleCardHeaderTiny: {
    gap: 8,
  },
  styleMetaPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  styleMetaPillBase: {
    backgroundColor: theme.colors.surface,
  },
  styleMetaPillCustom: {
    backgroundColor: "#14273c",
  },
  styleMetaPillText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  stylePrompt: {
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  styleTagRow: {
    gap: 6,
  },
  styleTagRowCompact: {
    gap: 4,
  },
  styleTagText: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  styleCardActions: {
    flexDirection: "row",
    gap: 10,
  },
  styleCardActionsCompact: {
    gap: 8,
    flexWrap: "wrap",
  },
  styleCardActionsTiny: {
    gap: 8,
    flexWrap: "wrap",
  },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: "top",
  },
  segmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  segmentButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  segmentButtonActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  segmentButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  segmentButtonTextActive: {
    color: theme.colors.accent,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: "700",
  },
  contentComposer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  contentInput: {
    flex: 1,
  },
  autonomyRow: {
    gap: 10,
    paddingVertical: 10,
  },
  autonomyRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  settingValue: {
    color: theme.colors.text,
    fontWeight: "800",
  },
  badgeDanger: {
    color: theme.colors.danger,
  },
  badgeOk: {
    color: theme.colors.success,
  },
  badgeMuted: {
    color: theme.colors.muted,
  },
  autonomyStatePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  autonomyStatePillAuto: {
    backgroundColor: "#17311f",
  },
  autonomyStatePillManual: {
    backgroundColor: theme.colors.surfaceAlt,
  },
  autonomyStateText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: "800",
  },
  logoutRow: {
    minHeight: 52,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  logoutText: {
    color: theme.colors.danger,
    fontWeight: "800",
  },
  welcomeCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  welcomeTopBar: {
    position: "absolute",
    top: 14,
    left: 14,
    zIndex: 2,
  },
  welcomeAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceAlt,
  },
  welcomeAvatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceAlt,
  },
  analysisBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  analysisBannerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  analysisBannerIcon: {
    color: theme.colors.success,
    fontSize: 16,
    fontWeight: "900",
  },
  analysisBannerText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
  analysisBannerAction: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  sheetBody: {
    gap: 10,
    paddingBottom: 8,
  },
  sheetBodyCompact: {
    gap: 8,
    paddingBottom: 6,
  },
  sheetBodyTiny: {
    gap: 8,
    paddingBottom: 4,
  },
  sheetTitleCompact: {
    fontSize: 16,
  },
  styleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  styleRowActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  styleChip: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "800",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  screenBottomSpacer: {
    height: 12,
  },
  screenBottomSpacerCompact: {
    height: 6,
  },
  globalError: {
    color: theme.colors.danger,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
});


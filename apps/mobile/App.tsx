import { Ionicons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  variantEditPromptForStyle,
  variantStylePresetForIndex,
  type BatchDetail,
  type BatchSummary,
  type GenerateBatchStyleOverride,
  type MetaPage,
  type Photo,
  type ScheduledPost,
  type Variant
} from "@fbmaniaco/shared";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert as NativeAlert,
  AppState,
  BackHandler,
  Image,
  ImageBackground,
  type ImageStyle,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  type StyleProp,
  Text,
  TextInput,
  View,
  type ViewStyle
} from "react-native";
import {
  approveVariant,
  cancelScheduledPost,
  clearStoredSession,
  confirmCalendar,
  connectMeta,
  createBatch,
  deleteBatch,
  ensureSessionForMeta,
  generateBatchVariants,
  getBatchDetail,
  getBootstrapStatus,
  getStoredSessionToken,
  isAuthSessionError,
  listBatches,
  listMetaPages,
  listScheduledPosts,
  publishScheduledPost,
  rejectVariant,
  retryScheduledPost,
  selectMetaPage,
  updateScheduledPost,
  updateVariantCaption,
  uploadPhoto
} from "./src/api/client";
import type { PhotoUploadFile } from "./src/api/client";
import { getMobileConfig } from "./src/config";
import { checkForAppUpdate, openAppUpdate, type AppUpdateInfo } from "./src/update";

const queryClient = new QueryClient();
WebBrowser.maybeCompleteAuthSession();

type FlowStep = "home" | "styles" | "generate" | "review" | "schedule" | "calendar" | "settings";
type IconName = ComponentProps<typeof Ionicons>["name"];
type PeriodDays = 7 | 14 | 30;
type BatchFlowStep = Extract<FlowStep, "styles" | "generate" | "review" | "schedule" | "calendar">;
type BatchProcessState = "done" | "active" | "ready" | "locked";
type BatchProcessStep = {
  key: BatchFlowStep;
  label: string;
  icon: IconName;
  state: BatchProcessState;
};
type PageAction = {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean | undefined;
  tone?: "primary" | "danger" | undefined;
};

const MAX_PHOTOS_PER_PICK = 10;
const IMAGE_TARGET_WIDTH = 1800;
const IMAGE_RECOMPRESS_THRESHOLD = 7 * 1024 * 1024;
const WORK_POLL_MS = 3500;

const styleCatalog = [
  { id: "atardecer", name: "Atardecer", detail: "Calido, dorado, social", icon: "sunny-outline" as IconName },
  { id: "marmol", name: "Mármol", detail: "Limpio, elegante, claro", icon: "diamond-outline" as IconName },
  { id: "madera", name: "Madera", detail: "Natural, local, cercano", icon: "cafe-outline" as IconName },
  { id: "jardin", name: "Jardín", detail: "Fresco, verde, abierto", icon: "leaf-outline" as IconName },
  { id: "playa", name: "Playa", detail: "Luz suave, relajado", icon: "water-outline" as IconName },
  { id: "estudio", name: "Estudio", detail: "Profesional, controlado", icon: "camera-outline" as IconName },
  { id: "nocturno", name: "Nocturno", detail: "Contraste, moderno", icon: "moon-outline" as IconName },
  { id: "bambu", name: "Bambú", detail: "Organico, textura fina", icon: "flower-outline" as IconName }
];

type PhotoStylePreference = { styleId: string; intensity: number };
type LocalPhotoPreview = { id: string; uri: string; name: string };
const asImageStyle = (style: unknown) => style as StyleProp<ImageStyle>;
const asViewStyle = (style: unknown) => style as StyleProp<ViewStyle>;

const mimeFromFileName = (fileName?: string | null) => {
  const lower = fileName?.toLowerCase() ?? "";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
};

const uploadNameForAsset = (asset: ImagePicker.ImagePickerAsset, index: number, forceJpeg = false) => {
  const baseName = asset.fileName?.trim() || `foto-${Date.now()}-${index + 1}.jpg`;
  if (!forceJpeg) return baseName;
  return /\.[a-z0-9]+$/i.test(baseName) ? baseName.replace(/\.[a-z0-9]+$/i, ".jpg") : `${baseName}.jpg`;
};

const localFileSize = async (uri: string) => {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info.exists ? info.size : undefined;
  } catch {
    return undefined;
  }
};

const preparePhotoForUpload = async (asset: ImagePicker.ImagePickerAsset, index: number): Promise<PhotoUploadFile> => {
  const sourceMime = asset.mimeType ?? mimeFromFileName(asset.fileName) ?? "image/jpeg";
  const largeFile = (asset.fileSize ?? 0) > IMAGE_RECOMPRESS_THRESHOLD;
  const wideImage = asset.width ? asset.width > IMAGE_TARGET_WIDTH : false;
  const unsupportedForUpload = !["image/jpeg", "image/png", "image/webp"].includes(sourceMime);

  if (largeFile || wideImage || unsupportedForUpload) {
    const actions: ImageManipulator.Action[] = wideImage ? [{ resize: { width: IMAGE_TARGET_WIDTH } }] : [];
    const image = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: 0.82,
      format: ImageManipulator.SaveFormat.JPEG
    });
    const fileSize = await localFileSize(image.uri);
    return {
      uri: image.uri,
      name: uploadNameForAsset(asset, index, true),
      contentType: "image/jpeg",
      ...(fileSize === undefined ? {} : { fileSize }),
      width: image.width,
      height: image.height
    };
  }

  const fileSize = asset.fileSize ?? (await localFileSize(asset.uri));
  return {
    uri: asset.uri,
    name: uploadNameForAsset(asset, index),
    contentType: sourceMime,
    ...(fileSize === undefined ? {} : { fileSize }),
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height })
  };
};

const isPhotoAnalyzed = (photo: Photo) => ["validada", "validated"].includes(photo.status);
const isPhotoBusy = (photo: Photo) => ["uploading", "uploaded", "analyzing"].includes(photo.status);
const isVariantReviewable = (variant: Variant) => ["generada", "generated"].includes(variant.status);
const isVariantAccepted = (variant: Variant) => ["aprobada", "programada", "publicada", "approved"].includes(variant.status);
const isVariantDone = (variant: Variant) =>
  ["generada", "aprobada", "rechazada", "programada", "publicada", "fallida", "generated", "approved", "rejected", "failed"].includes(variant.status);
const isVariantBusy = (variant: Variant) => ["pendiente", "generando", "queued", "generating"].includes(variant.status);
const isPostFailed = (post: ScheduledPost) => ["fallida", "failed", "estado_incierto", "needs_user_action"].includes(post.status);
const isPostGood = (post: ScheduledPost) => ["publicada", "published"].includes(post.status);
const isPostPublishing = (post: ScheduledPost) => ["publicacion_en_proceso", "publishing"].includes(post.status);

const postStatusLabel = (post: ScheduledPost) => {
  if (isPostGood(post)) return "Publicada en Facebook";
  if (isPostPublishing(post)) return "Publicando ahora";
  if (isPostFailed(post)) return post.status === "estado_incierto" ? "Sin confirmacion de Meta" : "Fallo al publicar";
  if (["cancelada", "cancelled"].includes(post.status)) return "Cancelada";
  if (["programada", "scheduled"].includes(post.status)) return "Programada, aun no publicada";
  return post.status;
};

const postStatusTone = (post: ScheduledPost): "good" | "warn" | "neutral" => {
  if (isPostGood(post)) return "good";
  if (isPostFailed(post) || isPostPublishing(post)) return "warn";
  return "neutral";
};

const pct = (done: number, total: number) => (total <= 0 ? 0 : Math.min(100, Math.round((done / total) * 100)));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const formatDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
const formatTime = (value: string | Date) => new Date(value).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const dateKey = (value: string | Date) => new Date(value).toISOString().slice(0, 10);

const batchStatusText = (status: string) => {
  if (["pendiente", "pending"].includes(status)) return "Preparando";
  if (["subiendo", "uploading"].includes(status)) return "Subiendo";
  if (["analizando", "analyzing"].includes(status)) return "Analizando";
  if (["pendiente_confirmacion", "ready_for_generation"].includes(status)) return "Listo";
  if (["generando", "generating"].includes(status)) return "Generando";
  if (["generado_parcial", "ready_for_review"].includes(status)) return "Revisar";
  if (["programado", "scheduled"].includes(status)) return "Programado";
  if (["completado", "completed"].includes(status)) return "Completo";
  return status;
};

const photoStatusText = (photo: Photo) => {
  if (isPhotoAnalyzed(photo)) return "Lista";
  if (["uploading", "uploaded"].includes(photo.status)) return "Subiendo";
  if (["analyzing"].includes(photo.status)) return "Analizando";
  return photo.status;
};

const styleForPhoto = (photoId: string, preferences: Record<string, PhotoStylePreference>) => {
  const preference = preferences[photoId];
  return styleCatalog.find((style) => style.id === preference?.styleId) ?? styleCatalog[0]!;
};

const variantStylesForPhoto = (photoId: string, preferences: Record<string, PhotoStylePreference>, count: number) =>
  Array.from({ length: count }, (_, index) => variantStylePresetForIndex(index + 1, preferences[photoId]?.styleId));

const styleSummaryForPhoto = (photoId: string, preferences: Record<string, PhotoStylePreference>, count: number) =>
  variantStylesForPhoto(photoId, preferences, count)
    .map((style, index) => `V${index + 1} ${style.styleName}`)
    .join(" · ");

const compactStyleSummaryForPhoto = (photoId: string, preferences: Record<string, PhotoStylePreference>, count: number) => {
  const styles = variantStylesForPhoto(photoId, preferences, count);
  if (styles.length <= 2) return styles.map((style) => style.styleName).join(" / ");
  return `${styles[0]?.styleName ?? "Estilo"} / ${styles[1]?.styleName ?? "Estilo"} +${styles.length - 2}`;
};

const promptsForPhoto = (
  photoId: string,
  preferences: Record<string, PhotoStylePreference>,
  count: number,
  fallbackIntensity: number
) => {
  const intensity = intensityLevel(preferences[photoId]?.intensity ?? fallbackIntensity);
  return variantStylesForPhoto(photoId, preferences, count)
    .map((style, index) => `V${index + 1}: ${variantEditPromptForStyle(style.styleName, intensity)}`)
    .join("\n");
};

const intensityLevel = (value: number): "ligera" | "media" | "fuerte" => {
  if (value <= 40) return "ligera";
  if (value >= 80) return "fuerte";
  return "media";
};

const intensityCopy = (value: number) => {
  if (value <= 40) return "Conserva la comida casi intacta; solo mejora foto.";
  if (value >= 80) return "Cambia mas el ambiente, sin cambiar el platillo.";
  return "Mejora presentacion sin transformar el producto.";
};

const GenerationIntensityControl = ({
  value,
  onChange
}: {
  value: number;
  onChange: (next: number) => void;
}) => (
  <View style={styles.intensityBox}>
    <View style={styles.rowBetween}>
      <Text style={styles.rowTitle}>Intensidad de generacion</Text>
      <Pill label={`${value}%`} tone={value <= 40 ? "good" : value >= 80 ? "warn" : "neutral"} />
    </View>
    <Text style={styles.muted}>{intensityCopy(value)}</Text>
    <View style={styles.sliderRow}>
      {[25, 40, 60, 80].map((option) => (
        <Pressable key={option} style={[styles.sliderDot, value === option ? styles.sliderDotActive : null]} onPress={() => onChange(option)}>
          <Text style={[styles.sliderText, value === option ? styles.sliderTextActive : null]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  </View>
);

const styleOverridesForGeneration = (
  photos: Photo[],
  preferences: Record<string, PhotoStylePreference>,
  fallbackIntensity: number
): GenerateBatchStyleOverride[] =>
  photos.filter(isPhotoAnalyzed).map((photo) => {
    const style = styleForPhoto(photo.id, preferences);
    return {
      photoId: photo.id,
      styleId: style.id,
      styleName: style.name,
      intensity: preferences[photo.id]?.intensity ?? fallbackIntensity
    };
  });

const visionLabels = (photo: Photo) => {
  const analysis = photo.visionAnalysis as
    | {
        subject?: { description?: string };
        mood?: { keywords?: string[]; description?: string };
        summary?: string;
      }
    | null
    | undefined;
  return [
    analysis?.subject?.description,
    ...(analysis?.mood?.keywords ?? []),
    analysis?.mood?.description,
    analysis?.summary
  ].filter((item): item is string => Boolean(item)).slice(0, 6);
};

const hasWorkInProgress = (detail: BatchDetail | undefined) =>
  Boolean(
    detail?.photos.some(isPhotoBusy) ||
      detail?.variants.some(isVariantBusy) ||
      detail?.jobs.some((job) => ["queued", "running"].includes(job.status))
  );

const isWorkJob = (job: BatchDetail["jobs"][number]) =>
  ["analyze_photo", "generate_batch", "generate_variant", "schedule_posts", "publish_post"].includes(job.type);

const hasActiveWorkJobs = (jobs: BatchDetail["jobs"]) =>
  jobs.some((job) => ["queued", "running"].includes(job.status) && isWorkJob(job));

const isBatchWorking = (batch: BatchSummary) =>
  ["pending_upload", "pendiente", "subiendo", "uploading", "analizando", "analyzing", "generando", "generating"].includes(batch.status);

const flowForBatchSummary = (batch: BatchSummary): FlowStep => {
  if (["completado", "completed"].includes(batch.status)) return "calendar";
  if (["generando", "generating"].includes(batch.status)) return "generate";
  if (batch.variantsCount > 0 || ["generado_parcial", "ready_for_review"].includes(batch.status)) return "review";
  return "styles";
};

const flowForBatchDetail = (detail: BatchDetail, posts: ScheduledPost[] = []): FlowStep => {
  const variants = detail.variants;
  const photos = detail.photos;
  const batchPosts = posts.filter((post) => post.batchId === detail.batch.id);
  if (batchPosts.length > 0) return "calendar";
  const generationJobsActive = detail.jobs.some(
    (job) => ["queued", "running"].includes(job.status) && ["generate_batch", "generate_variant"].includes(job.type)
  );
  if (variants.some(isVariantBusy) || generationJobsActive || ["generando", "generating"].includes(detail.batch.status)) {
    return "generate";
  }
  if (variants.some(isVariantReviewable)) return "review";
  const accepted = variants.some((variant) => ["aprobada", "approved"].includes(variant.status));
  if (accepted) return "schedule";
  if (variants.length > 0) return "review";
  if (photos.some(isPhotoBusy)) return "styles";
  return "styles";
};

function BootScreen() {
  const config = getMobileConfig();
  const [flow, setFlow] = useState<FlowStep>("home");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [metaReturnMessage, setMetaReturnMessage] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [localUploadPreviews, setLocalUploadPreviews] = useState<LocalPhotoPreview[]>([]);
  const [pageSnapshot, setPageSnapshot] = useState<MetaPage | null>(null);
  const [photoPrefs, setPhotoPrefs] = useState<Record<string, PhotoStylePreference>>({});
  const [stylePhotoId, setStylePhotoId] = useState<string | null>(null);
  const [detailPhotoId, setDetailPhotoId] = useState<string | null>(null);
  const [generationIntensity, setGenerationIntensity] = useState(40);
  const [variantsPerPhoto, setVariantsPerPhoto] = useState(5);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(14);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [pendingAutoRouteBatchId, setPendingAutoRouteBatchId] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null);
  const updatePromptShown = useRef(false);
  const authRecoveryAttempted = useRef(false);

  const handleMetaReturn = useCallback((url: string | null) => {
    if (!url?.startsWith("fbmaniaco://meta-connected")) return;
    const succeeded = url.includes("status=success");
    setMetaReturnMessage(
      succeeded ? "Facebook conectado. Actualizando tus paginas..." : "Facebook no completo la autorizacion. Intenta conectar otra vez."
    );
    void queryClient.invalidateQueries({ queryKey: ["session-token"] });
    void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    void queryClient.invalidateQueries({ queryKey: ["pages"] });
  }, []);

  const tokenQuery = useQuery({ queryKey: ["session-token"], queryFn: getStoredSessionToken });
  const token = tokenQuery.data ?? "";
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      if (!token) return { authenticated: false as const, nextStep: "sign_in" as const };
      return getBootstrapStatus(token);
    },
    enabled: tokenQuery.isSuccess,
    retry: 1
  });

  useEffect(() => {
    if (!bootstrap.isError || !isAuthSessionError(bootstrap.error) || authRecoveryAttempted.current) return;
    authRecoveryAttempted.current = true;
    void clearStoredSession().then(async () => {
      queryClient.setQueryData(["session-token"], null);
      await queryClient.invalidateQueries({ queryKey: ["session-token"] });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    });
  }, [bootstrap.error, bootstrap.isError]);

  useEffect(() => {
    if (bootstrap.isSuccess) authRecoveryAttempted.current = false;
  }, [bootstrap.isSuccess]);

  const selectedBusinessId = bootstrap.data?.authenticated ? bootstrap.data.selectedBusinessId : null;
  const selectedPageId = bootstrap.data?.authenticated ? bootstrap.data.selectedPageId : null;

  const pages = useQuery({
    queryKey: ["pages"],
    queryFn: async () => listMetaPages(token),
    enabled: Boolean(
      token &&
        bootstrap.data?.authenticated &&
        (bootstrap.data.nextStep === "select_page" || bootstrap.data.nextStep === "home")
    )
  });
  const selectedPage = useMemo(
    () => (pages.data ?? []).find((page) => page.id === selectedPageId || page.isSelected) ?? pageSnapshot,
    [pageSnapshot, pages.data, selectedPageId]
  );

  useEffect(() => {
    const current = (pages.data ?? []).find((page) => page.id === selectedPageId || page.isSelected);
    if (current) setPageSnapshot(current);
  }, [pages.data, selectedPageId]);

  const batches = useQuery({
    queryKey: ["batches", selectedBusinessId],
    queryFn: async () => listBatches(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && selectedBusinessId && bootstrap.data?.nextStep === "home"),
    refetchInterval: (query) => ((query.state.data as BatchSummary[] | undefined)?.some(isBatchWorking) ? WORK_POLL_MS : false)
  });
  const selectedBatch = useMemo(
    () => (selectedBatchId ? (batches.data ?? []).find((batch) => batch.id === selectedBatchId) ?? null : null),
    [batches.data, selectedBatchId]
  );
  const batchDetail = useQuery({
    queryKey: ["batch-detail", selectedBusinessId, selectedBatch?.id],
    queryFn: async () => getBatchDetail(token, selectedBusinessId ?? "", selectedBatch?.id ?? ""),
    enabled: Boolean(token && selectedBusinessId && selectedBatch?.id && bootstrap.data?.nextStep === "home"),
    refetchInterval: (query) =>
      hasWorkInProgress(query.state.data as BatchDetail | undefined) || (selectedBatch ? isBatchWorking(selectedBatch) : false)
        ? WORK_POLL_MS
        : false
  });
  const scheduledPosts = useQuery({
    queryKey: ["scheduled-posts", selectedBusinessId],
    queryFn: async () => listScheduledPosts(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && selectedBusinessId && bootstrap.data?.nextStep === "home"),
    refetchInterval: 15000
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void refreshAll();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync().catch(() => undefined);
    return () => {
      void WebBrowser.coolDownAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (config.appEnv === "development") return;
    let mounted = true;
    void checkForAppUpdate()
      .then((update) => {
        if (mounted) setAvailableUpdate(update);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [config.appEnv]);

  useEffect(() => {
    if (!availableUpdate || updatePromptShown.current) return;
    updatePromptShown.current = true;
    NativeAlert.alert(
      availableUpdate.mandatory ? "Actualizacion requerida" : "Actualizacion disponible",
      availableUpdate.notes ?? `Ya esta lista Maniaco ${availableUpdate.versionName}.`,
      [
        ...(availableUpdate.mandatory ? [] : [{ text: "Despues", style: "cancel" as const }]),
        { text: "Actualizar", onPress: () => void openAppUpdate(availableUpdate) }
      ]
    );
  }, [availableUpdate]);

  useEffect(() => {
    void Linking.getInitialURL().then(handleMetaReturn);
    const subscription = Linking.addEventListener("url", (event) => handleMetaReturn(event.url));
    return () => subscription.remove();
  }, [handleMetaReturn]);

  useEffect(() => {
    if (!tokenQuery.isSuccess || token) return;
    let cancelled = false;
    void ensureSessionForMeta()
      .then((sessionToken) => {
        if (!cancelled) queryClient.setQueryData(["session-token"], sessionToken);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, tokenQuery.isSuccess]);

  useEffect(() => {
    if (selectedBatchId && batches.data && !batches.data.some((batch) => batch.id === selectedBatchId)) {
      setSelectedBatchId(null);
      setPendingAutoRouteBatchId(null);
      setFlow(selectedPage ? "styles" : "home");
    }
  }, [batches.data, selectedBatchId, selectedPage]);

  const invalidateWork = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["batches"] }),
      queryClient.invalidateQueries({ queryKey: ["batch-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] })
    ]);
  };

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["session-token"] }),
      queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      queryClient.invalidateQueries({ queryKey: ["pages"] }),
      queryClient.invalidateQueries({ queryKey: ["batches"] }),
      queryClient.invalidateQueries({ queryKey: ["batch-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] })
    ]);
  };

  const connect = useMutation({
    mutationFn: async () => {
      let sessionToken = token || (await ensureSessionForMeta());
      queryClient.setQueryData(["session-token"], sessionToken);
      try {
        return await connectMeta(sessionToken);
      } catch (error) {
        if (!isAuthSessionError(error)) throw error;
        await clearStoredSession();
        sessionToken = await ensureSessionForMeta();
        queryClient.setQueryData(["session-token"], sessionToken);
        return connectMeta(sessionToken);
      }
    },
    onSuccess: async (result) => {
      if (result.authorizationUrl) {
        try {
          const authResult = await WebBrowser.openAuthSessionAsync(result.authorizationUrl, "fbmaniaco://meta-connected");
          if (authResult.type === "success") handleMetaReturn(authResult.url);
          else if (authResult.type === "cancel" || authResult.type === "dismiss") {
            setMetaReturnMessage("Facebook se cerro antes de terminar la autorizacion.");
          }
        } catch {
          await Linking.openURL(result.authorizationUrl);
        }
      }
      await refreshAll();
    }
  });

  const signOut = useMutation({
    mutationFn: clearStoredSession,
    onSuccess: async () => {
      queryClient.clear();
      setSelectedBatchId(null);
      setPendingAutoRouteBatchId(null);
      setFlow("home");
      await queryClient.invalidateQueries({ queryKey: ["session-token"] });
    }
  });

  const selectPage = useMutation({
    mutationFn: async (pageId: string) => selectMetaPage(token, pageId),
    onSuccess: async (result) => {
      queryClient.setQueryData(["bootstrap"], result.bootstrap);
      setSelectedBatchId(null);
      setPendingAutoRouteBatchId(null);
      setFlow("styles");
      await refreshAll();
    }
  });

  const uploadSelectedPhotos = useMutation({
    mutationFn: async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("Necesitamos permiso para elegir fotos.");
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.95,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS_PER_PICK
      });
      if (selection.canceled || selection.assets.length === 0) return { uploaded: 0, failed: 0, total: 0, errors: [] as string[] };
      const assets = selection.assets.slice(0, MAX_PHOTOS_PER_PICK);

      const businessId = selectedBusinessId ?? "";
      if (!businessId) throw new Error("Selecciona una pagina antes de subir fotos.");
      let batchId = selectedBatch?.id ?? null;
      if (!batchId || selectedBatch?.status === "completado" || selectedBatch?.status === "completed") {
        const batch = await createBatch(token, businessId);
        batchId = batch.id;
        setSelectedBatchId(batch.id);
        queryClient.setQueryData(["batches", businessId], (current: BatchSummary[] | undefined) => [batch, ...(current ?? [])]);
      }

      const errors: string[] = [];
      let uploaded = 0;
      setUploadNotice(null);
      setUploadProgress({ done: 0, total: assets.length });
      setLocalUploadPreviews(
        assets.map((asset, index) => ({
          id: `${Date.now()}-${index}`,
          uri: asset.uri,
          name: asset.fileName ?? `Foto ${index + 1}`
        }))
      );
      setFlow("styles");

      for (const [index, asset] of assets.entries()) {
        try {
          const upload = await preparePhotoForUpload(asset, index);
          await uploadPhoto(token, businessId, batchId, upload);
          uploaded += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "No pudimos subir esta foto.";
          errors.push(`${asset.fileName ?? `Foto ${index + 1}`}: ${message}`);
        } finally {
          setUploadProgress({ done: index + 1, total: assets.length });
        }
      }

      if (uploaded === 0) throw new Error(errors[0] ?? "No pudimos subir las fotos seleccionadas.");
      return { uploaded, failed: errors.length, total: assets.length, errors };
    },
    onSuccess: async (result) => {
      if (result.total > 0) {
        setUploadNotice(
          result.failed > 0
            ? `Subimos ${result.uploaded} de ${result.total} fotos. ${result.failed} necesita reintento.`
            : `Subimos ${result.uploaded} foto${result.uploaded === 1 ? "" : "s"} y ya se estan analizando.`
        );
        setFlow("styles");
      }
      setUploadProgress(null);
      await invalidateWork();
    },
    onError: () => setUploadProgress(null)
  });

  const generateVariants = useMutation({
    mutationFn: async () =>
      generateBatchVariants(
        token,
        selectedBusinessId ?? "",
        selectedBatch?.id ?? "",
        variantsPerPhoto,
        styleOverridesForGeneration(photos, photoPrefs, generationIntensity)
      ),
    onMutate: () => setFlow("generate"),
    onSuccess: invalidateWork
  });

  const saveCaption = useMutation({
    mutationFn: async (variantId: string) =>
      updateVariantCaption(token, selectedBusinessId ?? "", selectedBatch?.id ?? "", variantId, captionDrafts[variantId] ?? ""),
    onSuccess: invalidateWork
  });

  const approve = useMutation({
    mutationFn: async (variantId: string) => approveVariant(token, selectedBusinessId ?? "", selectedBatch?.id ?? "", variantId),
    onSuccess: invalidateWork
  });

  const reject = useMutation({
    mutationFn: async (variantId: string) => rejectVariant(token, selectedBusinessId ?? "", selectedBatch?.id ?? "", variantId),
    onSuccess: invalidateWork
  });

  const schedule = useMutation({
    mutationFn: async () => confirmCalendar(token, selectedBusinessId ?? "", selectedBatch?.id ?? "", periodDays),
    onSuccess: async (result) => {
      setPublishNotice(
        `Quedaron ${result.scheduledPosts.length} publicaciones programadas. Aun no estan publicadas; se enviaran automaticamente en su hora.`
      );
      setFlow("calendar");
      await invalidateWork();
    }
  });

  const publishNow = useMutation({
    mutationFn: async (post: ScheduledPost) => publishScheduledPost(token, selectedBusinessId ?? "", post.batchId, post.id),
    onMutate: () => setPublishNotice("Mandando la publicacion a Facebook..."),
    onSuccess: async (result) => {
      setPublishNotice(
        isPostGood(result.scheduledPost)
          ? "Publicacion confirmada en Facebook."
          : "La publicacion quedo enviada. Esperando confirmacion del proceso."
      );
      await invalidateWork();
    }
  });

  const retryPost = useMutation({
    mutationFn: async (post: ScheduledPost) => retryScheduledPost(token, selectedBusinessId ?? "", post.batchId, post.id),
    onMutate: () => setPublishNotice("Reintentando publicacion..."),
    onSuccess: async (result) => {
      setPublishNotice(
        isPostGood(result.scheduledPost)
          ? "Publicacion confirmada en Facebook."
          : "Reintento enviado. Revisa el estado en esta pantalla."
      );
      await invalidateWork();
    }
  });

  const cancelPost = useMutation({
    mutationFn: async (post: ScheduledPost) => cancelScheduledPost(token, selectedBusinessId ?? "", post.batchId, post.id),
    onSuccess: async () => {
      setPublishNotice("Publicacion cancelada.");
      await invalidateWork();
    }
  });

  const removeBatch = useMutation({
    mutationFn: async (batchId: string) => deleteBatch(token, selectedBusinessId ?? "", batchId),
    onSuccess: async (_result, batchId) => {
      if (selectedBatchId === batchId) {
        setSelectedBatchId(null);
        setPendingAutoRouteBatchId(null);
        setFlow(selectedPage ? "styles" : "home");
        setStylePhotoId(null);
        setDetailPhotoId(null);
      }
      await invalidateWork();
    }
  });

  const reschedulePost = useMutation({
    mutationFn: async ({ post, scheduledFor }: { post: ScheduledPost; scheduledFor: string }) =>
      updateScheduledPost(token, selectedBusinessId ?? "", post.batchId, post.id, scheduledFor),
    onSuccess: invalidateWork
  });

  const detail = batchDetail.data;
  const photos = detail?.photos ?? [];
  const variants = detail?.variants ?? [];
  const jobs = detail?.jobs ?? [];
  const posts = scheduledPosts.data ?? [];
  const failedWorkJobs = jobs.filter((job) => job.status === "failed" && isWorkJob(job));
  const reviewQueue = variants.filter(isVariantReviewable);
  const currentReview = reviewQueue[Math.min(reviewIndex, Math.max(0, reviewQueue.length - 1))] ?? null;
  const acceptedCount = variants.filter(isVariantAccepted).length;
  const generatedDone = variants.filter(isVariantDone).length;
  const generatedTotal = variants.length;
  const analyzedCount = photos.filter(isPhotoAnalyzed).length;
  const generationBusy = generateVariants.isPending || variants.some(isVariantBusy) || hasActiveWorkJobs(jobs);
  const readyPhotoCount = photos.filter(isPhotoAnalyzed).length;
  const photosReadyForGeneration = photos.length > 0 && analyzedCount === photos.length && !photos.some(isPhotoBusy);
  const hasVariants = variants.length > 0;
  const failedPosts = posts.filter(isPostFailed);
  const selectedBatchPosts = selectedBatch ? posts.filter((post) => post.batchId === selectedBatch.id) : [];
  const refreshing =
    tokenQuery.isFetching || bootstrap.isFetching || pages.isFetching || batches.isFetching || batchDetail.isFetching || scheduledPosts.isFetching;

  const batchProcessSteps = useMemo<BatchProcessStep[]>(() => {
    if (!selectedBatch) return [];
    const processOrder: BatchFlowStep[] = ["styles", "generate", "review", "schedule", "calendar"];
    const labels: Record<BatchFlowStep, { label: string; icon: IconName }> = {
      styles: { label: "Fotos", icon: "images-outline" },
      generate: { label: "Generar", icon: "sparkles-outline" },
      review: { label: "Revisar", icon: "albums-outline" },
      schedule: { label: "Programar", icon: "calendar-outline" },
      calendar: { label: "Agenda", icon: "calendar-number-outline" }
    };
    const variantsStarted = variants.length > 0 || selectedBatch.variantsCount > 0 || generationBusy;
    const variantsComplete = variantsStarted && !generationBusy && (variants.length > 0 || selectedBatch.variantsCount > 0);
    const reviewComplete = variantsComplete && variants.length > 0 && reviewQueue.length === 0;
    const calendarReady =
      selectedBatchPosts.length > 0 || ["programado", "scheduled", "completado", "completed"].includes(selectedBatch.status);
    const completed: Record<BatchFlowStep, boolean> = {
      styles: photosReadyForGeneration || variantsStarted || calendarReady,
      generate: variantsComplete || calendarReady,
      review: reviewComplete || calendarReady,
      schedule: calendarReady,
      calendar: false
    };
    const ready: Record<BatchFlowStep, boolean> = {
      styles: true,
      generate: photosReadyForGeneration,
      review: variantsComplete,
      schedule: reviewComplete && acceptedCount > 0,
      calendar: calendarReady
    };
    const current = processOrder.includes(flow as BatchFlowStep) ? (flow as BatchFlowStep) : flowForBatchSummary(selectedBatch);
    return processOrder.map((key) => {
      const state: BatchProcessState = current === key ? "active" : completed[key] ? "done" : ready[key] ? "ready" : "locked";
      return { key, label: labels[key].label, icon: labels[key].icon, state };
    });
  }, [
    acceptedCount,
    flow,
    generationBusy,
    photosReadyForGeneration,
    reviewQueue.length,
    selectedBatch,
    selectedBatchPosts.length,
    variants.length
  ]);

  const leaveBatch = useCallback(() => {
    setSelectedBatchId(null);
    setStylePhotoId(null);
    setDetailPhotoId(null);
    setSelectedDay(null);
    setPendingAutoRouteBatchId(null);
    setFlow(selectedPage ? "styles" : "home");
  }, [selectedPage]);

  const confirmDeleteBatch = (batch: BatchSummary) => {
    NativeAlert.alert(
      "Eliminar lote",
      "El lote saldra de tu lista y se cancelara el trabajo pendiente que todavia no se haya enviado. Las publicaciones ya publicadas no se borran de Facebook.",
      [
        { text: "Conservar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => removeBatch.mutate(batch.id) }
      ]
    );
  };

  useEffect(() => {
    setReviewIndex(0);
  }, [reviewQueue.length]);

  useEffect(() => {
    if (!uploadSelectedPhotos.isPending && photos.length > 0) {
      setLocalUploadPreviews([]);
    }
  }, [photos.length, uploadSelectedPhotos.isPending]);

  useEffect(() => {
    if (flow === "generate" && !generationBusy && reviewQueue.length > 0) {
      setFlow("review");
    }
  }, [flow, generationBusy, reviewQueue.length]);

  useEffect(() => {
    if (flow === "generate" && !generationBusy && !hasVariants && !photosReadyForGeneration) {
      setFlow("styles");
    }
  }, [flow, generationBusy, hasVariants, photosReadyForGeneration]);

  useEffect(() => {
    if (!detail || pendingAutoRouteBatchId !== detail.batch.id) return;
    setFlow(flowForBatchDetail(detail, posts));
    setPendingAutoRouteBatchId(null);
  }, [detail, pendingAutoRouteBatchId, posts]);

  const visibleError =
    bootstrap.error ??
    connect.error ??
    pages.error ??
    selectPage.error ??
    batches.error ??
    batchDetail.error ??
    scheduledPosts.error ??
    uploadSelectedPhotos.error ??
    generateVariants.error ??
    saveCaption.error ??
    approve.error ??
    reject.error ??
    schedule.error ??
    publishNow.error ??
    retryPost.error ??
    cancelPost.error ??
    removeBatch.error ??
    reschedulePost.error;

  const openPage = (page: MetaPage) => {
    setPageSnapshot(page);
    if (page.id === selectedPage?.id || page.isSelected) {
      setSelectedBatchId(null);
      setPendingAutoRouteBatchId(null);
      setFlow("styles");
      return;
    }
    selectPage.mutate(page.id);
  };

  const openBatch = (batch: BatchSummary) => {
    setStylePhotoId(null);
    setDetailPhotoId(null);
    setSelectedDay(null);
    setSelectedBatchId(batch.id);
    setPendingAutoRouteBatchId(batch.id);
    setFlow(flowForBatchSummary(batch));
  };

  const handleReviewAction = async (action: "approve" | "reject") => {
    if (!currentReview) return;
    if (action === "approve") await approve.mutateAsync(currentReview.id);
    else await reject.mutateAsync(currentReview.id);
    setReviewIndex((current) => current + 1);
  };

  const shiftPost = (post: ScheduledPost, days: number, hours: number) => {
    const next = new Date(post.scheduledFor);
    next.setDate(next.getDate() + days);
    next.setHours(next.getHours() + hours);
    reschedulePost.mutate({ post, scheduledFor: next.toISOString() });
  };

  const stateText = useMemo(() => {
    if (bootstrap.isLoading) return "Revisando conexion inicial...";
    if (bootstrap.isError) return "No pudimos conectar con Maniaco.";
    if (!bootstrap.data?.authenticated) return "Conecta Facebook para empezar.";
    if (bootstrap.data.nextStep === "connect_meta" || bootstrap.data.nextStep === "recover_meta") return "Sesion segura lista.";
    if (bootstrap.data.nextStep === "select_page") return "Facebook conectado: elige pagina.";
    return selectedPage?.pageName ? `Pagina activa: ${selectedPage.pageName}` : "Pagina activa";
  }, [bootstrap.data, bootstrap.isError, bootstrap.isLoading, selectedPage?.pageName]);

  const showPageDirectory = useCallback(() => {
    setSelectedBatchId(null);
    setStylePhotoId(null);
    setDetailPhotoId(null);
    setSelectedDay(null);
    setPendingAutoRouteBatchId(null);
    setFlow("home");
  }, []);

  const handleAndroidBack = useCallback(() => {
    if (stylePhotoId) {
      setStylePhotoId(null);
      return true;
    }
    if (detailPhotoId) {
      setDetailPhotoId(null);
      return true;
    }
    if (selectedDay) {
      setSelectedDay(null);
      return true;
    }
    if (!bootstrap.data?.authenticated || bootstrap.data.nextStep === "select_page") {
      return false;
    }
    if (flow === "settings") {
      if (selectedBatch && detail) {
        setFlow(flowForBatchDetail(detail, posts));
      } else if (selectedBatch) {
        setFlow(flowForBatchSummary(selectedBatch));
      } else if (selectedPage) {
        setFlow("styles");
      } else {
        setFlow("home");
      }
      return true;
    }
    if (selectedBatch) {
      if (flow === "calendar") {
        setFlow(acceptedCount > 0 ? "schedule" : hasVariants ? "review" : photosReadyForGeneration ? "generate" : "styles");
        return true;
      }
      if (flow === "schedule") {
        setFlow(hasVariants ? "review" : photosReadyForGeneration ? "generate" : "styles");
        return true;
      }
      if (flow === "review") {
        setFlow(generationBusy || hasVariants ? "generate" : "styles");
        return true;
      }
      if (flow === "generate") {
        setFlow("styles");
        return true;
      }
      if (flow === "styles") {
        leaveBatch();
        return true;
      }
    }
    if (selectedPage && flow === "styles") {
      showPageDirectory();
      return true;
    }
    if (flow !== "home") {
      setFlow("home");
      return true;
    }
    return false;
  }, [
    acceptedCount,
    bootstrap.data?.authenticated,
    bootstrap.data?.nextStep,
    detail,
    detailPhotoId,
    flow,
    generationBusy,
    hasVariants,
    leaveBatch,
    photosReadyForGeneration,
    posts,
    selectedBatch,
    selectedDay,
    selectedPage,
    showPageDirectory,
    stylePhotoId
  ]);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", handleAndroidBack);
    return () => subscription.remove();
  }, [handleAndroidBack]);

  const renderPageChrome = (options: { includeUpload?: boolean } = {}) => {
    if (!selectedPage) return null;
    const actions: PageAction[] = [
      { label: "Paginas", icon: "albums-outline", onPress: showPageDirectory },
      ...(options.includeUpload
        ? [
            {
              label: uploadSelectedPhotos.isPending ? "Subiendo" : "Subir lote",
              icon: "cloud-upload-outline" as IconName,
              onPress: () => uploadSelectedPhotos.mutate(),
              disabled: uploadSelectedPhotos.isPending || !selectedBusinessId,
              tone: "primary" as const
            }
          ]
        : []),
      { label: "Ajustes", icon: "settings-outline", onPress: () => setFlow("settings") }
    ];
    return (
      <>
        <PageHeader page={selectedPage} />
        <PageActionRail actions={actions} />
      </>
    );
  };

  const renderJobAlerts = () =>
    failedWorkJobs.length > 0 ? (
      <Alert
        tone="critical"
        message={
          failedWorkJobs[0]?.userMessage ??
          (failedWorkJobs[0] as { lastError?: string } | undefined)?.lastError ??
          "Un proceso del lote fallo."
        }
      />
    ) : null;

  const renderOnboarding = () => {
    if (!bootstrap.data?.authenticated) {
      return (
        <CenteredScreen>
          <Button
            label={connect.isPending ? "Abriendo Facebook..." : "Continuar con Facebook"}
            icon="logo-facebook"
            disabled={connect.isPending || tokenQuery.isFetching}
            onPress={() => connect.mutate()}
          />
          {metaReturnMessage ? <Text style={styles.muted}>{metaReturnMessage}</Text> : null}
        </CenteredScreen>
      );
    }

    if (bootstrap.data?.nextStep === "connect_meta" || bootstrap.data?.nextStep === "recover_meta") {
      return (
        <CenteredScreen>
          <Button
            label={connect.isPending ? "Conectando..." : "Conectar con Facebook"}
            icon="logo-facebook"
            disabled={connect.isPending}
            onPress={() => connect.mutate()}
          />
          {metaReturnMessage ? <Text style={styles.muted}>{metaReturnMessage}</Text> : null}
        </CenteredScreen>
      );
    }

    if (bootstrap.data?.nextStep === "select_page") {
      return renderPageDirectory();
    }

    return null;
  };

  const renderPageDirectory = () => (
    <Screen>
      {pages.isLoading ? <View style={styles.centeredBlock}><ActivityIndicator color={palette.blue} /></View> : null}
      {(pages.data ?? []).map((page) => (
        <PageCard
          key={page.id}
          page={page}
          selected={page.id === selectedPage?.id || page.isSelected}
          disabled={selectPage.isPending}
          onPress={() => openPage(page)}
        />
      ))}
    </Screen>
  );

  const renderPageWorkspace = () => (
    <Screen>
      {renderPageChrome({ includeUpload: true })}
      {renderJobAlerts()}
      {uploadNotice ? <Alert tone="info" message={uploadNotice} /> : null}
      <View style={styles.batchList}>
        {(batches.data ?? []).length === 0 ? <EmptyState title="Sin lotes" body="Sube fotos para crear el primero." /> : null}
        {(batches.data ?? []).map((batch) => (
          <BatchRow
            key={batch.id}
            batch={batch}
            selected={batch.id === selectedBatch?.id}
            deleting={removeBatch.isPending}
            onPress={() => openBatch(batch)}
            onDelete={() => confirmDeleteBatch(batch)}
          />
        ))}
      </View>
    </Screen>
  );

  const renderStyles = () => {
    const primaryLabel = generationBusy
      ? "Ver progreso"
      : reviewQueue.length > 0
        ? "Revisar variantes"
        : acceptedCount > 0
          ? "Programar"
          : hasVariants
            ? "Ver resumen"
            : "Generar variantes";
    const primaryIcon: IconName = generationBusy
      ? "time-outline"
      : acceptedCount > 0 && reviewQueue.length === 0
          ? "calendar-outline"
          : reviewQueue.length > 0 || hasVariants
            ? "images-outline"
            : "sparkles-outline";
    const handlePrimary = () => {
      if (generationBusy) setFlow("generate");
      else if (acceptedCount > 0 && reviewQueue.length === 0) setFlow("schedule");
      else if (reviewQueue.length > 0 || hasVariants) setFlow("review");
      else setFlow("generate");
    };

    return (
      <Screen>
        {renderPageChrome()}
        {renderJobAlerts()}
        {selectedBatch ? (
          <BatchTop
            batch={selectedBatch}
            active="styles"
            steps={batchProcessSteps}
            deleting={removeBatch.isPending}
            onMinimize={leaveBatch}
            onDelete={() => confirmDeleteBatch(selectedBatch)}
          />
        ) : null}
        {uploadNotice ? <Alert tone="info" message={uploadNotice} /> : null}
        {generationBusy ? <Alert tone="info" message="Este lote ya esta generando variantes." /> : null}
        {!generationBusy && reviewQueue.length > 0 ? <Alert tone="info" message="Este lote ya tiene variantes listas para revisar." /> : null}
        {photos.length === 0 && localUploadPreviews.length === 0 ? <EmptyState title="Aun no hay fotos" body="Sube fotos para generar variantes." /> : null}
        {localUploadPreviews.length > 0 && photos.length === 0 ? (
          <Panel title="Fotos seleccionadas" eyebrow="Subiendo">
            <View style={styles.photoGrid}>
              {localUploadPreviews.map((preview, index) => <PendingPhotoTile key={preview.id} preview={preview} index={index} />)}
            </View>
          </Panel>
        ) : null}
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              index={index}
              styleName={compactStyleSummaryForPhoto(photo.id, photoPrefs, variantsPerPhoto)}
              onPress={() => setDetailPhotoId(photo.id)}
              onLongPress={() => setStylePhotoId(photo.id)}
            />
          ))}
        </View>
        {stylePhotoId ? (
          <StylePicker
            photoId={stylePhotoId}
            preference={photoPrefs[stylePhotoId] ?? { styleId: styleCatalog[0]!.id, intensity: generationIntensity }}
            variantsPerPhoto={variantsPerPhoto}
            onChange={(next) => setPhotoPrefs((current) => ({ ...current, [stylePhotoId]: next }))}
            onClose={() => setStylePhotoId(null)}
          />
        ) : null}
        {detailPhotoId ? (
          <PhotoDetail
            photo={photos.find((photo) => photo.id === detailPhotoId) ?? null}
            prompt={promptsForPhoto(detailPhotoId, photoPrefs, variantsPerPhoto, generationIntensity)}
            onClose={() => setDetailPhotoId(null)}
          />
        ) : null}
        <ActionPair
          primaryLabel={primaryLabel}
          primaryIcon={primaryIcon}
          primaryDisabled={!generationBusy && !hasVariants && acceptedCount === 0 && !photosReadyForGeneration}
          onPrimary={handlePrimary}
          secondaryLabel={uploadSelectedPhotos.isPending ? "Subiendo..." : "Subir mas"}
          secondaryIcon="add-circle-outline"
          secondaryDisabled={uploadSelectedPhotos.isPending || generationBusy}
          onSecondary={() => uploadSelectedPhotos.mutate()}
        />
      </Screen>
    );
  };

  const renderGenerate = () => {
    const done = generatedTotal > 0 ? generatedDone : 0;
    const total = generatedTotal > 0 ? generatedTotal : readyPhotoCount * variantsPerPhoto;
    if (generationBusy) {
      return (
        <Screen>
          {renderPageChrome()}
          {renderJobAlerts()}
          {selectedBatch ? (
            <BatchTop
              batch={selectedBatch}
              active="generate"
              steps={batchProcessSteps}
              deleting={removeBatch.isPending}
              onMinimize={leaveBatch}
              onDelete={() => confirmDeleteBatch(selectedBatch)}
            />
          ) : null}
          <Panel title="Progreso">
            <View style={styles.spinnerMark}>
              <ActivityIndicator color={palette.blue} />
              <Text style={styles.panelTitle}>{done} de {Math.max(total, done)} generadas</Text>
            </View>
            <ProgressBar progress={pct(done, Math.max(total, done))} />
            <Text style={styles.muted}>Editando cada foto con un fondo distinto.</Text>
            <Button label="Salir del lote" icon="albums-outline" variant="secondary" onPress={leaveBatch} />
          </Panel>
        </Screen>
      );
    }

    return (
      <Screen>
        {renderPageChrome()}
        {renderJobAlerts()}
        {selectedBatch ? (
          <BatchTop
            batch={selectedBatch}
            active="generate"
            steps={batchProcessSteps}
            deleting={removeBatch.isPending}
            onMinimize={leaveBatch}
            onDelete={() => confirmDeleteBatch(selectedBatch)}
          />
        ) : null}
        <Panel title="Variantes por foto">
          <Stepper value={variantsPerPhoto} min={1} max={5} onChange={setVariantsPerPhoto} />
          <Text style={styles.muted}>
            Total estimado: {readyPhotoCount * variantsPerPhoto} variantes
          </Text>
          <Button
            label={generateVariants.isPending ? "Enviando..." : "Confirmar"}
            icon="checkmark-circle-outline"
            disabled={generateVariants.isPending || !photosReadyForGeneration || hasVariants}
            onPress={() => generateVariants.mutate()}
          />
        </Panel>
        {reviewQueue.length > 0 ? (
          <Button label="Revisar variantes listas" icon="checkmark-circle-outline" onPress={() => setFlow("review")} />
        ) : null}
      </Screen>
    );
  };

  const renderReview = () => {
    if (selectedBatch && (batchDetail.isLoading || (selectedBatch.variantsCount > 0 && variants.length === 0))) {
      return (
        <Screen>
          {renderPageChrome()}
          {renderJobAlerts()}
          <BatchTop
            batch={selectedBatch}
            active="review"
            steps={batchProcessSteps}
            deleting={removeBatch.isPending}
            onMinimize={leaveBatch}
            onDelete={() => confirmDeleteBatch(selectedBatch)}
          />
          <Panel title="Preparando vista">
            <View style={styles.spinnerMark}>
              <ActivityIndicator color={palette.blue} />
              <Text style={styles.muted}>Un momento...</Text>
            </View>
          </Panel>
        </Screen>
      );
    }

    if (!currentReview) {
      return (
        <Screen>
          {renderPageChrome()}
          {renderJobAlerts()}
          {selectedBatch ? (
            <BatchTop
              batch={selectedBatch}
              active="review"
              steps={batchProcessSteps}
              deleting={removeBatch.isPending}
              onMinimize={leaveBatch}
              onDelete={() => confirmDeleteBatch(selectedBatch)}
            />
          ) : null}
          <Panel title="Resumen">
            <Text style={styles.bigNumber}>{acceptedCount}</Text>
            <Text style={styles.muted}>Variantes aceptadas</Text>
            {acceptedCount > 0 ? (
              <Button label="Continuar a programar" icon="calendar-outline" onPress={() => setFlow("schedule")} />
            ) : (
              <Button label="Salir del lote" icon="albums-outline" variant="secondary" onPress={leaveBatch} />
            )}
          </Panel>
        </Screen>
      );
    }
    return (
      <Screen>
        {renderPageChrome()}
        {renderJobAlerts()}
        {selectedBatch ? (
          <BatchTop
            batch={selectedBatch}
            active="review"
            steps={batchProcessSteps}
            deleting={removeBatch.isPending}
            onMinimize={leaveBatch}
            onDelete={() => confirmDeleteBatch(selectedBatch)}
          />
        ) : null}
        <SwipeReviewCard
          variant={currentReview}
          position={`${Math.min(reviewIndex + 1, reviewQueue.length)} de ${reviewQueue.length}`}
          caption={captionDrafts[currentReview.id] ?? currentReview.caption ?? ""}
          onCaptionChange={(value) => setCaptionDrafts((current) => ({ ...current, [currentReview.id]: value }))}
          onSave={() => saveCaption.mutate(currentReview.id)}
          onApprove={() => void handleReviewAction("approve")}
          onReject={() => void handleReviewAction("reject")}
          busy={approve.isPending || reject.isPending || saveCaption.isPending}
          onUndo={() => setReviewIndex((current) => Math.max(0, current - 1))}
        />
      </Screen>
    );
  };

  const renderSchedule = () => (
    <Screen>
      {renderPageChrome()}
      {renderJobAlerts()}
      {selectedBatch ? (
        <BatchTop
          batch={selectedBatch}
          active="schedule"
          steps={batchProcessSteps}
          deleting={removeBatch.isPending}
          onMinimize={leaveBatch}
          onDelete={() => confirmDeleteBatch(selectedBatch)}
        />
      ) : null}
      <Panel title="Periodo">
        <View style={styles.periodGrid}>
          {([7, 14, 30] as PeriodDays[]).map((days) => (
            <Pressable key={days} style={[styles.periodCard, periodDays === days ? styles.periodCardActive : null]} onPress={() => setPeriodDays(days)}>
              <Text style={[styles.periodNumber, periodDays === days ? styles.periodNumberActive : null]}>{days}</Text>
              <Text style={styles.muted}>{days === 7 ? "c/24h" : days === 14 ? "c/48h" : "c/4d"}</Text>
            </Pressable>
          ))}
        </View>
        <SchedulePreview periodDays={periodDays} acceptedCount={acceptedCount} />
        <Button
          label={schedule.isPending ? "Programando..." : "Confirmar"}
          icon="checkmark-done-outline"
          disabled={schedule.isPending || acceptedCount === 0}
          onPress={() => schedule.mutate()}
        />
      </Panel>
    </Screen>
  );

  const renderCalendar = () => (
    <Screen>
      {renderPageChrome()}
      {renderJobAlerts()}
      {publishNotice ? <Alert tone="info" message={publishNotice} /> : null}
      {selectedBatch ? (
        <BatchTop
          batch={selectedBatch}
          active="calendar"
          steps={batchProcessSteps}
          deleting={removeBatch.isPending}
          onMinimize={leaveBatch}
          onDelete={() => confirmDeleteBatch(selectedBatch)}
        />
      ) : null}
      <CalendarGrid posts={posts} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      <Panel title={selectedDay ? `Publicaciones ${formatDate(selectedDay)}` : "Publicaciones"}>
        {(selectedDay ? posts.filter((post) => dateKey(post.scheduledFor) === selectedDay) : posts).length === 0 ? (
          <EmptyState title="Sin publicaciones" body="Cuando programes variantes apareceran aqui." />
        ) : null}
        {(selectedDay ? posts.filter((post) => dateKey(post.scheduledFor) === selectedDay) : posts).map((post) => (
          <ScheduledPostRow
            key={post.id}
            post={post}
            busy={publishNow.isPending || retryPost.isPending || cancelPost.isPending || reschedulePost.isPending}
            onPublish={() => publishNow.mutate(post)}
            onRetry={() => retryPost.mutate(post)}
            onCancel={() => cancelPost.mutate(post)}
            onShift={(days, hours) => shiftPost(post, days, hours)}
          />
        ))}
      </Panel>
    </Screen>
  );

  const renderSettings = () => (
    <Screen>
      {renderPageChrome()}
      <Panel title="Pagina activa">
        <Text style={styles.muted}>{stateText}</Text>
        <Button
          label={connect.isPending ? "Conectando..." : "Reconectar Facebook"}
          icon="logo-facebook"
          variant="secondary"
          disabled={connect.isPending}
          onPress={() => connect.mutate()}
        />
      </Panel>
      <Panel title="Paginas de Facebook">
        {(pages.data ?? []).map((page) => (
          <PageCard key={page.id} page={page} selected={page.isSelected} disabled={selectPage.isPending} onPress={() => openPage(page)} />
        ))}
      </Panel>
      <Button
        label={signOut.isPending ? "Saliendo..." : "Cerrar sesion"}
        icon="log-out-outline"
        variant="danger"
        disabled={signOut.isPending}
        onPress={() => signOut.mutate()}
      />
      {availableUpdate ? (
        <Button
          label={`Actualizar a ${availableUpdate.versionName}`}
          icon="download-outline"
          variant="secondary"
          onPress={() => void openAppUpdate(availableUpdate)}
        />
      ) : null}
      {config.appEnv === "development" ? <Text style={styles.muted}>API: {config.apiUrl}</Text> : null}
    </Screen>
  );

  const renderCurrent = () => {
    if (tokenQuery.isLoading || (Boolean(token) && bootstrap.isLoading)) {
      return (
        <CenteredScreen>
          <ActivityIndicator color={palette.blue} />
        </CenteredScreen>
      );
    }
    if (!bootstrap.data?.authenticated || bootstrap.data.nextStep === "connect_meta" || bootstrap.data.nextStep === "recover_meta") {
      return renderOnboarding();
    }
    if (bootstrap.data.nextStep === "select_page") return renderPageDirectory();
    if (flow === "home") return renderPageDirectory();
    if (flow === "styles" && !selectedBatch) return renderPageWorkspace();
    if (flow === "styles") return renderStyles();
    if (flow === "generate") return renderGenerate();
    if (flow === "review") return renderReview();
    if (flow === "schedule") return renderSchedule();
    if (flow === "calendar") return renderCalendar();
    if (flow === "settings") return renderSettings();
    return renderPageDirectory();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" backgroundColor={palette.bg} />
      <View style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshAll}
              tintColor={palette.blue}
              colors={[palette.blue]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          {visibleError ? <Alert message={visibleError instanceof Error ? visibleError.message : "No pudimos continuar."} tone="critical" /> : null}
          {renderCurrent()}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

function CenteredScreen({ children }: { children: ReactNode }) {
  return <View style={styles.centeredScreen}>{children}</View>;
}

function TopBar({ busy, onRefresh }: { busy: boolean; onRefresh: () => void }) {
  return (
    <View style={styles.topBar}>
      <View style={styles.flex}>
        <Text style={styles.productKicker}>Maniaco</Text>
        <Text style={styles.productTitle}>App Perrona</Text>
      </View>
      <IconButton icon={busy ? "sync" : "refresh"} label="Actualizar" disabled={busy} onPress={onRefresh} />
    </View>
  );
}

function ActivePageBanner({
  page,
  stateText,
  loading,
  onChangePage
}: {
  page: MetaPage | null;
  stateText: string;
  loading: boolean;
  onChangePage: () => void;
}) {
  if (!page) {
    return (
      <View style={styles.statusCard}>
        {loading ? <ActivityIndicator color={palette.blue} /> : <Ionicons name="radio-button-on" size={18} color={palette.blue} />}
        <View style={styles.flex}>
          <Text style={styles.statusText}>{stateText}</Text>
          <Text style={styles.muted}>Lista para trabajar con tus paginas.</Text>
        </View>
      </View>
    );
  }

  const content = (
    <View style={styles.activePageOverlay}>
      <View style={styles.activePageRow}>
        {page.profilePhotoUrl ? (
          <Image source={{ uri: page.profilePhotoUrl }} style={asImageStyle(styles.activeAvatar)} />
        ) : (
          <View style={styles.activeAvatarFallback}>
            <Text style={styles.pageAvatarText}>{page.pageName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.activeKicker}>Pagina activa</Text>
          <Text style={styles.activePageName} numberOfLines={2}>{page.pageName}</Text>
          <Text style={styles.activeMeta} numberOfLines={1}>{page.category ?? "Facebook Page"}</Text>
        </View>
        <View style={styles.changePagePill}>
          <Text style={styles.changePageText}>Cambiar</Text>
          <Ionicons name="chevron-forward" size={14} color={palette.ink} />
        </View>
      </View>
    </View>
  );

  return (
    <Pressable style={styles.activePageBanner} onPress={onChangePage} android_ripple={{ color: "rgba(255,255,255,0.08)" }}>
      {page.coverPhotoUrl ? (
        <ImageBackground source={{ uri: page.coverPhotoUrl }} style={styles.activeCover} imageStyle={asImageStyle(styles.activeCoverImage)}>
          {content}
        </ImageBackground>
      ) : (
        <View style={[styles.activeCover, styles.activeCoverFallback]}>{content}</View>
      )}
    </Pressable>
  );
}

function PageHeader({ page }: { page: MetaPage }) {
  return (
    <View style={styles.pageIdentity}>
      <View style={styles.pageCoverFrame}>
        {page.coverPhotoUrl ? <Image source={{ uri: page.coverPhotoUrl }} style={asImageStyle(styles.pageCover)} /> : <View style={[styles.pageCover, styles.pageCoverPlaceholder]} />}
      </View>
      <View style={styles.pageCardBody}>
        {page.profilePhotoUrl ? (
          <Image source={{ uri: page.profilePhotoUrl }} style={asImageStyle(styles.pageAvatar)} />
        ) : (
          <View style={styles.pageAvatarPlaceholder}>
            <Text style={styles.pageAvatarText}>{page.pageName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.pageName} numberOfLines={2}>{page.pageName}</Text>
          <Text style={styles.pageMeta} numberOfLines={1}>{page.category ?? "Facebook Page"}</Text>
        </View>
      </View>
    </View>
  );
}

function PageActionRail({ actions }: { actions: PageAction[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pageActionRail}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityLabel={action.label}
          style={[
            styles.pageActionButton,
            action.tone === "primary" ? styles.pageActionButtonPrimary : null,
            action.tone === "danger" ? styles.pageActionButtonDanger : null,
            action.disabled ? styles.disabled : null
          ]}
          disabled={action.disabled}
          onPress={action.onPress}
          android_ripple={{ color: "rgba(255,255,255,0.08)" }}
        >
          <Ionicons name={action.icon} size={16} color={action.tone === "primary" ? palette.ink : action.tone === "danger" ? palette.danger : palette.text} />
          <Text
            style={[
              styles.pageActionText,
              action.tone === "primary" ? styles.pageActionTextPrimary : null,
              action.tone === "danger" ? styles.headerButtonDangerText : null
            ]}
            numberOfLines={1}
          >
            {action.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function BatchTop({
  batch,
  active,
  steps,
  deleting,
  onMinimize,
  onDelete
}: {
  batch: BatchSummary;
  active: FlowStep;
  steps: BatchProcessStep[];
  deleting: boolean;
  onMinimize: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.batchTop}>
      <View style={styles.batchTitleBlock}>
        <Text style={styles.batchTitle} numberOfLines={1}>Lote {formatDate(batch.createdAt)}</Text>
        <Text style={styles.batchMeta} numberOfLines={1}>{batch.photosCount} fotos - {batch.variantsCount} variantes - {batchStatusText(batch.status)}</Text>
      </View>
      <BatchProgressBar steps={steps} active={active} />
      <View style={styles.batchActionRow}>
        <MiniButton label="Salir del lote" icon="remove-outline" disabled={deleting} onPress={onMinimize} />
        <MiniButton label={deleting ? "Eliminando" : "Eliminar lote"} icon="trash-outline" tone="danger" disabled={deleting} onPress={onDelete} />
      </View>
    </View>
  );
}

function BatchProgressBar({ steps, active }: { steps: BatchProcessStep[]; active: FlowStep }) {
  return (
    <View style={styles.processRail}>
      {steps.map((step) => {
        const isActive = step.state === "active" || active === step.key;
        const isDone = step.state === "done";
        const isLocked = step.state === "locked";
        return (
          <View key={step.key} style={styles.processItem}>
            <View
              style={[
                styles.processDot,
                isDone ? styles.processDotDone : null,
                isActive ? styles.processDotActive : null,
                isLocked ? styles.processDotLocked : null
              ]}
            >
              <Ionicons
                name={isDone ? "checkmark" : step.icon}
                size={14}
                color={isDone || isActive ? palette.ink : isLocked ? "#66707c" : palette.muted}
              />
            </View>
            <Text
              style={[
                styles.processLabel,
                isDone ? styles.processLabelDone : null,
                isActive ? styles.processLabelActive : null,
                isLocked ? styles.processLabelLocked : null
              ]}
              numberOfLines={1}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Hero({ title, eyebrow, body }: { title: string; eyebrow: string; body: string }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroBody}>{body}</Text>
    </View>
  );
}

function Panel({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <View style={styles.panel}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
    </View>
  );
}

function IconButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean | undefined }) {
  return (
    <Pressable accessibilityLabel={label} style={[styles.iconButton, disabled ? styles.disabled : null]} disabled={disabled} onPress={onPress}>
      <Ionicons name={icon} size={21} color={palette.text} />
    </Pressable>
  );
}

function HeaderButton({
  label,
  onPress,
  disabled,
  tone
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  tone?: "danger";
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      style={[styles.headerButton, tone === "danger" ? styles.headerButtonDanger : null, disabled ? styles.disabled : null]}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: "rgba(255,255,255,0.08)" }}
    >
      <Text style={[styles.headerButtonText, tone === "danger" ? styles.headerButtonDangerText : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = "primary",
  icon
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  variant?: "primary" | "secondary" | "danger";
  icon?: IconName | undefined;
}) {
  return (
    <Pressable
      style={[
        styles.button,
        variant === "secondary" ? styles.secondaryButton : null,
        variant === "danger" ? styles.dangerButton : null,
        disabled ? styles.disabled : null
      ]}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: variant === "primary" ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.08)" }}
    >
      {icon ? <Ionicons name={icon} size={18} color={variant === "primary" ? palette.ink : variant === "danger" ? palette.danger : palette.text} /> : null}
      <Text style={[styles.buttonText, variant === "secondary" ? styles.secondaryButtonText : null, variant === "danger" ? styles.dangerButtonText : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionPair({
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDisabled,
  secondaryDisabled,
  primaryIcon,
  secondaryIcon
}: {
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryDisabled?: boolean | undefined;
  secondaryDisabled?: boolean | undefined;
  primaryIcon?: IconName | undefined;
  secondaryIcon?: IconName | undefined;
}) {
  return (
    <View style={styles.actionPair}>
      <View style={styles.flex}>
        <Button label={secondaryLabel} icon={secondaryIcon} variant="secondary" disabled={secondaryDisabled} onPress={onSecondary} />
      </View>
      <View style={styles.flex}>
        <Button label={primaryLabel} icon={primaryIcon} disabled={primaryDisabled} onPress={onPrimary} />
      </View>
    </View>
  );
}

function Alert({ message, tone }: { message: string; tone: "warning" | "critical" | "info" }) {
  return (
    <View style={[styles.alert, tone === "critical" ? styles.alertCritical : tone === "info" ? styles.alertInfo : styles.alertWarning]}>
      <Text style={[styles.alertText, tone === "critical" ? styles.alertCriticalText : tone === "info" ? styles.alertInfoText : styles.alertWarningText]}>
        {message}
      </Text>
    </View>
  );
}

function PageCard({
  page,
  onPress,
  disabled,
  selected
}: {
  page: MetaPage;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const isSelected = selected ?? page.isSelected;
  return (
    <Pressable
      style={[styles.pageCard, isSelected ? styles.pageCardSelected : null, !page.canPublish || disabled ? styles.disabled : null]}
      disabled={!page.canPublish || disabled}
      onPress={onPress}
    >
      <View style={styles.pageCoverFrame}>
        {page.coverPhotoUrl ? <Image source={{ uri: page.coverPhotoUrl }} style={asImageStyle(styles.pageCover)} /> : <View style={[styles.pageCover, styles.pageCoverPlaceholder]} />}
      </View>
      <View style={styles.pageCardBody}>
        {page.profilePhotoUrl ? (
          <Image source={{ uri: page.profilePhotoUrl }} style={asImageStyle(styles.pageAvatar)} />
        ) : (
          <View style={styles.pageAvatarPlaceholder}>
            <Text style={styles.pageAvatarText}>{page.pageName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.pageName} numberOfLines={2}>{page.pageName}</Text>
          <Text style={styles.pageMeta} numberOfLines={1}>{page.category ?? "Facebook Page"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function BatchControls({
  batch,
  deleting,
  onMinimize,
  onDelete
}: {
  batch: BatchSummary;
  deleting: boolean;
  onMinimize: () => void;
  onDelete: () => void;
}) {
  return (
    <Panel title="Lote actual" eyebrow={batch.status}>
      <View style={styles.batchControlRow}>
        <View style={styles.flex}>
          <Text style={styles.muted}>{batch.photosCount} fotos - {batch.variantsCount} variantes</Text>
        </View>
        <MiniButton label="Minimizar" icon="remove-circle-outline" onPress={onMinimize} disabled={deleting} />
        <MiniButton label={deleting ? "Eliminando" : "Eliminar"} icon="trash-outline" tone="danger" onPress={onDelete} disabled={deleting} />
      </View>
    </Panel>
  );
}

function BatchRow({
  batch,
  selected,
  deleting,
  onPress,
  onDelete
}: {
  batch: BatchSummary;
  selected: boolean;
  deleting: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={[styles.batchRow, selected ? styles.batchRowSelected : null]}>
      <Pressable style={styles.batchRowMain} onPress={onPress}>
        <View style={styles.batchIcon}>
          <Ionicons name="albums-outline" size={20} color={palette.blue} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.rowTitle}>{formatDate(batch.createdAt)}</Text>
          <Text style={styles.muted}>{batch.photosCount} fotos - {batch.variantsCount} variantes</Text>
        </View>
        <Pill label={batchStatusText(batch.status)} tone={batch.status === "completado" || batch.status === "completed" ? "good" : "neutral"} />
      </Pressable>
      <IconButton icon="trash-outline" label="Eliminar lote" disabled={deleting} onPress={onDelete} />
    </View>
  );
}

function PreviewImage({
  uri,
  style,
  resizeMode = "cover",
  label = "Vista previa"
}: {
  uri?: string | null | undefined;
  style: StyleProp<ViewStyle>;
  resizeMode?: "cover" | "contain";
  label?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [uri]);

  return (
    <View style={[style, styles.previewFrame]}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={asImageStyle(styles.previewImageFill)}
          resizeMode={resizeMode}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {!uri || failed || !loaded ? (
        <View style={styles.imageStateOverlay}>
          <Ionicons name={failed ? "warning-outline" : "image-outline"} size={22} color={failed ? palette.warning : palette.muted} />
          <Text style={styles.imageStateText}>{failed ? "No se pudo cargar" : label}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PendingPhotoTile({ preview, index }: { preview: LocalPhotoPreview; index: number }) {
  return (
    <View style={styles.photoTile}>
      <Image source={{ uri: preview.uri }} style={asImageStyle(styles.photoImage)} />
      <View style={styles.photoTileBody}>
        <Text style={styles.rowTitle}>F{index + 1}</Text>
        <Text style={styles.muted} numberOfLines={1}>{preview.name}</Text>
        <Pill label="subiendo" tone="neutral" />
      </View>
    </View>
  );
}

function PhotoTile({
  photo,
  index,
  styleName,
  onPress,
  onLongPress
}: {
  photo: Photo;
  index: number;
  styleName: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable style={styles.photoTile} onPress={onPress} onLongPress={onLongPress}>
      <PreviewImage uri={photo.thumbnailUrl ?? photo.mediaUrl} style={asViewStyle(styles.photoImage)} label="Procesando" />
      <View style={styles.photoTileBody}>
        <Text style={styles.rowTitle}>F{index + 1}</Text>
        <Text style={styles.muted} numberOfLines={2}>{styleName}</Text>
        <Pill label={photoStatusText(photo)} tone={isPhotoAnalyzed(photo) ? "good" : "neutral"} />
      </View>
    </Pressable>
  );
}

function StylePicker({
  photoId,
  preference,
  variantsPerPhoto,
  onChange,
  onClose
}: {
  photoId: string;
  preference: PhotoStylePreference;
  variantsPerPhoto: number;
  onChange: (next: PhotoStylePreference) => void;
  onClose: () => void;
}) {
  return (
    <Panel title="Menu de estilos" eyebrow="Toque largo">
      {styleCatalog.map((style) => (
        <Pressable
          key={style.id}
          style={[styles.styleRow, preference.styleId === style.id ? styles.styleRowActive : null]}
          onPress={() => onChange({ ...preference, styleId: style.id })}
        >
          <Ionicons name={style.icon} size={20} color={preference.styleId === style.id ? palette.blue : palette.muted} />
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{style.name}</Text>
            <Text style={styles.muted}>{style.detail}</Text>
          </View>
          {preference.styleId === style.id ? <Ionicons name="checkmark-circle" size={18} color={palette.green} /> : null}
        </Pressable>
      ))}
      <Text style={styles.rowTitle}>Intensidad: {preference.intensity}%</Text>
      <View style={styles.sliderRow}>
        {[30, 50, 70, 90].map((value) => (
          <Pressable key={value} style={[styles.sliderDot, preference.intensity === value ? styles.sliderDotActive : null]} onPress={() => onChange({ ...preference, intensity: value })}>
            <Text style={[styles.sliderText, preference.intensity === value ? styles.sliderTextActive : null]}>{value}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.promptBox}>{promptsForPhoto(photoId, { [photoId]: preference }, variantsPerPhoto, preference.intensity)}</Text>
      <Button label="Listo" icon="checkmark-outline" variant="secondary" onPress={onClose} />
    </Panel>
  );
}

function PhotoDetail({ photo, prompt, onClose }: { photo: Photo | null; prompt: string; onClose: () => void }) {
  if (!photo) return null;
  const labels = visionLabels(photo);
  return (
    <Panel title="Detalle de foto" eyebrow={photo.fileName ?? "Foto"}>
      <PreviewImage uri={photo.mediaUrl ?? photo.thumbnailUrl} style={asViewStyle(styles.detailImage)} resizeMode="contain" label="Foto" />
      <Text style={styles.rowTitle}>Analisis IA</Text>
      <View style={styles.tagWrap}>
        {labels.length === 0 ? <Pill label="pendiente" tone="neutral" /> : labels.map((label) => <Pill key={label} label={label} tone="neutral" />)}
      </View>
      <Text style={styles.rowTitle}>Prompt</Text>
      <Text style={styles.promptBox}>{prompt}</Text>
      <Button label="Cerrar" icon="close-outline" variant="secondary" onPress={onClose} />
    </Panel>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.stepper}>
      <IconButton icon="remove" label="Menos" disabled={value <= min} onPress={() => onChange(clamp(value - 1, min, max))} />
      <Text style={styles.stepperValue}>{value}</Text>
      <IconButton icon="add" label="Mas" disabled={value >= max} onPress={() => onChange(clamp(value + 1, min, max))} />
    </View>
  );
}

function SwipeReviewCard({
  variant,
  position,
  caption,
  onCaptionChange,
  onSave,
  onApprove,
  onReject,
  onUndo,
  busy
}: {
  variant: Variant;
  position: string;
  caption: string;
  onCaptionChange: (value: string) => void;
  onSave: () => void;
  onApprove: () => void;
  onReject: () => void;
  onUndo: () => void;
  busy: boolean;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const responder = useMemo(
    () =>
      PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 14,
      onPanResponderMove: (_event, gesture) => pan.setValue({ x: gesture.dx, y: 0 }),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > 90) onApprove();
        else if (gesture.dx < -90) onReject();
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
      }
      }),
    [onApprove, onReject, pan]
  );

  return (
    <View>
      <View style={styles.reviewTop}>
        <MiniButton label="Deshacer" icon="arrow-undo-outline" onPress={onUndo} />
        <Text style={styles.muted}>{position}</Text>
      </View>
      <Animated.View style={[styles.swipeCard, { transform: [{ translateX: pan.x }] }]} {...responder.panHandlers}>
        <PreviewImage uri={variant.imageUrl} style={asViewStyle(styles.swipeImage)} resizeMode="contain" label="Variante" />
        <TextInput multiline style={styles.captionInput} value={caption} onChangeText={onCaptionChange} />
        <ActionPair
          primaryLabel="Aceptar"
          primaryIcon="checkmark-circle-outline"
          primaryDisabled={busy}
          onPrimary={onApprove}
          secondaryLabel="Guardar caption"
          secondaryIcon="save-outline"
          secondaryDisabled={busy}
          onSecondary={onSave}
        />
        <Button label="Rechazar" icon="close-circle-outline" variant="danger" disabled={busy} onPress={onReject} />
      </Animated.View>
    </View>
  );
}

function SchedulePreview({ periodDays, acceptedCount }: { periodDays: PeriodDays; acceptedCount: number }) {
  const preview = Array.from({ length: Math.min(acceptedCount, 4) }, (_, index) => {
    const date = new Date();
    const spacing = periodDays === 7 ? 1 : periodDays === 14 ? 2 : 4;
    date.setDate(date.getDate() + index * spacing + 1);
    date.setHours(index % 2 === 0 ? 9 : 18, index % 2 === 0 ? 0 : 30, 0, 0);
    return date;
  });
  return (
    <View style={styles.previewBox}>
      <Text style={styles.rowTitle}>Smart Schedule</Text>
      {preview.map((date) => (
        <Text key={date.toISOString()} style={styles.muted}>{formatDate(date)} - {formatTime(date)}</Text>
      ))}
    </View>
  );
}

function MiniCalendar({ posts, onOpenCalendar }: { posts: ScheduledPost[]; onOpenCalendar: () => void }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    const key = dateKey(date);
    const dayPosts = posts.filter((post) => dateKey(post.scheduledFor) === key);
    return { date, posts: dayPosts };
  });
  return (
    <Pressable onPress={onOpenCalendar}>
      <View style={styles.miniCalendar}>
        {days.map((day) => (
          <View key={day.date.toISOString()} style={styles.miniDay}>
            <Text style={styles.miniDayName}>{day.date.toLocaleDateString("es-MX", { weekday: "short" }).slice(0, 2)}</Text>
            <Text style={styles.miniDayNumber}>{day.date.getDate()}</Text>
            <View style={[styles.dayDot, day.posts.some(isPostFailed) ? styles.dotBad : day.posts.length > 0 ? styles.dotGood : styles.dotEmpty]} />
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function CalendarGrid({ posts, selectedDay, onSelectDay }: { posts: ScheduledPost[]; selectedDay: string | null; onSelectDay: (day: string) => void }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(today.getFullYear(), today.getMonth(), index + 1))
  ];
  return (
    <Panel title={today.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}>
      <View style={styles.weekHeader}>
        {["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"].map((day) => <Text key={day} style={styles.weekText}>{day}</Text>)}
      </View>
      <View style={styles.calendarGrid}>
        {cells.map((date, index) => {
          if (!date) return <View key={`blank-${index}`} style={styles.calendarCell} />;
          const key = dateKey(date);
          const dayPosts = posts.filter((post) => dateKey(post.scheduledFor) === key);
          const selected = selectedDay === key;
          return (
            <Pressable key={key} style={[styles.calendarCell, selected ? styles.calendarCellSelected : null]} onPress={() => onSelectDay(key)}>
              <Text style={[styles.calendarNumber, selected ? styles.calendarNumberSelected : null]}>{date.getDate()}</Text>
              <View style={[styles.dayDot, dayPosts.some(isPostFailed) ? styles.dotBad : dayPosts.some(isPostGood) ? styles.dotGood : dayPosts.length > 0 ? styles.dotWarn : styles.dotEmpty]} />
            </Pressable>
          );
        })}
      </View>
    </Panel>
  );
}

function ScheduledPostRow({
  post,
  busy,
  onPublish,
  onRetry,
  onCancel,
  onShift
}: {
  post: ScheduledPost;
  busy: boolean;
  onPublish: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onShift: (days: number, hours: number) => void;
}) {
  return (
    <View style={styles.postRow}>
      <View style={[styles.timelineDot, isPostFailed(post) ? styles.timelineBad : isPostGood(post) ? styles.timelineGood : null]} />
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{formatDate(post.scheduledFor)} - {formatTime(post.scheduledFor)}</Text>
        <Pill label={postStatusLabel(post)} tone={postStatusTone(post)} />
        {post.remoteStatus === "confirmado_meta" && post.remotePostUrl ? (
          <Text style={styles.muted}>Confirmada por Meta.</Text>
        ) : post.remoteStatus === "incierto" ? (
          <Text style={styles.muted}>Meta no confirmo el resultado. Revisa o reintenta.</Text>
        ) : (
          <Text style={styles.muted}>Pendiente de envio.</Text>
        )}
        <Text style={styles.captionPreview} numberOfLines={3}>{post.caption ?? "Sin caption"}</Text>
        <View style={styles.compactActions}>
          <MiniButton label="+1h" onPress={() => onShift(0, 1)} disabled={busy} />
          <MiniButton label="+1d" onPress={() => onShift(1, 0)} disabled={busy} />
          {isPostFailed(post) ? <MiniButton label="Reintentar" icon="refresh-outline" onPress={onRetry} disabled={busy} /> : null}
          {["programada", "scheduled"].includes(post.status) ? (
            <MiniButton label="Publicar ahora" icon="send-outline" onPress={onPublish} disabled={busy} />
          ) : null}
          {post.status !== "cancelada" && post.status !== "publicada" ? <MiniButton label="Cancelar" tone="danger" onPress={onCancel} disabled={busy} /> : null}
        </View>
      </View>
    </View>
  );
}

function WorkBanner({
  uploadProgress,
  photos,
  variants,
  acceptedCount,
  onPress
}: {
  uploadProgress: { done: number; total: number } | null;
  photos: Photo[];
  variants: Variant[];
  acceptedCount: number;
  onPress: (flow: FlowStep) => void;
}) {
  let label = "";
  let progress = 0;
  let target: FlowStep = "home";

  if (uploadProgress) {
    label = `Subiendo ${uploadProgress.done} de ${uploadProgress.total}...`;
    progress = pct(uploadProgress.done, uploadProgress.total);
    target = "styles";
  } else if (photos.some(isPhotoBusy)) {
    const done = photos.filter(isPhotoAnalyzed).length;
    label = `Preparando ${done} de ${photos.length}...`;
    progress = pct(done, photos.length);
    target = "styles";
  } else if (photos.length > 0 && variants.length === 0) {
    label = "Lote listo - Ver fotos";
    progress = 100;
    target = "styles";
  } else if (variants.some(isVariantBusy)) {
    const done = variants.filter(isVariantDone).length;
    label = `Generando ${done} de ${variants.length}...`;
    progress = pct(done, variants.length);
    target = "generate";
  } else if (variants.some(isVariantReviewable)) {
    label = "Variantes listas - Swipe";
    progress = 100;
    target = "review";
  } else if (acceptedCount > 0) {
    label = `${acceptedCount} aceptadas - Programar`;
    progress = 100;
    target = "schedule";
  } else {
    return null;
  }

  return (
    <Pressable style={styles.workBanner} onPress={() => onPress(target)}>
      <View style={styles.workBannerHeader}>
        <Ionicons name="pulse-outline" size={18} color={palette.blue} />
        <Text style={styles.workBannerText}>{label}</Text>
      </View>
      <ProgressBar progress={progress} />
    </Pressable>
  );
}

function BottomTabs({ active, onChange, failedPosts }: { active: FlowStep; onChange: (flow: FlowStep) => void; failedPosts: number }) {
  const tabs: Array<{ key: FlowStep; label: string; icon: IconName; activeIcon: IconName }> = [
    { key: "home", label: "Inicio", icon: "home-outline", activeIcon: "home" },
    { key: "styles", label: "Fotos", icon: "images-outline", activeIcon: "images" },
    { key: "review", label: "Swipe", icon: "albums-outline", activeIcon: "albums" },
    { key: "calendar", label: "Agenda", icon: "calendar-outline", activeIcon: "calendar" },
    { key: "settings", label: "Ajustes", icon: "settings-outline", activeIcon: "settings" }
  ];
  return (
    <View style={styles.tabs}>
      {tabs.map(({ key, label, icon, activeIcon }) => (
        <Pressable key={key} style={[styles.tab, active === key ? styles.activeTab : null]} onPress={() => onChange(key)}>
          <Ionicons name={active === key ? activeIcon : icon} size={19} color={active === key ? palette.ink : palette.muted} />
          <Text style={[styles.tabText, active === key ? styles.activeTabText : null]}>{label}</Text>
          {key === "calendar" && failedPosts > 0 ? <View style={styles.badge} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${progress}%` }]} />
    </View>
  );
}

function Pill({ label, tone }: { label: string; tone: "good" | "warn" | "neutral" }) {
  return (
    <View style={[styles.pill, tone === "good" ? styles.pillGood : tone === "warn" ? styles.pillWarn : null]}>
      <Text style={[styles.pillText, tone === "good" ? styles.pillGoodText : tone === "warn" ? styles.pillWarnText : null]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function MiniButton({
  label,
  onPress,
  disabled,
  tone,
  icon
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  tone?: "danger";
  icon?: IconName | undefined;
}) {
  return (
    <Pressable style={[styles.miniButton, tone === "danger" ? styles.miniDanger : null, disabled ? styles.disabled : null]} disabled={disabled} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={14} color={tone === "danger" ? palette.danger : palette.text} /> : null}
      <Text style={[styles.miniText, tone === "danger" ? styles.miniDangerText : null]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BootScreen />
    </QueryClientProvider>
  );
}

const palette = {
  bg: "#0d0f12",
  surface: "#14181d",
  panel: "#181d23",
  panel2: "#20262e",
  border: "#2d343d",
  text: "#f8fafc",
  muted: "#aab4c0",
  mediaBg: "#eef4fb",
  mediaText: "#475569",
  blue: "#6aa7ff",
  green: "#48d597",
  amber: "#f6c35f",
  danger: "#ff8f8f",
  warning: "#ffd27a",
  white: "#f8fafc",
  ink: "#111827"
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  shell: { flex: 1 },
  container: {
    flexGrow: 1,
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "android" ? (NativeStatusBar.currentHeight ?? 0) + 12 : 12,
    paddingBottom: 28
  },
  screen: { gap: 10 },
  centeredScreen: { flex: 1, minHeight: 520, justifyContent: "center", gap: 12 },
  centeredBlock: { minHeight: 180, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  topBar: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
  productKicker: { color: palette.blue, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  productTitle: { color: palette.text, fontSize: 27, fontWeight: "900", letterSpacing: 0 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel
  },
  headerButton: {
    minWidth: 72,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    backgroundColor: palette.surface
  },
  headerButtonDanger: { borderColor: "rgba(255,143,143,0.34)", backgroundColor: "rgba(255,143,143,0.10)" },
  headerButtonText: { color: palette.text, fontSize: 12, fontWeight: "900" },
  headerButtonDangerText: { color: palette.danger },
  statusCard: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: palette.panel
  },
  statusText: { color: palette.text, fontSize: 15, fontWeight: "800" },
  activePageBanner: { minHeight: 152, overflow: "hidden", borderWidth: 1, borderColor: palette.border, borderRadius: 8, backgroundColor: palette.panel },
  activeCover: { minHeight: 152, justifyContent: "flex-end" },
  activeCoverImage: { opacity: 0.82 },
  activeCoverFallback: { backgroundColor: palette.panel2 },
  activePageOverlay: { padding: 12, backgroundColor: "rgba(13,15,18,0.76)" },
  activePageRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  activeAvatar: { width: 54, height: 54, borderRadius: 8, borderWidth: 2, borderColor: palette.white },
  activeAvatarFallback: { width: 54, height: 54, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: palette.blue },
  activeKicker: { color: palette.blue, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  activePageName: { color: palette.text, fontSize: 20, fontWeight: "900" },
  activeMeta: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  changePagePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.white, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  changePageText: { color: palette.ink, fontSize: 12, fontWeight: "900" },
  pageIdentity: { overflow: "hidden", borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel2 },
  pageActionRail: { gap: 8, paddingVertical: 2 },
  pageActionButton: {
    minWidth: 96,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    backgroundColor: palette.surface
  },
  pageActionButtonPrimary: { backgroundColor: palette.white, borderColor: palette.white },
  pageActionButtonDanger: { borderColor: "rgba(255,143,143,0.34)", backgroundColor: "rgba(255,143,143,0.10)" },
  pageActionText: { color: palette.text, fontSize: 12, fontWeight: "900" },
  pageActionTextPrimary: { color: palette.ink },
  batchList: { gap: 8 },
  batchTop: { gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: 8, padding: 10, backgroundColor: palette.panel },
  batchTitleBlock: { gap: 2 },
  batchTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  batchMeta: { color: palette.muted, fontSize: 12, fontWeight: "700" },
  batchActionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  processRail: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 4, paddingVertical: 2 },
  processItem: { flex: 1, alignItems: "center", gap: 4, minWidth: 0 },
  processDot: {
    width: 31,
    height: 31,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface
  },
  processDotDone: { backgroundColor: palette.green, borderColor: palette.green },
  processDotActive: { backgroundColor: palette.white, borderColor: palette.white },
  processDotLocked: { backgroundColor: "#101317", borderColor: "#252b33" },
  processLabel: { color: palette.muted, fontSize: 9, fontWeight: "900", textAlign: "center" },
  processLabelDone: { color: palette.green },
  processLabelActive: { color: palette.text },
  processLabelLocked: { color: "#66707c" },
  hero: { gap: 7, paddingVertical: 4 },
  eyebrow: { color: palette.blue, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  heroTitle: { color: palette.text, fontSize: 29, fontWeight: "900", letterSpacing: 0 },
  heroBody: { color: palette.muted, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  panel: { gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 8, padding: 12, backgroundColor: palette.panel },
  panelTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
  rowTitle: { color: palette.text, fontSize: 15, fontWeight: "800" },
  muted: { color: palette.muted, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  empty: { gap: 5, padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 8, backgroundColor: palette.surface },
  button: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: palette.white
  },
  secondaryButton: { backgroundColor: palette.panel2, borderWidth: 1, borderColor: palette.border },
  dangerButton: { backgroundColor: "rgba(255,143,143,0.12)", borderWidth: 1, borderColor: "rgba(255,143,143,0.35)" },
  buttonText: { color: palette.ink, fontSize: 15, fontWeight: "900" },
  secondaryButtonText: { color: palette.text },
  dangerButtonText: { color: palette.danger },
  actionPair: { flexDirection: "row", gap: 10 },
  disabled: { opacity: 0.52 },
  alert: { borderRadius: 8, padding: 12, borderWidth: 1 },
  alertInfo: { backgroundColor: "rgba(106,167,255,0.12)", borderColor: "rgba(106,167,255,0.36)" },
  alertWarning: { backgroundColor: "rgba(246,195,95,0.12)", borderColor: "rgba(246,195,95,0.36)" },
  alertCritical: { backgroundColor: "rgba(255,143,143,0.12)", borderColor: "rgba(255,143,143,0.36)" },
  alertText: { fontSize: 14, fontWeight: "800", lineHeight: 20 },
  alertInfoText: { color: "#cfe2ff" },
  alertWarningText: { color: palette.warning },
  alertCriticalText: { color: palette.danger },
  pageCard: { overflow: "hidden", borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel2 },
  pageCardSelected: { borderColor: palette.green },
  pageCoverFrame: { height: 112, backgroundColor: palette.surface },
  pageCover: { width: "100%", height: "100%" },
  pageCoverPlaceholder: { backgroundColor: palette.surface },
  pageCardBody: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  pageAvatar: { width: 48, height: 48, borderRadius: 8 },
  pageAvatarPlaceholder: { width: 48, height: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: palette.blue },
  pageAvatarText: { color: palette.ink, fontSize: 20, fontWeight: "900" },
  pageName: { color: palette.text, fontSize: 18, fontWeight: "900" },
  pageMeta: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  batchRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, backgroundColor: palette.surface },
  batchRowMain: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
  batchRowSelected: { borderWidth: 1, borderColor: palette.blue },
  batchControlRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  batchIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: palette.panel2 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoTile: { width: "48.5%", overflow: "hidden", borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel },
  photoImage: { width: "100%", aspectRatio: 1, backgroundColor: palette.mediaBg },
  previewFrame: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  previewImageFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%" },
  imageStateOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: palette.mediaBg },
  imageStateText: { color: palette.mediaText, fontSize: 11, fontWeight: "900", textAlign: "center" },
  photoPlaceholder: { alignItems: "center", justifyContent: "center" },
  photoTileBody: { gap: 5, padding: 10 },
  styleRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 58, padding: 10, borderRadius: 8, backgroundColor: palette.surface },
  styleRowActive: { borderWidth: 1, borderColor: palette.blue },
  intensityBox: { gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  sliderRow: { flexDirection: "row", gap: 8 },
  sliderDot: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 8, backgroundColor: palette.surface },
  sliderDotActive: { backgroundColor: palette.white },
  sliderText: { color: palette.muted, fontWeight: "900" },
  sliderTextActive: { color: palette.ink },
  promptBox: { color: palette.text, fontSize: 13, lineHeight: 19, fontWeight: "700", padding: 10, borderRadius: 8, backgroundColor: palette.surface },
  detailImage: { width: "100%", height: 320, borderRadius: 8, backgroundColor: palette.mediaBg },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, minHeight: 84 },
  stepperValue: { color: palette.text, fontSize: 42, fontWeight: "900", minWidth: 82, textAlign: "center" },
  modePill: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, backgroundColor: "rgba(246,195,95,0.12)" },
  modeText: { color: palette.warning, fontSize: 13, fontWeight: "800" },
  spinnerMark: { alignItems: "center", gap: 10, paddingVertical: 10 },
  reviewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  swipeCard: { gap: 12, borderRadius: 8, borderWidth: 1, borderColor: palette.border, padding: 12, backgroundColor: palette.panel },
  swipeImage: { width: "100%", height: 430, borderRadius: 8, backgroundColor: palette.mediaBg },
  captionInput: {
    minHeight: 112,
    color: palette.text,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    textAlignVertical: "top",
    backgroundColor: palette.surface,
    fontSize: 15,
    lineHeight: 21
  },
  bigNumber: { color: palette.green, fontSize: 56, fontWeight: "900" },
  periodGrid: { flexDirection: "row", gap: 8 },
  periodCard: { flex: 1, alignItems: "center", gap: 3, padding: 12, borderRadius: 8, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  periodCardActive: { backgroundColor: palette.white, borderColor: palette.white },
  periodNumber: { color: palette.text, fontSize: 24, fontWeight: "900" },
  periodNumberActive: { color: palette.ink },
  previewBox: { gap: 5, padding: 12, borderRadius: 8, backgroundColor: palette.surface },
  miniCalendar: { flexDirection: "row", gap: 6 },
  miniDay: { flex: 1, alignItems: "center", gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: palette.surface },
  miniDayName: { color: palette.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  miniDayNumber: { color: palette.text, fontSize: 17, fontWeight: "900" },
  weekHeader: { flexDirection: "row", marginBottom: 6 },
  weekText: { flex: 1, color: palette.muted, textAlign: "center", fontSize: 12, fontWeight: "900" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarCell: { width: "14.285%", aspectRatio: 1, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 8 },
  calendarCellSelected: { backgroundColor: palette.white },
  calendarNumber: { color: palette.text, fontSize: 14, fontWeight: "900" },
  calendarNumberSelected: { color: palette.ink },
  dayDot: { width: 8, height: 8, borderRadius: 4 },
  dotGood: { backgroundColor: palette.green },
  dotWarn: { backgroundColor: palette.amber },
  dotBad: { backgroundColor: palette.danger },
  dotEmpty: { backgroundColor: palette.border },
  postRow: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 8, backgroundColor: palette.surface },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4, backgroundColor: palette.amber },
  timelineGood: { backgroundColor: palette.green },
  timelineBad: { backgroundColor: palette.danger },
  captionPreview: { color: palette.text, fontSize: 13, lineHeight: 18 },
  compactActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  miniButton: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: palette.panel2 },
  miniDanger: { backgroundColor: "rgba(255,143,143,0.12)" },
  miniText: { color: palette.text, fontSize: 12, fontWeight: "900" },
  miniDangerText: { color: palette.danger },
  workBanner: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: Platform.OS === "android" ? 92 : 86,
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel
  },
  workBannerHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  workBannerText: { color: palette.text, fontSize: 14, fontWeight: "900" },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: 8, backgroundColor: palette.surface },
  progressFill: { height: "100%", borderRadius: 8, backgroundColor: palette.blue },
  tabs: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: Platform.OS === "android" ? 18 : 14,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel
  },
  tab: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 8 },
  activeTab: { backgroundColor: palette.white },
  tabText: { color: palette.muted, fontSize: 10, fontWeight: "900" },
  activeTabText: { color: palette.ink },
  badge: { position: "absolute", top: 7, right: 15, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger },
  pill: { maxWidth: 160, alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: palette.panel2 },
  pillGood: { backgroundColor: "rgba(72,213,151,0.14)" },
  pillWarn: { backgroundColor: "rgba(246,195,95,0.14)" },
  pillText: { color: palette.muted, fontSize: 11, fontWeight: "900" },
  pillGoodText: { color: palette.green },
  pillWarnText: { color: palette.warning }
});

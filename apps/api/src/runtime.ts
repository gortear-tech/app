import type {
  ActionType,
  AssignedStyle,
  AuthSession,
  BatchStatus,
  BusinessAlert,
  BusinessDashboard,
  BusinessDetail,
  BusinessSummary,
  BusinessLearningEventType,
  FacebookPageConnection,
  FacebookTokenStatus,
  GeneratedVariant,
  GeneratedVariantSummary,
  PhotoStatus,
  PublishPostData,
  ScheduledPostStatus,
  ScheduledPostSummary,
  VisualStyle,
  VisionAnalysisResult,
} from "@fbmaniaco/shared";
import {
  AppError,
  INITIAL_VISUAL_STYLES,
  type BatchDetail,
  type BatchSummary,
  type ConfirmCalendarResponse,
  type CreateBusinessRequest,
  type CompletePhotoUploadRequest,
  type GetBatchResponse,
  type PreparePhotoUploadRequest,
  type UpdateBusinessRequest,
  type UpdateScheduledPostRequest,
  type UpdateVariantCaptionRequest,
  type BootstrapStatusResponse,
  type MetaAutoConnectResponse,
  type MetaDeviceLoginResponse,
  type MetaTokenConnectionResponse,
  type MetaTokenPayload,
  type CreateVisualStyleRequest,
  type UpdateVisualStyleRequest,
} from "@fbmaniaco/shared";
import {
  MockMediaStorage,
  MockPushNotificationProvider,
  OpenAICaptionGenerationProvider,
  MetaGraphAuthProvider,
  MetaGraphPublishingProvider,
  OpenAIImageGenerationProvider,
  OpenAIVisionAnalysisProvider,
  SupabasePlannerMirror,
  type CaptionGenerationProvider,
  type FacebookPublishingProvider,
  type ImageGenerationProvider,
  type MediaStorage,
  type MetaAuthProvider,
  type PushNotificationProvider,
  type SupabasePlannerState,
  type VisionAnalysisProvider,
} from "@fbmaniaco/providers";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
  import {
    assignStyle,
    buildDeepMemory,
    buildGenerationPlan,
    compareAgainstPeers,
    createDefaultAutonomyState,
    decide,
    emptyDeepMemory,
    generateWeeklyReport,
    predictPerformance,
    recordApproval,
  recordRejection,
  resumeAction,
  resetAction,
  type AutonomyState,
  type BenchmarkInput,
  type BusinessContext,
  type DeepMemorySnapshot,
  type DecisionContext,
  type LearningEvent,
} from "@fbmaniaco/motor-perron";
import { config } from "./config";
import { randomUUID } from "node:crypto";

const normalizeImageUrl = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname.endsWith(".local")
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;

const CALENDAR_TIME_SLOTS = [
  { hour: 9, minute: 15 },
  { hour: 12, minute: 30 },
  { hour: 16, minute: 45 },
  { hour: 20, minute: 0 },
] as const;

const toLocalDayAnchor = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const diffInLocalDays = (from: Date, to: Date): number => {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((toUtc - fromUtc) / CALENDAR_DAY_MS);
};

const buildPreferredDayOffsets = (count: number, periodDays: number): number[] => {
  if (count <= 1) {
    return [1];
  }

  const maxOffset = Math.max(1, periodDays);
  return Array.from({ length: count }, (_, index) => {
    const preferred = Math.round((index * (maxOffset - 1)) / Math.max(1, count - 1)) + 1;
    return Math.max(1, Math.min(maxOffset, preferred));
  });
};

const buildScheduledDateForOffset = (anchor: Date, dayOffset: number, slotIndex: number): Date => {
  const slot = CALENDAR_TIME_SLOTS[slotIndex % CALENDAR_TIME_SLOTS.length];
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset, slot.hour, slot.minute, 0, 0);
};

const cloneVisualStyle = (style: VisualStyle): VisualStyle => ({
  ...style,
  recommendedIndustries: [...style.recommendedIndustries],
  recommendedPhotoTypes: [...style.recommendedPhotoTypes],
  restrictions: [...style.restrictions],
});

const normalizeStyleText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const normalizeStyleList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const VALID_VISUAL_STYLE_INTENSITIES = new Set<VisualStyle["intensity"]>(["ligera", "media", "fuerte"]);

const sanitizeVisualStyle = (value: unknown): VisualStyle | null => {
  if (!value || typeof value !== "object") return null;
  const style = value as Partial<VisualStyle>;
  if (
    typeof style.id !== "string" ||
    typeof style.name !== "string" ||
    typeof style.description !== "string" ||
    typeof style.promptTemplate !== "string" ||
    typeof style.intensity !== "string" ||
    typeof style.aiDisclosureRequired !== "boolean"
  ) {
    return null;
  }
  if (!VALID_VISUAL_STYLE_INTENSITIES.has(style.intensity as VisualStyle["intensity"])) {
    return null;
  }
  return {
    id: style.id,
    name: style.name,
    description: style.description,
    promptTemplate: style.promptTemplate,
    recommendedIndustries: normalizeStyleList(style.recommendedIndustries),
    recommendedPhotoTypes: normalizeStyleList(style.recommendedPhotoTypes),
    intensity: style.intensity as VisualStyle["intensity"],
    aiDisclosureRequired: style.aiDisclosureRequired,
    restrictions: normalizeStyleList(style.restrictions),
    isCustom: style.isCustom ?? false,
    createdAt: typeof style.createdAt === "string" ? style.createdAt : undefined,
    updatedAt: typeof style.updatedAt === "string" ? style.updatedAt : undefined,
  };
};

const serializeVisualStyle = (style: VisualStyle): VisualStyle => cloneVisualStyle(style);

const createStyleId = (name: string): string => {
  const slug = normalizeStyleText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const base = slug.length ? slug : "custom-style";
  return `${base}-${randomUUID().slice(0, 8)}`;
};

const describeGenerationError = (error: unknown): string => {
  if (error instanceof AppError) {
    return error.userMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "No se pudo generar esta variante.";
};

const buildFacebookSquareImagePrompt = (prompt: string, outputCount: number): string =>
  [
    prompt,
    "",
    "Formato obligatorio para Facebook feed:",
    "- Salida cuadrada 1:1, ideal para post de Facebook.",
    "- Mantener el producto o comida completo y visible; no recortar platos, empaques, texto importante ni bordes utiles.",
    "- Centrar el sujeto con margen respirable y composicion lista para verse completa en una tarjeta cuadrada.",
    "- No agregar texto nuevo, logos nuevos, marcas de agua ni marcos decorativos.",
    outputCount > 1 ? `- Crear ${outputCount} variantes distintas pero coherentes entre si.` : "- Crear una variante pulida y lista para publicar.",
  ].join("\n");

const CLOSED_BATCH_STATUSES = new Set<BatchStatus>(["completado", "cancelado", "fallido", "abandonado"]);
const DISABLED_BATCH_STATUSES = new Set<BatchStatus>(["cancelado", "fallido", "abandonado"]);

const VARIANT_CREATIVE_DIRECTIONS = [
  {
    visual: "Hero shot premium: producto centrado, fondo limpio aspiracional, luz cuidada y margen amplio.",
    copy: "Beneficio directo y apetitoso, con cierre de accion simple.",
  },
  {
    visual: "Close-up de antojo: resaltar textura, frescura, brillo natural y detalles del platillo.",
    copy: "Lenguaje sensorial centrado en sabor, textura y frescura.",
  },
  {
    visual: "Ocasion social: composicion pensada para compartir, combo visible y ambiente cercano.",
    copy: "Enfoque en momento de consumo: comida para compartir, pedir hoy o resolver el antojo.",
  },
  {
    visual: "Descubrimiento local: imagen clara de menu/feed, producto completo y lectura rapida en Facebook.",
    copy: "SEO local natural, nombrando producto y zona si encaja sin sonar forzado.",
  },
  {
    visual: "Contraste editorial: fondo mas dramatico, sujeto limpio, colores con presencia y look publicitario.",
    copy: "Gancho breve de curiosidad o novedad, sin prometer descuentos inexistentes.",
  },
  {
    visual: "Estilo cotidiano premium: mantener realismo, mejorar orden, luz y apetito sin exagerar.",
    copy: "Texto cercano y confiable, como recomendacion rapida de negocio local.",
  },
] as const;

const includesNormalizedText = (items: readonly string[], haystack: string): boolean => {
  const normalizedHaystack = normalizeStyleText(haystack);
  return items.some((item) => {
    const normalizedItem = normalizeStyleText(item);
    return normalizedItem.length > 0 && (normalizedHaystack.includes(normalizedItem) || normalizedItem.includes(normalizedHaystack));
  });
};

const variantCreativeDirectionFor = (photoIndex: number, variantIndex: number): (typeof VARIANT_CREATIVE_DIRECTIONS)[number] =>
  VARIANT_CREATIVE_DIRECTIONS[(photoIndex + variantIndex) % VARIANT_CREATIVE_DIRECTIONS.length]!;

const getMetaPublishError = (error: unknown): { code?: number; error_subcode?: number; message?: string } | null => {
  if (!(error instanceof AppError)) {
    return null;
  }
  const details = error.details as { error?: { code?: number; error_subcode?: number; message?: string } } | null | undefined;
  return details?.error ?? null;
};

const isMetaTokenExpiredError = (error: unknown): boolean => {
  const metaError = getMetaPublishError(error);
  const message = (metaError?.message ?? (error instanceof Error ? error.message : "")).toLowerCase();
  return metaError?.code === 190 || metaError?.error_subcode === 463 || message.includes("access token") && message.includes("expired");
};

const normalizeMetadataStringList = (value: unknown): string[] => {
  const items =
    typeof value === "string"
      ? value.split(/[\n,;]/)
      : Array.isArray(value)
        ? value
        : [];

  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  );
};

const getBusinessFacebookSeoKeywords = (business: BusinessRecord): string[] =>
  normalizeMetadataStringList(business.metadata.facebookSeoKeywords);

const getBusinessFacebookSeoContext = (business: BusinessRecord): string | null => {
  const value = business.metadata.facebookSeoContext ?? business.metadata.facebookSeoInstructions;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

type MetaTokenRecord = {
  token: string;
  source: "auto" | "manual" | "refresh";
  status: FacebookTokenStatus;
  lastValidatedAt: string | null;
};

type MetaPageRecord = FacebookPageConnection & {
  pageAccessToken: string | null;
};

type PendingDeviceLoginRecord = MetaDeviceLoginResponse & {
  startedAt: string;
};

type BusinessRecord = BusinessDetail & {
  id: string;
  name: string;
  industry: string;
  facebookPageId: string;
  timezone: string;
  metadata: Record<string, unknown>;
  autonomySettings: Record<ActionType, number>;
  createdAt: string;
  updatedAt: string;
};

type BatchRecord = {
  id: string;
  businessId: string;
  status: BatchStatus;
  photosCount: number;
  variantsCount: number;
  estimatedCostUsd: number | null;
  confirmedCostUsd: number | null;
  lastActivityAt: string;
  variantsPerPhoto: number;
  photoIds: string[];
  variantIds: string[];
  scheduledPostIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

type PhotoRecord = {
  id: string;
  batchId: string;
  fileName: string;
  storageKey: string;
  uploadUrl: string;
  status: PhotoStatus;
  visionAnalysis: VisionAnalysisResult | null;
  assignedStyle: AssignedStyle | null;
  editingPrompt: string | null;
  createdAt: string;
  updatedAt: string;
};

type VariantRecord = {
  id: string;
  batchId: string;
  photoId: string;
  styleId: string;
  generationPlan: ReturnType<typeof buildGenerationPlan>;
  promptUsed: string;
  imageUrl: string | null;
  caption: string | null;
  status: "pendiente" | "generando" | "generada" | "fallida" | "aprobada" | "rechazada" | "programada" | "publicada" | "eliminada";
  createdAt: string;
  updatedAt: string;
};

type ScheduledPostRecord = {
  id: string;
  variantId: string;
  businessId: string;
  batchId: string;
  scheduledFor: string;
  facebookPostId: string | null;
  status: ScheduledPostStatus;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

type PersistedRuntimeState = {
  metaToken: MetaTokenRecord | null;
  pendingDeviceLogin: PendingDeviceLoginRecord | null;
  selectedPageId: string | null;
  selectedBusinessId: string | null;
  pages: MetaPageRecord[];
  businesses: BusinessRecord[];
  visualStyles: VisualStyle[];
  batches: BatchRecord[];
  photos: PhotoRecord[];
  variants: VariantRecord[];
  scheduledPosts: ScheduledPostRecord[];
  events: LearningEvent[];
  autonomyByBusiness: Array<[string, AutonomyState]>;
};

const stripInlineImage = (value: string): string => (value.startsWith("data:image/") ? "" : value);
const trimCloudString = (value: string): string => (value.length > 12000 ? value.slice(0, 12000) : value);

const trimCloudSnapshot = (value: unknown): unknown => {
  if (typeof value === "string") {
    return trimCloudString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => trimCloudSnapshot(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimCloudSnapshot(item)]));
  }
  return value;
};

const buildCloudRuntimeSnapshot = (snapshot: PersistedRuntimeState): PersistedRuntimeState => ({
  ...(trimCloudSnapshot(snapshot) as PersistedRuntimeState),
  photos: snapshot.photos.map((photo) => ({
    ...(trimCloudSnapshot(photo) as PhotoRecord),
    uploadUrl: stripInlineImage(photo.uploadUrl),
  })),
  variants: snapshot.variants.map((variant) => ({
    ...(trimCloudSnapshot(variant) as VariantRecord),
    imageUrl: variant.imageUrl?.startsWith("data:image/") ? null : variant.imageUrl,
  })),
});

const parseDataUrl = (value: string): { bytes: Buffer; mimeType: string; extension: string } | null => {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1]!.trim().toLowerCase();
  const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : mimeType.includes("png") ? "png" : "bin";
  return {
    bytes: Buffer.from(match[2]!, "base64"),
    mimeType,
    extension,
  };
};

const encodeStoragePath = (objectKey: string): string =>
  objectKey
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

class SupabaseRuntimeSnapshotStore {
  private bucketReady = false;

  constructor(
    private readonly options: {
      supabaseUrl?: string;
      serviceRole?: string;
      bucket: string;
      objectKey: string;
    },
  ) {}

  private get enabled(): boolean {
    return Boolean(this.options.supabaseUrl?.trim() && this.options.serviceRole?.trim());
  }

  private get baseUrl(): string {
    return this.options.supabaseUrl?.trim().replace(/\/$/, "") ?? "";
  }

  private get headers(): Record<string, string> {
    const serviceRole = this.options.serviceRole?.trim() ?? "";
    return {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
    };
  }

  private encodedObjectPath(): string {
    return encodeStoragePath(this.options.objectKey);
  }

  private async ensureBucket(): Promise<void> {
    if (!this.enabled || this.bucketReady) {
      return;
    }

    const response = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        id: this.options.bucket,
        name: this.options.bucket,
        public: false,
      }),
    });

    if (!response.ok && response.status !== 409) {
      const text = await response.text().catch(() => "");
      if (response.status !== 400 || !text.toLowerCase().includes("already")) {
        throw new Error(`Supabase state bucket creation failed (${response.status}): ${text || response.statusText}`);
      }
    }

    this.bucketReady = true;
  }

  async downloadSnapshot(): Promise<Partial<PersistedRuntimeState> | null> {
    if (!this.enabled) {
      return null;
    }

    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.options.bucket)}/${this.encodedObjectPath()}`,
      { headers: this.headers },
    );

    if (response.status === 404) {
      await this.ensureBucket();
      return null;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase state restore failed (${response.status}): ${text || response.statusText}`);
    }

    const raw = await response.text();
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as Partial<PersistedRuntimeState>;
  }

  async uploadSnapshot(snapshot: PersistedRuntimeState): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.ensureBucket();
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.options.bucket)}/${this.encodedObjectPath()}`,
      {
        method: "PUT",
        headers: {
          ...this.headers,
          "x-upsert": "true",
        },
        body: JSON.stringify(snapshot),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase state backup failed (${response.status}): ${text || response.statusText}`);
    }
  }
}

class SupabaseMediaStore {
  private bucketReady = false;

  constructor(
    private readonly options: {
      supabaseUrl?: string;
      serviceRole?: string;
      bucket: string;
    },
  ) {}

  private get enabled(): boolean {
    return Boolean(this.options.supabaseUrl?.trim() && this.options.serviceRole?.trim());
  }

  private get baseUrl(): string {
    return this.options.supabaseUrl?.trim().replace(/\/$/, "") ?? "";
  }

  private get headers(): Record<string, string> {
    const serviceRole = this.options.serviceRole?.trim() ?? "";
    return {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    };
  }

  private async ensureBucket(): Promise<void> {
    if (!this.enabled || this.bucketReady) {
      return;
    }

    const response = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: this.options.bucket,
        name: this.options.bucket,
        public: true,
      }),
    });

    if (!response.ok && response.status !== 409) {
      const text = await response.text().catch(() => "");
      if (response.status !== 400 || !text.toLowerCase().includes("already")) {
        throw new Error(`Supabase media bucket creation failed (${response.status}): ${text || response.statusText}`);
      }
    }

    this.bucketReady = true;
  }

  async uploadDataUrl(objectKey: string, dataUrl?: string | null): Promise<string | null> {
    if (!this.enabled || !dataUrl?.startsWith("data:image/")) {
      return null;
    }

    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return null;
    }

    await this.ensureBucket();
    const keyWithExtension = /\.[a-z0-9]{2,5}$/i.test(objectKey) ? objectKey : `${objectKey}.${parsed.extension}`;
    const safeKey = keyWithExtension.replace(/\\/g, "/").replace(/^\/+/, "");
    const body = parsed.bytes.buffer.slice(
      parsed.bytes.byteOffset,
      parsed.bytes.byteOffset + parsed.bytes.byteLength,
    ) as ArrayBuffer;
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.options.bucket)}/${encodeStoragePath(safeKey)}`, {
      method: "PUT",
      headers: {
        ...this.headers,
        "Content-Type": parsed.mimeType,
        "x-upsert": "true",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase media upload failed (${response.status}): ${text || response.statusText}`);
    }

    return `${this.baseUrl}/storage/v1/object/public/${encodeURIComponent(this.options.bucket)}/${encodeStoragePath(safeKey)}`;
  }
}

export class FbmaniacoRuntime {
  private metaToken: MetaTokenRecord | null = null;
  private pages: MetaPageRecord[] = [];
  private pendingDeviceLogin: PendingDeviceLoginRecord | null = null;
  private selectedPageId: string | null = null;
  private selectedBusinessId: string | null = null;
  private visualStyles: VisualStyle[] = INITIAL_VISUAL_STYLES.map((style) => cloneVisualStyle(style));
  private businesses = new Map<string, BusinessRecord>();
  private batches = new Map<string, BatchRecord>();
  private photos = new Map<string, PhotoRecord>();
  private variants = new Map<string, VariantRecord>();
  private scheduledPosts = new Map<string, ScheduledPostRecord>();
  private events: LearningEvent[] = [];
  private autonomyByBusiness = new Map<string, AutonomyState>();
  private readonly supabaseMirror = new SupabasePlannerMirror({
    supabaseUrl: config.supabaseUrl,
    serviceRole: config.supabaseServiceRole,
  });
  private readonly snapshotStore = new SupabaseRuntimeSnapshotStore({
    supabaseUrl: config.supabaseUrl,
    serviceRole: config.supabaseServiceRole,
    bucket: config.supabaseStateBucket,
    objectKey: config.supabaseStateObject,
  });
  private readonly cloudMediaStore = new SupabaseMediaStore({
    supabaseUrl: config.supabaseUrl,
    serviceRole: config.supabaseServiceRole,
    bucket: config.supabaseMediaBucket,
  });
  public readonly ready: Promise<void>;

  constructor(
    private readonly visionProvider: VisionAnalysisProvider,
    private readonly imageGenerationProvider: ImageGenerationProvider,
    private readonly captionGenerationProvider: CaptionGenerationProvider,
    private readonly mediaStorage: MediaStorage,
    private readonly metaAuthProvider: MetaAuthProvider,
    private readonly facebookPublishingProvider: FacebookPublishingProvider,
    private readonly pushNotificationProvider: PushNotificationProvider,
  ) {
    const restoredFromDisk = this.restoreStateFromDisk();
    this.ready = this.initializeState(restoredFromDisk);
  }

  bootstrapStatus(): BootstrapStatusResponse {
    const hasToken = Boolean(this.metaToken?.token);
    const hasPages = this.pages.length > 0;
    const hasSelectedBusiness = this.getSelectedBusiness() !== null;
    const facebookTokenStatus = this.metaToken?.status ?? null;

    if (!hasToken) {
      return {
        hasUsers: false,
        hasActiveSession: false,
        hasSelectedBusiness,
        facebookTokenStatus,
        canAutoConnectMeta: true,
        requiresManualToken: true,
        nextStep: "connect_meta",
      };
    }

    if (!hasPages || !hasSelectedBusiness) {
      return {
        hasUsers: true,
        hasActiveSession: facebookTokenStatus === "valido",
        hasSelectedBusiness,
        facebookTokenStatus,
        canAutoConnectMeta: facebookTokenStatus === "valido" || facebookTokenStatus === "por_vencer",
        requiresManualToken: false,
        nextStep: "select_page",
      };
    }

    return {
      hasUsers: true,
      hasActiveSession: facebookTokenStatus === "valido",
      hasSelectedBusiness: true,
      facebookTokenStatus,
      canAutoConnectMeta: facebookTokenStatus === "valido" || facebookTokenStatus === "por_vencer",
      requiresManualToken: false,
      nextStep: "home",
    };
  }

  async connectMetaToken(payload: MetaTokenPayload): Promise<MetaTokenConnectionResponse> {
    const valid = await this.metaAuthProvider.isTokenValid(payload.token);
    if (!valid) {
      this.metaToken = {
        token: payload.token,
        source: payload.source,
        status: "expirado",
        lastValidatedAt: new Date().toISOString(),
      };
      throw new AppError({
        code: "meta_token_invalid",
        statusCode: 400,
        message: "Meta token invalid",
        userMessage: "El token de Meta no es valido.",
      });
    }

    let resolvedToken = payload.token;
    if (payload.source !== "refresh") {
      try {
        resolvedToken = await this.metaAuthProvider.refreshLongLivedToken(payload.token);
      } catch {
        resolvedToken = payload.token;
      }
    }

    const pages = await this.metaAuthProvider.listPages(resolvedToken);
    const previousSelectedPageId = this.selectedPageId ?? this.pages.find((page) => page.isSelected)?.pageId ?? null;
    const previousSelectedBusinessId = this.selectedBusinessId ?? null;
    this.metaToken = {
      token: resolvedToken,
      source: payload.source,
      status: "valido",
      lastValidatedAt: new Date().toISOString(),
    };
    this.pendingDeviceLogin = null;
    this.pages = [];
    this.selectedPageId = null;
    this.selectedBusinessId = null;

    for (const page of pages) {
      const pageToken = await this.facebookPublishingProvider.getPageAccessToken(page.pageId);
      this.pages.push({
        pageId: page.pageId,
        pageName: page.pageName,
        coverPhotoUrl: page.coverPhotoUrl ?? null,
        pageAccessTokenStatus: page.pageAccessTokenStatus ?? this.metaToken.status,
        isSelected: false,
        pageAccessToken: pageToken || null,
        category: page.category ?? null,
        categoryList: page.categoryList ?? null,
        tasks: page.tasks ?? null,
      });
    }

    const previouslySelectedPage = previousSelectedPageId
      ? this.pages.find((page) => page.pageId === previousSelectedPageId) ?? null
      : null;
    if (previouslySelectedPage) {
      this.selectedPageId = previouslySelectedPage.pageId;
      this.selectedBusinessId =
        [...this.businesses.values()].find((business) => business.facebookPageId === previouslySelectedPage.pageId)?.id ??
        previousSelectedBusinessId ??
        null;
    }

    if (this.pages.length === 1) {
      await this.selectPage(this.pages[0]!.pageId);
    }

    this.syncBusinessTokenStatusesFromMeta();
    this.persistState();
    return { token: resolvedToken, status: this.bootstrapStatus(), pages: this.listPages() };
  }

  async autoConnectMeta(): Promise<MetaAutoConnectResponse> {
    if (this.metaToken?.token) {
      try {
        const refreshed = await this.metaAuthProvider.refreshLongLivedToken(this.metaToken.token);
        return await this.connectMetaToken({ token: refreshed, source: "refresh" });
      } catch (error) {
        this.metaToken = null;
        if (!(error instanceof AppError)) {
          throw error;
        }
      }
    }

    const bootstrapToken = config.metaBootstrapToken.trim();
    if (bootstrapToken) {
      try {
        return await this.connectMetaToken({ token: bootstrapToken, source: "auto" });
      } catch (error) {
        this.metaToken = null;
        if (!(error instanceof AppError)) {
          throw error;
        }
      }
    }

    if (this.pendingDeviceLogin) {
      try {
        const token = await this.metaAuthProvider.exchangeDeviceCode(this.pendingDeviceLogin.deviceCode);
        return this.connectMetaToken({ token, source: "auto" });
      } catch (error) {
        if (error instanceof AppError && error.code === "device_login_pending") {
          return {
            token: "",
            status: this.bootstrapStatus(),
            pages: this.listPages(),
            pendingDeviceLogin: {
              deviceCode: this.pendingDeviceLogin.deviceCode,
              userCode: this.pendingDeviceLogin.userCode,
              verificationUri: this.pendingDeviceLogin.verificationUri,
              expiresAt: this.pendingDeviceLogin.expiresAt,
              intervalSeconds: this.pendingDeviceLogin.intervalSeconds,
            },
            message: "Esperando aprobacion de Meta",
          };
        }
        this.pendingDeviceLogin = null;
        throw error;
      }
    }

    try {
      const deviceLogin = await this.metaAuthProvider.startDeviceLogin(config.metaDeviceLoginScopes);
      this.pendingDeviceLogin = {
        ...deviceLogin,
        startedAt: new Date().toISOString(),
      };

      return {
        token: "",
        status: this.bootstrapStatus(),
        pages: this.listPages(),
        pendingDeviceLogin: deviceLogin,
        message: "Activa el codigo en Facebook para conectar la pagina.",
      };
    } catch (error) {
      this.pendingDeviceLogin = null;
      return {
        token: "",
        status: this.bootstrapStatus(),
        pages: this.listPages(),
        message: error instanceof AppError ? error.userMessage : "Pega un token valido de Meta para continuar.",
      };
    }
  }

  listPages(): FacebookPageConnection[] {
    return this.pages.map(({ pageAccessToken: _pageAccessToken, ...page }) => ({
      ...page,
      isSelected: page.pageId === this.selectedPageId,
    }));
  }

  listStyles(): VisualStyle[] {
    return this.visualStyles.map((style) => cloneVisualStyle(style));
  }

  createStyle(input: CreateVisualStyleRequest): VisualStyle {
    const now = new Date().toISOString();
    const name = input.name.trim();
    const description = input.description.trim();
    const promptTemplate = input.promptTemplate.trim();
    if (!name || !description || !promptTemplate) {
      throw new AppError({
        code: "style_invalid",
        statusCode: 400,
        message: "Style fields are required",
        userMessage: "Completa nombre, descripcion e instruccion antes de guardar el estilo.",
      });
    }
    const style: VisualStyle = {
      id: createStyleId(name),
      name,
      description,
      promptTemplate,
      recommendedIndustries: normalizeStyleList(input.recommendedIndustries),
      recommendedPhotoTypes: normalizeStyleList(input.recommendedPhotoTypes),
      intensity: input.intensity,
      aiDisclosureRequired: input.aiDisclosureRequired,
      restrictions: normalizeStyleList(input.restrictions),
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    };
    this.visualStyles = [...this.visualStyles, style];
    this.persistState();
    return cloneVisualStyle(style);
  }

  updateStyle(styleId: string, input: UpdateVisualStyleRequest): VisualStyle {
    const index = this.visualStyles.findIndex((style) => style.id === styleId);
    if (index < 0) {
      throw new AppError({
        code: "style_not_found",
        statusCode: 404,
        message: "Style not found",
        userMessage: "El estilo no existe.",
      });
    }

    const current = this.visualStyles[index]!;
    const nextName = typeof input.name === "string" ? input.name.trim() : current.name;
    const nextDescription = typeof input.description === "string" ? input.description.trim() : current.description;
    const nextPromptTemplate = typeof input.promptTemplate === "string" ? input.promptTemplate.trim() : current.promptTemplate;
    if (!nextName || !nextDescription || !nextPromptTemplate) {
      throw new AppError({
        code: "style_invalid",
        statusCode: 400,
        message: "Style fields are required",
        userMessage: "Completa nombre, descripcion e instruccion antes de guardar el estilo.",
      });
    }
    const updated: VisualStyle = {
      ...current,
      name: nextName,
      description: nextDescription,
      promptTemplate: nextPromptTemplate,
      recommendedIndustries: input.recommendedIndustries ? normalizeStyleList(input.recommendedIndustries) : current.recommendedIndustries,
      recommendedPhotoTypes: input.recommendedPhotoTypes ? normalizeStyleList(input.recommendedPhotoTypes) : current.recommendedPhotoTypes,
      intensity: input.intensity ?? current.intensity,
      aiDisclosureRequired: typeof input.aiDisclosureRequired === "boolean" ? input.aiDisclosureRequired : current.aiDisclosureRequired,
      restrictions: input.restrictions ? normalizeStyleList(input.restrictions) : current.restrictions,
      isCustom: current.isCustom ?? false,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.visualStyles = this.visualStyles.map((style, styleIndex) => (styleIndex === index ? updated : style));
    this.persistState();
    return cloneVisualStyle(updated);
  }

  deleteStyle(styleId: string): { deleted: boolean } {
    const next = this.visualStyles.filter((style) => style.id !== styleId);
    if (next.length === this.visualStyles.length) {
      throw new AppError({
        code: "style_not_found",
        statusCode: 404,
        message: "Style not found",
        userMessage: "El estilo no existe.",
      });
    }

    this.visualStyles = next;
    this.persistState();
    return { deleted: true };
  }

  async selectPage(pageId: string): Promise<BusinessRecord> {
    const page = this.pages.find((item) => item.pageId === pageId);
    if (!page) {
      throw new AppError({
        code: "page_not_found",
        statusCode: 404,
        message: "Page not found",
        userMessage: "La pagina no existe.",
      });
    }

    this.pages = this.pages.map((item) => ({ ...item, isSelected: item.pageId === pageId }));
    this.selectedPageId = pageId;

    const existingBusiness = [...this.businesses.values()].find((business) => business.facebookPageId === pageId);
    if (existingBusiness) {
      this.selectedBusinessId = existingBusiness.id;
      this.syncBusinessTokenStatusesFromMeta();
      this.persistState();
      return this.businesses.get(existingBusiness.id) ?? existingBusiness;
    }

    const business: BusinessRecord = {
      id: randomUUID(),
      name: page.pageName,
      industry: "general",
      facebookPageId: pageId,
      timezone: "UTC",
      metadata: {
        pageName: page.pageName,
        contentTypes: [],
        facebookSeoKeywords: [],
      },
      autonomySettings: {
        STYLE_ASSIGNMENT: 60,
        VARIANT_COUNT: 65,
        SCHEDULING: 70,
        CAPTION_GENERATION: 75,
        FACEBOOK_PUBLISH: 85,
      },
      tokenStatus: this.metaToken?.status ?? "expirado",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.businesses.set(business.id, business);
    this.autonomyByBusiness.set(business.id, createDefaultAutonomyState(business.autonomySettings));
    this.selectedBusinessId = business.id;
    this.persistState();
    return business;
  }

  listBusinesses(): BusinessSummary[] {
    this.restoreStateFromDisk();
    if (this.syncBusinessTokenStatusesFromMeta()) {
      this.persistState();
    }
    return [...this.businesses.values()].map((business) => ({
      id: business.id,
      name: business.name,
      industry: business.industry,
      facebookPageId: business.facebookPageId,
      timezone: business.timezone,
      tokenStatus: business.tokenStatus,
    }));
  }

  getBusiness(businessId: string): BusinessRecord {
    const business = this.businesses.get(businessId);
    if (!business) {
      throw new AppError({
        code: "business_not_found",
        statusCode: 404,
        message: "Business not found",
        userMessage: "El negocio no existe.",
      });
    }
    return business;
  }

  updateBusiness(businessId: string, input: UpdateBusinessRequest): BusinessRecord {
    const business = this.getBusiness(businessId);
    const metadata = input.metadata
      ? {
          ...business.metadata,
          ...input.metadata,
        }
      : business.metadata;
    const updated: BusinessRecord = {
      ...business,
      name: input.name ?? business.name,
      industry: input.industry ?? business.industry,
      timezone: input.timezone ?? business.timezone,
      metadata,
      autonomySettings: {
        ...business.autonomySettings,
        ...(input.autonomySettings ?? {}),
      },
      updatedAt: new Date().toISOString(),
    };
    this.businesses.set(businessId, updated);

    if (input.autonomySettings) {
      this.autonomyByBusiness.set(businessId, createDefaultAutonomyState(updated.autonomySettings));
    }
    this.persistState();
    return updated;
  }

  getSelectedBusiness(): BusinessRecord | null {
    if (this.selectedBusinessId) {
      const selectedBusiness = this.businesses.get(this.selectedBusinessId);
      if (selectedBusiness) {
        return selectedBusiness;
      }
    }

    if (this.selectedPageId) {
      return [...this.businesses.values()].find((business) => business.facebookPageId === this.selectedPageId) ?? null;
    }

    const selectedPages = this.pages.filter((page) => page.isSelected);
    if (selectedPages.length === 1) {
      const selectedPageId = selectedPages[0]!.pageId;
      return [...this.businesses.values()].find((business) => business.facebookPageId === selectedPageId) ?? null;
    }

    return null;
  }

  private autonomyStateForBusiness(businessId: string): AutonomyState {
    const existing = this.autonomyByBusiness.get(businessId);
    if (existing) return existing;
    const business = this.getBusiness(businessId);
    const created = createDefaultAutonomyState(business.autonomySettings);
    this.autonomyByBusiness.set(businessId, created);
    return created;
  }

  private syncBusinessTokenStatusesFromMeta(): boolean {
    const facebookTokenStatus = this.metaToken?.status ?? null;
    if (facebookTokenStatus !== "valido" && facebookTokenStatus !== "por_vencer") {
      return false;
    }

    const now = new Date().toISOString();
    const connectedPageIds = new Set(this.pages.map((page) => page.pageId));
    let changed = false;

    for (const business of this.businesses.values()) {
      if (!connectedPageIds.has(business.facebookPageId) || business.tokenStatus === facebookTokenStatus) {
        continue;
      }

      this.businesses.set(business.id, {
        ...business,
        tokenStatus: facebookTokenStatus,
        updatedAt: now,
      });
      changed = true;
    }

    this.pages = this.pages.map((page) => {
      if (page.pageAccessTokenStatus === facebookTokenStatus) {
        return page;
      }

      changed = true;
      return { ...page, pageAccessTokenStatus: facebookTokenStatus };
    });

    return changed;
  }

  private setAutonomyState(businessId: string, state: AutonomyState): void {
    this.autonomyByBusiness.set(businessId, state);
  }

  private businessContextFor(business: BusinessRecord): BusinessContext {
    return {
      businessId: business.id,
      name: business.name,
      industry: business.industry,
      tone: String(business.metadata.tone ?? "profesional"),
      timezone: business.timezone,
      facebookPageId: business.facebookPageId,
      autonomySettings: business.autonomySettings,
    };
  }

  private buildSupabaseMirrorState(): SupabasePlannerState {
    return {
      pages: this.pages.map((page) => ({
        pageId: page.pageId,
        pageName: page.pageName,
        pageAccessToken: page.pageAccessToken,
        category: page.category ?? null,
        categoryList: page.categoryList ?? null,
        tasks: page.tasks ?? null,
      })),
      businesses: [...this.businesses.values()].map((business) => ({
        id: business.id,
        facebookPageId: business.facebookPageId,
        name: business.name,
        industry: business.industry,
        timezone: business.timezone,
        tokenStatus: business.tokenStatus,
        metadata: business.metadata,
        autonomySettings: business.autonomySettings,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      })),
      batches: [...this.batches.values()].map((batch) => ({
        id: batch.id,
        businessId: batch.businessId,
        status: batch.status,
        photosCount: batch.photosCount,
        variantsCount: batch.variantsCount,
        estimatedCostUsd: batch.estimatedCostUsd,
        confirmedCostUsd: batch.confirmedCostUsd,
        lastActivityAt: batch.lastActivityAt,
        variantsPerPhoto: batch.variantsPerPhoto,
        photoIds: batch.photoIds,
        variantIds: batch.variantIds,
        scheduledPostIds: batch.scheduledPostIds,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      })),
      photos: [...this.photos.values()].map((photo) => ({
        id: photo.id,
        batchId: photo.batchId,
        fileName: photo.fileName,
        storageKey: photo.storageKey,
        uploadUrl: photo.uploadUrl,
        status: photo.status,
        visionAnalysis: photo.visionAnalysis,
        assignedStyle: photo.assignedStyle,
        editingPrompt: photo.editingPrompt,
        createdAt: photo.createdAt,
        updatedAt: photo.updatedAt,
      })),
      variants: [...this.variants.values()].map((variant) => ({
        id: variant.id,
        batchId: variant.batchId,
        photoId: variant.photoId,
        styleId: variant.styleId,
        generationPlan: variant.generationPlan,
        promptUsed: variant.promptUsed,
        imageUrl: variant.imageUrl,
        caption: variant.caption,
        status: variant.status,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      })),
      scheduledPosts: [...this.scheduledPosts.values()].map((post) => ({
        id: post.id,
        variantId: post.variantId,
        businessId: post.businessId,
        batchId: post.batchId,
        scheduledFor: post.scheduledFor,
        facebookPostId: post.facebookPostId,
        status: post.status,
        createdAt: post.createdAt,
      })),
    };
  }

  getDashboard(businessId: string): BusinessDashboard {
    this.restoreStateFromDisk();
    if (this.syncBusinessTokenStatusesFromMeta()) {
      this.persistState();
    }
    const business = this.getBusiness(businessId);
    const memory = buildDeepMemory(this.events.filter((event) => event.negocioId === businessId));
    const report = generateWeeklyReport({
      business: this.businessContextFor(business),
      memory,
      benchmarks: null,
      events: this.events.filter((event) => event.negocioId === businessId),
    });

    const alerts: BusinessAlert[] = [];
    if (business.tokenStatus === "expirado" || business.tokenStatus === "requiere_reconexion") {
      alerts.push({
        id: "facebook-token",
        type: "facebook_token",
        message: "Facebook desconectado",
        level: "critical",
        createdAt: new Date().toISOString(),
        actionable: true,
        actionLabel: "Reconectar",
      });
    }

    const activeBatch = [...this.batches.values()].find((batch) => batch.businessId === businessId && !["completado", "cancelado", "fallido", "abandonado"].includes(batch.status));
    const batches = this.listBatches(businessId).sort(
      (left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime(),
    );
    const recentPosts = [...this.scheduledPosts.values()]
      .filter((post) => post.businessId === businessId && (post.status === "publicada" || post.status === "fallida"))
      .map((post) => this.toScheduledPostSummary(post))
      .slice(-10);

    const reach = this.events
      .filter((event) => event.negocioId === businessId && event.type === "metricas_recolectadas")
      .reduce((sum, event) => sum + (event.score ?? 0), 0);
    const engagement = this.events
      .filter((event) => event.negocioId === businessId && event.type === "metricas_recolectadas")
      .reduce((sum, event) => sum + (event.costUsd ?? 0), 0);

    return {
      business: {
        id: business.id,
        name: business.name,
        industry: business.industry,
        facebookPageId: business.facebookPageId,
        timezone: business.timezone,
        tokenStatus: business.tokenStatus,
      },
      alerts,
      activeBatch: activeBatch ? this.toBatchSummary(activeBatch) : null,
      batches,
      performance: {
        reach: Number(reach.toFixed(2)),
        engagement: Number(engagement.toFixed(2)),
        postsPublished: recentPosts.length,
        score: recentPosts.length > 0 ? Number((reach / Math.max(1, recentPosts.length)).toFixed(2)) : 0,
      },
      weeklyReport: report,
    };
  }

  createBatch(businessId: string): BatchRecord {
    this.restoreStateFromDisk();
    const business = this.getBusiness(businessId);
    const activeBatch = [...this.batches.values()].find((batch) => batch.businessId === businessId && !["completado", "cancelado", "fallido", "abandonado"].includes(batch.status));
    if (activeBatch) {
      throw new AppError({
        code: "active_batch_exists",
        statusCode: 409,
        message: "Business already has an active batch",
        userMessage: "Ya existe un lote activo para este negocio.",
      });
    }

    const batch: BatchRecord = {
      id: randomUUID(),
      businessId: business.id,
      status: "pending_upload",
      photosCount: 0,
      variantsCount: 0,
      estimatedCostUsd: null,
      confirmedCostUsd: null,
      lastActivityAt: new Date().toISOString(),
      variantsPerPhoto: 1,
      photoIds: [],
      variantIds: [],
      scheduledPostIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.batches.set(batch.id, batch);
    this.persistState();
    return batch;
  }

  cancelBatch(batchId: string): BatchSummary {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    if (batch.status === "cancelado") {
      return this.toBatchSummary(batch);
    }

    const timestamp = new Date().toISOString();
    batch.status = "cancelado";
    batch.lastActivityAt = timestamp;

    for (const photoId of batch.photoIds) {
      const photo = this.photos.get(photoId);
      if (!photo) continue;
      photo.status = "eliminada";
      photo.updatedAt = timestamp;
      this.photos.set(photo.id, photo);
    }

    for (const variantId of batch.variantIds) {
      const variant = this.variants.get(variantId);
      if (!variant) continue;
      if (variant.status !== "publicada") {
        variant.status = "eliminada";
      }
      variant.updatedAt = timestamp;
      this.variants.set(variant.id, variant);
    }

    for (const scheduledPostId of batch.scheduledPostIds) {
      const scheduledPost = this.scheduledPosts.get(scheduledPostId);
      if (!scheduledPost) continue;
      if (scheduledPost.status !== "publicada") {
        scheduledPost.status = "cancelada";
      }
      scheduledPost.updatedAt = timestamp;
      this.scheduledPosts.set(scheduledPost.id, scheduledPost);
    }

    this.recordEvent({
      negocioId: batch.businessId,
      type: "batch_abandoned",
      occurredAt: timestamp,
      score: 0,
    });
    this.batches.set(batch.id, batch);
    this.persistState();
    return this.toBatchSummary(batch);
  }

  listBatches(businessId: string): BatchSummary[] {
    return [...this.batches.values()]
      .filter((batch) => batch.businessId === businessId && batch.status !== "cancelado" && batch.status !== "abandonado")
      .map((batch) => this.toBatchSummary(batch));
  }

  getBatch(batchId: string): BatchRecord {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new AppError({
        code: "batch_not_found",
        statusCode: 404,
        message: "Batch not found",
        userMessage: "El lote no existe.",
      });
    }
    return batch;
  }

  private assertBatchCanBeWorked(batch: BatchRecord): void {
    if (!CLOSED_BATCH_STATUSES.has(batch.status)) {
      return;
    }

    throw new AppError({
      code: "batch_closed",
      statusCode: 409,
      message: `Batch is closed with status ${batch.status}`,
      userMessage: "Este lote ya esta cerrado. Crea un lote nuevo para seguir trabajando.",
    });
  }

  private assertBatchIsNotDisabled(batch: BatchRecord): void {
    if (!DISABLED_BATCH_STATUSES.has(batch.status)) {
      return;
    }

    throw new AppError({
      code: "batch_closed",
      statusCode: 409,
      message: `Batch is disabled with status ${batch.status}`,
      userMessage: "Este lote ya esta cerrado. Crea un lote nuevo para seguir trabajando.",
    });
  }

  private selectDiverseVariantStyle(input: {
    business: BusinessRecord;
    photo: PhotoRecord;
    batch: BatchRecord;
    memory: DeepMemorySnapshot;
    variantIndex: number;
    photoIndex: number;
  }): AssignedStyle {
    if (!input.photo.assignedStyle || !input.photo.visionAnalysis) {
      throw new AppError({
        code: "photo_not_ready_for_style",
        statusCode: 409,
        message: "Photo is missing assigned style or analysis",
        userMessage: "La foto aun no esta lista para generar variantes.",
      });
    }

    if (input.photo.assignedStyle.manualOverride || this.visualStyles.length === 0) {
      return input.photo.assignedStyle;
    }

    const usageByStyle = new Map<string, number>();
    for (const variantId of input.batch.variantIds) {
      const variant = this.variants.get(variantId);
      if (!variant || variant.status === "fallida" || variant.status === "eliminada") continue;
      usageByStyle.set(variant.styleId, (usageByStyle.get(variant.styleId) ?? 0) + 1);
    }

    const analysis = input.photo.visionAnalysis;
    const businessText = [
      input.business.name,
      input.business.industry,
      typeof input.business.metadata.pageName === "string" ? input.business.metadata.pageName : "",
      Array.isArray(input.business.metadata.facebookSeoKeywords) ? input.business.metadata.facebookSeoKeywords.join(" ") : "",
    ].join(" ");
    const photoText = `${analysis.subject.type} ${analysis.subject.description} ${analysis.mood.description}`;
    const hasSensitiveVisuals =
      analysis.sensitiveElements.logoVisible ||
      analysis.sensitiveElements.personVisible ||
      analysis.sensitiveElements.priceVisible ||
      analysis.sensitiveElements.textVisible;

    const rankedStyles = this.visualStyles
      .map((style, styleIndex) => {
        let score = 0;
        if (style.id === input.photo.assignedStyle?.styleId) score += input.variantIndex === 0 ? 28 : 4;
        if (includesNormalizedText(style.recommendedIndustries, businessText)) score += 38;
        if (includesNormalizedText(style.recommendedPhotoTypes, photoText)) score += 34;
        if (style.intensity === "ligera" && hasSensitiveVisuals) score += 10;
        if (style.intensity === "fuerte" && hasSensitiveVisuals) score -= 18;
        score -= (usageByStyle.get(style.id) ?? 0) * 26;
        score += ((input.photoIndex + input.variantIndex + styleIndex) % 11) / 100;
        return { style, score };
      })
      .sort((left, right) => right.score - left.score);

    const selected = rankedStyles[0]?.style ?? this.visualStyles[0]!;
    return assignStyle({
      business: this.businessContextFor(input.business),
      analysis,
      styles: [selected],
      memory: input.memory,
    });
  }

  getBatchDetail(batchId: string): BatchDetail {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    const photos = batch.photoIds.map((photoId) => this.photos.get(photoId)).filter(Boolean) as PhotoRecord[];
    const variants = batch.variantIds.map((variantId) => this.variants.get(variantId)).filter(Boolean) as VariantRecord[];
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    return {
      ...this.toBatchSummary(batch),
      photos: photos.map((photo) => ({
        id: photo.id,
        status: photo.status,
        imageUrl: normalizeImageUrl(photo.uploadUrl),
        assignedStyle: photo.assignedStyle,
        visionAnalysis: photo.visionAnalysis,
        editingPrompt: photo.editingPrompt,
      })),
      variants: variants.map((variant) => ({
        id: variant.id,
        photoId: variant.photoId,
        styleId: variant.styleId,
        status: variant.status,
        caption: variant.caption,
        imageUrl: normalizeImageUrl(variant.imageUrl) ?? normalizeImageUrl(photosById.get(variant.photoId)?.uploadUrl),
        generationPlan: variant.generationPlan,
      })),
    };
  }

  reopenVariantApproval(batchId: string): BatchSummary {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const scheduledPosts = batch.scheduledPostIds
      .map((scheduledPostId) => this.scheduledPosts.get(scheduledPostId))
      .filter((post): post is ScheduledPostRecord => Boolean(post));
    const reachedMeta = scheduledPosts.some((post) => post.status === "publicada" || Boolean(post.facebookPostId));

    if (reachedMeta) {
      throw new AppError({
        code: "batch_already_reached_meta",
        statusCode: 409,
        message: "Batch has scheduled or published posts in Meta",
        userMessage: "Este lote ya llego a Facebook. Para evitar duplicados, no se puede regresar a aprobacion desde aqui.",
      });
    }

    const now = new Date().toISOString();
    for (const scheduledPost of scheduledPosts) {
      this.scheduledPosts.delete(scheduledPost.id);
    }

    let reopenedVariants = 0;
    for (const variantId of batch.variantIds) {
      const variant = this.variants.get(variantId);
      if (!variant || variant.status === "publicada" || variant.status === "eliminada" || !variant.imageUrl) {
        continue;
      }
      variant.status = "generada";
      variant.updatedAt = now;
      this.variants.set(variant.id, variant);
      reopenedVariants += 1;
    }

    if (reopenedVariants === 0) {
      throw new AppError({
        code: "batch_without_reopenable_variants",
        statusCode: 409,
        message: "Batch has no generated variants to reopen",
        userMessage: "No encontre variantes generadas para regresar a aprobacion.",
      });
    }

    batch.status = "generado_parcial";
    batch.scheduledPostIds = [];
    batch.lastActivityAt = now;
    this.batches.set(batch.id, batch);
    this.persistState();
    return this.toBatchSummary(batch);
  }

  getActiveBatch(businessId: string): BatchSummary | null {
    const batch = [...this.batches.values()].find((entry) => entry.businessId === businessId && !["completado", "cancelado", "fallido", "abandonado"].includes(entry.status));
    return batch ? this.toBatchSummary(batch) : null;
  }

  async createUploadIntent(batchId: string, body: PreparePhotoUploadRequest): Promise<{ uploadUrl: string; storageKey: string }> {
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const storageKey = `batches/${batchId}/${randomUUID()}-${body.fileName}`;
    const intent = await this.mediaStorage.generateSignedUploadUrl(storageKey);
    return {
      uploadUrl: intent.url,
      storageKey: intent.key,
    };
  }

  async completeUpload(batchId: string, body: CompletePhotoUploadRequest): Promise<PhotoRecord> {
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    let cloudUploadUrl: string | null = null;
    try {
      cloudUploadUrl = await this.cloudMediaStore.uploadDataUrl(`photos/${body.uploadKey}`, body.imageDataUrl);
    } catch (error) {
      console.warn("[fbmaniaco] failed to upload original photo to Supabase", error);
    }
    const uploadUrl =
      normalizeImageUrl(cloudUploadUrl) ??
      normalizeImageUrl(body.imageDataUrl) ??
      normalizeImageUrl(await this.mediaStorage.getPresignedDownloadUrl(body.uploadKey));
    if (!uploadUrl) {
      throw new AppError({
        code: "photo_upload_invalid",
        statusCode: 400,
        message: "Photo upload did not produce a renderable image",
        userMessage: "La imagen no quedó lista para revisarse. Intenta subirla otra vez.",
      });
    }
    const photo: PhotoRecord = {
      id: randomUUID(),
      batchId,
      fileName: body.originalFileName,
      storageKey: body.uploadKey,
      uploadUrl,
      status: "analizando",
      visionAnalysis: null,
      assignedStyle: null,
      editingPrompt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.photos.set(photo.id, photo);
    batch.photoIds.push(photo.id);
    batch.photosCount = batch.photoIds.length;
    batch.lastActivityAt = new Date().toISOString();

    try {
      const analysis = await this.visionProvider.analyze(uploadUrl);
      const business = this.getBusiness(batch.businessId);
      const memory = buildDeepMemory(this.events.filter((event) => event.negocioId === batch.businessId));
      const styleCatalog = this.visualStyles;
      if (styleCatalog.length === 0) {
        throw new AppError({
          code: "style_catalog_empty",
          statusCode: 409,
          message: "No visual styles are configured",
          userMessage: "Primero agrega al menos un estilo visual para poder analizar fotos.",
        });
      }
      const assignedStyle = assignStyle({
        business: this.businessContextFor(business),
        analysis,
        styles: styleCatalog,
        memory,
      });
      const prompt = buildGenerationPlan({
        business: this.businessContextFor(business),
        analysis,
        style: assignedStyle,
        memory,
      });

      photo.visionAnalysis = analysis;
      photo.assignedStyle = assignedStyle;
      photo.editingPrompt = prompt.promptFinal;
      photo.status = "validada";
      photo.updatedAt = new Date().toISOString();
      batch.status = "pendiente_confirmacion";
      batch.lastActivityAt = new Date().toISOString();
      this.photos.set(photo.id, photo);
      this.batches.set(batch.id, batch);
      this.persistState();
      return photo;
    } catch (error) {
      this.photos.delete(photo.id);
      batch.photoIds = batch.photoIds.filter((id) => id !== photo.id);
      batch.photosCount = batch.photoIds.length;
      this.persistState();
      throw error;
    }
  }

  changePhotoStyle(batchId: string, photoId: string, styleId: string): PhotoRecord {
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const photo = this.photos.get(photoId);
    if (!photo || photo.batchId !== batch.id) {
      throw new AppError({
        code: "photo_not_found",
        statusCode: 404,
        message: "Photo not found",
        userMessage: "La foto no existe.",
      });
    }
    if (!photo.visionAnalysis) {
      throw new AppError({
        code: "photo_not_analyzed",
        statusCode: 409,
        message: "Photo is not analyzed yet",
        userMessage: "La foto aun no termino de analizarse.",
      });
    }
    const styleCatalog = this.visualStyles;
    const style = styleCatalog.find((item) => item.id === styleId);
    if (!style) {
      throw new AppError({
        code: "style_not_found",
        statusCode: 404,
        message: "Style not found",
        userMessage: "El estilo no existe.",
      });
    }

    const business = this.getBusiness(batch.businessId);
    const memory = buildDeepMemory(this.events.filter((event) => event.negocioId === batch.businessId));
    const assignedStyle = assignStyle({
      business: this.businessContextFor(business),
      analysis: photo.visionAnalysis,
      styles: [style],
      memory,
    });
    const prompt = buildGenerationPlan({
      business: this.businessContextFor(business),
      analysis: photo.visionAnalysis,
      style: assignedStyle,
      memory,
    });
    photo.assignedStyle = { ...assignedStyle, manualOverride: true };
    photo.editingPrompt = prompt.promptFinal;
    photo.updatedAt = new Date().toISOString();
    this.photos.set(photo.id, photo);

    this.recordEvent({
      negocioId: batch.businessId,
      type: "estilo_cambiado_por_usuario",
      occurredAt: new Date().toISOString(),
      styleId: style.id,
      styleName: style.name,
      photoType: photo.visionAnalysis.subject.type,
      score: 0,
    });
    this.persistState();
    return photo;
  }

  estimateCost(batchId: string, variantsPerPhoto: number): { estimatedCostUsd: number } {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const cost = Number((batch.photoIds.length * variantsPerPhoto * 0.35).toFixed(2));
    batch.estimatedCostUsd = cost;
    batch.variantsPerPhoto = variantsPerPhoto;
    batch.lastActivityAt = new Date().toISOString();
    this.batches.set(batch.id, batch);
    this.persistState();
    return { estimatedCostUsd: cost };
  }

  confirmCost(batchId: string): BatchSummary {
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    batch.confirmedCostUsd = batch.estimatedCostUsd ?? batch.confirmedCostUsd ?? 0;
    batch.status = "confirmado";
    batch.lastActivityAt = new Date().toISOString();
    this.batches.set(batch.id, batch);
    this.persistState();
    return this.toBatchSummary(batch);
  }

  async generateVariants(batchId: string, variantsPerPhoto: number): Promise<{ created: number; available: number; blockedReason?: string | null }> {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const business = this.getBusiness(batch.businessId);
    const memory = buildDeepMemory(this.events.filter((event) => event.negocioId === batch.businessId));
    const autonomyState = this.autonomyStateForBusiness(batch.businessId);
    const sensitive = batch.photoIds
      .map((photoId) => this.photos.get(photoId))
      .filter((photo): photo is PhotoRecord => Boolean(photo?.visionAnalysis))
      .some((photo) => {
        const sensitiveElements = photo.visionAnalysis!.sensitiveElements;
        return (
          sensitiveElements.priceVisible ||
          sensitiveElements.logoVisible ||
          sensitiveElements.personVisible ||
          sensitiveElements.promotionVisible
        );
      });

    const decision = decide({
      business: this.businessContextFor(business),
      taskType: "batch_generation",
      actionType: "VARIANT_COUNT",
      batchStatus: batch.status,
      costConfirmed: batch.status === "confirmado" || batch.confirmedCostUsd !== null,
      estimatedCostUsd: batch.estimatedCostUsd ?? 0,
      budgetUsd: batch.confirmedCostUsd ?? batch.estimatedCostUsd ?? 0,
      providerSupportsTask: true,
      sensitiveElements: {
        priceVisible: sensitive,
        logoVisible: sensitive,
        personVisible: sensitive,
        promotionVisible: sensitive,
        textVisible: false,
      },
      postsMeasured: memory.businessFootprint.totalPostsMeasured,
      memory,
      autonomyState,
    });

    if (decision.outcome === "bloqueado") {
      return { created: 0, available: 0, blockedReason: decision.reason };
    }

    batch.status = "generando";
    batch.variantsPerPhoto = variantsPerPhoto;
    batch.lastActivityAt = new Date().toISOString();
    this.batches.set(batch.id, batch);
    this.persistState();

    let created = 0;
    const countGeneratedVariants = (): number =>
      batch.variantIds
        .map((variantId) => this.variants.get(variantId))
        .filter((variant): variant is VariantRecord => Boolean(variant && variant.status === "generada")).length;
    const finishEarlyIfClosed = (variant?: VariantRecord): { created: number; available: number; blockedReason: null } | null => {
      if (!DISABLED_BATCH_STATUSES.has(batch.status)) {
        return null;
      }

      if (variant && variant.status !== "publicada") {
        variant.status = "eliminada";
        variant.updatedAt = new Date().toISOString();
        this.variants.set(variant.id, variant);
      }
      this.persistState();
      return { created, available: countGeneratedVariants(), blockedReason: null };
    };
    for (const [photoIndex, photoId] of batch.photoIds.entries()) {
      const closedResult = finishEarlyIfClosed();
      if (closedResult) return closedResult;

      const photo = this.photos.get(photoId);
      if (!photo || !photo.visionAnalysis || !photo.assignedStyle || !photo.editingPrompt) continue;
      const existingVariantsForPhoto = batch.variantIds
        .map((variantId) => this.variants.get(variantId))
        .filter((variant): variant is VariantRecord =>
          Boolean(variant && variant.photoId === photo.id && variant.status !== "fallida" && variant.status !== "eliminada"),
        );
      for (let index = existingVariantsForPhoto.length; index < variantsPerPhoto; index += 1) {
        const closedResult = finishEarlyIfClosed();
        if (closedResult) return closedResult;

        const creativeDirection = variantCreativeDirectionFor(photoIndex, index);
        const selectedStyle = this.selectDiverseVariantStyle({
          business,
          photo,
          batch,
          memory,
          variantIndex: index,
          photoIndex,
        });
        const plan = buildGenerationPlan({
          business: this.businessContextFor(business),
          analysis: photo.visionAnalysis,
          style: selectedStyle,
          memory,
        });
        const promptUsed = buildFacebookSquareImagePrompt(
          [
            plan.promptFinal,
            `Variant: ${index + 1}/${variantsPerPhoto}.`,
            `Creative visual direction: ${creativeDirection.visual}`,
            "Make this variant visibly different from sibling variants for the same photo while preserving the real product.",
          ].join("\n"),
          1,
        );
        const now = new Date().toISOString();
        const variant: VariantRecord = {
          id: randomUUID(),
          batchId,
          photoId,
          styleId: selectedStyle.styleId,
          generationPlan: plan,
          promptUsed,
          imageUrl: null,
          caption: null,
          status: "generando",
          createdAt: now,
          updatedAt: now,
        };
        this.variants.set(variant.id, variant);
        batch.variantIds.push(variant.id);

        batch.variantsCount = batch.variantIds.length;
        batch.lastActivityAt = new Date().toISOString();
        this.batches.set(batch.id, batch);
        this.persistState();

        try {
          const image = await this.imageGenerationProvider.generateImage({
            prompt: promptUsed,
            styleId: selectedStyle.styleId,
            sourceImageUrl: photo.uploadUrl,
          });
          const closedAfterImage = finishEarlyIfClosed(variant);
          if (closedAfterImage) return closedAfterImage;

          let imageUrl = image.imageUrl;
          try {
            imageUrl = (await this.cloudMediaStore.uploadDataUrl(`variants/${variant.id}.png`, image.imageUrl)) ?? image.imageUrl;
          } catch (error) {
            console.warn("[fbmaniaco] failed to upload generated image to Supabase", error);
          }

          const avoidCaptions = batch.variantIds
            .map((variantId) => this.variants.get(variantId)?.caption?.trim() ?? "")
            .filter(Boolean)
            .slice(-8);
          const caption = await this.captionGenerationProvider.generateCaption({
            prompt: plan.promptFinal,
            styleName: selectedStyle.styleName,
            subjectDescription: photo.visionAnalysis.subject.description,
            businessTone: this.businessContextFor(business).tone,
            facebookSeoKeywords: getBusinessFacebookSeoKeywords(business),
            facebookSeoContext: getBusinessFacebookSeoContext(business),
            creativeAngle: creativeDirection.copy,
            visualDirection: creativeDirection.visual,
            variantIndex: index + 1,
            totalVariants: variantsPerPhoto,
            avoidCaptions,
          });
          const closedAfterCaption = finishEarlyIfClosed(variant);
          if (closedAfterCaption) return closedAfterCaption;

          variant.imageUrl = imageUrl;
          variant.caption = caption.caption;
          variant.status = "generada";
          variant.updatedAt = new Date().toISOString();
          this.variants.set(variant.id, variant);
          created += 1;
          this.recordEvent({
            negocioId: batch.businessId,
            type: "variante_generada",
            occurredAt: new Date().toISOString(),
            styleId: variant.styleId,
            styleName: selectedStyle.styleName,
            photoType: photo.visionAnalysis.subject.type,
            captionPattern: caption.caption,
            score: 0,
          });
        } catch (error) {
          variant.caption = describeGenerationError(error);
          variant.status = "fallida";
          variant.updatedAt = new Date().toISOString();
          this.variants.set(variant.id, variant);
        }

        this.persistState();
      }
    }

    const closedResult = finishEarlyIfClosed();
    if (closedResult) return closedResult;

    batch.variantsCount = batch.variantIds.length;
    batch.variantsPerPhoto = variantsPerPhoto;
    const generatedTotal = countGeneratedVariants();
    batch.status = generatedTotal > 0 ? "generado_parcial" : "fallido";
    batch.lastActivityAt = new Date().toISOString();
    this.batches.set(batch.id, batch);
    this.persistState();

    return {
      created,
      available: generatedTotal,
      blockedReason: decision.outcome === "puede_continuar_swipe" ? "Requiere aprobacion del usuario" : null,
    };
  }

  listVariants(batchId: string): GeneratedVariantSummary[] {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    return batch.variantIds
      .map((variantId) => this.variants.get(variantId))
      .filter((variant): variant is VariantRecord => Boolean(variant))
      .map((variant) => ({
        id: variant.id,
        photoId: variant.photoId,
        styleId: variant.styleId,
        status: variant.status,
        caption: variant.caption,
        imageUrl: variant.imageUrl,
        generationPlan: variant.generationPlan,
      }));
  }

  updateVariantCaption(batchId: string, variantId: string, input: UpdateVariantCaptionRequest): VariantRecord {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const variant = this.variants.get(variantId);
    if (!variant || variant.batchId !== batch.id) {
      throw new AppError({
        code: "variant_not_found",
        statusCode: 404,
        message: "Variant not found",
        userMessage: "La variante no existe.",
      });
    }
    variant.caption = input.caption;
    variant.updatedAt = new Date().toISOString();
    this.variants.set(variant.id, variant);
    this.recordEvent({
      negocioId: batch.businessId,
      type: "caption_editado_por_usuario",
      occurredAt: new Date().toISOString(),
      styleId: variant.styleId,
      captionPattern: input.caption,
      score: 0,
    });
    this.persistState();
    return variant;
  }

  approveVariant(batchId: string, variantId: string): VariantRecord {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const variant = this.getVariant(variantId, batchId);
    variant.status = "aprobada";
    variant.updatedAt = new Date().toISOString();
    this.variants.set(variant.id, variant);
    this.recordEvent({
      negocioId: batch.businessId,
      type: "variante_aprobada",
      occurredAt: new Date().toISOString(),
      styleId: variant.styleId,
      captionPattern: variant.caption ?? undefined,
      score: 1,
      actionType: "CAPTION_GENERATION",
    });
    const state = this.autonomyStateForBusiness(batch.businessId);
    this.setAutonomyState(batch.businessId, recordApproval(state, "CAPTION_GENERATION", true));
    this.persistState();
    return variant;
  }

  rejectVariant(batchId: string, variantId: string): VariantRecord {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const variant = this.getVariant(variantId, batchId);
    variant.status = "rechazada";
    variant.updatedAt = new Date().toISOString();
    this.variants.set(variant.id, variant);
    this.recordEvent({
      negocioId: batch.businessId,
      type: "variante_rechazada",
      occurredAt: new Date().toISOString(),
      styleId: variant.styleId,
      captionPattern: variant.caption ?? undefined,
      score: 0,
      actionType: "CAPTION_GENERATION",
    });
    const state = this.autonomyStateForBusiness(batch.businessId);
    this.setAutonomyState(batch.businessId, recordRejection(state, "CAPTION_GENERATION"));
    this.persistState();
    return variant;
  }

  async confirmCalendar(batchId: string, periodDays: 7 | 14 | 30): Promise<ConfirmCalendarResponse> {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchCanBeWorked(batch);
    const business = this.getBusiness(batch.businessId);
    const photoRecords = batch.photoIds.map((photoId) => this.photos.get(photoId)).filter(Boolean) as PhotoRecord[];
    const scheduledVariantIds = new Set(
      batch.scheduledPostIds
        .map((scheduledPostId) => this.scheduledPosts.get(scheduledPostId)?.variantId ?? null)
        .filter((variantId): variantId is string => Boolean(variantId)),
    );
    const approvedVariants = batch.variantIds
      .map((variantId) => this.variants.get(variantId))
      .filter((variant): variant is VariantRecord =>
        Boolean(variant && !scheduledVariantIds.has(variant.id) && (variant.status === "aprobada" || variant.status === "generada")),
      );
    const photosById = new Map(photoRecords.map((photo) => [photo.id, photo] as const));

    if (approvedVariants.length === 0) {
      throw new AppError({
        code: "no_approved_variants",
        statusCode: 409,
        message: "No approved variants available for scheduling",
        userMessage: "Primero aprueba al menos una variante para poder programarla en el calendario.",
      });
    }

    const memory = buildDeepMemory(this.events.filter((event) => event.negocioId === batch.businessId));
    const sorted = approvedVariants.sort((a, b) => {
      const predictionA = predictPerformance({
        memory,
        business: this.businessContextFor(business),
        contentType: "producto",
        styleId: a.styleId,
        dayOfWeek: new Date().getUTCDay(),
        hourOfDay: new Date().getUTCHours(),
        captionTone: "afirmacion",
      });
      const predictionB = predictPerformance({
        memory,
        business: this.businessContextFor(business),
        contentType: "producto",
        styleId: b.styleId,
        dayOfWeek: new Date().getUTCDay(),
        hourOfDay: new Date().getUTCHours(),
        captionTone: "afirmacion",
      });
      return predictionB.estimatedScore - predictionA.estimatedScore;
    });

    const calendarStart = toLocalDayAnchor(new Date());
    const existingLoadByDay = new Map<number, number>();
    for (const post of this.scheduledPosts.values()) {
      if (post.businessId !== business.id || post.status === "cancelada") {
        continue;
      }
      const scheduledDate = new Date(post.scheduledFor);
      if (Number.isNaN(scheduledDate.getTime())) {
        continue;
      }
      const offset = diffInLocalDays(calendarStart, scheduledDate);
      if (offset < 1 || offset > periodDays) {
        continue;
      }
      existingLoadByDay.set(offset, (existingLoadByDay.get(offset) ?? 0) + 1);
    }

    const preferredOffsets = buildPreferredDayOffsets(sorted.length, periodDays);
    const newLoadByDay = new Map<number, number>();
    const now = new Date().toISOString();
    const created: ScheduledPostRecord[] = [];
    let failedCount = 0;
    for (const [index, variant] of sorted.entries()) {
      let chosenOffset = 1;
      let chosenLoad = Number.POSITIVE_INFINITY;
      let chosenDistance = Number.POSITIVE_INFINITY;
      const preferredOffset = preferredOffsets[index] ?? 1;

      for (let dayOffset = 1; dayOffset <= periodDays; dayOffset += 1) {
        const existingLoad = existingLoadByDay.get(dayOffset) ?? 0;
        const allocatedLoad = newLoadByDay.get(dayOffset) ?? 0;
        const totalLoad = existingLoad + allocatedLoad;
        const distance = Math.abs(dayOffset - preferredOffset);
        if (
          totalLoad < chosenLoad ||
          (totalLoad === chosenLoad && distance < chosenDistance) ||
          (totalLoad === chosenLoad && distance === chosenDistance && dayOffset < chosenOffset)
        ) {
          chosenOffset = dayOffset;
          chosenLoad = totalLoad;
          chosenDistance = distance;
        }
      }

      const scheduledAt = buildScheduledDateForOffset(calendarStart, chosenOffset, chosenLoad);
      const scheduledFor = scheduledAt.toISOString();
      try {
        const originalPhotoUrl = normalizeImageUrl(variant.imageUrl) ?? normalizeImageUrl(photosById.get(variant.photoId)?.uploadUrl);
        const result = await this.facebookPublishingProvider.publishPost({
          pageId: business.facebookPageId,
          message: variant.caption ?? "",
          imageUrl: originalPhotoUrl ?? undefined,
          scheduledFor,
        });
        if (!result.postId?.trim()) {
          throw new AppError({
            code: "meta_schedule_missing_post_id",
            statusCode: 502,
            message: "Meta scheduling did not return a post id",
            userMessage: "Meta no confirmo la programacion de una publicacion. Reintenta o revisa la conexion con Facebook.",
          });
        }
        variant.status = "programada";
        variant.updatedAt = now;
        this.variants.set(variant.id, variant);
        const scheduledPost: ScheduledPostRecord = {
          id: randomUUID(),
          variantId: variant.id,
          businessId: business.id,
          batchId: batch.id,
          scheduledFor,
          facebookPostId: result.postId,
          status: "programada",
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.scheduledPosts.set(scheduledPost.id, scheduledPost);
        batch.scheduledPostIds.push(scheduledPost.id);
        created.push(scheduledPost);
        newLoadByDay.set(chosenOffset, (newLoadByDay.get(chosenOffset) ?? 0) + 1);
        this.recordEvent({
          negocioId: business.id,
          type: "accion_aprobada_en_swipe_autonomia",
          occurredAt: now,
          actionType: "SCHEDULING",
          score: 1,
        });
        const state = this.autonomyStateForBusiness(business.id);
        this.setAutonomyState(business.id, recordApproval(state, "SCHEDULING"));
      } catch (error) {
        failedCount += 1;
        const tokenExpired = isMetaTokenExpiredError(error);
        if (tokenExpired) {
          this.metaToken = this.metaToken ? { ...this.metaToken, status: "expirado" } : this.metaToken;
          business.tokenStatus = "expirado";
          business.updatedAt = now;
          this.businesses.set(business.id, business);
          this.pages = this.pages.map((page) =>
            page.pageId === business.facebookPageId ? { ...page, pageAccessTokenStatus: "expirado" } : page,
          );
        }
        variant.status = "aprobada";
        variant.updatedAt = now;
        this.variants.set(variant.id, variant);
        const scheduledPost: ScheduledPostRecord = {
          id: randomUUID(),
          variantId: variant.id,
          businessId: business.id,
          batchId: batch.id,
          scheduledFor,
          facebookPostId: null,
          status: "fallida",
          retryCount: 1,
          createdAt: now,
          updatedAt: now,
        };
        this.scheduledPosts.set(scheduledPost.id, scheduledPost);
        batch.scheduledPostIds.push(scheduledPost.id);
        newLoadByDay.set(chosenOffset, (newLoadByDay.get(chosenOffset) ?? 0) + 1);
        this.recordEvent({
          negocioId: business.id,
          type: "post_fallido",
          occurredAt: now,
          styleId: variant.styleId,
          captionPattern: variant.caption ?? undefined,
          score: 0,
          scheduledFor,
        });
        console.warn("[fbmaniaco] unable to schedule post in Meta", error);
      }
    }

    batch.status = created.length + failedCount > 0 ? "completado" : "generado_parcial";
    batch.lastActivityAt = new Date().toISOString();
    this.batches.set(batch.id, batch);
    this.persistState();
    return { created: created.length };
  }

  listScheduledPosts(batchId: string): ScheduledPostSummary[] {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    return batch.scheduledPostIds
      .map((id) => this.scheduledPosts.get(id))
      .filter((post): post is ScheduledPostRecord => Boolean(post))
      .map((post) => this.toScheduledPostSummary(post));
  }

  listScheduledPostsByBusiness(businessId: string): ScheduledPostSummary[] {
    this.restoreStateFromDisk();
    return [...this.scheduledPosts.values()]
      .filter((post) => post.businessId === businessId)
      .map((post) => this.toScheduledPostSummary(post));
  }

  updateScheduledPost(batchId: string, scheduledPostId: string, input: UpdateScheduledPostRequest): ScheduledPostRecord {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchIsNotDisabled(batch);
    const scheduledPost = this.scheduledPosts.get(scheduledPostId);
    if (!scheduledPost || scheduledPost.batchId !== batch.id) {
      throw new AppError({
        code: "scheduled_post_not_found",
        statusCode: 404,
        message: "Scheduled post not found",
        userMessage: "La publicacion programada no existe.",
      });
    }
    scheduledPost.scheduledFor = input.scheduledFor;
    scheduledPost.status = "programada";
    scheduledPost.updatedAt = new Date().toISOString();
    this.scheduledPosts.set(scheduledPost.id, scheduledPost);
    const variant = this.variants.get(scheduledPost.variantId);
    if (variant) {
      variant.status = "programada";
      variant.updatedAt = new Date().toISOString();
      this.variants.set(variant.id, variant);
    }
    this.persistState();
    return scheduledPost;
  }

  cancelScheduledPost(batchId: string, scheduledPostId: string): ScheduledPostRecord {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchIsNotDisabled(batch);
    const scheduledPost = this.scheduledPosts.get(scheduledPostId);
    if (!scheduledPost || scheduledPost.batchId !== batch.id) {
      throw new AppError({
        code: "scheduled_post_not_found",
        statusCode: 404,
        message: "Scheduled post not found",
        userMessage: "La publicacion programada no existe.",
      });
    }
    scheduledPost.status = "cancelada";
    scheduledPost.updatedAt = new Date().toISOString();
    this.scheduledPosts.set(scheduledPost.id, scheduledPost);
    const variant = this.variants.get(scheduledPost.variantId);
    if (variant) {
      variant.status = "aprobada";
      variant.updatedAt = new Date().toISOString();
      this.variants.set(variant.id, variant);
    }
    this.persistState();
    return scheduledPost;
  }

  async publishScheduledPost(batchId: string, scheduledPostId: string): Promise<ScheduledPostRecord> {
    this.restoreStateFromDisk();
    const batch = this.getBatch(batchId);
    this.assertBatchIsNotDisabled(batch);
    const business = this.getBusiness(batch.businessId);
    const scheduledPost = this.scheduledPosts.get(scheduledPostId);
    if (!scheduledPost || scheduledPost.batchId !== batch.id) {
      throw new AppError({
        code: "scheduled_post_not_found",
        statusCode: 404,
        message: "Scheduled post not found",
        userMessage: "La publicacion programada no existe.",
      });
    }
    const variant = this.variants.get(scheduledPost.variantId);
    if (!variant) {
      throw new AppError({
        code: "variant_not_found",
        statusCode: 404,
        message: "Variant not found for scheduled post",
        userMessage: "La variante de la publicacion no existe.",
      });
    }
    if (scheduledPost.facebookPostId) {
      scheduledPost.status = "publicada";
      scheduledPost.updatedAt = new Date().toISOString();
      this.scheduledPosts.set(scheduledPost.id, scheduledPost);
      variant.status = "publicada";
      variant.updatedAt = new Date().toISOString();
      this.variants.set(variant.id, variant);
      this.persistState();
      return scheduledPost;
    }
    scheduledPost.status = "publicacion_en_proceso";
    this.scheduledPosts.set(scheduledPost.id, scheduledPost);

    try {
      const originalPhoto = this.photos.get(variant.photoId) ?? null;
      const renderableImageUrl = normalizeImageUrl(variant.imageUrl) ?? normalizeImageUrl(originalPhoto?.uploadUrl);
      const publishData: PublishPostData = {
        pageId: business.facebookPageId,
        message: variant.caption ?? "",
        imageUrl: renderableImageUrl ?? undefined,
        scheduledFor: scheduledPost.scheduledFor,
      };
      const result = await this.facebookPublishingProvider.publishPost(publishData);
      if (!result.postId?.trim()) {
        throw new AppError({
          code: "meta_publish_missing_post_id",
          statusCode: 502,
          message: "Meta publish did not return a post id",
          userMessage: "Meta no confirmo la publicacion. Reintenta o revisa la conexion con Facebook.",
        });
      }
      scheduledPost.facebookPostId = result.postId;
      scheduledPost.status = "publicada";
      scheduledPost.updatedAt = new Date().toISOString();
      this.scheduledPosts.set(scheduledPost.id, scheduledPost);
      variant.status = "publicada";
      variant.updatedAt = new Date().toISOString();
      this.variants.set(variant.id, variant);
      this.recordEvent({
        negocioId: business.id,
        type: "post_publicado",
        occurredAt: new Date().toISOString(),
        styleId: variant.styleId,
        captionPattern: variant.caption ?? undefined,
        score: 1,
        scheduledFor: scheduledPost.scheduledFor,
      });
      await this.pushNotificationProvider.send({
        title: "Publicacion completada",
        body: "Se publico un post programado en Facebook.",
        destination: `/businesses/${business.id}/calendar`,
        businessId: business.id,
      });
      return scheduledPost;
    } catch (error) {
      scheduledPost.retryCount += 1;
      scheduledPost.status = "fallida";
      scheduledPost.updatedAt = new Date().toISOString();
      this.scheduledPosts.set(scheduledPost.id, scheduledPost);
      variant.status = "aprobada";
      variant.updatedAt = new Date().toISOString();
      this.variants.set(variant.id, variant);
      this.recordEvent({
        negocioId: business.id,
        type: "post_fallido",
        occurredAt: new Date().toISOString(),
        styleId: variant.styleId,
        captionPattern: variant.caption ?? undefined,
        score: 0,
        scheduledFor: scheduledPost.scheduledFor,
      });
      this.persistState();
      throw error;
    }
  }

  async retryScheduledPost(batchId: string, scheduledPostId: string): Promise<ScheduledPostRecord> {
    this.restoreStateFromDisk();
    const scheduledPost = this.scheduledPosts.get(scheduledPostId);
    if (!scheduledPost) {
      throw new AppError({
        code: "scheduled_post_not_found",
        statusCode: 404,
        message: "Scheduled post not found",
        userMessage: "La publicacion programada no existe.",
      });
    }
    return this.publishScheduledPost(batchId, scheduledPostId);
  }

  recordEvent(event: LearningEvent): void {
    this.events.push(event);
    this.persistState();
  }

  getEvents(businessId?: string): LearningEvent[] {
    return businessId ? this.events.filter((event) => event.negocioId === businessId) : [...this.events];
  }

  getBootstrapMetaToken(): MetaTokenRecord | null {
    return this.metaToken;
  }

  getOwnerSession(): AuthSession {
    return {
      accessToken: "fbmaniaco-local-access",
      refreshToken: "fbmaniaco-local-refresh",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      sessionId: "local-session",
    };
  }

  private getVariant(variantId: string, batchId: string): VariantRecord {
    const variant = this.variants.get(variantId);
    if (!variant || variant.batchId !== batchId) {
      throw new AppError({
        code: "variant_not_found",
        statusCode: 404,
        message: "Variant not found",
        userMessage: "La variante no existe.",
      });
    }
    return variant;
  }

  private toBatchSummary(batch: BatchRecord): BatchSummary {
    return {
      id: batch.id,
      negocioId: batch.businessId,
      status: batch.status,
      photosCount: batch.photosCount,
      variantsCount: batch.variantsCount,
      estimatedCostUsd: batch.estimatedCostUsd,
      confirmedCostUsd: batch.confirmedCostUsd,
      lastActivityAt: batch.lastActivityAt,
    };
  }

  private toScheduledPostSummary(post: ScheduledPostRecord): ScheduledPostSummary {
    const variant = this.variants.get(post.variantId) ?? null;
    const photo = variant ? this.photos.get(variant.photoId) ?? null : null;
    return {
      id: post.id,
      variantId: post.variantId,
      negocioId: post.businessId,
      batchId: post.batchId,
      scheduledFor: post.scheduledFor,
      facebookPostId: post.facebookPostId,
      status: post.status,
      retryCount: post.retryCount,
      caption: variant?.caption ?? null,
      imageUrl: normalizeImageUrl(variant?.imageUrl) ?? normalizeImageUrl(photo?.uploadUrl),
      styleId: variant?.styleId ?? null,
      styleName: photo?.assignedStyle?.styleName ?? variant?.styleId ?? null,
    };
  }

  private async initializeState(restoredFromDisk: boolean): Promise<void> {
    if (!restoredFromDisk) {
      try {
        const snapshot = await this.snapshotStore.downloadSnapshot();
        if (snapshot) {
          this.restoreStateFromSnapshot(snapshot);
          this.persistState();
        }
      } catch (error) {
        console.warn("[fbmaniaco] failed to restore runtime state from Supabase", error);
      }
    } else {
      try {
        await this.snapshotStore.uploadSnapshot(buildCloudRuntimeSnapshot(this.buildPersistedRuntimeState()));
      } catch (error) {
        console.warn("[fbmaniaco] failed to back up runtime state to Supabase", error);
      }
    }

    void this.supabaseMirror.syncState(this.buildSupabaseMirrorState()).catch((error) => {
      console.warn("[fbmaniaco] failed to sync Supabase planner mirror on startup", error);
    });
  }

  private restoreStateFromDisk(): boolean {
    try {
      if (!existsSync(config.stateFilePath)) {
        return false;
      }

      const raw = readFileSync(config.stateFilePath, "utf8");
      if (!raw.trim()) {
        return false;
      }

      const snapshot = JSON.parse(raw) as Partial<PersistedRuntimeState>;
      if (this.restoreStateFromSnapshot(snapshot)) {
        this.persistState();
      }
      return true;
    } catch (error) {
      console.warn("[fbmaniaco] failed to restore runtime state", error);
      return false;
    }
  }

  private restoreStateFromSnapshot(snapshot: Partial<PersistedRuntimeState>): boolean {
    let stateNeedsPersist = false;
    const restoredPages = Array.isArray(snapshot.pages)
      ? snapshot.pages.filter((page): page is MetaPageRecord => Boolean(page && page.pageId))
      : [];
    this.pages = restoredPages;
    const restoredSelectedPageId =
      typeof snapshot.selectedPageId === "string" && restoredPages.some((page) => page.pageId === snapshot.selectedPageId)
        ? snapshot.selectedPageId
        : restoredPages.filter((page) => page.isSelected).length === 1
          ? restoredPages.find((page) => page.isSelected)?.pageId ?? null
          : null;
    const authProvider = this.metaAuthProvider as unknown as {
      seedPageAccessTokens?: (entries: Array<{ pageId: string; accessToken: string }>) => void;
    };
    if (typeof authProvider.seedPageAccessTokens === "function") {
      try {
        authProvider.seedPageAccessTokens(
          this.pages
            .filter((page): page is MetaPageRecord & { pageAccessToken: string } => Boolean(page.pageAccessToken?.trim()))
            .map((page) => ({ pageId: page.pageId, accessToken: page.pageAccessToken })),
        );
      } catch (error) {
        console.warn("[fbmaniaco] failed to seed page access tokens from persisted state", error);
      }
    }
    const restoredStyles = Array.isArray(snapshot.visualStyles)
      ? snapshot.visualStyles.map((style) => sanitizeVisualStyle(style)).filter((style): style is VisualStyle => Boolean(style))
      : [];
    this.visualStyles = Array.isArray(snapshot.visualStyles)
      ? restoredStyles
      : INITIAL_VISUAL_STYLES.map((style) => cloneVisualStyle(style));
    this.businesses = new Map(
      Array.isArray(snapshot.businesses)
        ? snapshot.businesses
            .filter((business): business is BusinessRecord => Boolean(business && business.id))
            .map((business) => [business.id, business])
        : [],
    );
    this.batches = new Map(
      Array.isArray(snapshot.batches)
        ? snapshot.batches
            .filter((batch): batch is BatchRecord => Boolean(batch && batch.id))
            .map((batch) => [batch.id, batch])
        : [],
    );
    this.photos = new Map(
      Array.isArray(snapshot.photos)
        ? snapshot.photos
            .filter((photo): photo is PhotoRecord => Boolean(photo && photo.id))
            .map((photo) => [photo.id, photo])
        : [],
    );
    this.variants = new Map(
      Array.isArray(snapshot.variants)
        ? snapshot.variants
            .filter((variant): variant is VariantRecord => Boolean(variant && variant.id))
            .map((variant) => [variant.id, variant])
        : [],
    );
    this.scheduledPosts = new Map(
      Array.isArray(snapshot.scheduledPosts)
        ? snapshot.scheduledPosts
            .filter((scheduledPost): scheduledPost is ScheduledPostRecord => Boolean(scheduledPost && scheduledPost.id))
            .map((scheduledPost) => {
              const normalizedStatus =
                scheduledPost.status === "programada" && !scheduledPost.facebookPostId ? "estado_incierto" : scheduledPost.status;
              if (normalizedStatus !== scheduledPost.status) {
                stateNeedsPersist = true;
              }
              return [
                scheduledPost.id,
                {
                  ...scheduledPost,
                  status: normalizedStatus,
                },
              ] as const;
            })
        : [],
    );
    this.events = Array.isArray(snapshot.events) ? snapshot.events : [];
    this.autonomyByBusiness = new Map(snapshot.autonomyByBusiness ?? []);
    this.metaToken = snapshot.metaToken ?? this.metaToken;
    this.pendingDeviceLogin = snapshot.pendingDeviceLogin ?? this.pendingDeviceLogin;
    this.selectedPageId = restoredSelectedPageId;
    this.selectedBusinessId =
      typeof snapshot.selectedBusinessId === "string" && this.businesses.has(snapshot.selectedBusinessId)
        ? snapshot.selectedBusinessId
        : this.selectedPageId
          ? [...this.businesses.values()].find((business) => business.facebookPageId === this.selectedPageId)?.id ?? null
          : null;
    if (!this.selectedPageId && this.selectedBusinessId) {
      this.selectedPageId = this.businesses.get(this.selectedBusinessId)?.facebookPageId ?? null;
    }

    if (this.syncBusinessTokenStatusesFromMeta()) {
      stateNeedsPersist = true;
    }

    for (const business of this.businesses.values()) {
      if (!this.autonomyByBusiness.has(business.id)) {
        this.autonomyByBusiness.set(business.id, createDefaultAutonomyState(business.autonomySettings));
      }
    }

    return stateNeedsPersist;
  }

  private buildPersistedRuntimeState(): PersistedRuntimeState {
    return {
      metaToken: this.metaToken,
      pendingDeviceLogin: this.pendingDeviceLogin,
      selectedPageId: this.selectedPageId,
      selectedBusinessId: this.selectedBusinessId,
      pages: this.pages,
      businesses: [...this.businesses.values()],
      visualStyles: this.visualStyles.map((style) => serializeVisualStyle(style)),
      batches: [...this.batches.values()],
      photos: [...this.photos.values()],
      variants: [...this.variants.values()],
      scheduledPosts: [...this.scheduledPosts.values()],
      events: this.events,
      autonomyByBusiness: [...this.autonomyByBusiness.entries()],
    };
  }

  private persistState(): void {
    try {
      const directory = dirname(config.stateFilePath);
      mkdirSync(directory, { recursive: true });
      const snapshot = this.buildPersistedRuntimeState();
      writeFileSync(config.stateFilePath, JSON.stringify(snapshot, null, 2), "utf8");
      void this.snapshotStore.uploadSnapshot(buildCloudRuntimeSnapshot(snapshot)).catch((error) => {
        console.warn("[fbmaniaco] failed to back up runtime state to Supabase", error);
      });
      void this.supabaseMirror.syncState(this.buildSupabaseMirrorState()).catch((error) => {
        console.warn("[fbmaniaco] failed to sync Supabase planner mirror", error);
      });
    } catch (error) {
      console.warn("[fbmaniaco] failed to persist runtime state", error);
    }
  }
}

export function createRuntime(): FbmaniacoRuntime {
  const visionProvider = new OpenAIVisionAnalysisProvider();
  const imageGenerationProvider = new OpenAIImageGenerationProvider();
  const captionGenerationProvider = new OpenAICaptionGenerationProvider();
  const mediaStorage = new MockMediaStorage();
  const metaAuthProvider: MetaAuthProvider = new MetaGraphAuthProvider({
    appId: config.metaAppId,
    appSecret: config.metaAppSecret,
    apiVersion: config.metaGraphApiVersion,
    deviceLoginScopes: config.metaDeviceLoginScopes,
  });
  const facebookPublishingProvider: FacebookPublishingProvider = new MetaGraphPublishingProvider(metaAuthProvider, config.metaGraphApiVersion);
  const pushNotificationProvider = new MockPushNotificationProvider();

  return new FbmaniacoRuntime(
    visionProvider,
    imageGenerationProvider,
    captionGenerationProvider,
    mediaStorage,
    metaAuthProvider,
    facebookPublishingProvider,
    pushNotificationProvider,
  );
}

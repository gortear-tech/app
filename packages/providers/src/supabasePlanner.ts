type PlannerPage = {
  pageId: string;
  pageName: string;
  pageAccessToken?: string | null;
  category?: string | null;
  categoryList?: Array<{ id?: string; name?: string }> | null;
  tasks?: string[] | null;
};

type PlannerBusiness = {
  id: string;
  facebookPageId: string;
  name?: string | null;
  industry?: string | null;
  timezone?: string | null;
  tokenStatus?: string | null;
  metadata?: Record<string, unknown> | null;
  autonomySettings?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PlannerBatch = {
  id: string;
  businessId: string;
  status: string;
  photosCount: number;
  variantsCount: number;
  estimatedCostUsd?: number | null;
  confirmedCostUsd?: number | null;
  lastActivityAt: string;
  variantsPerPhoto?: number | null;
  photoIds?: string[] | null;
  variantIds?: string[] | null;
  scheduledPostIds?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PlannerPhoto = {
  id: string;
  batchId: string;
  fileName?: string | null;
  storageKey?: string | null;
  uploadUrl?: string | null;
  status: string;
  visionAnalysis?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PlannerVariant = {
  id: string;
  batchId: string;
  photoId: string;
  styleId: string;
  assignedStyle?: unknown;
  generationPlan?: unknown;
  promptUsed?: string | null;
  imageUrl?: string | null;
  caption?: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PlannerScheduledPost = {
  id: string;
  variantId: string;
  businessId: string;
  batchId: string;
  scheduledFor: string;
  facebookPostId?: string | null;
  status: string;
  createdAt?: string | null;
};

export type SupabasePlannerState = {
  pages?: PlannerPage[];
  businesses?: PlannerBusiness[];
  batches?: PlannerBatch[];
  photos?: PlannerPhoto[];
  variants?: PlannerVariant[];
  scheduledPosts?: PlannerScheduledPost[];
};

type SyncOptions = {
  supabaseUrl?: string;
  serviceRole?: string;
};

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

const stripKeys = (row: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
  const copy = { ...row };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
};

export class SupabasePlannerMirror {
  private lastFingerprint: string | null = null;
  private syncChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: SyncOptions) {}

  private get enabled(): boolean {
    return Boolean(this.options.supabaseUrl?.trim() && this.options.serviceRole?.trim());
  }

  private get baseUrl(): string {
    return this.options.supabaseUrl?.trim().replace(/\/$/, "") ?? "";
  }

  private get headers(): HeadersInit {
    const serviceRole = this.options.serviceRole?.trim() ?? "";
    return {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    };
  }

  private buildPageRows(state: SupabasePlannerState): Array<Record<string, unknown>> {
    return (state.pages ?? []).map((page) => ({
      page_id: page.pageId,
      page_name: page.pageName,
      page_access_token: page.pageAccessToken ?? null,
      updated_at: new Date().toISOString(),
    }));
  }

  private buildBusinessRows(state: SupabasePlannerState): Array<Record<string, unknown>> {
    return (state.businesses ?? []).map((business) => ({
      id: business.id,
      facebook_page_id: business.facebookPageId,
      name: business.name ?? null,
      industry: business.industry ?? null,
      timezone: business.timezone ?? null,
      token_status: business.tokenStatus ?? null,
      metadata: business.metadata ?? null,
      autonomy_settings: business.autonomySettings ?? null,
      created_at: business.createdAt ?? new Date().toISOString(),
      updated_at: business.updatedAt ?? new Date().toISOString(),
    }));
  }

  private buildBatchRows(state: SupabasePlannerState): Array<Record<string, unknown>> {
    return (state.batches ?? []).map((batch) => ({
      id: batch.id,
      business_id: batch.businessId,
      status: batch.status,
      photos_count: batch.photosCount,
      variants_count: batch.variantsCount,
      estimated_cost_usd: batch.estimatedCostUsd ?? null,
      confirmed_cost_usd: batch.confirmedCostUsd ?? null,
      last_activity_at: batch.lastActivityAt,
      variants_per_photo: batch.variantsPerPhoto ?? null,
      photo_ids: batch.photoIds ?? [],
      variant_ids: batch.variantIds ?? [],
      scheduled_post_ids: batch.scheduledPostIds ?? [],
      created_at: batch.createdAt ?? new Date().toISOString(),
      updated_at: batch.updatedAt ?? new Date().toISOString(),
    }));
  }

  private buildPhotoRows(state: SupabasePlannerState): Array<Record<string, unknown>> {
    return (state.photos ?? []).map((photo) => ({
      id: photo.id,
      batch_id: photo.batchId,
      file_name: photo.fileName ?? null,
      storage_key: photo.storageKey ?? null,
      upload_url: normalizeImageUrl(photo.uploadUrl) ?? photo.uploadUrl ?? null,
      status: photo.status,
      vision_analysis: photo.visionAnalysis ?? null,
      created_at: photo.createdAt ?? new Date().toISOString(),
      updated_at: photo.updatedAt ?? new Date().toISOString(),
    }));
  }

  private buildVariantRows(state: SupabasePlannerState): Array<Record<string, unknown>> {
    return (state.variants ?? []).map((variant) => ({
      id: variant.id,
      batch_id: variant.batchId,
      photo_id: variant.photoId,
      style_id: variant.styleId,
      generation_plan: variant.generationPlan ?? null,
      prompt_used: variant.promptUsed ?? null,
      image_url: normalizeImageUrl(variant.imageUrl) ?? variant.imageUrl ?? null,
      caption: variant.caption ?? null,
      status: variant.status,
      created_at: variant.createdAt ?? new Date().toISOString(),
      updated_at: variant.updatedAt ?? new Date().toISOString(),
    }));
  }

  private buildScheduledRows(state: SupabasePlannerState): Array<Record<string, unknown>> {
    const businessesById = new Map((state.businesses ?? []).map((business) => [business.id, business] as const));
    const pagesById = new Map((state.pages ?? []).map((page) => [page.pageId, page] as const));
    const variantsById = new Map((state.variants ?? []).map((variant) => [variant.id, variant] as const));
    const photosById = new Map((state.photos ?? []).map((photo) => [photo.id, photo] as const));

    const rows = (state.scheduledPosts ?? [])
      .map((post) => {
        const business = businessesById.get(post.businessId);
        const page = business ? pagesById.get(business.facebookPageId) ?? null : null;
        if (!page) {
          return null;
        }

        const variant = variantsById.get(post.variantId) ?? null;
        const photo = variant ? photosById.get(variant.photoId) ?? null : null;
        const imageUrl = normalizeImageUrl(variant?.imageUrl) ?? normalizeImageUrl(photo?.uploadUrl);

        return {
          id: post.id,
          page_id: page.pageId,
          scheduled_at: post.scheduledFor,
          message: variant?.caption ?? "",
          image_url: imageUrl ?? null,
          facebook_post_id: post.facebookPostId ?? null,
          status: post.status,
          created_at: post.createdAt ?? new Date().toISOString(),
        };
      })
      .filter((row) => row !== null) as Array<Record<string, unknown>>;

    return rows;
  }

  private async upsertRows(table: string, rows: Array<Record<string, unknown>>, onConflict: string): Promise<void> {
    if (!rows.length) {
      return;
    }

    const response = await fetch(`${this.baseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase ${table} sync failed (${response.status}): ${text || response.statusText}`);
    }
  }

  async syncState(state: SupabasePlannerState): Promise<void> {
    const execute = async (): Promise<void> => {
      if (!this.enabled) {
        return;
      }

      const pageRows = this.buildPageRows(state);
      const businessRows = this.buildBusinessRows(state);
      const batchRows = this.buildBatchRows(state);
      const photoRows = this.buildPhotoRows(state);
      const variantRows = this.buildVariantRows(state);
      const scheduledRows = this.buildScheduledRows(state);
      const fingerprint = JSON.stringify({
        pageRows: pageRows.map((row) => stripKeys(row, ["updated_at"])),
        businessRows: businessRows.map((row) => stripKeys(row, ["created_at", "updated_at"])),
        batchRows: batchRows.map((row) => stripKeys(row, ["created_at", "updated_at"])),
        photoRows: photoRows.map((row) => stripKeys(row, ["created_at", "updated_at"])),
        variantRows: variantRows.map((row) => stripKeys(row, ["created_at", "updated_at"])),
        scheduledRows: scheduledRows.map((row) => stripKeys(row, ["created_at"])),
      });
      if (fingerprint === this.lastFingerprint) {
        return;
      }

      await Promise.all([
        this.upsertRows("facebook_pages", pageRows, "page_id"),
        this.upsertRows("businesses", businessRows, "id"),
        this.upsertRows("batches", batchRows, "id"),
        this.upsertRows("photos", photoRows, "id"),
        this.upsertRows("variants", variantRows, "id"),
        this.upsertRows("scheduled_posts", scheduledRows, "id"),
      ]);

      this.lastFingerprint = fingerprint;
    };

    const next = this.syncChain.then(execute, execute);
    this.syncChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

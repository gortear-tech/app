alter table public.media_assets
  add column if not exists variant_id text references public.variants(id) on delete set null;

create index if not exists media_assets_workspace_variant_idx
  on public.media_assets(workspace_id, variant_id);

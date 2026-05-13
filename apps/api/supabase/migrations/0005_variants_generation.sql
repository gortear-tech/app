create table if not exists public.variants (
  id text primary key,
  workspace_id text not null,
  business_id text not null,
  batch_id text not null,
  photo_id text not null,
  variant_index integer not null,
  style_id text,
  assigned_style jsonb,
  generation_plan jsonb,
  quality_check jsonb,
  caption_result jsonb,
  model_profile_id text,
  prompt_template_id text,
  prompt_version text,
  ai_run_id text,
  quality_check_id text,
  quality_status text,
  quality_score numeric,
  quality_warnings jsonb,
  image_url text,
  generated_asset_id text,
  publishable_asset_id text,
  caption text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, business_id, batch_id, photo_id, variant_index)
);

create index if not exists variants_workspace_batch_idx
  on public.variants (workspace_id, business_id, batch_id, status);

create index if not exists variants_photo_idx
  on public.variants (workspace_id, photo_id, variant_index);

create table if not exists public.ai_quality_checks (
  id text primary key,
  workspace_id text not null,
  business_id text not null,
  batch_id text not null,
  photo_id text not null,
  variant_id text not null,
  schema_version text not null default 'ai_quality_check.v1',
  status text not null,
  score numeric not null,
  warnings jsonb not null default '[]'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  requires_human_review boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_quality_checks_variant_id_idx
  on public.ai_quality_checks (workspace_id, variant_id, created_at);

alter table public.variants enable row level security;
alter table public.ai_quality_checks enable row level security;

drop policy if exists variants_workspace_members on public.variants;
create policy variants_workspace_members on public.variants
  for all using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = variants.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

drop policy if exists ai_quality_checks_workspace_members on public.ai_quality_checks;
create policy ai_quality_checks_workspace_members on public.ai_quality_checks
  for all using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = ai_quality_checks.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

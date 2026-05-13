create table if not exists public.batches (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text not null references public.businesses(id) on delete restrict,
  status text not null default 'pending_upload',
  photos_count integer not null default 0,
  variants_count integer not null default 0,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.upload_intents (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text not null references public.businesses(id) on delete restrict,
  batch_id text not null references public.batches(id) on delete restrict,
  bucket text not null,
  storage_key text not null unique,
  allowed_mime_types text[] not null,
  max_bytes integer not null,
  status text not null default 'created',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text not null references public.businesses(id) on delete restrict,
  batch_id text not null references public.batches(id) on delete restrict,
  file_name text,
  storage_key text,
  original_asset_id text,
  thumbnail_asset_id text,
  vision_input_asset_id text,
  content_hash text,
  mime_type text,
  width integer,
  height integer,
  status text not null default 'uploaded',
  vision_analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text not null references public.businesses(id) on delete restrict,
  batch_id text references public.batches(id) on delete restrict,
  photo_id text references public.photos(id) on delete restrict,
  kind text not null,
  bucket text not null,
  storage_key text not null unique,
  mime_type text not null,
  file_size integer not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.photos
  add constraint photos_original_asset_fk
  foreign key (original_asset_id) references public.media_assets(id);

alter table public.batches enable row level security;
alter table public.upload_intents enable row level security;
alter table public.photos enable row level security;
alter table public.media_assets enable row level security;

create index if not exists batches_workspace_business_idx on public.batches(workspace_id, business_id, updated_at desc);
create index if not exists photos_workspace_batch_idx on public.photos(workspace_id, batch_id, created_at desc);
create index if not exists upload_intents_workspace_batch_idx on public.upload_intents(workspace_id, batch_id, status);
create index if not exists media_assets_workspace_photo_idx on public.media_assets(workspace_id, photo_id);

create policy "workspace members can read batches"
  on public.batches for select
  using (public.current_user_has_workspace(workspace_id));

create policy "workspace operators can mutate batches"
  on public.batches for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

create policy "workspace members can read upload intents"
  on public.upload_intents for select
  using (public.current_user_has_workspace(workspace_id));

create policy "workspace operators can mutate upload intents"
  on public.upload_intents for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

create policy "workspace members can read photos"
  on public.photos for select
  using (public.current_user_has_workspace(workspace_id));

create policy "workspace operators can mutate photos"
  on public.photos for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

create policy "workspace members can read media assets"
  on public.media_assets for select
  using (public.current_user_has_workspace(workspace_id));

create policy "workspace operators can mutate media assets"
  on public.media_assets for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table if not exists public.media_categories (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

alter table public.media_assets
  add column if not exists sha256 text,
  add column if not exists phash text,
  add column if not exists display_name text,
  add column if not exists original_name text,
  add column if not exists category_id text references public.media_categories(id) on delete set null,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists bytes bigint,
  add column if not exists thumb_path text,
  add column if not exists preview_path text,
  add column if not exists full_path text,
  add column if not exists usage_count integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists status text not null default 'ready',
  add column if not exists error_reason text,
  add column if not exists processed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists media_assets_workspace_sha256_unique
  on public.media_assets (workspace_id, sha256)
  where sha256 is not null;

create index if not exists media_assets_category_idx
  on public.media_assets (category_id);

create index if not exists media_assets_last_used_idx
  on public.media_assets (workspace_id, last_used_at desc nulls last);

create index if not exists media_assets_archived_idx
  on public.media_assets (workspace_id, archived_at)
  where archived_at is null;

create table if not exists public.media_tags (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.media_asset_tags (
  asset_id text not null references public.media_assets(id) on delete cascade,
  tag_id text not null references public.media_tags(id) on delete cascade,
  primary key (asset_id, tag_id)
);

create table if not exists public.media_asset_fb_uploads (
  id text primary key default gen_random_uuid()::text,
  asset_id text not null references public.media_assets(id) on delete cascade,
  facebook_page_id text not null references public.facebook_pages(id) on delete cascade,
  fb_photo_id text not null,
  uploaded_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (asset_id, facebook_page_id)
);

create index if not exists media_asset_fb_uploads_asset_idx on public.media_asset_fb_uploads (asset_id);
create index if not exists media_asset_fb_uploads_page_idx on public.media_asset_fb_uploads (facebook_page_id);

create table if not exists public.media_selections (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  name text,
  asset_ids text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','consumed','discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_selections_workspace_user_idx
  on public.media_selections (workspace_id, user_id, updated_at desc);

create table if not exists public.media_asset_usages (
  id text primary key default gen_random_uuid()::text,
  asset_id text not null references public.media_assets(id) on delete cascade,
  scheduled_post_id text references public.scheduled_posts(id) on delete set null,
  variant_id text references public.variants(id) on delete set null,
  facebook_page_id text references public.facebook_pages(id) on delete set null,
  used_at timestamptz not null default now()
);

create index if not exists media_asset_usages_asset_idx
  on public.media_asset_usages (asset_id, used_at desc);

create table if not exists public.menu_items (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  category_id text references public.media_categories(id) on delete set null,
  name text not null,
  description text,
  price_cents integer,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_items_workspace_idx on public.menu_items (workspace_id);

drop trigger if exists set_media_categories_updated_at on public.media_categories;
create trigger set_media_categories_updated_at
  before update on public.media_categories
  for each row execute function public.set_updated_at();

drop trigger if exists set_media_assets_updated_at on public.media_assets;
create trigger set_media_assets_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();

drop trigger if exists set_media_selections_updated_at on public.media_selections;
create trigger set_media_selections_updated_at
  before update on public.media_selections
  for each row execute function public.set_updated_at();

drop trigger if exists set_menu_items_updated_at on public.menu_items;
create trigger set_menu_items_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

alter table public.media_categories enable row level security;
alter table public.media_tags enable row level security;
alter table public.media_asset_tags enable row level security;
alter table public.media_asset_fb_uploads enable row level security;
alter table public.media_selections enable row level security;
alter table public.media_asset_usages enable row level security;
alter table public.menu_items enable row level security;

drop policy if exists media_categories_workspace_members on public.media_categories;
create policy media_categories_workspace_members on public.media_categories
  for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

drop policy if exists media_tags_workspace_members on public.media_tags;
create policy media_tags_workspace_members on public.media_tags
  for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

drop policy if exists media_asset_tags_workspace_members on public.media_asset_tags;
create policy media_asset_tags_workspace_members on public.media_asset_tags
  for all
  using (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_asset_tags.asset_id
        and public.current_user_has_workspace(ma.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_asset_tags.asset_id
        and public.current_user_has_workspace(ma.workspace_id)
    )
  );

drop policy if exists media_asset_fb_uploads_workspace_members on public.media_asset_fb_uploads;
create policy media_asset_fb_uploads_workspace_members on public.media_asset_fb_uploads
  for all
  using (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_asset_fb_uploads.asset_id
        and public.current_user_has_workspace(ma.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_asset_fb_uploads.asset_id
        and public.current_user_has_workspace(ma.workspace_id)
    )
  );

drop policy if exists media_selections_workspace_members on public.media_selections;
create policy media_selections_workspace_members on public.media_selections
  for all
  using (
    public.current_user_has_workspace(workspace_id)
    and (
      user_id = auth.uid()::text
      or exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = media_selections.workspace_id
          and wm.user_id = auth.uid()::text
          and wm.role in ('owner','admin')
          and wm.status = 'active'
      )
    )
  )
  with check (
    public.current_user_has_workspace(workspace_id)
    and (
      user_id = auth.uid()::text
      or exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = media_selections.workspace_id
          and wm.user_id = auth.uid()::text
          and wm.role in ('owner','admin')
          and wm.status = 'active'
      )
    )
  );

drop policy if exists media_asset_usages_workspace_members on public.media_asset_usages;
create policy media_asset_usages_workspace_members on public.media_asset_usages
  for all
  using (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_asset_usages.asset_id
        and public.current_user_has_workspace(ma.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_asset_usages.asset_id
        and public.current_user_has_workspace(ma.workspace_id)
    )
  );

drop policy if exists menu_items_workspace_members on public.menu_items;
create policy menu_items_workspace_members on public.menu_items
  for all
  using (public.current_user_has_workspace(workspace_id))
  with check (public.current_user_has_workspace(workspace_id));

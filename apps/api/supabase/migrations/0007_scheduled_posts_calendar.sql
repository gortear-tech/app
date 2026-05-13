create table if not exists public.scheduled_posts (
  id text primary key,
  workspace_id text not null,
  business_id text not null,
  batch_id text not null,
  variant_id text not null,
  page_id text not null,
  scheduled_for timestamptz not null,
  facebook_post_id text,
  remote_post_type text,
  remote_post_url text,
  delivery_mode text not null,
  graph_api_version text,
  publish_lead_seconds integer,
  scheduled_for_unix bigint,
  status text not null,
  remote_status text not null,
  retry_count integer not null default 0,
  last_remote_sync_at timestamptz,
  remote_error_code text,
  remote_trace_id text,
  caption text,
  image_url text,
  style_id text,
  style_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_posts_business_id_idx
  on public.scheduled_posts (workspace_id, business_id);

create index if not exists scheduled_posts_batch_id_idx
  on public.scheduled_posts (workspace_id, batch_id);

create index if not exists scheduled_posts_page_id_idx
  on public.scheduled_posts (page_id);

create index if not exists scheduled_posts_scheduled_for_idx
  on public.scheduled_posts (scheduled_for);

create index if not exists scheduled_posts_status_idx
  on public.scheduled_posts (status);

create index if not exists scheduled_posts_remote_status_idx
  on public.scheduled_posts (remote_status);

create unique index if not exists scheduled_posts_variant_active_idx
  on public.scheduled_posts (workspace_id, variant_id)
  where status <> 'cancelada';

create unique index if not exists scheduled_posts_facebook_post_id_idx
  on public.scheduled_posts (workspace_id, facebook_post_id)
  where facebook_post_id is not null;

alter table public.scheduled_posts enable row level security;

drop policy if exists scheduled_posts_workspace_members on public.scheduled_posts;
create policy scheduled_posts_workspace_members on public.scheduled_posts
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = scheduled_posts.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

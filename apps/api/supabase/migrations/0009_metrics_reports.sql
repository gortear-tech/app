create table public.metric_definitions (
  id text primary key,
  provider text not null check (provider in ('fbmaniaco', 'meta')),
  canonical_metric text not null,
  provider_metric_name text,
  graph_api_version text,
  value_type text not null check (value_type in ('count', 'rate', 'duration', 'currency')),
  status text not null check (status in ('active', 'deprecated', 'unavailable')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  notes text
);

insert into public.metric_definitions
  (id, provider, canonical_metric, provider_metric_name, graph_api_version, value_type, status, effective_from, notes)
values
  (
    'metric-fbmaniaco-publish-success-v1',
    'fbmaniaco',
    'publish_success',
    null,
    null,
    'count',
    'active',
    '2026-05-01T00:00:00.000Z',
    'Publicaciones confirmadas por FBmaniaco.'
  ),
  (
    'metric-fbmaniaco-publish-failure-v1',
    'fbmaniaco',
    'publish_failure',
    null,
    null,
    'count',
    'active',
    '2026-05-01T00:00:00.000Z',
    'Publicaciones fallidas o inciertas en FBmaniaco.'
  ),
  (
    'metric-fbmaniaco-week-coverage-v1',
    'fbmaniaco',
    'week_coverage',
    null,
    null,
    'rate',
    'active',
    '2026-05-01T00:00:00.000Z',
    'Cobertura semanal de publicaciones programadas o publicadas.'
  ),
  (
    'metric-meta-engagements-v23-unavailable',
    'meta',
    'engagements',
    'post_engaged_users',
    'v23.0',
    'count',
    'unavailable',
    '2026-05-01T00:00:00.000Z',
    'Insights Meta degradados hasta configurar permisos reales.'
  )
on conflict (id) do nothing;

create unique index metric_definitions_provider_name_version_idx
  on public.metric_definitions (
    provider,
    coalesce(provider_metric_name, canonical_metric),
    coalesce(graph_api_version, 'internal'),
    effective_from
  );

create index metric_definitions_canonical_status_idx
  on public.metric_definitions (canonical_metric, status);

create table public.post_metric_snapshots (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  business_id text not null references public.businesses(id) on delete cascade,
  scheduled_post_id text not null references public.scheduled_posts(id) on delete cascade,
  facebook_post_id text,
  metric_definition_id text not null references public.metric_definitions(id),
  provider text not null check (provider in ('fbmaniaco', 'meta')),
  canonical_metric text not null,
  provider_metric_name text,
  metric_window text not null check (metric_window in ('24h', '72h', '7d', 'lifetime')),
  value numeric not null,
  collected_at timestamptz not null default now(),
  observed_until timestamptz not null,
  collection_status text not null check (collection_status in ('ok', 'partial', 'unavailable', 'deprecated', 'permission_error')),
  source_version text,
  raw_ref text
);

create index post_metric_snapshots_post_window_idx
  on public.post_metric_snapshots (scheduled_post_id, metric_window, collected_at);

create index post_metric_snapshots_business_metric_idx
  on public.post_metric_snapshots (business_id, canonical_metric, metric_window, collected_at);

create table public.performance_summaries (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  business_id text not null references public.businesses(id) on delete cascade,
  scope text not null check (scope in ('business_week', 'style', 'time_slot', 'caption_pattern', 'content_type')),
  scope_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  sample_size integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  confidence text not null check (confidence in ('exploratoria', 'media', 'alta')),
  reason_codes text[] not null default '{}',
  generated_at timestamptz not null default now()
);

create index performance_summaries_business_period_idx
  on public.performance_summaries (business_id, period_start, period_end, scope);

create table public.weekly_reports (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  business_id text not null references public.businesses(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  confidence text not null check (confidence in ('exploratoria', 'media', 'alta')),
  sample_size integer not null default 0,
  sections jsonb not null,
  reason_codes text[] not null default '{}',
  generated_at timestamptz not null default now()
);

create index weekly_reports_business_generated_idx
  on public.weekly_reports (business_id, generated_at desc);

alter table public.metric_definitions enable row level security;
alter table public.post_metric_snapshots enable row level security;
alter table public.performance_summaries enable row level security;
alter table public.weekly_reports enable row level security;

create policy metric_definitions_authenticated_read
  on public.metric_definitions for select
  to authenticated
  using (true);

create policy post_metric_snapshots_member_read
  on public.post_metric_snapshots for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = post_metric_snapshots.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

create policy performance_summaries_member_read
  on public.performance_summaries for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = performance_summaries.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

create policy weekly_reports_member_read
  on public.weekly_reports for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = weekly_reports.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

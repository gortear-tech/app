create extension if not exists pgcrypto;

create table if not exists public.users (
  id text primary key,
  email text not null,
  display_name text,
  status text not null default 'activo',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.workspaces (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  owner_user_id text not null references public.users(id) on delete restrict,
  plan text,
  billing_status text not null default 'trial',
  entitlements jsonb not null default '{}'::jsonb,
  status text not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete restrict,
  user_id text not null references public.users(id) on delete restrict,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.facebook_pages (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  meta_page_id text not null,
  page_name text not null,
  page_access_token_status text not null default 'requiere_reconexion',
  encrypted_page_access_token text,
  page_access_token_key_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  facebook_page_id text references public.facebook_pages(id) on delete restrict,
  name text not null,
  timezone text not null default 'America/Mexico_City',
  token_status text not null default 'requiere_reconexion',
  metadata jsonb not null default '{}'::jsonb,
  autonomy_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  actor_id text references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key default gen_random_uuid()::text,
  type text not null,
  status text not null,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text references public.businesses(id) on delete restrict,
  batch_id text,
  photo_id text,
  variant_id text,
  scheduled_post_id text,
  dedupe_key text not null,
  operation_key text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  request_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  last_attempt_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists facebook_pages_workspace_meta_page_idx
  on public.facebook_pages(workspace_id, meta_page_id);

create unique index if not exists businesses_active_page_idx
  on public.businesses(workspace_id, facebook_page_id)
  where facebook_page_id is not null;

create index if not exists workspaces_owner_user_id_idx on public.workspaces(owner_user_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workspace_members_workspace_id_idx on public.workspace_members(workspace_id);
create index if not exists audit_logs_workspace_created_idx on public.audit_logs(workspace_id, created_at);
create index if not exists jobs_status_run_after_idx on public.jobs(status, run_after);
create index if not exists jobs_workspace_status_idx on public.jobs(workspace_id, status);
create unique index if not exists jobs_active_dedupe_idx
  on public.jobs(type, dedupe_key)
  where status in ('queued', 'running', 'blocked', 'needs_user_action');
create unique index if not exists jobs_operation_key_idx
  on public.jobs(operation_key)
  where operation_key is not null and status in ('queued', 'running', 'blocked', 'needs_user_action');

create table if not exists public.job_attempts (
  id text primary key default gen_random_uuid()::text,
  job_id text not null references public.jobs(id) on delete restrict,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  attempt_number integer not null,
  status text not null,
  operation_key text,
  provider text,
  provider_request_id text,
  provider_resource_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

create unique index if not exists job_attempts_job_attempt_idx
  on public.job_attempts(job_id, attempt_number);
create index if not exists job_attempts_workspace_idx on public.job_attempts(workspace_id);

create table if not exists public.idempotency_records (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  actor_id text references public.users(id) on delete set null,
  method text not null,
  route_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists idempotency_records_key_idx
  on public.idempotency_records(workspace_id, actor_id, method, route_key, idempotency_key);

create table if not exists public.outbox_events (
  id text primary key default gen_random_uuid()::text,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text references public.businesses(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists outbox_events_status_available_idx
  on public.outbox_events(status, available_at);

create or replace function public.current_user_has_workspace(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()::text
      and wm.status = 'active'
  );
$$;

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.facebook_pages enable row level security;
alter table public.businesses enable row level security;
alter table public.audit_logs enable row level security;
alter table public.jobs enable row level security;
alter table public.job_attempts enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.outbox_events enable row level security;

drop policy if exists users_self_read on public.users;
create policy users_self_read on public.users
  for select using (id = auth.uid()::text);

drop policy if exists workspaces_member_read on public.workspaces;
create policy workspaces_member_read on public.workspaces
  for select using (public.current_user_has_workspace(id));

drop policy if exists workspace_members_member_read on public.workspace_members;
create policy workspace_members_member_read on public.workspace_members
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists facebook_pages_member_read on public.facebook_pages;
create policy facebook_pages_member_read on public.facebook_pages
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists businesses_member_read on public.businesses;
create policy businesses_member_read on public.businesses
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists jobs_member_read on public.jobs;
create policy jobs_member_read on public.jobs
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists job_attempts_member_read on public.job_attempts;
create policy job_attempts_member_read on public.job_attempts
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists audit_logs_member_read on public.audit_logs;
create policy audit_logs_member_read on public.audit_logs
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists idempotency_records_member_read on public.idempotency_records;
create policy idempotency_records_member_read on public.idempotency_records
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists outbox_events_member_read on public.outbox_events;
create policy outbox_events_member_read on public.outbox_events
  for select using (public.current_user_has_workspace(workspace_id));

create table if not exists public.meta_authorizations (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  actor_id text references public.users(id) on delete set null,
  status text not null,
  granted_scopes jsonb not null default '[]'::jsonb,
  declined_scopes jsonb not null default '[]'::jsonb,
  missing_required_scopes jsonb not null default '[]'::jsonb,
  granted_page_ids jsonb not null default '[]'::jsonb,
  app_mode text not null default 'unknown',
  app_review_status text not null default 'unknown',
  graph_api_version text not null default 'v23.0',
  token_status text not null default 'requiere_reconexion',
  encrypted_access_token text,
  token_key_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.facebook_pages
  add column if not exists meta_authorization_id text references public.meta_authorizations(id) on delete set null,
  add column if not exists cover_photo_url text,
  add column if not exists category text,
  add column if not exists tasks jsonb not null default '[]'::jsonb,
  add column if not exists is_granted boolean not null default false,
  add column if not exists is_selected boolean not null default false,
  add column if not exists can_publish boolean not null default false,
  add column if not exists granted_scopes jsonb not null default '[]'::jsonb,
  add column if not exists declined_scopes jsonb not null default '[]'::jsonb;

create table if not exists public.external_operations (
  operation_key text primary key,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  job_id text references public.jobs(id) on delete set null,
  provider text not null,
  operation text not null,
  status text not null,
  provider_request_id text,
  provider_resource_id text,
  idempotency_key_sent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_authorizations_workspace_idx
  on public.meta_authorizations(workspace_id);
create index if not exists meta_authorizations_status_idx
  on public.meta_authorizations(status);
create index if not exists external_operations_workspace_idx
  on public.external_operations(workspace_id);
create index if not exists external_operations_status_idx
  on public.external_operations(status);

alter table public.meta_authorizations enable row level security;
alter table public.external_operations enable row level security;

drop policy if exists meta_authorizations_member_read on public.meta_authorizations;
create policy meta_authorizations_member_read on public.meta_authorizations
  for select using (public.current_user_has_workspace(workspace_id));

drop policy if exists external_operations_member_read on public.external_operations;
create policy external_operations_member_read on public.external_operations
  for select using (public.current_user_has_workspace(workspace_id));

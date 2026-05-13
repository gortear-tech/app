create table if not exists public.model_profiles (
  id text primary key,
  task text not null,
  provider text not null,
  primary_model text not null,
  fallback_model text,
  reasoning_effort text,
  text_verbosity text,
  schema_version text not null,
  timeout_ms integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_templates (
  id text primary key,
  task text not null,
  prompt_version text not null,
  stable_instructions text not null,
  schema_version text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text references public.businesses(id) on delete restrict,
  job_id text not null references public.jobs(id) on delete restrict,
  operation_key text not null,
  provider text not null,
  model text not null,
  model_profile_id text not null,
  prompt_template_id text not null,
  prompt_version text not null,
  schema_version text not null,
  input_hash text not null,
  output_hash text not null,
  response_id text,
  usage jsonb,
  latency_ms integer not null,
  status text not null,
  error_code text,
  request_id text,
  created_at timestamptz not null default now()
);

alter table public.model_profiles enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.ai_runs enable row level security;

create unique index if not exists prompt_templates_task_version_idx on public.prompt_templates(task, prompt_version);
create index if not exists ai_runs_workspace_job_idx on public.ai_runs(workspace_id, job_id);
create index if not exists ai_runs_operation_key_idx on public.ai_runs(operation_key);

create policy model_profiles_member_read on public.model_profiles
  for select using (true);

create policy prompt_templates_member_read on public.prompt_templates
  for select using (true);

create policy ai_runs_member_read on public.ai_runs
  for select using (public.current_user_has_workspace(workspace_id));

insert into public.model_profiles (id, task, provider, primary_model, reasoning_effort, text_verbosity, schema_version, timeout_ms, status)
values ('vision-default-v1', 'vision', 'openai', 'gpt-5.5', 'low', 'low', 'vision_analysis.v1', 30000, 'active')
on conflict (id) do nothing;

insert into public.prompt_templates (id, task, prompt_version, stable_instructions, schema_version, status)
values (
  'photo-vision-analysis',
  'vision',
  'vision-analysis-v1',
  'Analiza solo datos observables de la imagen para crear publicaciones de Facebook. No inventes precios, promociones, disponibilidad ni claims comerciales.',
  'vision_analysis.v1',
  'active'
)
on conflict (id) do nothing;

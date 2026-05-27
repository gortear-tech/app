create table if not exists public.batch_stage_timings (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete restrict,
  business_id text not null references public.businesses(id) on delete restrict,
  batch_id text not null references public.batches(id) on delete restrict,
  stage text not null check (stage in (
    'upload',
    'variant_generation',
    'review',
    'scheduling',
    'publish_execution'
  )),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms bigint,
  counters jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, stage)
);

create index if not exists batch_stage_timings_workspace_business_idx
  on public.batch_stage_timings(workspace_id, business_id, started_at desc);

create index if not exists batch_stage_timings_stage_status_idx
  on public.batch_stage_timings(stage, status, completed_at desc);

alter table public.batch_stage_timings enable row level security;

drop policy if exists batch_stage_timings_workspace_members on public.batch_stage_timings;
create policy batch_stage_timings_workspace_members on public.batch_stage_timings
  for all using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = batch_stage_timings.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = batch_stage_timings.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

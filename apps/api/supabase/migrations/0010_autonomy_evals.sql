create table public.ai_evaluations (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  business_id text not null references public.businesses(id) on delete cascade,
  task text not null check (task in ('caption')),
  dataset_id text not null,
  baseline_prompt_template_id text not null,
  candidate_prompt_template_id text not null,
  status text not null check (status in ('passed', 'failed')),
  metrics jsonb not null default '{}'::jsonb,
  failed_criteria text[] not null default '{}',
  rollout_recommendation text not null check (rollout_recommendation in ('promote_canary', 'retain_baseline')),
  used_batch_mode boolean not null default true,
  created_at timestamptz not null default now()
);

create index ai_evaluations_task_created_idx
  on public.ai_evaluations (task, created_at desc);

create index ai_evaluations_business_created_idx
  on public.ai_evaluations (business_id, created_at desc);

alter table public.ai_evaluations enable row level security;

create policy ai_evaluations_member_read
  on public.ai_evaluations for select
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = ai_evaluations.workspace_id
        and wm.user_id = auth.uid()::text
        and wm.status = 'active'
    )
  );

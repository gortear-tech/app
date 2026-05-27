create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  service text not null default 'worker',
  environment text not null,
  release text not null,
  status text not null check (status in ('starting', 'idle', 'processing', 'stopping', 'error')),
  last_beat_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists worker_heartbeats_last_beat_at_idx
  on public.worker_heartbeats (last_beat_at desc);

create index if not exists worker_heartbeats_status_idx
  on public.worker_heartbeats (status);

alter table public.worker_heartbeats enable row level security;

update public.job_attempts ja
set status = 'failed',
    finished_at = now(),
    error = 'batch_terminal'
where ja.status = 'running'
  and exists (
    select 1
    from public.jobs j
    join public.batches b on b.id = j.batch_id
    where j.id = ja.job_id
      and b.status in ('abandonado', 'abandoned', 'cancelado', 'cancelled')
      and j.status in ('queued', 'running', 'blocked', 'needs_user_action')
  );

update public.jobs j
set status = 'cancelled',
    last_error = 'batch_terminal',
    updated_at = now()
from public.batches b
where b.id = j.batch_id
  and b.status in ('abandonado', 'abandoned', 'cancelado', 'cancelled')
  and j.status in ('queued', 'running', 'blocked', 'needs_user_action');

update public.job_attempts ja
set status = 'failed',
    finished_at = now(),
    error = 'publish_job_lease_expired'
where ja.status = 'running'
  and exists (
    select 1
    from public.jobs j
    where j.id = ja.job_id
      and j.type = 'publish_post'
      and j.status = 'running'
      and coalesce(j.lease_expires_at, j.locked_at + interval '60 seconds') < now()
  );

update public.scheduled_posts sp
set status = 'estado_incierto',
    remote_status = 'incierto',
    remote_error_code = 'publish_job_lease_expired',
    updated_at = now()
from public.jobs j
where j.type = 'publish_post'
  and j.status = 'running'
  and coalesce(j.lease_expires_at, j.locked_at + interval '60 seconds') < now()
  and j.payload->>'scheduledPostId' = sp.id
  and sp.status not in ('publicada', 'published', 'cancelada', 'cancelled');

update public.jobs
set status = 'needs_user_action',
    last_error = 'publish_job_lease_expired',
    updated_at = now()
where type = 'publish_post'
  and status = 'running'
  and coalesce(lease_expires_at, locked_at + interval '60 seconds') < now();

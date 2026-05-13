create table public.worker_heartbeats (
  worker_id text primary key,
  service text not null default 'worker',
  environment text not null,
  release text not null,
  status text not null,
  last_beat_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index worker_heartbeats_last_beat_at_idx
  on public.worker_heartbeats (last_beat_at desc);

create index worker_heartbeats_status_idx
  on public.worker_heartbeats (status);

alter table public.worker_heartbeats enable row level security;


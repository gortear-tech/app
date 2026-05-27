create table if not exists public.mobile_device_sessions (
  device_key_hash text primary key,
  user_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text
);

create index if not exists mobile_device_sessions_user_id_idx
  on public.mobile_device_sessions(user_id);

alter table public.mobile_device_sessions enable row level security;

drop policy if exists mobile_device_sessions_service_only on public.mobile_device_sessions;
create policy mobile_device_sessions_service_only on public.mobile_device_sessions
  for all
  using (false)
  with check (false);

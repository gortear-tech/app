create table if not exists public.cadencia_meta_sessions (
  id text primary key,
  long_lived_user_token text not null,
  connected_at timestamptz not null default now(),
  expires_at timestamptz,
  user_info jsonb not null default jsonb_build_object(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cadencia_meta_sessions enable row level security;


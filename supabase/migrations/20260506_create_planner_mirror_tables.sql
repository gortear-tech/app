create table if not exists public.businesses (
  id text primary key,
  facebook_page_id text not null unique,
  name text,
  industry text,
  timezone text,
  token_status text,
  metadata jsonb not null default '{}'::jsonb,
  autonomy_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batches (
  id text primary key,
  business_id text not null,
  status text not null,
  photos_count integer not null default 0,
  variants_count integer not null default 0,
  estimated_cost_usd double precision,
  confirmed_cost_usd double precision,
  last_activity_at timestamptz not null default now(),
  variants_per_photo integer not null default 1,
  photo_ids jsonb not null default '[]'::jsonb,
  variant_ids jsonb not null default '[]'::jsonb,
  scheduled_post_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists batches_business_id_idx on public.batches (business_id);

create table if not exists public.photos (
  id text primary key,
  batch_id text not null,
  file_name text,
  storage_key text,
  upload_url text,
  status text not null,
  vision_analysis jsonb,
  assigned_style jsonb,
  editing_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists photos_batch_id_idx on public.photos (batch_id);

create table if not exists public.variants (
  id text primary key,
  batch_id text not null,
  photo_id text not null,
  style_id text not null,
  generation_plan jsonb,
  prompt_used text,
  image_url text,
  caption text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists variants_batch_id_idx on public.variants (batch_id);
create index if not exists variants_photo_id_idx on public.variants (photo_id);

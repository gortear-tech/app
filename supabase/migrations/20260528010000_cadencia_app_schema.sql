create table if not exists public.cadencia_pages (
  id text primary key,
  fb_page_id text not null unique,
  name text not null,
  category text not null default '',
  cover_url text not null default '',
  profile_url text not null default '',
  page_access_token text,
  settings jsonb not null default jsonb_build_object(
    'seoKeywords',
    jsonb_build_array(),
    'businessHours',
    jsonb_build_object('start', '09:00', 'end', '20:00'),
    'preferredImageModels',
    jsonb_build_array('gpt_image_2'),
    'defaultContextMode',
    'ai',
    'skipReviewDefault',
    false
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cadencia_photos (
  id text primary key default gen_random_uuid()::text,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  storage_path text not null,
  thumbnail_url text not null,
  context text,
  context_source text check (context_source in ('ai', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cadencia_photos_context_source_requires_context check (
    (context is null and context_source is null)
    or (context is not null and context_source is not null)
  )
);

create table if not exists public.cadencia_batches (
  id text primary key default gen_random_uuid()::text,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'generating', 'awaiting_review', 'scheduling', 'publishing', 'archived', 'failed')
  ),
  variants_per_photo int not null check (variants_per_photo between 1 and 10),
  distribution_days int not null default 1 check (distribution_days >= 1),
  skip_review boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.cadencia_variants (
  id text primary key default gen_random_uuid()::text,
  batch_id text not null references public.cadencia_batches (id) on delete cascade,
  source_photo_id text not null references public.cadencia_photos (id) on delete restrict,
  variant_type text not null default 'ai_image' check (variant_type in ('ai_image', 'canva_image', 'ai_video')),
  style text not null,
  generated_image_path text,
  generated_text text,
  user_text_override text,
  status text not null default 'pending' check (
    status in ('pending', 'generating', 'ready', 'approved', 'rejected', 'scheduled', 'published', 'failed')
  ),
  scheduled_at timestamptz,
  fb_post_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.cadencia_styles_history (
  id text primary key default gen_random_uuid()::text,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  style text not null,
  batch_id text references public.cadencia_batches (id) on delete cascade,
  used_at timestamptz not null default now()
);

create table if not exists public.cadencia_calendar_items (
  id text primary key default gen_random_uuid()::text,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  variant_id text references public.cadencia_variants (id) on delete set null,
  title text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'published')),
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists cadencia_photos_page_id_created_at_idx
  on public.cadencia_photos (page_id, created_at desc);

create index if not exists cadencia_batches_page_id_created_at_idx
  on public.cadencia_batches (page_id, created_at desc);

create index if not exists cadencia_variants_batch_id_status_idx
  on public.cadencia_variants (batch_id, status);

create index if not exists cadencia_styles_history_page_id_used_at_idx
  on public.cadencia_styles_history (page_id, used_at desc);

create index if not exists cadencia_calendar_items_page_id_scheduled_at_idx
  on public.cadencia_calendar_items (page_id, scheduled_at);

alter table public.cadencia_pages enable row level security;
alter table public.cadencia_photos enable row level security;
alter table public.cadencia_batches enable row level security;
alter table public.cadencia_variants enable row level security;
alter table public.cadencia_styles_history enable row level security;
alter table public.cadencia_calendar_items enable row level security;

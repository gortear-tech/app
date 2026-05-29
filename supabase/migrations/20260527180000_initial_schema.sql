create extension if not exists pgcrypto;

create type public.context_source as enum ('ai', 'manual');
create type public.batch_status as enum (
  'queued',
  'generating',
  'awaiting_review',
  'scheduling',
  'publishing',
  'archived',
  'failed'
);
create type public.variant_status as enum (
  'pending',
  'generating',
  'ready',
  'approved',
  'rejected',
  'scheduled',
  'published',
  'failed'
);
create type public.variant_type as enum ('ai_image', 'canva_image', 'ai_video');
create type public.calendar_status as enum ('scheduled', 'published');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  fb_user_id text unique,
  long_lived_user_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  fb_page_id text not null unique,
  name text not null,
  category text not null default '',
  cover_url text not null default '',
  profile_url text not null default '',
  page_access_token text,
  settings jsonb not null default jsonb_build_object(
    'seo_keywords',
    jsonb_build_array(),
    'business_hours',
    jsonb_build_object('start', '09:00', 'end', '20:00'),
    'preferred_image_models',
    jsonb_build_array('gpt_image_2'),
    'default_context_mode',
    'ai',
    'skip_review_default',
    false
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  storage_path text not null,
  context text,
  context_source public.context_source,
  created_at timestamptz not null default now(),
  constraint photos_context_source_requires_context check (
    (context is null and context_source is null)
    or (context is not null and context_source is not null)
  )
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  status public.batch_status not null default 'queued',
  variants_per_photo int not null check (variants_per_photo between 1 and 10),
  distribution_days int not null default 1 check (distribution_days >= 1),
  skip_review boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id) on delete cascade,
  source_photo_id uuid not null references public.photos (id) on delete restrict,
  variant_type public.variant_type not null default 'ai_image',
  style text not null,
  generated_image_path text,
  generated_text text,
  user_text_override text,
  status public.variant_status not null default 'pending',
  scheduled_at timestamptz,
  fb_post_id text,
  created_at timestamptz not null default now()
);

create table public.styles_history (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  style text not null,
  batch_id uuid not null references public.batches (id) on delete cascade,
  used_at timestamptz not null default now()
);

create table public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  variant_id uuid references public.variants (id) on delete set null,
  title text not null,
  status public.calendar_status not null default 'scheduled',
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index pages_user_id_idx on public.pages (user_id);
create index photos_page_id_created_at_idx on public.photos (page_id, created_at desc);
create index batches_page_id_created_at_idx on public.batches (page_id, created_at desc);
create index variants_batch_id_status_idx on public.variants (batch_id, status);
create index styles_history_page_id_used_at_idx on public.styles_history (page_id, used_at desc);
create index calendar_items_page_id_scheduled_at_idx on public.calendar_items (page_id, scheduled_at);

alter table public.users enable row level security;
alter table public.pages enable row level security;
alter table public.photos enable row level security;
alter table public.batches enable row level security;
alter table public.variants enable row level security;
alter table public.styles_history enable row level security;
alter table public.calendar_items enable row level security;

create policy "Users can read and update themselves"
  on public.users
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Users can access their pages"
  on public.pages
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can access photos from their pages"
  on public.photos
  for all
  using (
    exists (
      select 1
      from public.pages
      where pages.id = photos.page_id
        and pages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.pages
      where pages.id = photos.page_id
        and pages.user_id = auth.uid()
    )
  );

create policy "Users can access batches from their pages"
  on public.batches
  for all
  using (
    exists (
      select 1
      from public.pages
      where pages.id = batches.page_id
        and pages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.pages
      where pages.id = batches.page_id
        and pages.user_id = auth.uid()
    )
  );

create policy "Users can access variants through their batches"
  on public.variants
  for all
  using (
    exists (
      select 1
      from public.batches
      join public.pages on pages.id = batches.page_id
      where batches.id = variants.batch_id
        and pages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.batches
      join public.pages on pages.id = batches.page_id
      where batches.id = variants.batch_id
        and pages.user_id = auth.uid()
    )
  );

create policy "Users can access style history from their pages"
  on public.styles_history
  for all
  using (
    exists (
      select 1
      from public.pages
      where pages.id = styles_history.page_id
        and pages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.pages
      where pages.id = styles_history.page_id
        and pages.user_id = auth.uid()
    )
  );

create policy "Users can access calendar items from their pages"
  on public.calendar_items
  for all
  using (
    exists (
      select 1
      from public.pages
      where pages.id = calendar_items.page_id
        and pages.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.pages
      where pages.id = calendar_items.page_id
        and pages.user_id = auth.uid()
    )
  );


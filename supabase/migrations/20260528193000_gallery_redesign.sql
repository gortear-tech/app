create extension if not exists vector;

alter table public.cadencia_pages
  alter column settings set default jsonb_build_object(
    'seoKeywords',
    jsonb_build_array(),
    'businessHours',
    jsonb_build_object('start', '09:00', 'end', '20:00'),
    'preferredImageModels',
    jsonb_build_array('gpt_image_2'),
    'defaultContextMode',
    'ai',
    'skipReviewDefault',
    false,
    'gallery',
    jsonb_build_object(
      'taxonomy',
      jsonb_build_array(
        'producto',
        'ambiente',
        'personas',
        'proceso',
        'exterior',
        'evento',
        'detalle',
        'behind_the_scenes',
        'promocional',
        'otro'
      ),
      'namingLanguage',
      'es',
      'duplicatePolicy',
      'block',
      'stackTimeWindowMinutes',
      5,
      'qualityThresholds',
      jsonb_build_object(
        'blur',
        0.42,
        'exposureMin',
        0.18,
        'exposureMax',
        0.92,
        'minResolution',
        1200000
      )
    )
  );

update public.cadencia_pages
set settings = settings || jsonb_build_object(
  'gallery',
  coalesce(
    settings->'gallery',
    jsonb_build_object(
      'taxonomy',
      jsonb_build_array(
        'producto',
        'ambiente',
        'personas',
        'proceso',
        'exterior',
        'evento',
        'detalle',
        'behind_the_scenes',
        'promocional',
        'otro'
      ),
      'namingLanguage',
      'es',
      'duplicatePolicy',
      'block',
      'stackTimeWindowMinutes',
      5,
      'qualityThresholds',
      jsonb_build_object(
        'blur',
        0.42,
        'exposureMin',
        0.18,
        'exposureMax',
        0.92,
        'minResolution',
        1200000
      )
    )
  )
);

alter table public.cadencia_photos
  add column if not exists file_hash text,
  add column if not exists perceptual_hash text,
  add column if not exists name text,
  add column if not exists name_source text not null default 'ai'
    check (name_source in ('ai', 'manual')),
  add column if not exists description text,
  add column if not exists alt_text text,
  add column if not exists category text not null default 'otro',
  add column if not exists tags text[] not null default '{}',
  add column if not exists is_favorite boolean not null default false,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived', 'trashed')),
  add column if not exists trashed_at timestamptz,
  add column if not exists quality_score jsonb not null default jsonb_build_object(
    'blur',
    0.8,
    'exposure',
    0.7,
    'resolution',
    0
  ),
  add column if not exists low_quality boolean not null default false,
  add column if not exists stack_id text,
  add column if not exists stack_is_primary boolean not null default true,
  add column if not exists exif jsonb not null default '{}'::jsonb,
  add column if not exists taken_at timestamptz not null default now(),
  add column if not exists origin text not null default 'phone_gallery'
    check (origin in ('app_gallery', 'phone_gallery', 'external')),
  add column if not exists manual_override boolean not null default false;

update public.cadencia_photos
set
  name = coalesce(name, 'Foto del ' || to_char(created_at, 'YYYY-MM-DD')),
  description = coalesce(description, context),
  alt_text = coalesce(alt_text, description, context, name),
  taken_at = coalesce(taken_at, created_at);

alter table public.cadencia_photos
  alter column name set not null;

create table if not exists public.cadencia_photo_stacks (
  id text primary key default gen_random_uuid()::text,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  primary_photo_id text references public.cadencia_photos (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.cadencia_photos
  add constraint cadencia_photos_stack_id_fkey
  foreign key (stack_id)
  references public.cadencia_photo_stacks (id)
  on delete set null
  not valid;

alter table public.cadencia_photos
  validate constraint cadencia_photos_stack_id_fkey;

create table if not exists public.cadencia_photo_embeddings (
  photo_id text primary key references public.cadencia_photos (id) on delete cascade,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  embedding vector(512) not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cadencia_albums (
  id text primary key default gen_random_uuid()::text,
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  name text not null,
  kind text not null default 'manual' check (kind in ('manual', 'auto')),
  rule jsonb,
  cover_photo_id text references public.cadencia_photos (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cadencia_album_items (
  album_id text not null references public.cadencia_albums (id) on delete cascade,
  photo_id text not null references public.cadencia_photos (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (album_id, photo_id)
);

create unique index if not exists cadencia_photos_page_file_hash_uidx
  on public.cadencia_photos (page_id, file_hash)
  where file_hash is not null and manual_override = false;

create index if not exists cadencia_photos_page_status_taken_at_idx
  on public.cadencia_photos (page_id, status, taken_at desc);

create index if not exists cadencia_photos_page_category_idx
  on public.cadencia_photos (page_id, category);

create index if not exists cadencia_photos_page_tags_idx
  on public.cadencia_photos using gin (tags);

create index if not exists cadencia_photos_page_perceptual_hash_idx
  on public.cadencia_photos (page_id, perceptual_hash);

create index if not exists cadencia_photo_embeddings_page_embedding_idx
  on public.cadencia_photo_embeddings
  using hnsw (embedding vector_cosine_ops);

create index if not exists cadencia_photo_embeddings_page_id_idx
  on public.cadencia_photo_embeddings (page_id);

create index if not exists cadencia_photo_stacks_page_id_idx
  on public.cadencia_photo_stacks (page_id);

create index if not exists cadencia_albums_page_id_idx
  on public.cadencia_albums (page_id);

alter table public.cadencia_photo_stacks enable row level security;
alter table public.cadencia_photo_embeddings enable row level security;
alter table public.cadencia_albums enable row level security;
alter table public.cadencia_album_items enable row level security;

alter table public.cadencia_batches
  drop constraint if exists cadencia_batches_status_check;

alter table public.cadencia_batches
  add constraint cadencia_batches_status_check check (
    status in (
      'draft',
      'queued',
      'generating',
      'awaiting_review',
      'scheduling',
      'publishing',
      'archived',
      'failed'
    )
  );

alter table public.cadencia_batches
  add column if not exists selected_photo_ids text[] not null default '{}',
  add column if not exists pending_uploads jsonb not null default '[]'::jsonb,
  add column if not exists context_mode_overrides jsonb not null default '{}'::jsonb,
  add column if not exists cancelled_by_user boolean not null default false,
  add column if not exists failed_reason text,
  add column if not exists short_label text,
  add column if not exists accent_color text,
  add column if not exists updated_at timestamptz not null default now();

update public.cadencia_batches
set
  failed_reason = coalesce(failed_reason, failure_reason),
  short_label = coalesce(short_label, 'Lote ' || upper(substr(id, 1, 1))),
  accent_color = coalesce(accent_color, '#8EC5FF')
where failed_reason is null
  or short_label is null
  or accent_color is null;

alter table public.cadencia_variants
  add column if not exists failed_reason text;

create table if not exists public.scheduling_history (
  id uuid primary key default gen_random_uuid(),
  page_id text not null references public.cadencia_pages (id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  hour int not null check (hour between 0 and 23),
  score numeric not null default 0,
  last_updated timestamptz not null default now(),
  unique (page_id, day_of_week, hour)
);

create or replace function public.set_cadencia_batch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cadencia_batches_updated_at on public.cadencia_batches;
create trigger cadencia_batches_updated_at
before update on public.cadencia_batches
for each row execute function public.set_cadencia_batch_updated_at();

create or replace function public.bump_scheduling_history_from_variant()
returns trigger
language plpgsql
as $$
declare
  owning_page_id text;
  slot timestamptz;
  monday_first int;
begin
  if new.status not in ('scheduled', 'published') or new.scheduled_at is null then
    return new;
  end if;

  select b.page_id
    into owning_page_id
    from public.cadencia_batches b
    where b.id = new.batch_id;

  if owning_page_id is null then
    return new;
  end if;

  slot := new.scheduled_at;
  monday_first := (extract(dow from slot)::int + 6) % 7;

  insert into public.scheduling_history (page_id, day_of_week, hour, score, last_updated)
  values (owning_page_id, monday_first, extract(hour from slot)::int, 1, now())
  on conflict (page_id, day_of_week, hour)
  do update set
    score = public.scheduling_history.score + 1,
    last_updated = now();

  return new;
end;
$$;

drop trigger if exists cadencia_variants_scheduling_history on public.cadencia_variants;
create trigger cadencia_variants_scheduling_history
after insert or update of status, scheduled_at on public.cadencia_variants
for each row execute function public.bump_scheduling_history_from_variant();

create index if not exists cadencia_batches_active_page_idx
  on public.cadencia_batches (page_id, updated_at desc)
  where status in ('queued', 'generating', 'awaiting_review', 'scheduling', 'publishing');

create index if not exists cadencia_batches_draft_purge_idx
  on public.cadencia_batches (updated_at)
  where status = 'draft';

create index if not exists scheduling_history_page_score_idx
  on public.scheduling_history (page_id, score desc, last_updated desc);

alter table public.scheduling_history enable row level security;

notify pgrst, 'reload schema';

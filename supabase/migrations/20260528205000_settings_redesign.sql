create table if not exists public.user_settings (
  user_id text primary key,
  display_name text not null default 'Usuario de Cadencia',
  email text not null default '',
  language text not null default 'es' check (language in ('es', 'en')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  region text not null default 'MX',
  default_timezone text not null default 'auto',
  notifications jsonb not null default jsonb_build_object(
    'batch_completed', jsonb_build_object('push', true, 'email', false),
    'variant_rejected', jsonb_build_object('push', true, 'email', false),
    'publish_succeeded', jsonb_build_object('push', false, 'email', false),
    'generation_error', jsonb_build_object('push', true, 'email', true),
    'fb_token_expiring', jsonb_build_object('push', true, 'email', true),
    'openai_quota_warning', jsonb_build_object('push', true, 'email', true),
    'weekly_summary', jsonb_build_object('push', false, 'email', true)
  ),
  quiet_hours jsonb,
  beta_features text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings_audit (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  page_id text references public.cadencia_pages (id) on delete cascade,
  path text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now(),
  device_id text
);

alter table public.cadencia_pages
  add column if not exists meta_disconnected_at timestamptz;

alter table public.cadencia_pages
  alter column settings set default jsonb_build_object(
    'brand', jsonb_build_object(
      'voice', 'amigable',
      'voice_custom', '',
      'default_hashtags', jsonb_build_array(),
      'default_mentions', jsonb_build_array(),
      'signature', '',
      'brand_colors', jsonb_build_array(),
      'logo_url', null
    ),
    'generation', jsonb_build_object(
      'default_variants_per_photo', 3,
      'skip_review_default', false,
      'default_context_mode', 'ai',
      'image_model', 'gpt_image_2',
      'text_model', 'gpt_4o_mini',
      'posting_language', 'inherit',
      'seo_keywords', jsonb_build_array(),
      'prompt_suffix', ''
    ),
    'styles', jsonb_build_object(
      'active',
      jsonb_build_array(
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
        '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'
      ),
      'custom',
      jsonb_build_array()
    ),
    'scheduling', jsonb_build_object(
      'timezone', 'inherit',
      'business_hours', jsonb_build_object('start', '09:00', 'end', '20:00'),
      'active_days', jsonb_build_array('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'),
      'min_gap_minutes', 60,
      'max_posts_per_day', 4,
      'start_today_or_tomorrow', 'tomorrow',
      'distribute_evenly', true
    ),
    'gallery', jsonb_build_object(
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
      'naming_language', 'es',
      'duplicate_policy', 'block',
      'stack_time_window_minutes', 5,
      'quality_thresholds', jsonb_build_object(
        'blur', 0.42,
        'exposureMin', 0.18,
        'exposureMax', 0.92,
        'minResolution', 1200000
      ),
      'auto_archive_after_days', 0,
      'default_sort', 'recent'
    ),
    'notifications', jsonb_build_object(
      'batch_completed', 'inherit',
      'variant_rejected', 'inherit',
      'publish_succeeded', 'inherit',
      'generation_error', 'inherit',
      'fb_token_expiring', 'inherit',
      'openai_quota_warning', 'inherit',
      'weekly_summary', 'inherit'
    )
  );

update public.cadencia_pages
set settings =
  jsonb_build_object(
    'brand', coalesce(settings->'brand', jsonb_build_object(
      'voice', 'amigable',
      'voice_custom', '',
      'default_hashtags', jsonb_build_array(),
      'default_mentions', jsonb_build_array(),
      'signature', '',
      'brand_colors', jsonb_build_array(),
      'logo_url', null
    )),
    'generation', coalesce(settings->'generation', jsonb_build_object(
      'default_variants_per_photo', 3,
      'skip_review_default', coalesce(settings->'skipReviewDefault', 'false'::jsonb),
      'default_context_mode', coalesce(settings->'defaultContextMode', '"ai"'::jsonb),
      'image_model', coalesce(settings->'preferredImageModels'->0, '"gpt_image_2"'::jsonb),
      'text_model', 'gpt_4o_mini',
      'posting_language', 'inherit',
      'seo_keywords', coalesce(settings->'seoKeywords', jsonb_build_array()),
      'prompt_suffix', ''
    )),
    'styles', coalesce(settings->'styles', jsonb_build_object(
      'active',
      jsonb_build_array(
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
        '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'
      ),
      'custom',
      jsonb_build_array()
    )),
    'scheduling', coalesce(settings->'scheduling', jsonb_build_object(
      'timezone', 'inherit',
      'business_hours', coalesce(settings->'businessHours', jsonb_build_object('start', '09:00', 'end', '20:00')),
      'active_days', jsonb_build_array('lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'),
      'min_gap_minutes', 60,
      'max_posts_per_day', 4,
      'start_today_or_tomorrow', 'tomorrow',
      'distribute_evenly', true
    )),
    'gallery', jsonb_build_object(
      'taxonomy',
      coalesce(settings#>'{gallery,taxonomy}', jsonb_build_array(
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
      )),
      'naming_language', coalesce(
        settings#>'{gallery,naming_language}',
        settings#>'{gallery,namingLanguage}',
        '"es"'::jsonb
      ),
      'duplicate_policy', coalesce(
        settings#>'{gallery,duplicate_policy}',
        settings#>'{gallery,duplicatePolicy}',
        '"block"'::jsonb
      ),
      'stack_time_window_minutes', coalesce(
        settings#>'{gallery,stack_time_window_minutes}',
        settings#>'{gallery,stackTimeWindowMinutes}',
        '5'::jsonb
      ),
      'quality_thresholds', coalesce(
        settings#>'{gallery,quality_thresholds}',
        settings#>'{gallery,qualityThresholds}',
        jsonb_build_object(
        'blur', 0.42,
        'exposureMin', 0.18,
        'exposureMax', 0.92,
        'minResolution', 1200000
        )
      ),
      'auto_archive_after_days', coalesce(
        settings#>'{gallery,auto_archive_after_days}',
        settings#>'{gallery,autoArchiveAfterDays}',
        '0'::jsonb
      ),
      'default_sort', coalesce(
        settings#>'{gallery,default_sort}',
        settings#>'{gallery,defaultSort}',
        '"recent"'::jsonb
      )
    ),
    'notifications', coalesce(settings->'notifications', jsonb_build_object(
      'batch_completed', 'inherit',
      'variant_rejected', 'inherit',
      'publish_succeeded', 'inherit',
      'generation_error', 'inherit',
      'fb_token_expiring', 'inherit',
      'openai_quota_warning', 'inherit',
      'weekly_summary', 'inherit'
    ))
  );

create or replace function public.set_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_settings_updated_at();

create or replace function public.audit_page_settings_change()
returns trigger
language plpgsql
as $$
begin
  if old.settings is distinct from new.settings then
    insert into public.settings_audit (user_id, page_id, path, old_value, new_value, device_id)
    values ('meta-user', new.id, 'pages.settings', old.settings, new.settings, current_setting('request.headers', true)::jsonb->>'x-device-id');
  end if;

  return new;
exception
  when others then
    insert into public.settings_audit (user_id, page_id, path, old_value, new_value)
    values ('meta-user', new.id, 'pages.settings', old.settings, new.settings);
    return new;
end;
$$;

create or replace function public.audit_user_settings_change()
returns trigger
language plpgsql
as $$
begin
  insert into public.settings_audit (user_id, page_id, path, old_value, new_value, device_id)
  values (
    new.user_id,
    null,
    'user_settings',
    to_jsonb(old),
    to_jsonb(new),
    current_setting('request.headers', true)::jsonb->>'x-device-id'
  );

  return new;
exception
  when others then
    insert into public.settings_audit (user_id, page_id, path, old_value, new_value)
    values (new.user_id, null, 'user_settings', to_jsonb(old), to_jsonb(new));
    return new;
end;
$$;

drop trigger if exists cadencia_pages_settings_audit on public.cadencia_pages;
create trigger cadencia_pages_settings_audit
after update of settings on public.cadencia_pages
for each row execute function public.audit_page_settings_change();

drop trigger if exists user_settings_audit on public.user_settings;
create trigger user_settings_audit
after update on public.user_settings
for each row execute function public.audit_user_settings_change();

create index if not exists settings_audit_user_changed_idx
  on public.settings_audit (user_id, changed_at desc);

create index if not exists settings_audit_page_changed_idx
  on public.settings_audit (page_id, changed_at desc)
  where page_id is not null;

alter table public.user_settings enable row level security;
alter table public.settings_audit enable row level security;

drop policy if exists "Users can manage their settings"
  on public.user_settings;
create policy "Users can manage their settings"
  on public.user_settings
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

drop policy if exists "Users can read their settings audit"
  on public.settings_audit;
create policy "Users can read their settings audit"
  on public.settings_audit
  for select
  using (user_id = auth.uid()::text);

notify pgrst, 'reload schema';

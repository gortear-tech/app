create unique index if not exists menu_items_workspace_lower_name_unique
  on public.menu_items (workspace_id, lower(name));

create index if not exists media_assets_workspace_phash_ready_idx
  on public.media_assets (workspace_id, phash)
  where phash is not null and archived_at is null and status = 'ready';

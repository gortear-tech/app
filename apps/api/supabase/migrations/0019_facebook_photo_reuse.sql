alter table public.scheduled_posts
  add column if not exists fb_photo_id text,
  add column if not exists fb_photo_reused boolean;

create index if not exists scheduled_posts_fb_photo_id_idx
  on public.scheduled_posts (workspace_id, fb_photo_id)
  where fb_photo_id is not null;

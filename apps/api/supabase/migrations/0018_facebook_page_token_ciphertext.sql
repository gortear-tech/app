alter table public.facebook_pages
  add column if not exists encrypted_page_access_token_ciphertext bytea,
  add column if not exists page_access_token_encryption_version text not null default 'legacy_base64';

create index if not exists facebook_pages_token_encryption_version_idx
  on public.facebook_pages(page_access_token_encryption_version);

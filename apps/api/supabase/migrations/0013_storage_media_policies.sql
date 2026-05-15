drop policy if exists "fbmaniaco media service insert" on storage.objects;
drop policy if exists "fbmaniaco media service select" on storage.objects;
drop policy if exists "fbmaniaco media service update" on storage.objects;
drop policy if exists "fbmaniaco media service delete" on storage.objects;

drop policy if exists "fbmaniaco media insert" on storage.objects;
create policy "fbmaniaco media insert"
  on storage.objects
  for insert
  to anon, authenticated, service_role
  with check (bucket_id = 'fbmaniaco-media');

drop policy if exists "fbmaniaco media select" on storage.objects;
create policy "fbmaniaco media select"
  on storage.objects
  for select
  to anon, authenticated, service_role
  using (bucket_id = 'fbmaniaco-media');

drop policy if exists "fbmaniaco media update" on storage.objects;
create policy "fbmaniaco media update"
  on storage.objects
  for update
  to service_role
  using (bucket_id = 'fbmaniaco-media')
  with check (bucket_id = 'fbmaniaco-media');

drop policy if exists "fbmaniaco media delete" on storage.objects;
create policy "fbmaniaco media delete"
  on storage.objects
  for delete
  to service_role
  using (bucket_id = 'fbmaniaco-media');

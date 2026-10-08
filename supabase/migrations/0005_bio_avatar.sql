-- Profiles bio + public avatars bucket.
-- Run via API or SQL Editor.

alter table profiles add column if not exists bio text check (char_length(bio) <= 300);
alter table profiles add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars readable by all" on storage.objects;
create policy "avatars readable by all" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "users upload own avatar" on storage.objects;
create policy "users upload own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update own avatar" on storage.objects;
create policy "users update own avatar" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own avatar" on storage.objects;
create policy "users delete own avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text);

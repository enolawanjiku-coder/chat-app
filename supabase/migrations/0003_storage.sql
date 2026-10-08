-- Private chat-images bucket policies (Blueprint 2 §9).
-- Run in Supabase SQL Editor after 0001 + 0002.
-- Create the bucket first (Storage > New bucket > chat-images, Private).
-- If the bucket already exists this insert is a no-op.

insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

drop policy if exists "members read images" on storage.objects;
create policy "members read images" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-images'
         and is_member((storage.foldername(name))[1]::uuid));

drop policy if exists "members upload images" on storage.objects;
create policy "members upload images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-images'
         and is_member((storage.foldername(name))[1]::uuid));

drop policy if exists "members delete images" on storage.objects;
create policy "members delete images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images'
         and is_member((storage.foldername(name))[1]::uuid));

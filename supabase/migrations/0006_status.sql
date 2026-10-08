-- 24-hour photo statuses (WhatsApp-style).
-- Client filters expires_at > now(); owners can delete.
-- Run via API or SQL Editor.

create table if not exists statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  image_path text not null,
  caption text check (char_length(caption) <= 200),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '24 hours')
);
create index if not exists statuses_user_created_idx on statuses (user_id, created_at desc);

alter table statuses enable row level security;

drop policy if exists "authenticated read live statuses" on statuses;
create policy "authenticated read live statuses" on statuses
  for select to authenticated using (expires_at > now());

drop policy if exists "users post own status" on statuses;
create policy "users post own status" on statuses
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "users delete own status" on statuses;
create policy "users delete own status" on statuses
  for delete to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('status-media', 'status-media', false)
on conflict (id) do nothing;

drop policy if exists "authenticated read status media" on storage.objects;
create policy "authenticated read status media" on storage.objects
  for select to authenticated using (bucket_id = 'status-media');

drop policy if exists "users upload status media" on storage.objects;
create policy "users upload status media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete status media" on storage.objects;
create policy "users delete status media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'status-media'
    and (storage.foldername(name))[1] = auth.uid()::text);

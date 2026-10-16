-- Stickers: emoji (body) or saved images (stickers bucket, public).
-- Run via API or SQL Editor.

alter table messages drop constraint if exists messages_type_check;
alter table messages add constraint messages_type_check check (type in ('text','image','audio','system','sticker'));

create table if not exists stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  image_path text not null,
  created_at timestamptz default now()
);
create index if not exists stickers_user_idx on stickers (user_id, created_at desc);

alter table stickers enable row level security;

drop policy if exists "users manage own stickers" on stickers;
create policy "users manage own stickers" on stickers
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('stickers', 'stickers', true)
on conflict (id) do nothing;

drop policy if exists "stickers readable by all" on storage.objects;
create policy "stickers readable by all" on storage.objects
  for select using (bucket_id = 'stickers');

drop policy if exists "users upload own stickers" on storage.objects;
create policy "users upload own stickers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own stickers" on storage.objects;
create policy "users delete own stickers" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stickers'
    and (storage.foldername(name))[1] = auth.uid()::text);

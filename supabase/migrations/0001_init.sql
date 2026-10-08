-- Substack Connect v1 schema (Blueprint 2)
-- Run in Supabase SQL editor or as migration

-- PROFILES
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url text,
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

-- CONVERSATIONS
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  name text,
  avatar_url text,
  created_by uuid references profiles(id),
  direct_key text unique,
  created_at timestamptz default now()
);

-- MEMBERS
create table if not exists conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz default now(),
  last_read_at timestamptz default now(),
  primary key (conversation_id, user_id)
);

-- MESSAGES
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  type text not null default 'text' check (type in ('text','image')),
  body text check (char_length(body) <= 4000),
  image_path text,
  reply_to uuid references messages(id),
  created_at timestamptz default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists messages_conv_created_idx on messages (conversation_id, created_at desc);

-- BLOCKS
create table if not exists blocks (
  blocker_id uuid references profiles(id) on delete cascade,
  blocked_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);

-- RLS
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table blocks enable row level security;

create or replace function is_member(conv uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

create or replace function is_admin(conv uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = conv and user_id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles readable by logged in users" on profiles;
create policy "profiles readable by logged in users" on profiles
  for select to authenticated using (true);
drop policy if exists "users insert own profile" on profiles;
create policy "users insert own profile" on profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles
  for update to authenticated using (id = auth.uid());

drop policy if exists "members read conversations" on conversations;
create policy "members read conversations" on conversations
  for select to authenticated using (is_member(id));
drop policy if exists "authenticated create conversations" on conversations;
create policy "authenticated create conversations" on conversations
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "admins update conversations" on conversations;
create policy "admins update conversations" on conversations
  for update to authenticated using (is_admin(id));

drop policy if exists "members read membership" on conversation_members;
create policy "members read membership" on conversation_members
  for select to authenticated using (is_member(conversation_id));
drop policy if exists "admins add members or self-join on create" on conversation_members;
create policy "admins add members or self-join on create" on conversation_members
  for insert to authenticated
  with check (is_admin(conversation_id) or user_id = auth.uid());
drop policy if exists "leave or admin remove" on conversation_members;
create policy "leave or admin remove" on conversation_members
  for delete to authenticated
  using (user_id = auth.uid() or is_admin(conversation_id));
drop policy if exists "update own read marker" on conversation_members;
create policy "update own read marker" on conversation_members
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "members read messages" on messages;
create policy "members read messages" on messages
  for select to authenticated using (is_member(conversation_id));
drop policy if exists "members send messages" on messages;
create policy "members send messages" on messages
  for insert to authenticated
  with check (is_member(conversation_id) and sender_id = auth.uid());
drop policy if exists "sender edits own messages" on messages;
create policy "sender edits own messages" on messages
  for update to authenticated using (sender_id = auth.uid());

drop policy if exists "manage own blocks" on blocks;
create policy "manage own blocks" on blocks
  for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- RPC: direct conversation (atomic, prevents duplicates)
create or replace function create_direct_conversation(other_user uuid)
returns uuid language plpgsql security definer as $$
declare
  me uuid := auth.uid();
  key text;
  conv_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user = me then raise exception 'cannot chat with self'; end if;
  if exists (select 1 from blocks where (blocker_id = me and blocked_id = other_user) or (blocker_id = other_user and blocked_id = me)) then
    raise exception 'blocked';
  end if;
  key := (select string_agg(x::text, '_' order by x::text) from (select me as x union all select other_user) s);
  select id into conv_id from conversations where direct_key = key;
  if conv_id is not null then return conv_id; end if;
  insert into conversations (type, created_by, direct_key) values ('direct', me, key) returning id into conv_id;
  insert into conversation_members (conversation_id, user_id, role) values (conv_id, me, 'admin'), (conv_id, other_user, 'member');
  return conv_id;
end;
$$;

-- RPC: group creation
create or replace function create_group(group_name text, member_ids uuid[])
returns uuid language plpgsql security definer as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  mid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if group_name is null or char_length(group_name) < 1 or char_length(group_name) > 60 then
    raise exception 'invalid group name';
  end if;
  insert into conversations (type, name, created_by) values ('group', group_name, me) returning id into conv_id;
  insert into conversation_members (conversation_id, user_id, role) values (conv_id, me, 'admin');
  foreach mid in array coalesce(member_ids, '{}') loop
    if mid != me then
      insert into conversation_members (conversation_id, user_id, role) values (conv_id, mid, 'member') on conflict do nothing;
    end if;
  end loop;
  return conv_id;
end;
$$;

-- Storage bucket must be created once (private): insert into storage.buckets (id, name, public) values ('chat-images','chat-images', false) on conflict do nothing;

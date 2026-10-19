-- Music: shared YouTube listening sessions + private Realtime authorization.
-- Safe to re-run. Apply after 0001..0013.

-- ── Shared session snapshot (at most one active session per conversation) ───
-- Deliberately reuses conversations.id; it is NOT a new conversation store.
create table if not exists public.music_sessions (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  video_id        text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  is_playing      boolean not null default false,
  position_s      double precision not null default 0 check (position_s >= 0),
  queue           jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(queue) = 'array' and jsonb_array_length(queue) <= 100),
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.music_sessions enable row level security;

drop policy if exists "members read music sessions" on public.music_sessions;
create policy "members read music sessions" on public.music_sessions
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "members write music sessions" on public.music_sessions;
create policy "members write music sessions" on public.music_sessions
  for insert to authenticated
  with check (public.is_member(conversation_id) and (updated_by is null or updated_by = auth.uid()));

drop policy if exists "members update music sessions" on public.music_sessions;
create policy "members update music sessions" on public.music_sessions
  for update to authenticated
  using (public.is_member(conversation_id))
  with check (public.is_member(conversation_id) and (updated_by is null or updated_by = auth.uid()));

drop policy if exists "members delete music sessions" on public.music_sessions;
create policy "members delete music sessions" on public.music_sessions
  for delete to authenticated using (public.is_member(conversation_id));

-- membership lookups used by the Realtime authorization checks below
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

-- ── Realtime topic authorization helpers ────────────────────────────────────
-- "<prefix>:<conversation uuid>" -> caller is a member of that conversation.
-- SECURITY DEFINER so it can read members without recursing through RLS.
create or replace function public.can_access_conversation_topic(topic text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  parts text[];
  conv uuid;
begin
  if topic is null then return false; end if;
  parts := string_to_array(topic, ':');
  if array_length(parts, 1) <> 2 then return false; end if;
  if parts[1] not in ('music','call','typing','presence','messages','read') then return false; end if;
  begin
    conv := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
end;
$$;

-- "reactions:<message uuid>" -> caller is a member of that message's conversation.
create or replace function public.can_access_message_topic(topic text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  parts text[];
  mid uuid;
  conv uuid;
begin
  if topic is null then return false; end if;
  parts := string_to_array(topic, ':');
  if array_length(parts, 1) <> 2 or parts[1] <> 'reactions' then return false; end if;
  begin
    mid := parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  select m.conversation_id into conv from public.messages m where m.id = mid;
  if conv is null then return false; end if;
  return exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
end;
$$;

-- ── Realtime Authorization policies for private channels ────────────────────
-- NOTE: do NOT run "alter table realtime.messages enable row level security" —
-- RLS is already on and non-owners get "must be owner of table messages".
-- These policies only take effect once public access is disabled in
-- Dashboard → Project Settings → Realtime, but they are harmless otherwise.
drop policy if exists "authorized read realtime topics" on realtime.messages;
create policy "authorized read realtime topics" on realtime.messages
  for select to authenticated
  using (
    (select realtime.topic()) = 'chat-page-bump'
    or public.can_access_conversation_topic((select realtime.topic()))
    or public.can_access_message_topic((select realtime.topic()))
  );

drop policy if exists "authorized write realtime topics" on realtime.messages;
create policy "authorized write realtime topics" on realtime.messages
  for insert to authenticated
  with check (
    public.can_access_conversation_topic((select realtime.topic()))
    or public.can_access_message_topic((select realtime.topic()))
  );

-- Emoji reactions (v2 feature).
-- Run in Supabase SQL Editor after 0003_storage.sql.

create table if not exists message_reactions (
  message_id uuid references messages(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 8),
  created_at timestamptz default now(),
  primary key (message_id, user_id, emoji)
);

alter table message_reactions enable row level security;

drop policy if exists "members read reactions" on message_reactions;
create policy "members read reactions" on message_reactions
  for select to authenticated using (
    exists (
      select 1 from messages m
      where m.id = message_reactions.message_id
        and is_member(m.conversation_id)
    )
  );

drop policy if exists "members add reactions" on message_reactions;
create policy "members add reactions" on message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from messages m
      where m.id = message_reactions.message_id
        and is_member(m.conversation_id)
    )
  );

drop policy if exists "members remove own reactions" on message_reactions;
create policy "members remove own reactions" on message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- Realtime for reactions
alter publication supabase_realtime add table message_reactions;

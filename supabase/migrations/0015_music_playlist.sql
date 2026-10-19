-- Shared YouTube listening in the chat: adds playlist/history support on top of
-- the conversation-scoped session from 0014. Safe to re-run. Apply after 0014.

alter table public.music_sessions add column if not exists title text;
alter table public.music_sessions add column if not exists playlist_id text;
alter table public.music_sessions
  add column if not exists history jsonb not null default '[]'::jsonb
  check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 100);

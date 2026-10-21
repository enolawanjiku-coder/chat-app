-- Host-only control for the shared YouTube session.
-- The host is the member who started the current video; only they can
-- play/pause/seek/skip/queue, and the session ends for everyone when they leave.
-- Safe to re-run. Apply after 0014 and 0015.

alter table public.music_sessions
  add column if not exists host_id uuid references public.profiles(id) on delete set null;

-- Existing sessions: treat the last writer as the host so playback keeps working.
update public.music_sessions
  set host_id = updated_by
  where host_id is null and updated_by is not null;

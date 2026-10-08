-- Call history logs (signaling itself stays on Realtime Broadcast).
-- Clients insert on ring, update on answer/decline/end/timeout.
-- Run via API or SQL Editor.

create table if not exists call_logs (
  id uuid primary key default gen_random_uuid(),
  call_id text unique not null,
  conversation_id uuid not null references conversations(id) on delete cascade,
  caller_id uuid not null references profiles(id) on delete cascade,
  callee_id uuid references profiles(id) on delete cascade,
  call_type text not null default 'voice' check (call_type in ('voice','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','missed','ended')),
  started_at timestamptz default now(),
  ended_at timestamptz,
  duration_s integer
);
create index if not exists call_logs_conv_idx on call_logs (conversation_id, started_at desc);

alter table call_logs enable row level security;

drop policy if exists "members read call logs" on call_logs;
create policy "members read call logs" on call_logs
  for select to authenticated using (is_member(conversation_id));

drop policy if exists "members write call logs" on call_logs;
create policy "members write call logs" on call_logs
  for insert to authenticated
  with check (is_member(conversation_id) and caller_id = auth.uid());

drop policy if exists "members update call logs" on call_logs;
create policy "members update call logs" on call_logs
  for update to authenticated using (is_member(conversation_id));

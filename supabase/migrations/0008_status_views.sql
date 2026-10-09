-- Who viewed each status (WhatsApp-style view receipts).
-- Run via API or SQL Editor.

create table if not exists status_views (
  status_id uuid references statuses(id) on delete cascade,
  viewer_id uuid references profiles(id) on delete cascade,
  viewed_at timestamptz default now(),
  primary key (status_id, viewer_id)
);

alter table status_views enable row level security;

-- viewers can record their own view of any live status
drop policy if exists "viewers record own view" on status_views;
create policy "viewers record own view" on status_views
  for insert to authenticated
  with check (
    viewer_id = auth.uid()
    and exists (select 1 from statuses s where s.id = status_views.status_id and s.expires_at > now())
  );

-- status owners can see who viewed
drop policy if exists "owners see views" on status_views;
create policy "owners see views" on status_views
  for select to authenticated using (
    exists (select 1 from statuses s where s.id = status_views.status_id and s.user_id = auth.uid())
  );

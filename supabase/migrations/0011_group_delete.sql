-- Allow group admins to delete their conversations (cascades to members/messages).
-- Run via API or SQL Editor.

drop policy if exists "admins delete conversations" on conversations;
create policy "admins delete conversations" on conversations
  for delete to authenticated using (is_admin(id));

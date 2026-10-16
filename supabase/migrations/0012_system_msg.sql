-- System messages (call history entries inside chats, etc).
-- Run via API or SQL Editor.

alter table messages drop constraint if exists messages_type_check;
alter table messages add constraint messages_type_check check (type in ('text','image','audio','system'));

-- Voice notes: allow audio messages.
-- Run via API or SQL Editor.

alter table messages add column if not exists audio_path text;
alter table messages drop constraint if exists messages_type_check;
alter table messages add constraint messages_type_check check (type in ('text','image','audio'));

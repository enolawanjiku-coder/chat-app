-- Screen sharing: approve private Realtime signaling on "screen:<conversation uuid>".
-- Safe to re-run. Apply after 0001..0015.
--
-- Only WebRTC signaling (offers/answers/ICE) travels over Realtime. The shared
-- video/audio itself is peer-to-peer and never stored or relayed by Supabase.
create or replace function public.can_access_conversation_topic(topic text)
returns boolean language plpgsql security definer stable set search_path = public as $$
declare
  parts text[];
  conv uuid;
begin
  if topic is null then return false; end if;
  parts := string_to_array(topic, ':');
  if array_length(parts, 1) <> 2 then return false; end if;
  if parts[1] not in ('music','call','typing','presence','messages','read','screen') then return false; end if;
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

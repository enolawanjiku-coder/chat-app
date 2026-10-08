-- Auto-create profiles on signup so email-confirmation ON/OFF both work.
-- Run this in Supabase SQL Editor after 0001_init.sql.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(new.email, '@', 1)
  );
  -- sanitize to match profiles.username check
  uname := lower(regexp_replace(uname, '[^a-z0-9_]', '_', 'g'));
  if char_length(uname) < 3 then uname := 'user_' || substr(new.id::text, 1, 8); end if;
  uname := substr(uname, 1, 20);

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    uname,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), uname)
  )
  on conflict (id) do nothing;

  return new;
exception when unique_violation then
  -- username taken: fall back to unique suffix so signup never fails here.
  -- User can fix it in the "finish setup" banner in ChatPage.
  insert into public.profiles (id, username, display_name)
  values (new.id, 'user_' || substr(new.id::text, 1, 8), uname)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

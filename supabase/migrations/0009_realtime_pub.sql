-- Make sure realtime subscriptions used by the app actually stream.
-- (message_reactions was added in 0004.)
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table conversation_members;
exception when duplicate_object then null;
end $$;

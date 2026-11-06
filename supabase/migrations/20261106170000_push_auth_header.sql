-- Passing Notes: send the project's publishable key with each notification request,
-- so the notify-tag function accepts the call even if JWT verification is still on.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.

create or replace function public.queue_tag_push() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.channel = 'ooc' and new.ref_post_id is not null
     and coalesce(array_length(new.tagged_character_ids, 1), 0) > 0 then
    perform net.http_post(
      url := 'https://lkuzjmwgwnnwenkhfmbm.supabase.co/functions/v1/notify-tag',
      body := jsonb_build_object('post_id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_Q1JZZLILE0QBM_Dr7lp_sw_EalJXYi4',
        'Authorization', 'Bearer sb_publishable_Q1JZZLILE0QBM_Dr7lp_sw_EalJXYi4'
      )
    );
  end if;
  return new;
end $$;

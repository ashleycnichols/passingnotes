-- Passing Notes: tag notifications + deleting characters.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Push notifications
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

alter table public.posts add column if not exists push_sent_at timestamptz;

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null,
  endpoint      text not null unique check (char_length(endpoint) <= 1000),
  p256dh        text not null check (char_length(p256dh) <= 200),
  auth          text not null check (char_length(auth) <= 100),
  character_ids uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists push_subscriptions_chars on public.push_subscriptions using gin (character_ids);

-- Nobody reads or writes this table directly; only the functions below and the server.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(
  p_device_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_character_ids uuid[])
returns void language sql security definer set search_path = public as $$
  insert into push_subscriptions (device_id, endpoint, p256dh, auth, character_ids)
  values (p_device_id, p_endpoint, p_p256dh, p_auth, coalesce(p_character_ids, '{}'))
  on conflict (endpoint) do update
    set device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth,
        character_ids = excluded.character_ids, updated_at = now();
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.save_push_subscription(uuid, text, text, text, uuid[]) from public;
revoke all on function public.remove_push_subscription(text) from public;
grant execute on function public.save_push_subscription(uuid, text, text, text, uuid[]) to anon, authenticated;
grant execute on function public.remove_push_subscription(text) to anon, authenticated;

-- When a tag ping lands in OOC chat, ask the notify-tag function to send it.
create or replace function public.queue_tag_push() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.channel = 'ooc' and new.ref_post_id is not null
     and coalesce(array_length(new.tagged_character_ids, 1), 0) > 0 then
    perform net.http_post(
      url := 'https://lkuzjmwgwnnwenkhfmbm.supabase.co/functions/v1/notify-tag',
      body := jsonb_build_object('post_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return new;
end $$;

drop trigger if exists posts_queue_push on public.posts;
create trigger posts_queue_push after insert on public.posts
  for each row execute function public.queue_tag_push();

-- ---------------------------------------------------------------------------
-- 2. Deleting characters (soft delete: past posts keep their name and colour)
-- ---------------------------------------------------------------------------
alter table public.characters add column if not exists deleted_at timestamptz;
grant select (deleted_at) on public.characters to anon, authenticated;

create or replace function public.delete_character(p_character_id uuid, p_key uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update characters set deleted_at = now()
   where id = p_character_id and owner_key = p_key and deleted_at is null;
  if not found then
    return false;
  end if;
  delete from scene_characters where character_id = p_character_id;
  update push_subscriptions set character_ids = array_remove(character_ids, p_character_id)
   where p_character_id = any(character_ids);
  return true;
end $$;

revoke all on function public.delete_character(uuid, uuid) from public;
grant execute on function public.delete_character(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

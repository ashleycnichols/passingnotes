-- Passing Notes: tag pings in OOC chat.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- An OOC ping points at the story post it is about. Deleting that post removes its pings.

alter table public.posts
  add column if not exists ref_post_id uuid references public.posts(id) on delete cascade;

create index if not exists posts_ref_post on public.posts (ref_post_id) where ref_post_id is not null;
create index if not exists posts_tagged on public.posts using gin (tagged_character_ids);

notify pgrst, 'reload schema';

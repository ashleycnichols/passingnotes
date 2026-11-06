-- Passing Notes: chapter breaks in the story.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('character', 'narrator', 'player', 'chapter'));

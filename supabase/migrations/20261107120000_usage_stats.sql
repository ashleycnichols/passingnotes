-- Passing Notes: private usage stats for the app owner.
-- 1. Change CHANGE-ME below to a passcode only you know (letters and numbers, no quotes).
-- 2. Paste into Supabase > SQL Editor > New query and press Run.
-- 3. Open the app at #/stats and enter that passcode.
-- To change the passcode later, edit the line and run this file again.

-- Keeps the other migrations' columns in place even if one was skipped.
alter table public.scenes add column if not exists view_slug text unique;
alter table public.characters add column if not exists deleted_at timestamptz;
alter table public.posts add column if not exists ref_post_id uuid references public.posts(id) on delete cascade;

-- A private settings table that the app's public key can never read.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_settings (key text primary key, value text not null);

insert into private.app_settings (key, value) values ('stats_code', 'CHANGE-ME')
on conflict (key) do update set value = excluded.value;

-- Returns totals, the last 7 days against the 7 before, a 30-day daily series,
-- universes and the most active scenes. Returns nothing without the right passcode.
create or replace function public.usage_stats(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  ok boolean;
  since timestamptz := date_trunc('day', now()) - interval '29 days';
begin
  select value = p_code and value <> 'CHANGE-ME' into ok from private.app_settings where key = 'stats_code';
  if not coalesce(ok, false) then
    return null;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'scenes',        (select count(*) from scenes),
      'characters',    (select count(*) from characters where deleted_at is null),
      'players',       (select count(distinct device_id) from scene_participants),
      'story_posts',   (select count(*) from posts where channel = 'story' and kind in ('character', 'narrator')),
      'ooc_posts',     (select count(*) from posts where channel = 'ooc' and ref_post_id is null),
      'chapters',      (select count(*) from posts where kind = 'chapter'),
      'universes',     (select count(distinct lower(trim(universe))) from scenes where coalesce(trim(universe), '') <> ''),
      'reader_links',  (select count(*) from scenes where view_slug is not null)
    ),
    'last7', (
      select jsonb_build_object(
        'new_scenes',     (select count(*) from scenes where created_at >= now() - interval '7 days'),
        'new_characters', (select count(*) from characters where created_at >= now() - interval '7 days'),
        'story_posts',    (select count(*) from posts where channel = 'story' and kind in ('character', 'narrator') and created_at >= now() - interval '7 days'),
        'active_scenes',  (select count(distinct scene_id) from posts where kind in ('character', 'narrator') and created_at >= now() - interval '7 days'),
        'active_writers', (select count(distinct author_device_id) from posts where created_at >= now() - interval '7 days')
      )
    ),
    'prev7', (
      select jsonb_build_object(
        'new_scenes',     (select count(*) from scenes where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'new_characters', (select count(*) from characters where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'story_posts',    (select count(*) from posts where channel = 'story' and kind in ('character', 'narrator') and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'active_scenes',  (select count(distinct scene_id) from posts where kind in ('character', 'narrator') and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'active_writers', (select count(distinct author_device_id) from posts where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days')
      )
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'posts', coalesce(p.n, 0), 'scenes', coalesce(s.n, 0)) order by d.day), '[]'::jsonb)
      from (select generate_series(since, date_trunc('day', now()), interval '1 day')::date as day) d
      left join (select created_at::date as day, count(*) as n from posts
                  where channel = 'story' and kind in ('character', 'narrator') and created_at >= since group by 1) p using (day)
      left join (select created_at::date as day, count(*) as n from scenes where created_at >= since group by 1) s using (day)
    ),
    'universes', (
      select coalesce(jsonb_agg(u order by u.scenes desc, u.name), '[]'::jsonb) from (
        select mode() within group (order by trim(sc.universe)) as name,
               count(distinct sc.id) as scenes,
               count(p.id) as posts
          from scenes sc
          left join posts p on p.scene_id = sc.id and p.kind in ('character', 'narrator')
         where coalesce(trim(sc.universe), '') <> ''
         group by lower(trim(sc.universe))
         order by 2 desc limit 10
      ) u
    ),
    'top_scenes', (
      select coalesce(jsonb_agg(t order by t.posts_30d desc), '[]'::jsonb) from (
        select sc.title, sc.universe,
               (select count(*) from scene_participants sp where sp.scene_id = sc.id) as players,
               count(p.id) as posts_30d,
               max(p.created_at) as last_post_at
          from scenes sc
          join posts p on p.scene_id = sc.id and p.kind in ('character', 'narrator') and p.created_at >= since
         group by sc.id
         order by 4 desc limit 5
      ) t
    )
  );
end $$;

revoke all on function public.usage_stats(text) from public;
grant execute on function public.usage_stats(text) to anon, authenticated;

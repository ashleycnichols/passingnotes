-- Passing Notes: count unique devices that open the app (readers and lurkers included).
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- Each device records "opened the app today" at most once a day: only its random ID and the date.
-- Past activity is filled in from scene joins and posts, so the history doesn't start at zero.

create table if not exists public.device_days (
  device_id uuid not null,
  day       date not null default current_date,
  primary key (device_id, day)
);
alter table public.device_days enable row level security;
revoke all on public.device_days from anon, authenticated;

create or replace function public.record_visit(p_device_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into device_days (device_id, day) values (p_device_id, current_date) on conflict do nothing;
$$;
revoke all on function public.record_visit(uuid) from public;
grant execute on function public.record_visit(uuid) to anon, authenticated;

-- Backfill from what's already in the database.
insert into device_days (device_id, day) select device_id, joined_at::date from scene_participants on conflict do nothing;
insert into device_days (device_id, day) select distinct author_device_id, created_at::date from posts on conflict do nothing;

-- The stats report, now with device numbers.
create or replace function public.usage_stats(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  ok boolean;
  since timestamptz := date_trunc('day', now()) - interval '29 days';
begin
  select coalesce(value, '') <> '' and lower(trim(value)) = lower(trim(coalesce(p_code, ''))) into ok
    from private.app_settings where key = 'stats_code';
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
      'reader_links',  (select count(*) from scenes where view_slug is not null),
      'devices_ever',  (select count(distinct device_id) from device_days),
      'devices_30d',   (select count(distinct device_id) from device_days where day >= current_date - 29)
    ),
    'last7', (
      select jsonb_build_object(
        'new_scenes',     (select count(*) from scenes where created_at >= now() - interval '7 days'),
        'new_characters', (select count(*) from characters where created_at >= now() - interval '7 days'),
        'story_posts',    (select count(*) from posts where channel = 'story' and kind in ('character', 'narrator') and created_at >= now() - interval '7 days'),
        'active_scenes',  (select count(distinct scene_id) from posts where kind in ('character', 'narrator') and created_at >= now() - interval '7 days'),
        'active_writers', (select count(distinct author_device_id) from posts where created_at >= now() - interval '7 days'),
        'devices',        (select count(distinct device_id) from device_days where day >= current_date - 6),
        'new_devices',    (select count(*) from (select device_id from device_days group by 1 having min(day) >= current_date - 6) f)
      )
    ),
    'prev7', (
      select jsonb_build_object(
        'new_scenes',     (select count(*) from scenes where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'new_characters', (select count(*) from characters where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'story_posts',    (select count(*) from posts where channel = 'story' and kind in ('character', 'narrator') and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'active_scenes',  (select count(distinct scene_id) from posts where kind in ('character', 'narrator') and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'active_writers', (select count(distinct author_device_id) from posts where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days'),
        'devices',        (select count(distinct device_id) from device_days where day between current_date - 13 and current_date - 7),
        'new_devices',    (select count(*) from (select device_id from device_days group by 1 having min(day) between current_date - 13 and current_date - 7) f)
      )
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'posts', coalesce(p.n, 0), 'scenes', coalesce(s.n, 0), 'devices', coalesce(v.n, 0)) order by d.day), '[]'::jsonb)
      from (select generate_series(since, date_trunc('day', now()), interval '1 day')::date as day) d
      left join (select created_at::date as day, count(*) as n from posts
                  where channel = 'story' and kind in ('character', 'narrator') and created_at >= since group by 1) p using (day)
      left join (select created_at::date as day, count(*) as n from scenes where created_at >= since group by 1) s using (day)
      left join (select day, count(*) as n from device_days where day >= since::date group by 1) v using (day)
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

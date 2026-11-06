-- Passing Notes: shared universe list for the dropdown.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- Returns each universe name once (case-insensitive), using its most common spelling.
-- Only universe names are shared, never scene titles or contents.

create or replace function public.list_universes()
returns table (name text, uses bigint)
language sql stable security definer set search_path = public as $$
  with u as (
    select trim(universe) as n from scenes where universe is not null and trim(universe) <> ''
    union all
    select trim(universe) from characters where universe is not null and trim(universe) <> ''
  )
  select mode() within group (order by n) as name, count(*) as uses
    from u
   group by lower(n)
   order by count(*) desc, 1
   limit 300;
$$;

revoke all on function public.list_universes() from public;
grant execute on function public.list_universes() to anon, authenticated;

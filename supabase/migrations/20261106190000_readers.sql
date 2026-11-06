-- Passing Notes: read-only links for people who want to read along.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- A scene gets a second, separate code. The read-only view never shows the player link.

alter table public.scenes add column if not exists view_slug text unique;

-- Create the read-only code the first time someone asks for it.
create or replace function public.ensure_view_slug(p_scene_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v text;
begin
  select view_slug into v from scenes where id = p_scene_id;
  if v is null then
    v := 'r' || translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', '-_');
    update scenes set view_slug = v where id = p_scene_id and view_slug is null;
    select view_slug into v from scenes where id = p_scene_id;
  end if;
  return v;
end $$;

-- Look up scenes by read-only code, leaving out the player link.
create or replace function public.get_scenes_for_viewer(p_views text[])
returns table (id uuid, title text, universe text, description text, theme text, font text,
               created_by_device uuid, created_at timestamptz, updated_at timestamptz,
               last_post_at timestamptz, view_slug text)
language sql stable security definer set search_path = public as $$
  select id, title, universe, description, theme, font, created_by_device, created_at, updated_at, last_post_at, view_slug
    from scenes where view_slug = any(p_views);
$$;

revoke all on function public.ensure_view_slug(uuid) from public;
revoke all on function public.get_scenes_for_viewer(text[]) from public;
grant execute on function public.ensure_view_slug(uuid) to anon, authenticated;
grant execute on function public.get_scenes_for_viewer(text[]) to anon, authenticated;

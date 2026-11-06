-- Passing Notes: honour-system character reclaim.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- Lets a player take back a character on a new device, as long as that character is in the scene.
-- The app posts a note in the scene's OOC chat whenever this happens.

create or replace function public.reclaim_character(p_character_id uuid, p_scene_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select c.owner_key
    from characters c
    join scene_characters sc on sc.character_id = c.id and sc.scene_id = p_scene_id
   where c.id = p_character_id;
$$;

revoke all on function public.reclaim_character(uuid, uuid) from public;
grant execute on function public.reclaim_character(uuid, uuid) to anon, authenticated;

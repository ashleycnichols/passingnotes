-- Passing Notes: delete a scene.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- Only the device that created a scene can delete it. Deleting removes its posts,
-- OOC chat and player list. Characters are kept so they can join other scenes.

create or replace function public.delete_scene(p_scene_id uuid, p_device_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from scenes where id = p_scene_id and created_by_device = p_device_id;
  return found;
end $$;

revoke all on function public.delete_scene(uuid, uuid) from public;
grant execute on function public.delete_scene(uuid, uuid) to anon, authenticated;

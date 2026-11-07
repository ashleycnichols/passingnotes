-- Passing Notes: limit scenes to 10 characters instead of 10 devices.
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to run again.
-- Any number of devices can join (so reclaiming or switching phones never uses up a slot),
-- but a scene holds at most 10 characters.

create or replace function public.join_scene(p_scene_id uuid, p_device_id uuid, p_player_name text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from scenes where id = p_scene_id) then
    return 'missing';
  end if;
  if exists (select 1 from scene_participants where scene_id = p_scene_id and device_id = p_device_id) then
    return 'already';
  end if;
  insert into scene_participants (scene_id, device_id, player_name)
    values (p_scene_id, p_device_id, nullif(trim(p_player_name), ''))
    on conflict (scene_id, device_id) do nothing;
  return 'joined';
end $$;

create or replace function public.enforce_character_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.scene_id::text));
  if (select count(*) from scene_characters where scene_id = new.scene_id) >= 10 then
    raise exception 'scene_full: this scene already has 10 characters';
  end if;
  return new;
end $$;

drop trigger if exists scene_characters_limit on public.scene_characters;
create trigger scene_characters_limit before insert on public.scene_characters
  for each row execute function public.enforce_character_limit();

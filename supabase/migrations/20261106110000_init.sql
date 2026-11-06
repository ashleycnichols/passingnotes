-- Passing Notes: database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run again: it only creates what is missing and refreshes the rules.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.scenes (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[A-Za-z0-9_-]{8,16}$'),
  title             text not null check (char_length(title) between 1 and 120),
  universe          text check (char_length(universe) <= 60),
  description       text check (char_length(description) <= 8000),
  theme             text not null default 'paper',
  font              text not null default 'lora',
  created_by_device uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_post_at      timestamptz
);

create table if not exists public.scene_participants (
  id          uuid primary key default gen_random_uuid(),
  scene_id    uuid not null references public.scenes(id) on delete cascade,
  device_id   uuid not null,
  player_name text check (char_length(player_name) <= 40),
  joined_at   timestamptz not null default now(),
  unique (scene_id, device_id)
);

create table if not exists public.characters (
  id                uuid primary key default gen_random_uuid(),
  owner_key         uuid not null,
  name              text not null check (char_length(name) between 1 and 60),
  color             text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  photo_url         text check (char_length(photo_url) <= 500),
  universe          text check (char_length(universe) <= 60),
  created_by_device uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.scene_characters (
  id             uuid primary key default gen_random_uuid(),
  scene_id       uuid not null references public.scenes(id) on delete cascade,
  character_id   uuid not null references public.characters(id) on delete cascade,
  added_by_device uuid,
  added_at       timestamptz not null default now(),
  unique (scene_id, character_id)
);

create table if not exists public.posts (
  id                   uuid primary key default gen_random_uuid(),
  scene_id             uuid not null references public.scenes(id) on delete cascade,
  channel              text not null default 'story' check (channel in ('story', 'ooc')),
  kind                 text not null check (kind in ('character', 'narrator', 'player')),
  character_id         uuid references public.characters(id) on delete set null,
  author_device_id     uuid not null,
  body                 text not null check (char_length(body) between 1 and 20000),
  tagged_character_ids uuid[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists posts_scene_channel_created on public.posts (scene_id, channel, created_at);
create index if not exists scene_characters_scene on public.scene_characters (scene_id);
create index if not exists scene_participants_scene on public.scene_participants (scene_id);

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists scenes_touch on public.scenes;
create trigger scenes_touch before update on public.scenes
  for each row execute function public.touch_updated_at();

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

drop trigger if exists characters_touch on public.characters;
create trigger characters_touch before update on public.characters
  for each row execute function public.touch_updated_at();

-- Keep scenes.last_post_at current so the home screen can sort by activity.
create or replace function public.bump_scene_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel = 'story' then
    update public.scenes set last_post_at = new.created_at where id = new.scene_id;
  end if;
  return new;
end $$;

drop trigger if exists posts_bump_scene on public.posts;
create trigger posts_bump_scene after insert on public.posts
  for each row execute function public.bump_scene_activity();

-- ---------------------------------------------------------------------------
-- Access rules (no logins: everyone uses the public "anon" key)
-- The app decides who may edit what. These rules stop the obvious abuse:
-- character secret keys are never readable, and the 10-player limit is enforced.
-- ---------------------------------------------------------------------------

alter table public.scenes             enable row level security;
alter table public.scene_participants enable row level security;
alter table public.characters         enable row level security;
alter table public.scene_characters   enable row level security;
alter table public.posts              enable row level security;

-- scenes
grant select, insert, update on public.scenes to anon, authenticated;
drop policy if exists scenes_read   on public.scenes;
drop policy if exists scenes_insert on public.scenes;
drop policy if exists scenes_update on public.scenes;
create policy scenes_read   on public.scenes for select to anon, authenticated using (true);
create policy scenes_insert on public.scenes for insert to anon, authenticated with check (true);
create policy scenes_update on public.scenes for update to anon, authenticated using (true) with check (true);

-- scene_participants: read and rename freely; joining goes through join_scene()
revoke insert on public.scene_participants from anon, authenticated;
grant select, update (player_name) on public.scene_participants to anon, authenticated;
drop policy if exists participants_read   on public.scene_participants;
drop policy if exists participants_update on public.scene_participants;
create policy participants_read   on public.scene_participants for select to anon, authenticated using (true);
create policy participants_update on public.scene_participants for update to anon, authenticated using (true) with check (true);

-- characters: owner_key can be written once but never read back
revoke all on public.characters from anon, authenticated;
grant select (id, name, color, photo_url, universe, created_by_device, created_at, updated_at)
  on public.characters to anon, authenticated;
grant insert (id, owner_key, name, color, photo_url, universe, created_by_device)
  on public.characters to anon, authenticated;
drop policy if exists characters_read   on public.characters;
drop policy if exists characters_insert on public.characters;
create policy characters_read   on public.characters for select to anon, authenticated using (true);
create policy characters_insert on public.characters for insert to anon, authenticated with check (true);

-- scene_characters
grant select, insert, delete on public.scene_characters to anon, authenticated;
drop policy if exists scene_characters_read   on public.scene_characters;
drop policy if exists scene_characters_insert on public.scene_characters;
drop policy if exists scene_characters_delete on public.scene_characters;
create policy scene_characters_read   on public.scene_characters for select to anon, authenticated using (true);
create policy scene_characters_insert on public.scene_characters for insert to anon, authenticated with check (true);
create policy scene_characters_delete on public.scene_characters for delete to anon, authenticated using (true);

-- posts
grant select, insert, update, delete on public.posts to anon, authenticated;
drop policy if exists posts_read   on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete on public.posts;
create policy posts_read   on public.posts for select to anon, authenticated using (true);
create policy posts_insert on public.posts for insert to anon, authenticated with check (true);
create policy posts_update on public.posts for update to anon, authenticated using (true) with check (true);
create policy posts_delete on public.posts for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

-- Join a scene. Returns 'joined', 'already', 'full' or 'missing'.
create or replace function public.join_scene(p_scene_id uuid, p_device_id uuid, p_player_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not exists (select 1 from scenes where id = p_scene_id) then
    return 'missing';
  end if;
  if exists (select 1 from scene_participants where scene_id = p_scene_id and device_id = p_device_id) then
    return 'already';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_scene_id::text));
  select count(*) into n from scene_participants where scene_id = p_scene_id;
  if n >= 10 then
    return 'full';
  end if;
  insert into scene_participants (scene_id, device_id, player_name)
    values (p_scene_id, p_device_id, nullif(trim(p_player_name), ''));
  return 'joined';
end $$;

-- Check a character's secret key (used by share links).
create or replace function public.verify_character_key(p_character_id uuid, p_key uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from characters where id = p_character_id and owner_key = p_key);
$$;

-- Edit a character. Only works with the right secret key.
create or replace function public.update_character(
  p_character_id uuid, p_key uuid, p_name text, p_color text, p_photo_url text, p_universe text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update characters
     set name = p_name, color = p_color, photo_url = p_photo_url, universe = nullif(trim(p_universe), '')
   where id = p_character_id and owner_key = p_key;
  return found;
end $$;

revoke all on function public.join_scene(uuid, uuid, text) from public;
revoke all on function public.verify_character_key(uuid, uuid) from public;
revoke all on function public.update_character(uuid, uuid, text, text, text, text) from public;
grant execute on function public.join_scene(uuid, uuid, text) to anon, authenticated;
grant execute on function public.verify_character_key(uuid, uuid) to anon, authenticated;
grant execute on function public.update_character(uuid, uuid, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Live updates
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['posts', 'scene_characters', 'scene_participants', 'scenes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Character photos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-photos', 'character-photos', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "character photos upload" on storage.objects;
create policy "character photos upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'character-photos');

-- Done. You should see "Success. No rows returned".

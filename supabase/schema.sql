-- Been Map: accounts, synced maps and friends.
-- Paste the whole file into Supabase → SQL Editor and run it once. Safe to re-run.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.maps (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  statuses jsonb not null default '{}'::jsonb,
  people jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);

-- one friendship per pair, whichever side asked first
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- A profile is created together with the account, from the username given at
-- sign-up. Accounts made through Google or Apple arrive without one; they pick
-- a username afterwards (claim_username below).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  name text := lower(new.raw_user_meta_data ->> 'username');
begin
  if name ~ '^[a-z0-9_]{3,20}$' then
    insert into public.profiles (id, username) values (new.id, name);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form check a username before an account exists.
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.profiles where username = lower(name));
$$;

grant execute on function public.username_available(text) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.maps enable row level security;
alter table public.friendships enable row level security;

drop policy if exists "profiles are visible to signed-in users" on public.profiles;
create policy "profiles are visible to signed-in users" on public.profiles
  for select to authenticated using (true);

drop policy if exists "own map and friends' maps are readable" on public.maps;
create policy "own map and friends' maps are readable" on public.maps
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = maps.user_id)
          or (f.addressee = auth.uid() and f.requester = maps.user_id))
    )
  );

drop policy if exists "own map can be created" on public.maps;
create policy "own map can be created" on public.maps
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own map can be changed" on public.maps;
create policy "own map can be changed" on public.maps
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "both sides see a friendship" on public.friendships;
create policy "both sides see a friendship" on public.friendships
  for select to authenticated using (auth.uid() in (requester, addressee));

drop policy if exists "requests are sent as yourself" on public.friendships;
create policy "requests are sent as yourself" on public.friendships
  for insert to authenticated with check (requester = auth.uid() and status = 'pending');

drop policy if exists "the invited side accepts" on public.friendships;
create policy "the invited side accepts" on public.friendships
  for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid());

drop policy if exists "either side can remove a friendship" on public.friendships;
create policy "either side can remove a friendship" on public.friendships
  for delete to authenticated using (auth.uid() in (requester, addressee));

-- accepting may only change the status, never who the friendship is between
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- ---------------------------------------------------------------------------
-- Shared maps: one map that several people mark together.
-- ---------------------------------------------------------------------------

create table if not exists public.shared_maps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  created_by uuid not null references public.profiles (id) on delete cascade,
  statuses jsonb not null default '{}'::jsonb,
  people jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_map_members (
  map_id uuid not null references public.shared_maps (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (map_id, user_id)
);

-- Membership checks run as the table owner, so policies on shared_map_members
-- can ask "is the caller a member?" without recursing into themselves.
create or replace function public.is_map_member(map uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.shared_map_members where map_id = map and user_id = auth.uid());
$$;

create or replace function public.is_friend(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = other)
        or (f.addressee = auth.uid() and f.requester = other))
  );
$$;

-- Creates the map and makes the caller its first member in one step.
create or replace function public.create_shared_map(map_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.shared_maps (name, created_by)
  values (btrim(map_name), auth.uid())
  returning id into new_id;
  insert into public.shared_map_members (map_id, user_id) values (new_id, auth.uid());
  return new_id;
end;
$$;

-- Marks are applied one country at a time, so two people editing at once
-- don't overwrite each other's changes. A null status clears the country.
create or replace function public.mark_shared_map(map uuid, country text, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_map_member(map) then
    raise exception 'not a member of this map';
  end if;
  if country !~ '^[A-Z]{2}$'
    or (new_status is not null and new_status not in ('visited', 'lived', 'transit', 'wish')) then
    raise exception 'invalid marking';
  end if;
  update public.shared_maps
  set statuses = case
        when new_status is null then statuses - country
        else jsonb_set(statuses, array[country], to_jsonb(new_status))
      end,
      updated_at = now()
  where id = map;
end;
$$;

create or replace function public.flag_shared_map(map uuid, country text, known boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_map_member(map) then
    raise exception 'not a member of this map';
  end if;
  if country !~ '^[A-Z]{2}$' then
    raise exception 'invalid marking';
  end if;
  update public.shared_maps
  set people = case
        when known and not people ? country then people || to_jsonb(country)
        when not known then people - country
        else people
      end,
      updated_at = now()
  where id = map;
end;
$$;

revoke execute on function public.create_shared_map(text) from public, anon;
revoke execute on function public.mark_shared_map(uuid, text, text) from public, anon;
revoke execute on function public.flag_shared_map(uuid, text, boolean) from public, anon;
grant execute on function public.create_shared_map(text) to authenticated;
grant execute on function public.mark_shared_map(uuid, text, text) to authenticated;
grant execute on function public.flag_shared_map(uuid, text, boolean) to authenticated;
grant execute on function public.is_map_member(uuid) to authenticated;
grant execute on function public.is_friend(uuid) to authenticated;

alter table public.shared_maps enable row level security;
alter table public.shared_map_members enable row level security;

drop policy if exists "members read a shared map" on public.shared_maps;
create policy "members read a shared map" on public.shared_maps
  for select to authenticated using (public.is_map_member(id));

drop policy if exists "the creator deletes a shared map" on public.shared_maps;
create policy "the creator deletes a shared map" on public.shared_maps
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "members see who is on a shared map" on public.shared_map_members;
create policy "members see who is on a shared map" on public.shared_map_members
  for select to authenticated using (public.is_map_member(map_id));

drop policy if exists "members add their friends" on public.shared_map_members;
create policy "members add their friends" on public.shared_map_members
  for insert to authenticated with check (public.is_map_member(map_id) and public.is_friend(user_id));

drop policy if exists "members leave, the creator removes" on public.shared_map_members;
create policy "members leave, the creator removes" on public.shared_map_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.shared_maps m where m.id = map_id and m.created_by = auth.uid())
  );

-- Live updates: everyone looking at a shared map sees new marks as they happen.
do $$
begin
  alter publication supabase_realtime add table public.shared_maps;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Places, regions and notes; public links; usernames for Google/Apple accounts.
-- ---------------------------------------------------------------------------

-- Everything on a personal map beyond the country markings, as one document:
-- { "pins": [...], "regions": {...}, "notes": {...} }
alter table public.maps add column if not exists extras jsonb not null default '{}'::jsonb;

-- Whether anyone with the link may look at this person's map.
alter table public.profiles add column if not exists is_public boolean not null default false;

drop policy if exists "own profile can be changed" on public.profiles;
create policy "own profile can be changed" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- the only thing people change on their profile is the public switch
revoke update on public.profiles from authenticated;
grant update (is_public) on public.profiles to authenticated;

-- Gives a signed-in account without a profile its username.
create or replace function public.claim_username(name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if lower(name) !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username';
  end if;
  insert into public.profiles (id, username) values (auth.uid(), lower(name));
end;
$$;

revoke execute on function public.claim_username(text) from public, anon;
grant execute on function public.claim_username(text) to authenticated;

-- A public map, for the read-only link. Works without signing in; returns
-- nothing unless the owner switched the link on. Notes stay private.
create or replace function public.public_map(name text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'username', p.username,
    'statuses', coalesce(m.statuses, '{}'::jsonb),
    'people', coalesce(m.people, '[]'::jsonb),
    'extras', coalesce(m.extras, '{}'::jsonb) - 'notes'
  )
  from public.profiles p
  left join public.maps m on m.user_id = p.id
  where p.username = lower(name) and p.is_public;
$$;

grant execute on function public.public_map(text) to anon, authenticated;

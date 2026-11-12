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

-- A profile is created together with the account, from the username given at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
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

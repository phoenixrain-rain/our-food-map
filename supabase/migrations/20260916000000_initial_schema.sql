create extension if not exists pgcrypto;

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null default '我' check (char_length(nickname) between 1 and 40),
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id),
  unique (user_id)
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  city text,
  category text,
  address text,
  visit_date date,
  price_per_person numeric(10,2) check (price_per_person is null or price_per_person >= 0),
  tags text[] not null default '{}',
  status text not null default 'eaten' check (status in ('eaten', 'wishlist')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  taste numeric(3,1) check (taste between 1 and 10),
  value numeric(3,1) check (value between 1 and 10),
  service numeric(3,1) check (service between 1 and 10),
  vibe numeric(3,1) check (vibe between 1 and 10),
  look numeric(3,1) check (look between 1 and 10),
  favorite_dish text,
  comment text,
  favorite boolean not null default false,
  would_return boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create table if not exists public.food_photos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists space_members_space_idx on public.space_members(space_id);
create index if not exists restaurants_space_idx on public.restaurants(space_id, visit_date desc);
create index if not exists reviews_space_idx on public.reviews(space_id);
create index if not exists reviews_restaurant_idx on public.reviews(restaurant_id);
create index if not exists food_photos_space_idx on public.food_photos(space_id);
create index if not exists food_photos_restaurant_idx on public.food_photos(restaurant_id);

create or replace function public.is_space_member(
  p_space_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.space_members sm
      where sm.space_id = p_space_id
        and sm.user_id = p_user_id
    );
$$;

revoke all on function public.is_space_member(uuid, uuid) from public, anon;
grant execute on function public.is_space_member(uuid, uuid) to authenticated;

create or replace function public.create_space(
  p_name text,
  p_nickname text default '我'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_space public.spaces;
  v_code text;
begin
  if v_user_id is null then
    raise exception '请先登录';
  end if;

  if exists (select 1 from public.space_members where user_id = v_user_id) then
    raise exception '当前账号已经加入了一个情侣空间';
  end if;

  loop
    v_code := 'LOVE' || substr(upper(replace(gen_random_uuid()::text, '-', '')), 1, 8);
    exit when not exists (select 1 from public.spaces where invite_code = v_code);
  end loop;

  insert into public.spaces (name, invite_code, created_by)
  values (
    left(coalesce(nullif(trim(p_name), ''), '我们的美食地图'), 80),
    v_code,
    v_user_id
  )
  returning * into v_space;

  insert into public.space_members (space_id, user_id, nickname, role)
  values (
    v_space.id,
    v_user_id,
    left(coalesce(nullif(trim(p_nickname), ''), '我'), 40),
    'owner'
  );

  return jsonb_build_object(
    'id', v_space.id,
    'name', v_space.name,
    'invite_code', v_space.invite_code
  );
end;
$$;

create or replace function public.join_space_by_code(
  p_code text,
  p_nickname text default '我'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_space_id uuid;
begin
  if v_user_id is null then
    raise exception '请先登录';
  end if;

  select id into v_space_id
  from public.spaces
  where invite_code = upper(trim(p_code))
  for update;

  if v_space_id is null then
    raise exception '邀请码不存在';
  end if;

  if exists (
    select 1 from public.space_members
    where user_id = v_user_id and space_id = v_space_id
  ) then
    return jsonb_build_object('message', '你已经在这个空间里', 'space_id', v_space_id);
  end if;

  if exists (select 1 from public.space_members where user_id = v_user_id) then
    raise exception '当前账号已经加入了另一个情侣空间';
  end if;

  if (select count(*) from public.space_members where space_id = v_space_id) >= 2 then
    raise exception '这个情侣空间已经有两位成员';
  end if;

  insert into public.space_members (space_id, user_id, nickname, role)
  values (
    v_space_id,
    v_user_id,
    left(coalesce(nullif(trim(p_nickname), ''), '我'), 40),
    'member'
  );

  return jsonb_build_object('message', '已加入共同空间', 'space_id', v_space_id);
end;
$$;

revoke all on function public.create_space(text, text) from public, anon;
revoke all on function public.join_space_by_code(text, text) from public, anon;
grant execute on function public.create_space(text, text) to authenticated;
grant execute on function public.join_space_by_code(text, text) to authenticated;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.restaurants enable row level security;
alter table public.reviews enable row level security;
alter table public.food_photos enable row level security;

revoke all on table public.spaces from anon, authenticated;
revoke all on table public.space_members from anon, authenticated;
revoke all on table public.restaurants from anon, authenticated;
revoke all on table public.reviews from anon, authenticated;
revoke all on table public.food_photos from anon, authenticated;

grant select on table public.spaces to authenticated;
grant select, update on table public.space_members to authenticated;
grant select, insert, update on table public.restaurants to authenticated;
grant select, insert, update on table public.reviews to authenticated;
grant select, insert on table public.food_photos to authenticated;

drop policy if exists spaces_select_members on public.spaces;
create policy spaces_select_members
on public.spaces for select to authenticated
using (public.is_space_member(id));

drop policy if exists space_members_select_members on public.space_members;
create policy space_members_select_members
on public.space_members for select to authenticated
using (public.is_space_member(space_id));

drop policy if exists space_members_update_self on public.space_members;
create policy space_members_update_self
on public.space_members for update to authenticated
using (user_id = auth.uid() and public.is_space_member(space_id))
with check (user_id = auth.uid() and public.is_space_member(space_id));

drop policy if exists restaurants_select_members on public.restaurants;
create policy restaurants_select_members
on public.restaurants for select to authenticated
using (public.is_space_member(space_id));

drop policy if exists restaurants_insert_members on public.restaurants;
create policy restaurants_insert_members
on public.restaurants for insert to authenticated
with check (created_by = auth.uid() and public.is_space_member(space_id));

drop policy if exists restaurants_update_members on public.restaurants;
create policy restaurants_update_members
on public.restaurants for update to authenticated
using (public.is_space_member(space_id))
with check (public.is_space_member(space_id));

drop policy if exists reviews_select_members on public.reviews;
create policy reviews_select_members
on public.reviews for select to authenticated
using (public.is_space_member(space_id));

drop policy if exists reviews_insert_self on public.reviews;
create policy reviews_insert_self
on public.reviews for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_space_member(space_id)
  and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.space_id = reviews.space_id
  )
);

drop policy if exists reviews_update_self on public.reviews;
create policy reviews_update_self
on public.reviews for update to authenticated
using (user_id = auth.uid() and public.is_space_member(space_id))
with check (
  user_id = auth.uid()
  and public.is_space_member(space_id)
  and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.space_id = reviews.space_id
  )
);

drop policy if exists food_photos_select_members on public.food_photos;
create policy food_photos_select_members
on public.food_photos for select to authenticated
using (public.is_space_member(space_id));

drop policy if exists food_photos_insert_self on public.food_photos;
create policy food_photos_insert_self
on public.food_photos for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_space_member(space_id)
  and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_id and r.space_id = food_photos.space_id
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-photos', 'food-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_upload_food_photo(
  p_path text,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space_text text := split_part(p_path, '/', 1);
  v_restaurant_text text := split_part(p_path, '/', 2);
  v_user_text text := split_part(p_path, '/', 3);
  v_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
begin
  if p_user_id is null
     or v_space_text !~ v_uuid_pattern
     or v_restaurant_text !~ v_uuid_pattern
     or v_user_text <> p_user_id::text then
    return false;
  end if;

  return exists (
    select 1
    from public.restaurants r
    where r.id = v_restaurant_text::uuid
      and r.space_id = v_space_text::uuid
      and public.is_space_member(r.space_id, p_user_id)
  );
end;
$$;

create or replace function public.can_read_food_photo(
  p_path text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.food_photos fp
      where fp.path = p_path
        and public.is_space_member(fp.space_id, p_user_id)
    );
$$;

revoke all on function public.can_upload_food_photo(text, uuid) from public, anon;
revoke all on function public.can_read_food_photo(text, uuid) from public, anon;
grant execute on function public.can_upload_food_photo(text, uuid) to authenticated;
grant execute on function public.can_read_food_photo(text, uuid) to authenticated;

drop policy if exists food_photos_storage_insert on storage.objects;
create policy food_photos_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'food-photos'
  and public.can_upload_food_photo(name)
);

drop policy if exists food_photos_storage_select on storage.objects;
create policy food_photos_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'food-photos'
  and public.can_read_food_photo(name)
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array['restaurants', 'reviews', 'food_photos']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

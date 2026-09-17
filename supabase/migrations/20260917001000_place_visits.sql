-- Stable place identities; existing rows remain separate visits with unchanged IDs, photos and reviews.
create table public.food_places (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, space_id)
);
alter table public.food_places enable row level security;
revoke all on public.food_places from anon, authenticated;
grant select, insert on public.food_places to authenticated;
create policy food_places_read on public.food_places for select to authenticated using (public.is_space_member(space_id));
create policy food_places_create on public.food_places for insert to authenticated with check (public.is_space_member(space_id));

alter table public.restaurants add column place_id uuid;
insert into public.food_places(id, space_id) select id, space_id from public.restaurants;
-- Do not guess whether two identically named shops are the same branch.
update public.restaurants set place_id = id;
alter table public.restaurants alter column place_id set not null;
alter table public.restaurants add constraint restaurants_place_space_fk
  foreign key (place_id, space_id) references public.food_places(id, space_id) on delete cascade;
create index restaurants_place_visits_idx on public.restaurants(space_id, place_id, visit_date desc);

-- Compatibility for old tabs: a new record without a place still receives its own identity.
create or replace function public.ensure_food_place()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.place_id := coalesce(new.place_id, case when tg_op = 'UPDATE' then old.place_id else null end, new.id);
  if not exists (select 1 from public.food_places where id = new.place_id and space_id = new.space_id) then
    if new.place_id = new.id then
      insert into public.food_places(id, space_id) values(new.place_id, new.space_id) on conflict (id) do nothing;
    end if;
    if not exists (select 1 from public.food_places where id = new.place_id and space_id = new.space_id) then
      raise exception '店铺不存在或不属于当前空间，请重新选择';
    end if;
  end if;
  return new;
end; $$;
create trigger ensure_food_place before insert or update of place_id, space_id on public.restaurants
  for each row execute function public.ensure_food_place();

drop trigger guard_deleted_restaurant on public.restaurants;
create trigger guard_deleted_restaurant before update of name, city, category, address, visit_date, price_per_person, tags, status, place_id
  on public.restaurants for each row execute function public.guard_deleted_food_record();

create or replace function public.save_food_record(
  p_restaurant jsonb,
  p_review jsonb default null,
  p_photo_paths text[] default '{}',
  p_remove_photo_ids uuid[] default '{}',
  p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := (p_restaurant->>'id')::uuid;
  v_space uuid := (p_restaurant->>'space_id')::uuid;
  v_old public.restaurants;
  v_row public.restaurants;
  v_payload public.restaurants;
  v_path text;
  v_removed text[] := '{}';
  v_tags text[];
  v_count integer;
begin
  if v_uid is null or not public.is_space_member(v_space) then raise exception '请先加入这个空间'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text, 0));
  v_payload := jsonb_populate_record(null::public.restaurants, p_restaurant);
  v_tags := coalesce(v_payload.tags, '{}');
  if char_length(trim(coalesce(v_payload.name, ''))) not between 1 and 120 then raise exception '请填写正确的店名'; end if;
  if char_length(coalesce(v_payload.category, '')) > 40 then raise exception '分类最多填写 40 字'; end if;
  if cardinality(v_tags) > 20 then raise exception '最多填写 20 个标签'; end if;
  if cardinality(p_photo_paths) > 8 then raise exception '每人每家最多 8 张照片'; end if;
  select * into v_old from public.restaurants where id = v_id for update;
  v_payload.place_id := coalesce(v_payload.place_id, v_old.place_id, v_id);
  if coalesce((p_restaurant->>'create_place')::boolean, false) then
    insert into public.food_places(id, space_id) values(v_payload.place_id, v_space) on conflict (id) do nothing;
  end if;
  if v_old.id is not null then
    if v_old.deleted_at is not null then raise exception '记录已删除，请先从回收站恢复'; end if;
    if v_old.space_id <> v_space then raise exception '记录不属于当前空间'; end if;
    if v_payload.status = 'wishlist' and exists (select 1 from public.reviews where restaurant_id = v_id) then
      raise exception '已有评价的餐厅不能改回想吃，评价仍然保留';
    end if;
    if (v_old.name, v_old.city, v_old.category, v_old.address, v_old.visit_date, v_old.price_per_person, v_old.tags, v_old.status, v_old.place_id)
       is distinct from (trim(v_payload.name), v_payload.city, v_payload.category, v_payload.address, v_payload.visit_date, v_payload.price_per_person, v_tags, v_payload.status, v_payload.place_id) then
      if p_expected_updated_at is null or v_old.updated_at <> p_expected_updated_at then
        raise exception '另一半刚刚修改了餐厅信息，请重新打开记录后再保存';
      end if;
      update public.restaurants set name = trim(v_payload.name), city = v_payload.city, category = v_payload.category,
        address = v_payload.address, visit_date = v_payload.visit_date, price_per_person = v_payload.price_per_person,
        tags = v_tags, status = v_payload.status, place_id = v_payload.place_id, updated_at = clock_timestamp() where id = v_id returning * into v_row;
    else v_row := v_old;
    end if;
  else
    insert into public.restaurants(id, space_id, name, city, category, address, visit_date, price_per_person, tags, status, created_by, place_id)
    values(v_id, v_space, trim(v_payload.name), v_payload.city, v_payload.category, v_payload.address,
      v_payload.visit_date, v_payload.price_per_person, v_tags, v_payload.status, v_uid, v_payload.place_id) returning * into v_row;
  end if;
  if p_review is not null and v_row.status = 'eaten' then
    insert into public.reviews(restaurant_id, space_id, user_id, taste, value, vibe, service, look, favorite_dish, comment, favorite, would_return)
    values(v_id, v_space, v_uid, (p_review->>'taste')::numeric, (p_review->>'value')::numeric, (p_review->>'vibe')::numeric,
      (p_review->>'service')::numeric, (p_review->>'look')::numeric, left(p_review->>'favorite_dish', 1000), left(p_review->>'comment', 5000),
      coalesce((p_review->>'favorite')::boolean, false), coalesce((p_review->>'would_return')::boolean, false))
    on conflict (restaurant_id, user_id) do update set taste = excluded.taste, value = excluded.value, vibe = excluded.vibe,
      service = excluded.service, look = excluded.look, favorite_dish = excluded.favorite_dish, comment = excluded.comment,
      favorite = excluded.favorite, would_return = excluded.would_return, updated_at = clock_timestamp();
  end if;
  select coalesce(array_agg(path), '{}') into v_removed from public.food_photos
    where restaurant_id = v_id and user_id = v_uid and id = any(p_remove_photo_ids);
  delete from public.food_photos where restaurant_id = v_id and user_id = v_uid and id = any(p_remove_photo_ids);
  foreach v_path in array coalesce(p_photo_paths, '{}') loop
    if not public.can_upload_food_photo(v_path) or split_part(v_path, '/', 1) <> v_space::text
       or split_part(v_path, '/', 2) <> v_id::text then raise exception '照片路径不属于这条记录'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'food-photos' and name = v_path) then
      raise exception '照片文件尚未上传，请重试保存';
    end if;
    insert into public.food_photos(restaurant_id, space_id, user_id, path) values(v_id, v_space, v_uid, v_path)
      on conflict (path) do nothing;
  end loop;
  select count(*) into v_count from public.food_photos where restaurant_id = v_id and user_id = v_uid;
  if v_count > 8 then raise exception '每人每家最多 8 张照片'; end if;
  return jsonb_build_object('restaurant', to_jsonb(v_row), 'removed_paths', to_jsonb(v_removed));
end; $$;
revoke all on function public.save_food_record(jsonb, jsonb, text[], uuid[], timestamptz) from public, anon;
grant execute on function public.save_food_record(jsonb, jsonb, text[], uuid[], timestamptz) to authenticated;

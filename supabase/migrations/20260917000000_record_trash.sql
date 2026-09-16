-- Reversible record deletion. Never delete either person's reviews or image files.
alter table public.restaurants add column if not exists deleted_at timestamptz;
alter table public.restaurants add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create or replace function public.set_food_record_deleted(
  p_id uuid, p_deleted boolean, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.restaurants;
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_deleted is null then raise exception '请先登录并选择操作'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  select * into v_row from public.restaurants where id = p_id for update;
  if not found or not public.is_space_member(v_row.space_id) then raise exception '记录不存在或你没有空间权限'; end if;
  -- A lost response can be retried safely without toggling the state again.
  if (v_row.deleted_at is not null) = p_deleted then return to_jsonb(v_row); end if;
  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception '另一半刚刚修改了记录，请刷新后再操作';
  end if;
  update public.restaurants set deleted_at = case when p_deleted then clock_timestamp() else null end,
    deleted_by = case when p_deleted then v_uid else null end, updated_at = clock_timestamp()
    where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
revoke all on function public.set_food_record_deleted(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_food_record_deleted(uuid, boolean, timestamptz) to authenticated;

-- Old open tabs must not edit a deleted restaurant or attach new reviews/photos.
create or replace function public.guard_deleted_food_record()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_deleted timestamptz;
begin
  if tg_table_name = 'restaurants' then
    if old.deleted_at is not null and new.deleted_at is not null then
      raise exception '记录已删除，请先从回收站恢复';
    end if;
  else
    select deleted_at into v_deleted from public.restaurants where id = new.restaurant_id for update;
    if v_deleted is not null then raise exception '记录已删除，请先从回收站恢复'; end if;
  end if;
  return new;
end; $$;
create trigger guard_deleted_restaurant before update of name, city, category, address, visit_date, price_per_person, tags, status
  on public.restaurants for each row execute function public.guard_deleted_food_record();
create trigger guard_deleted_review before insert or update on public.reviews for each row execute function public.guard_deleted_food_record();
create trigger guard_deleted_photo before insert or update on public.food_photos for each row execute function public.guard_deleted_food_record();

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
  if found then
    if v_old.deleted_at is not null then raise exception '记录已删除，请先从回收站恢复'; end if;
    if v_old.space_id <> v_space then raise exception '记录不属于当前空间'; end if;
    if v_payload.status = 'wishlist' and exists (select 1 from public.reviews where restaurant_id = v_id) then
      raise exception '已有评价的餐厅不能改回想吃，评价仍然保留';
    end if;
    if (v_old.name, v_old.city, v_old.category, v_old.address, v_old.visit_date, v_old.price_per_person, v_old.tags, v_old.status)
       is distinct from (trim(v_payload.name), v_payload.city, v_payload.category, v_payload.address, v_payload.visit_date, v_payload.price_per_person, v_tags, v_payload.status) then
      if p_expected_updated_at is null or v_old.updated_at <> p_expected_updated_at then
        raise exception '另一半刚刚修改了餐厅信息，请重新打开记录后再保存';
      end if;
      update public.restaurants set name = trim(v_payload.name), city = v_payload.city, category = v_payload.category,
        address = v_payload.address, visit_date = v_payload.visit_date, price_per_person = v_payload.price_per_person,
        tags = v_tags, status = v_payload.status, updated_at = clock_timestamp() where id = v_id returning * into v_row;
    else v_row := v_old;
    end if;
  else
    insert into public.restaurants(id, space_id, name, city, category, address, visit_date, price_per_person, tags, status, created_by)
    values(v_id, v_space, trim(v_payload.name), v_payload.city, v_payload.category, v_payload.address,
      v_payload.visit_date, v_payload.price_per_person, v_tags, v_payload.status, v_uid) returning * into v_row;
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

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

revoke all on function public.create_space(text, text) from public, anon;
grant execute on function public.create_space(text, text) to authenticated;

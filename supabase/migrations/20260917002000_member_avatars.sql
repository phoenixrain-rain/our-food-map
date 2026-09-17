-- Avatars belong to a member, not to a restaurant. Private and immutable objects.
alter table public.space_members add column avatar_path text;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('food-avatars', 'food-avatars', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Members can view space avatars" on storage.objects for select to authenticated
using (bucket_id = 'food-avatars' and exists (
  select 1 from public.space_members m where m.user_id = auth.uid() and m.space_id::text = split_part(name, '/', 1)
));
create policy "Members can upload own avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'food-avatars' and split_part(name, '/', 2) = auth.uid()::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  and exists (select 1 from public.space_members m where m.user_id = auth.uid() and m.space_id::text = split_part(name, '/', 1)));
create policy "Members can remove unused own avatars" on storage.objects for delete to authenticated
using (bucket_id = 'food-avatars' and split_part(name, '/', 2) = auth.uid()::text
  and exists (select 1 from public.space_members m where m.user_id = auth.uid() and m.space_id::text = split_part(name, '/', 1))
  and not exists (select 1 from public.space_members m where m.avatar_path = name));

-- No direct UPDATE grant on avatar_path: validate ownership, existence and stale editors here.
create or replace function public.save_member_profile(p_nickname text, p_avatar_path text, p_expected_avatar_path text, p_expected_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_member public.space_members; v_old text;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select * into v_member from public.space_members where user_id = auth.uid() for update;
  if not found then raise exception '请先加入情侣空间，再设置云端头像'; end if;
  if p_nickname is null or length(trim(p_nickname)) not between 1 and 40 then raise exception '请输入 1–40 字的昵称'; end if;
  p_nickname := trim(p_nickname);
  if v_member.avatar_path is not distinct from p_avatar_path and v_member.nickname = p_nickname then
    return jsonb_build_object('avatar_path', p_avatar_path, 'removed_path', null);
  end if;
  if v_member.avatar_path is distinct from p_expected_avatar_path or v_member.nickname is distinct from p_expected_nickname then
    raise exception '头像或昵称已在另一台设备修改，请关闭后重新打开设置';
  end if;
  if p_avatar_path is not null and (
    p_avatar_path !~ ('^' || v_member.space_id::text || '/' || auth.uid()::text || '/[0-9a-f-]{36}\.jpg$')
    or not exists (select 1 from storage.objects where bucket_id = 'food-avatars' and name = p_avatar_path)
  ) then raise exception '头像文件不存在或不属于当前账号，请重新选择'; end if;
  v_old := v_member.avatar_path;
  update public.space_members set nickname = p_nickname, avatar_path = p_avatar_path where user_id = auth.uid();
  return jsonb_build_object('avatar_path', p_avatar_path, 'removed_path', case when v_old is distinct from p_avatar_path then v_old end);
end;
$$;
revoke all on function public.save_member_profile(text,text,text,text) from public, anon;
grant execute on function public.save_member_profile(text,text,text,text) to authenticated;

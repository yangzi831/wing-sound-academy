-- Open email registration into the existing shared academy. No curriculum,
-- personal records, audio, histories, invitations or caches are replaced.
begin;
create table if not exists public.academy_registration (
 singleton boolean primary key default true check(singleton),
 academy_id uuid not null references public.academies(id),
 enabled boolean not null default true
);
alter table public.academy_registration enable row level security;
revoke all on public.academy_registration from public,anon,authenticated;

-- Do not silently pick an academy on installations with multiple academies.
do $$
begin
 if not exists(select 1 from public.academy_registration) then
  if (select count(*) from public.academies) <> 1 then
   raise exception 'Expected one existing academy. Set academy_registration.academy_id explicitly before retrying.';
  end if;
  insert into public.academy_registration(singleton,academy_id,enabled)
   select true,id,true from public.academies;
 end if;
end;
$$;

create or replace function public.academy_join_shared() returns uuid
language plpgsql security definer set search_path='' as $$
declare target uuid; registration_enabled boolean; email2 text; confirmed timestamptz; member_active boolean;
begin
 -- Identity and email are read from Auth, never from browser parameters or metadata.
 select lower(btrim(email)),email_confirmed_at into email2,confirmed from auth.users where id=auth.uid();
 if auth.uid() is null or confirmed is null or nullif(email2,'') is null
    or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
  raise exception '请先验证邮箱后再加入学院。' using errcode='42501';
 end if;
 select academy_id,enabled into target,registration_enabled from public.academy_registration where singleton;
 if target is null then raise exception '学院注册尚未配置，请联系管理员。'; end if;
 -- Same lock as member removal and invitation acceptance. Retrying is idempotent.
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 select active into member_active from public.academy_members where academy_id=target and user_id=auth.uid();
 if found then
  if not member_active then raise exception '你的学院成员权限已移除，请联系管理员。' using errcode='42501'; end if;
  return target;
 end if;
 if not registration_enabled then raise exception '学院暂未开放自动加入，请联系管理员。' using errcode='42501'; end if;
 insert into public.academy_members(academy_id,user_id,display_name,role)
 values(target,auth.uid(),email2,'member');
 return target;
end;
$$;
revoke all on function public.academy_join_shared() from public,anon;
grant execute on function public.academy_join_shared() to authenticated;
commit;

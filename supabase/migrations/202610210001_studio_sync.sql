-- Run once in the Supabase SQL Editor as the project administrator.
begin;
create table public.studio_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.studio_owners enable row level security;
revoke all on public.studio_owners from anon, authenticated;

create function public.studio_authorized() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.studio_owners o join auth.users u on u.id = o.user_id
    where o.user_id = auth.uid() and u.email_confirmed_at is not null
      and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
  );
$$;
revoke all on function public.studio_authorized() from public;
grant execute on function public.studio_authorized() to authenticated;

-- Each row is one independently versioned entity; default W01/P00 IDs are retained.
create table public.studio_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('semester','session','project','artifact','critique')),
  id text not null check(length(id) between 1 and 160),
  payload jsonb,
  revision bigint not null check(revision > 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,kind,id),
  check(payload is null or jsonb_typeof(payload) = 'object'),
  check(kind not in ('semester','session','project') or payload is not null),
  check(payload is null or kind = 'semester' or payload->>'id' = id),
  check(kind != 'semester' or id = 'main'),
  check(kind != 'session' or id ~ '^W(0[1-9]|1[0-6])$'),
  check(kind != 'project' or id ~ '^P0[0-4]$'),
  check(octet_length(payload::text) <= 1048576)
);
create table public.studio_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  id text not null,
  payload jsonb,
  revision bigint not null,
  updated_at timestamptz not null,
  primary key(user_id,kind,id,revision)
);
alter table public.studio_records enable row level security;
alter table public.studio_history enable row level security;
create policy owner_read on public.studio_records for select to authenticated
  using(user_id = (select auth.uid()) and (select public.studio_authorized()));
create policy owner_history_read on public.studio_history for select to authenticated
  using(user_id = (select auth.uid()) and (select public.studio_authorized()));
-- All mutations go through the CAS function; direct REST writes are deliberately denied.
revoke all on public.studio_records, public.studio_history from anon, authenticated;
grant select on public.studio_records, public.studio_history to authenticated;

create function public.studio_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.studio_authorized() then raise exception 'Only the verified studio owner may access personal data' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'id',r.id,'payload',r.payload,'revision',r.revision,'updated_at',r.updated_at)), '[]'::jsonb)
    from public.studio_records r where r.user_id = auth.uid());
end;
$$;
create function public.studio_write(p_kind text, p_id text, p_payload jsonb, p_expected bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  current_row public.studio_records;
  result_row public.studio_records;
  review_row public.studio_records;
  uid uuid := auth.uid();
begin
  if not public.studio_authorized() then raise exception 'Only the verified studio owner may edit personal data' using errcode = '42501'; end if;
  -- Locks even the missing-row case; no two clients can both create revision 1.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into current_row from public.studio_records where user_id=uid and kind=p_kind and id=p_id;
  if coalesce(current_row.revision,0) != p_expected then
    return jsonb_build_object('ok',false,'row',to_jsonb(current_row)-'user_id');
  end if;
  if p_kind = 'critique' and coalesce(p_payload->>'versionId','') != '' and not exists (
    select 1 from public.studio_records a where a.user_id=uid and a.kind='artifact'
      and a.id=p_payload->>'versionId' and a.payload->>'kind'='音频版本'
      and a.payload->>'projectId'=p_payload->>'projectId'
  ) then raise exception 'Linked audio version is missing or belongs to another project'; end if;
  if p_kind='artifact' and coalesce(p_payload->>'remotePath','') != '' then
    if (p_payload->>'remotePath') is distinct from (uid::text || '/' || (p_payload->>'fileId')) or not exists (
      select 1 from storage.objects o where o.bucket_id='studio-audio' and o.name=p_payload->>'remotePath'
    ) then raise exception 'Private audio is missing; restore the file from a complete backup before linking it'; end if;
  end if;
  insert into public.studio_records(user_id,kind,id,payload,revision,updated_at)
    values(uid,p_kind,p_id,p_payload,p_expected+1,clock_timestamp())
    on conflict(user_id,kind,id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at
    returning * into result_row;
  insert into public.studio_history values(uid,p_kind,p_id,result_row.payload,result_row.revision,result_row.updated_at);
  -- Referential changes are in the same transaction as removal/reclassification.
  -- Lock all writes for this owner to avoid a concurrent new review linking a removed artifact.
  if p_kind='artifact' then
    for review_row in
      update public.studio_records r set payload=jsonb_set(r.payload,'{versionId}','""'::jsonb),revision=r.revision+1,updated_at=clock_timestamp()
      where r.user_id=uid and r.kind='critique' and r.payload->>'versionId'=p_id
        and (p_payload is null or p_payload->>'kind' != '音频版本' or p_payload->>'projectId' != r.payload->>'projectId')
      returning r.*
    loop
      insert into public.studio_history values(uid,review_row.kind,review_row.id,review_row.payload,review_row.revision,review_row.updated_at);
    end loop;
  end if;
  return jsonb_build_object('ok',true,'row',to_jsonb(result_row)-'user_id');
end;
$$;
revoke all on function public.studio_snapshot(), public.studio_write(text,text,jsonb,bigint) from public;
grant execute on function public.studio_snapshot(), public.studio_write(text,text,jsonb,bigint) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('studio-audio','studio-audio',false,47185920)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
create policy studio_audio_read on storage.objects for select to authenticated
  using(bucket_id='studio-audio' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.studio_authorized()));
create policy studio_audio_insert on storage.objects for insert to authenticated
  with check(bucket_id='studio-audio' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.studio_authorized()));
create policy studio_audio_delete on storage.objects for delete to authenticated
  using(bucket_id='studio-audio' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.studio_authorized())
    and not exists(select 1 from public.studio_records r where r.user_id=(select auth.uid()) and r.kind='artifact' and r.payload->>'remotePath'=storage.objects.name));
-- No UPDATE policy: immutable file IDs prevent cross-device replacement races.
commit;

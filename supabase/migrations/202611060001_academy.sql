-- Incremental upgrade. Keep the original migration, legacy records and history intact.
begin;
create table public.academies(id uuid primary key, name text not null, created_at timestamptz not null default now());
create table public.academy_members(
 academy_id uuid not null references public.academies(id), user_id uuid not null references auth.users(id),
 display_name text not null, role text not null check(role in ('admin','member')), active boolean not null default true,
 joined_at timestamptz not null default now(), primary key(academy_id,user_id)
);
create table public.academy_documents(
 academy_id uuid not null references public.academies(id), id text not null check(length(id) between 1 and 500),
 course_id text not null check(length(course_id) between 1 and 160),
 kind text not null check(kind in ('course','lesson','project','week','process','artifact','critique','note','feedback')),
 author_id uuid references auth.users(id), payload jsonb, revision bigint not null check(revision>0), updated_at timestamptz not null default now(),
 primary key(academy_id,id), check(payload is null or jsonb_typeof(payload)='object'),
 check((kind in ('course','lesson','project') and author_id is null) or (kind not in ('course','lesson','project') and author_id is not null)),
 check(octet_length(payload::text)<=1048576)
);
create table public.academy_history(like public.academy_documents including defaults including constraints);
alter table public.academy_history add primary key(academy_id,id,revision);
create table public.academy_files(
 path text primary key, academy_id uuid not null references public.academies(id), course_id text not null,
 author_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.academy_invitations(
 id uuid primary key, academy_id uuid not null references public.academies(id), email text not null,
 ticket_hash text not null, status text not null check(status in ('sending','pending','accepted','revoked','failed')),
 expires_at timestamptz not null, sent_at timestamptz, error text, accepted_by uuid references auth.users(id),
 invited_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create unique index academy_invitation_open on public.academy_invitations(academy_id,lower(email)) where status in ('sending','pending','failed');

create function public.academy_active(p_academy uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.academy_members m join auth.users u on u.id=m.user_id
  where m.academy_id=p_academy and m.user_id=auth.uid() and m.active and u.email_confirmed_at is not null
   and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false));
$$;
create function public.academy_admin(p_academy uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.academy_active(p_academy) and exists(select 1 from public.academy_members where academy_id=p_academy and user_id=auth.uid() and role='admin' and active);
$$;

alter table public.academies enable row level security;
alter table public.academy_members enable row level security;
alter table public.academy_documents enable row level security;
alter table public.academy_history enable row level security;
alter table public.academy_files enable row level security;
alter table public.academy_invitations enable row level security;
create policy academy_read on public.academies for select to authenticated using(public.academy_active(id));
create policy members_read on public.academy_members for select to authenticated using(public.academy_active(academy_id));
create policy documents_read on public.academy_documents for select to authenticated using(public.academy_active(academy_id));
create policy history_read on public.academy_history for select to authenticated using(public.academy_active(academy_id));
create policy files_read on public.academy_files for select to authenticated using(public.academy_active(academy_id));
-- Invitation ticket hashes are never exposed by SELECT to a browser.
revoke all on public.academies,public.academy_members,public.academy_documents,public.academy_history,public.academy_files,public.academy_invitations from anon,authenticated;
grant select on public.academies,public.academy_members,public.academy_documents,public.academy_history,public.academy_files to authenticated;

-- Canonical seed is generated from src/data.ts; no personal data is embedded here.
create function pg_temp.curriculum() returns jsonb language sql as $seed$
select '{"schemaVersion":1,"semester":{"name":"Semester 01 / Autumn–Winter","year":"2026–2027","title":"Electronic Music Composition Lab","code":"STUDIO 01","timezone":"Asia/Shanghai"},"sessions":[{"id":"W01","week":1,"date":"2026-10-25","projectId":"P00","topic":"P00：One Minute Study，微型电子音乐创作","event":"微型作品试听与结题","objectives":"以单一动机建立微型音乐结构。","task":"直接创作60–90秒电子音乐，尝试重复与变化。","submission":"音频初稿、核心动机与简短创作说明","references":"","notes":"","progress":"","status":"未开始"},{"id":"W02","week":2,"date":"2026-11-01","projectId":"P01","topic":"P01：The Living Loop，律动研究与创作草稿","event":"创作方案讨论 / Concept Review","objectives":"通过参考作品试听，提出循环产生运动感的创作方案。","task":"研究参考作品的律动；建立Kick/Bass与核心循环。","submission":"律动草图、参考分析与概念说明","references":"","notes":"","progress":"","status":"未开始"},{"id":"W03","week":3,"date":"2026-11-08","projectId":"P01","topic":"律动系统、Loop发展与编曲结构","event":"阶段试听与反馈 / Work-in-Progress Review","objectives":"探索有限材料的发展手段和结构。","task":"发展Sequencing、Automation与和声循环；制作结构草稿。","submission":"结构Demo与两种发展手段说明","references":"","notes":"","progress":"","status":"未开始"},{"id":"W04","week":4,"date":"2026-11-15","projectId":"P01","topic":"音乐推进、结构修改与制作完善","event":"P01 · 作品结题讲评 / Final Review","objectives":"整合能量、低频和结构修改。","task":"依据中期反馈修改并完成2–4分钟作品。","submission":"最终音频、过程版本与结题总结","references":"","notes":"","progress":"","status":"未开始"},{"id":"W05","week":5,"date":"2026-11-22","projectId":"P02","topic":"P02：Sound Transformation，声音来源与材料实验","event":"创作方案讨论 / Concept Review","objectives":"建立以声音变化组织音乐的实验方向。","task":"采集一个原始声音并探索三种音乐角色。","submission":"原始素材、声音实验与概念说明","references":"","notes":"","progress":"","status":"未开始"},{"id":"W06","week":6,"date":"2026-11-29","projectId":"P02","topic":"音色变形、声音组织与作品发展","event":"阶段试听与反馈 / Work-in-Progress Review","objectives":"将材料变形发展为音乐关系。","task":"尝试采样、Resampling、调制与空间处理。","submission":"声音角色对照与结构Demo","references":"","notes":"","progress":"","status":"未开始"},{"id":"W07","week":7,"date":"2026-12-06","projectId":"P02","topic":"作品整合、声音关系与完成度","event":"P02 · 作品结题讲评 / Final Review","objectives":"完成以声音变化为核心的作品。","task":"整合声音关系，完成2–3分钟电子音乐。","submission":"最终音频、声音来源说明与总结","references":"","notes":"","progress":"","status":"未开始"},{"id":"W08","week":8,"date":"2026-12-13","projectId":"P03","topic":"P03：Beyond the Loop，动机与长篇结构研究","event":"创作方案讨论 / Concept Review","objectives":"研究动机如何支撑长篇叙事。","task":"研究Post-rock × Electronica，构建动机与结构方案。","submission":"动机草图、结构图与参考研究","references":"","notes":"","progress":"","status":"未开始"},{"id":"W09","week":9,"date":"2026-12-20","projectId":"P03","topic":"自由制作、参考研究、素材整理","event":"自主制作与参考研究 / Flexible Studio","objectives":"演出期弹性工作室课程，自主推进音乐制作。","task":"按演出安排自由制作、研究参考并整理素材。","submission":"素材记录与自主进度笔记","references":"","notes":"","progress":"","status":"未开始"},{"id":"W10","week":10,"date":"2026-12-27","projectId":"P03","topic":"段落发展、转折与长篇结构","event":"阶段试听与反馈 / Work-in-Progress Review","objectives":"建立转折、段落关系与长线张力。","task":"发展和声、多声部及电子与器乐的结合。","submission":"长篇结构Demo与修改议题","references":"","notes":"","progress":"","status":"未开始"},{"id":"W11","week":11,"date":"2027-01-03","projectId":"P03","topic":"编曲深化与项目完成","event":"P03 · 作品结题讲评 / Final Review","objectives":"检验长篇叙事与音乐结构的完整性。","task":"深化编曲并完成4–7分钟作品。","submission":"最终音频、结构说明与总结","references":"","notes":"","progress":"","status":"未开始"},{"id":"W12","week":12,"date":"2027-01-10","projectId":"P04","topic":"P04：Independent Studio，自主命题与立项","event":"独立创作立项 / Project Proposal","objectives":"确定自主命题、研究问题与创作计划。","task":"整理前期成果，提出独立项目方案。","submission":"Project Proposal与参考研究","references":"","notes":"","progress":"","status":"未开始"},{"id":"W13","week":13,"date":"2027-01-17","projectId":"P04","topic":"核心音乐材料与整体结构发展","event":"阶段作品试听与反馈 / Progress Review","objectives":"检验核心材料与整体结构的关系。","task":"发展关键音乐材料，形成可讨论的结构。","submission":"过程Demo与进展说明","references":"","notes":"","progress":"","status":"未开始"},{"id":"W14","week":14,"date":"2027-01-24","projectId":"P04","topic":"独立制作、编曲、声音与细节深化","event":"工作室创作讨论 / Studio Session","objectives":"推进作品结构、声音语言与细节。","task":"独立制作并记录重要修改及其依据。","submission":"更新版本与制作记录","references":"","notes":"","progress":"","status":"未开始"},{"id":"W15","week":15,"date":"2027-01-31","projectId":"P04","topic":"完整作品预评、修改与粗混","event":"期末作品预评 / Pre-Final Review","objectives":"从完整聆听检验创作意图和制作完成度。","task":"提交完整作品预评，记录并实施修改。","submission":"完整预评版本、粗混与修改计划","references":"","notes":"","progress":"","status":"未开始"},{"id":"W16","week":16,"date":"2027-02-07","projectId":"P04","topic":"期末作品展示、最终讲评、作品归档","event":"期末作品展示与评审 / Final Presentation","objectives":"展示独立研究成果并完成创作复盘。","task":"提交正式作品、创作者陈述与过程档案。","submission":"正式音频、过程版本、作品结题讲评与创作总结","references":"","notes":"","progress":"","status":"未开始"}],"projects":[{"id":"P00","name":"One Minute Study","cn":"微型创作快题","weeks":[1],"direction":"Micro Composition / Studio Exercise","question":"一个短小音乐想法如何形成完整的微型作品？","brief":"创作60–90秒电子音乐。围绕一个核心音乐动机发展。第一周直接创作，不安排独立的基础理论学习周。","constraints":"建议不超过6条主要音轨；围绕一个核心动机。","topics":"动机、重复、变化、微型音乐结构","references":"","status":"未开始","idea":"","log":"","summary":"","stages":[false,false,false,false,false]},{"id":"P01","name":"The Living Loop","cn":"循环与运动","weeks":[2,3,4],"direction":"Melodic Techno","question":"怎样通过有限的材料与细微变化，让循环不断产生运动感？","brief":"创作2–4分钟电子音乐，以有限材料建立有运动感的循环与完整结构。","constraints":"保留至少一个贯穿全曲的音乐元素；运用至少两种不同的发展手段。","topics":"Groove、Kick/Bass、Sequencing、Automation、和声循环、低频、编曲能量与重复","references":"","status":"未开始","idea":"","log":"","summary":"","stages":[false,false,false,false,false]},{"id":"P02","name":"Sound Transformation","cn":"声音材料与变形","weeks":[5,6,7],"direction":"Sound Design / Experimental Electronic Music","question":"声音的变化能否成为音乐结构的核心？","brief":"从一个主要原始声音出发，发展出至少三种不同的音乐角色，创作2–3分钟电子音乐。","constraints":"一个主要原始声音；至少三种不同的音乐角色。","topics":"合成、采样、Resampling、FM、Wavetable、Granular、调制、失真与空间处理","references":"","status":"未开始","idea":"","log":"","summary":"","stages":[false,false,false,false,false]},{"id":"P03","name":"Beyond the Loop","cn":"长篇音乐叙事","weeks":[8,9,10,11],"direction":"Post-rock × Electronica","question":"如何把一个短小音乐动机，发展成具有结构与情绪变化的长篇作品？","brief":"创作4–7分钟音乐，研究长篇音乐的结构、情绪变化与长线张力。","constraints":"保留可辨识的核心动机，研究其在不同段落中的变形。","topics":"动机变形、段落组织、和声、多声部、电子与器乐结合、长线张力","references":"KASHIWA Daisuke：研究长篇音乐结构和电子与器乐融合方法，不要求模仿具体风格。","status":"未开始","idea":"","log":"","summary":"","stages":[false,false,false,false,false]},{"id":"P04","name":"Independent Studio","cn":"期末独立创作","weeks":[12,13,14,15,16],"direction":"Independent Research / Final Project","question":"如何将个人研究发展为完整、自主的原创作品？","brief":"正式期末独立音乐创作项目。自主提出创作命题，可以深化之前的声音研究，也可以创作新的原创作品。","constraints":"不规定固定风格与长度；须具备完整创作方案、正式音频、过程版本和作品结题讲评。","topics":"创作立项 → 阶段试听与反馈 → 独立制作 → 期末作品预评 → 作品展示与评审","references":"","status":"未开始","idea":"","log":"","summary":"","stages":[false,false,false,false,false]}],"critiques":[],"artifacts":[]}'::jsonb;
$seed$;
-- Snapshot all original rows/history before decomposing them. Never delete or rewrite them.
create table public.academy_legacy_snapshot as select user_id,kind,id,payload,revision,updated_at from public.studio_records;
alter table public.academy_legacy_snapshot enable row level security;
revoke all on public.academy_legacy_snapshot from anon,authenticated;
create policy legacy_snapshot_read on public.academy_legacy_snapshot for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.academy_members m where m.user_id=auth.uid() and m.active and public.academy_active(m.academy_id)));
grant select on public.academy_legacy_snapshot to authenticated;

do $$
declare owner_row record; aid uuid; seed jsonb:=pg_temp.curriculum(); r record; item jsonb; shared jsonb; personal jsonb; cid text; kind2 text; docid text;
begin
 for owner_row in select o.user_id,coalesce(u.email,'学院管理员') email from public.studio_owners o join auth.users u on u.id=o.user_id order by o.user_id loop
  aid:=md5('wing-academy:'||owner_row.user_id::text)::uuid;
  insert into public.academies values(aid,'WING SOUND ACADEMY',now()) on conflict do nothing;
  insert into public.academy_members(academy_id,user_id,display_name,role) values(aid,owner_row.user_id,owner_row.email,'admin') on conflict do nothing;
  foreach cid in array array['electronic','keyboard','violin'] loop
   shared:=jsonb_build_object('name',case cid when 'electronic' then '电子音乐制作' when 'keyboard' then '键盘' else '小提琴' end,
    'description',case when cid='electronic' then 'Electronic Music Composition Lab' else '' end,'goals','',
    'fixed',cid='electronic','archived',false,'order',case cid when 'electronic' then 0 when 'keyboard' then 1 else 2 end,
    'adminRole',case cid when 'keyboard' then '老师' when 'violin' then '学生' else '共同学习者' end,
    'memberRole',case cid when 'keyboard' then '学生' when 'violin' then '老师' else '共同学习者' end,'roles','{}'::jsonb);
   if cid='electronic' then shared:=shared||jsonb_build_object('semester',coalesce((select payload from public.studio_records where user_id=owner_row.user_id and kind='semester' and id='main'),seed->'semester')); end if;
   insert into public.academy_documents values(aid,'course/'||cid,cid,'course',null,shared,1,now()) on conflict do nothing;
  end loop;
  for item in select value from jsonb_array_elements(seed->'sessions') loop
   select payload into shared from public.studio_records where user_id=owner_row.user_id and kind='session' and id=item->>'id';
   shared:=coalesce(shared,item)-array['notes','progress','status','references'];
   insert into public.academy_documents values(aid,'lesson/electronic/'||(item->>'id'),'electronic','lesson',null,shared,1,now()) on conflict do nothing;
  end loop;
  for item in select value from jsonb_array_elements(seed->'projects') loop
   select payload into shared from public.studio_records where user_id=owner_row.user_id and kind='project' and id=item->>'id';
   shared:=coalesce(shared,item)-array['status','idea','log','summary','stages'];
   insert into public.academy_documents values(aid,'project/electronic/'||(item->>'id'),'electronic','project',null,shared,1,now()) on conflict do nothing;
  end loop;
  -- Split every historical revision, retaining original author, revision and timestamp.
  for r in select * from public.studio_history where user_id=owner_row.user_id and kind!='semester' order by revision loop
   kind2:=case r.kind when 'session' then 'week' when 'project' then 'process' else r.kind end;
   docid:=kind2||'/electronic/'||owner_row.user_id::text||'/'||r.id;
   personal:=case r.kind when 'session' then r.payload-array['id','week','date','topic','event','projectId','objectives','task','submission']
    when 'project' then r.payload-array['id','name','cn','weeks','direction','question','brief','constraints','topics','references'] else r.payload end;
   insert into public.academy_history values(aid,docid,'electronic',kind2,owner_row.user_id,personal,r.revision,r.updated_at) on conflict do nothing;
  end loop;
  for r in select * from public.studio_records where user_id=owner_row.user_id and kind!='semester' loop
   kind2:=case r.kind when 'session' then 'week' when 'project' then 'process' else r.kind end;
   docid:=kind2||'/electronic/'||owner_row.user_id::text||'/'||r.id;
   personal:=case r.kind when 'session' then r.payload-array['id','week','date','topic','event','projectId','objectives','task','submission']
    when 'project' then r.payload-array['id','name','cn','weeks','direction','question','brief','constraints','topics','references'] else r.payload end;
   insert into public.academy_documents values(aid,docid,'electronic',kind2,owner_row.user_id,personal,r.revision,r.updated_at) on conflict do nothing;
  end loop;
  insert into public.academy_history select * from public.academy_documents where academy_id=aid on conflict do nothing;
  insert into public.academy_files(path,academy_id,course_id,author_id)
   select distinct payload->>'remotePath',aid,'electronic',owner_row.user_id from public.studio_history
   where user_id=owner_row.user_id and kind='artifact' and payload->>'remotePath' like owner_row.user_id::text||'/%' on conflict do nothing;
  insert into public.academy_files(path,academy_id,course_id,author_id)
   select payload->>'remotePath',aid,'electronic',owner_row.user_id from public.studio_records
   where user_id=owner_row.user_id and kind='artifact' and payload->>'remotePath' like owner_row.user_id::text||'/%' on conflict do nothing;
 end loop;
end;
$$;

create function public.academy_index() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'role',m.role)),'[]'::jsonb)
 from public.academies a join public.academy_members m on m.academy_id=a.id where m.user_id=auth.uid() and public.academy_active(a.id) and m.active;
$$;
create function public.academy_snapshot(p_academy uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.academy_active(p_academy) then raise exception 'Academy membership is inactive or email is not verified' using errcode='42501'; end if;
 return jsonb_build_object('academy',(select jsonb_build_object('id',id,'name',name) from public.academies where id=p_academy),
 'members',(select coalesce(jsonb_agg(to_jsonb(m)-'academy_id'),'[]') from public.academy_members m where academy_id=p_academy),
 'documents',(select coalesce(jsonb_agg(to_jsonb(d)-'academy_id'),'[]') from public.academy_documents d where academy_id=p_academy),
 'invitations',case when public.academy_admin(p_academy) then (select coalesce(jsonb_agg(to_jsonb(i)-array['ticket_hash','invited_by','accepted_by','academy_id']),'[]') from public.academy_invitations i where academy_id=p_academy) else '[]'::jsonb end);
end;
$$;
create function public.academy_write(p_academy uuid,p_id text,p_course text,p_kind text,p_author uuid,p_payload jsonb,p_expected bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_row public.academy_documents; result_row public.academy_documents; course_row public.academy_documents; target public.academy_documents;
begin
 -- A lock shared by membership removal/invite acceptance serializes permission changes.
 perform pg_advisory_xact_lock(hashtextextended(p_academy::text,0));
 if not public.academy_active(p_academy) then raise exception 'Inactive academy membership' using errcode='42501'; end if;
 select * into current_row from public.academy_documents where academy_id=p_academy and id=p_id;
 if current_row.id is not null and (current_row.kind!=p_kind or current_row.course_id!=p_course or current_row.author_id is distinct from p_author) then raise exception 'Document identity and author are immutable' using errcode='42501'; end if;
 if p_kind in ('course','lesson','project') then
  if p_author is not null then raise exception 'Shared content has no personal author'; end if;
  if p_course='electronic' then raise exception 'Electronic curriculum is fixed' using errcode='42501'; end if;
  if p_kind='course' then
   if p_id!='course/'||p_course or p_payload is null then raise exception 'Invalid course identity'; end if;
   if not public.academy_admin(p_academy) and (current_row.id is null or (current_row.payload-array['description','goals']) is distinct from (p_payload-array['description','goals'])) then raise exception 'Only academy admins manage courses and roles' using errcode='42501'; end if;
   if p_payload->>'fixed' is distinct from 'false' or coalesce(btrim(p_payload->>'name'),'')='' then raise exception 'Invalid custom course'; end if;
  end if;
 else
  if p_author is distinct from auth.uid() then raise exception 'Only the record author may edit' using errcode='42501'; end if;
 end if;
 if p_kind!='course' then
  select * into course_row from public.academy_documents where academy_id=p_academy and id='course/'||p_course and payload is not null;
  if course_row.id is null then raise exception 'Course does not exist'; end if;
 end if;
 if p_payload is not null and (jsonb_typeof(p_payload)!='object' or octet_length(p_payload::text)>1048576) then raise exception 'Invalid record'; end if;
 if p_kind='week' then
  if p_course!='electronic' or p_id !~ ('^week/electronic/'||auth.uid()::text||'/W(0[1-9]|1[0-6])$') or (p_payload-array['notes','progress','status','references'])!='{}'::jsonb then raise exception 'Invalid personal week'; end if;
 elsif p_kind='process' then
  if p_course!='electronic' or p_id !~ ('^process/electronic/'||auth.uid()::text||'/P0[0-4]$') or (p_payload-array['status','idea','log','summary','stages'])!='{}'::jsonb then raise exception 'Invalid project learning record'; end if;
 end if;
 if p_kind in ('week','process') and p_payload is null then raise exception 'Reset personal fields instead of deleting progress'; end if;
 if p_kind='lesson' and p_payload is not null then
  if jsonb_typeof(p_payload->'title') is distinct from 'string' or coalesce(btrim(p_payload->>'title'),'')='' then raise exception 'Lesson title required'; end if;
  if coalesce(p_payload->>'date','')!='' then perform (p_payload->>'date')::date; end if;
 end if;
 if p_kind='note' and p_payload is not null then
  if coalesce(p_payload->>'lessonId','')!='' and not exists(select 1 from public.academy_documents d where d.academy_id=p_academy and d.course_id=p_course and d.id=p_payload->>'lessonId' and d.kind='lesson' and d.payload is not null) then raise exception 'Lesson must belong to this course'; end if;
  if coalesce(p_payload->>'projectId','')!='' and not exists(select 1 from public.academy_documents d where d.academy_id=p_academy and d.course_id=p_course and d.kind='project' and d.payload is not null and (d.id=p_payload->>'projectId' or d.payload->>'id'=p_payload->>'projectId')) then raise exception 'Project must belong to this course'; end if;
 end if;
 if p_kind='feedback' and p_payload is not null then
  select * into target from public.academy_documents where academy_id=p_academy and id=p_payload->>'targetId' and course_id=p_course and payload is not null and author_id is not null;
  if target.id is null or coalesce(btrim(p_payload->>'body'),'')='' then raise exception 'Feedback needs a valid learning record'; end if;
 end if;
 if p_kind='critique' and coalesce(p_payload->>'versionId','')!='' then
  if not exists(select 1 from public.academy_documents d where d.academy_id=p_academy and d.course_id=p_course and d.author_id=p_author and d.kind='artifact' and d.payload->>'id'=p_payload->>'versionId' and d.payload->>'projectId'=p_payload->>'projectId' and d.payload->>'kind'='音频版本') then raise exception 'Linked audio version missing'; end if;
 end if;
 if p_kind in ('artifact','critique') and p_payload is not null and current_row.payload is not null and p_payload->>'id' is distinct from current_row.payload->>'id' then raise exception 'Original version/record identity is immutable'; end if;
 if coalesce(p_payload->>'remotePath','')!='' then
  if not exists(select 1 from public.academy_files f join storage.objects o on o.bucket_id='studio-audio' and o.name=f.path where f.path=p_payload->>'remotePath' and f.academy_id=p_academy and f.course_id=p_course and f.author_id=p_author) then raise exception 'Audio file is not owned by this author/course or missing'; end if;
 end if;
 if coalesce(current_row.revision,0)!=p_expected then return jsonb_build_object('ok',false,'row',to_jsonb(current_row)-'academy_id'); end if;
 insert into public.academy_documents values(p_academy,p_id,p_course,p_kind,p_author,p_payload,p_expected+1,clock_timestamp())
 on conflict(academy_id,id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at returning * into result_row;
 insert into public.academy_history select result_row.*;
 -- Clear only this author's review link; preserve text/timecodes and record the revision.
 if p_kind='artifact' then
  for target in update public.academy_documents d set payload=jsonb_set(d.payload,'{versionId}','""'),revision=d.revision+1,updated_at=clock_timestamp()
   where d.academy_id=p_academy and d.course_id=p_course and d.author_id=p_author and d.kind='critique' and d.payload->>'versionId'=coalesce(current_row.payload->>'id',p_payload->>'id')
    and (p_payload is null or p_payload->>'kind'!='音频版本' or p_payload->>'projectId'!=d.payload->>'projectId') returning d.*
  loop insert into public.academy_history select target.*; end loop;
 end if;
 return jsonb_build_object('ok',true,'row',to_jsonb(result_row)-'academy_id');
end;
$$;
create function public.academy_register_file(p_academy uuid,p_course text,p_file text) returns text language plpgsql security definer set search_path='' as $$
declare path2 text:=p_academy::text||'/'||auth.uid()::text||'/'||p_file;
begin
 if not public.academy_active(p_academy) then raise exception 'Inactive academy membership' using errcode='42501'; end if;
 if p_file !~ '^[a-zA-Z0-9-]{1,100}$' or not exists(select 1 from public.academy_documents where academy_id=p_academy and id='course/'||p_course and payload is not null) then raise exception 'Invalid audio course or file'; end if;
 insert into public.academy_files(path,academy_id,course_id,author_id) values(path2,p_academy,p_course,auth.uid()) on conflict do nothing;
 if not exists(select 1 from public.academy_files where path=path2 and course_id=p_course and author_id=auth.uid()) then raise exception 'File already belongs to another course'; end if;
 return path2;
end;
$$;

create function public.academy_remove_member(p_academy uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_academy::text,0));
 if not public.academy_admin(p_academy) then raise exception 'Admin required' using errcode='42501'; end if;
 if exists(select 1 from public.academy_members where academy_id=p_academy and user_id=p_user and role='admin') then raise exception 'Cannot remove academy administrator'; end if;
 update public.academy_members set active=false where academy_id=p_academy and user_id=p_user;
 update public.academy_invitations set status='revoked',updated_at=now() where academy_id=p_academy and accepted_by=p_user;
end;
$$;
create function public.academy_prepare_invitation(p_academy uuid,p_email text,p_id uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare email2 text:=lower(btrim(p_email)); invitation public.academy_invitations;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_academy::text,0));
 if not public.academy_admin(p_academy) then raise exception 'Admin required' using errcode='42501'; end if;
 if email2 !~ '^[^ @]+@[^ @]+\.[^ @]+$' or length(email2)>254 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
 if exists(select 1 from public.academy_members m join auth.users u on m.user_id=u.id where m.academy_id=p_academy and m.active and lower(u.email)=email2) then raise exception 'This email is already an active member'; end if;
 select * into invitation from public.academy_invitations where academy_id=p_academy and lower(email)=email2 and status in ('sending','pending','failed');
 if invitation.status='sending' and invitation.updated_at>now()-interval '2 minutes' then raise exception 'Invitation is already being sent'; end if;
 if invitation.sent_at>now()-interval '60 seconds' then raise exception 'Please wait 60 seconds before resending'; end if;
 if invitation.id is not null then update public.academy_invitations set status='revoked',updated_at=now() where id=invitation.id; end if;
 insert into public.academy_invitations(id,academy_id,email,ticket_hash,status,expires_at,invited_by)
 values(p_id,p_academy,email2,p_hash,'sending',now()+interval '7 days',auth.uid()) returning * into invitation;
 return to_jsonb(invitation)-'ticket_hash';
end;
$$;
-- This is service-only: a browser cannot claim mail delivery succeeded.
create function public.academy_invitation_delivery(p_id uuid,p_ok boolean,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.academy_invitations set status=case when p_ok then 'pending' else 'failed' end,sent_at=case when p_ok then now() else sent_at end,error=left(p_error,300),updated_at=now() where id=p_id and status='sending';
end;
$$;
create function public.academy_revoke_invitation(p_academy uuid,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_academy::text,0));
 if not public.academy_admin(p_academy) then raise exception 'Admin required' using errcode='42501'; end if;
 update public.academy_invitations set status='revoked',updated_at=now() where id=p_id and academy_id=p_academy and status in ('sending','pending','failed');
end;
$$;
create function public.academy_accept_invitation(p_id uuid,p_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.academy_invitations; email2 text; confirmed timestamptz;
begin
 select * into invitation from public.academy_invitations where id=p_id;
 if invitation.id is null then raise exception 'Invitation unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(invitation.academy_id::text,0));
 select * into invitation from public.academy_invitations where id=p_id for update;
 select lower(email),email_confirmed_at into email2,confirmed from auth.users where id=auth.uid();
 if auth.uid() is null or confirmed is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) or email2 is distinct from invitation.email or p_hash is distinct from invitation.ticket_hash then raise exception 'Sign in with the verified invited email' using errcode='42501'; end if;
 if invitation.status='accepted' and invitation.accepted_by=auth.uid() and public.academy_active(invitation.academy_id) then return invitation.academy_id; end if;
 if invitation.status!='pending' or invitation.expires_at<=now() then raise exception 'Invitation expired, revoked, or not delivered'; end if;
 insert into public.academy_members(academy_id,user_id,display_name,role) values(invitation.academy_id,auth.uid(),email2,'member')
 on conflict(academy_id,user_id) do update set active=true;
 update public.academy_invitations set status='accepted',accepted_by=auth.uid(),updated_at=now() where id=p_id;
 return invitation.academy_id;
end;
$$;

-- Disable legacy write API: an older cached application must not bypass read-only curriculum.
create or replace function public.studio_write(p_kind text,p_id text,p_payload jsonb,p_expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Academy upgraded. Refresh the website before editing.' using errcode='42501'; end;$$;
create or replace function public.studio_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Academy upgraded. Refresh the website.' using errcode='42501'; end;$$;

-- Replace (do not OR with) the old owner-only Storage policies.
drop policy studio_audio_read on storage.objects;
drop policy studio_audio_insert on storage.objects;
drop policy studio_audio_delete on storage.objects;
create policy academy_audio_read on storage.objects for select to authenticated using(bucket_id='studio-audio' and exists(select 1 from public.academy_files f where f.path=name and public.academy_active(f.academy_id)));
create policy academy_audio_insert on storage.objects for insert to authenticated with check(bucket_id='studio-audio' and exists(select 1 from public.academy_files f where f.path=name and f.author_id=auth.uid() and public.academy_active(f.academy_id)));
create policy academy_audio_delete on storage.objects for delete to authenticated using(bucket_id='studio-audio' and exists(select 1 from public.academy_files f where f.path=name and f.author_id=auth.uid() and public.academy_active(f.academy_id)) and not exists(select 1 from public.academy_documents d where d.payload->>'remotePath'=name));

-- Explicit function privileges, including functions created in earlier migrations.
revoke all on function public.academy_active(uuid),public.academy_admin(uuid),public.academy_index(),public.academy_snapshot(uuid),public.academy_write(uuid,text,text,text,uuid,jsonb,bigint),public.academy_register_file(uuid,text,text),public.academy_remove_member(uuid,uuid),public.academy_prepare_invitation(uuid,text,uuid,text),public.academy_revoke_invitation(uuid,uuid),public.academy_accept_invitation(uuid,text),public.academy_invitation_delivery(uuid,boolean,text) from public,anon;
grant execute on function public.academy_active(uuid),public.academy_admin(uuid),public.academy_index(),public.academy_snapshot(uuid),public.academy_write(uuid,text,text,text,uuid,jsonb,bigint),public.academy_register_file(uuid,text,text),public.academy_remove_member(uuid,uuid),public.academy_prepare_invitation(uuid,text,uuid,text),public.academy_revoke_invitation(uuid,uuid),public.academy_accept_invitation(uuid,text) to authenticated;
revoke all on function public.academy_invitation_delivery(uuid,boolean,text) from authenticated;
grant execute on function public.academy_invitation_delivery(uuid,boolean,text) to service_role;
commit;

-- =====================================================================
-- 마이플래너: 일정 동기화 + 가족 공유
-- 버디플래너와 같은 Supabase 프로젝트를 쓰므로 모든 이름을 mp_ 로 시작해 분리합니다.
-- (버디플래너의 user_data 등 기존 테이블은 건드리지 않음)
-- 계정(auth.users)은 두 앱이 함께 씁니다 → 같은 카카오 계정이면 같은 사용자.
-- 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1) 프로필: 가족에게 보이는 이름 --------------------------------------
create table if not exists public.mp_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 30),
  updated_at   timestamptz not null default now()
);

-- 2) 일정: 일정 하나 = 한 줄 (앱의 일정 JSON 그대로) ----------------------
create table if not exists public.mp_schedules (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 4 and 64),
  data       jsonb not null,
  deleted    boolean not null default false,       -- 지운 일정 표시 (다른 기기에도 지우기 위해)
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create index if not exists mp_schedules_updated_idx on public.mp_schedules (owner_id, updated_at);

-- 3) 가족 그룹 · 구성원 ------------------------------------------------
create table if not exists public.mp_families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 30),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.mp_family_members (
  family_id    uuid not null references public.mp_families (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 30),
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index if not exists mp_family_members_user_idx on public.mp_family_members (user_id);

-- 4) 일정 공유: 내 일정을 가족 한 명에게 → 그 사람 폰에서도 알람 ------------
create table if not exists public.mp_schedule_shares (
  owner_id    uuid not null,
  schedule_id text not null,
  target_id   uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (owner_id, schedule_id, target_id),
  foreign key (owner_id, schedule_id) references public.mp_schedules (owner_id, id) on delete cascade,
  check (owner_id <> target_id)
);
create index if not exists mp_schedule_shares_target_idx on public.mp_schedule_shares (target_id);

-- 5) 도우미 함수 (정책 안에서 다른 테이블을 볼 때 무한 반복을 막기 위해 security definer)
create or replace function public.mp_is_member(fid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_family_members m where m.family_id = fid and m.user_id = (select auth.uid()));
$$;

create or replace function public.mp_same_family(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.mp_family_members x
    join public.mp_family_members y on y.family_id = x.family_id
    where x.user_id = a and y.user_id = b
  );
$$;

create or replace function public.mp_is_shared_with_me(o uuid, sid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_schedule_shares s
                 where s.owner_id = o and s.schedule_id = sid and s.target_id = (select auth.uid()));
$$;

create or replace function public.mp_owns_schedule(sid text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_schedules s where s.owner_id = (select auth.uid()) and s.id = sid);
$$;

-- 6) 행 수준 보안 ------------------------------------------------------
alter table public.mp_profiles        enable row level security;
alter table public.mp_schedules       enable row level security;
alter table public.mp_families        enable row level security;
alter table public.mp_family_members  enable row level security;
alter table public.mp_schedule_shares enable row level security;

-- 프로필: 본인 + 같은 가족은 이름을 볼 수 있음, 수정은 본인만
drop policy if exists mp_profiles_select on public.mp_profiles;
drop policy if exists mp_profiles_insert on public.mp_profiles;
drop policy if exists mp_profiles_update on public.mp_profiles;
create policy mp_profiles_select on public.mp_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.mp_same_family((select auth.uid()), user_id));
create policy mp_profiles_insert on public.mp_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy mp_profiles_update on public.mp_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 일정: 내 일정 + 나에게 공유된 일정만 보임, 쓰기는 주인만
drop policy if exists mp_schedules_select on public.mp_schedules;
drop policy if exists mp_schedules_insert on public.mp_schedules;
drop policy if exists mp_schedules_update on public.mp_schedules;
drop policy if exists mp_schedules_delete on public.mp_schedules;
create policy mp_schedules_select on public.mp_schedules for select to authenticated
  using (owner_id = (select auth.uid()) or public.mp_is_shared_with_me(owner_id, id));
create policy mp_schedules_insert on public.mp_schedules for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy mp_schedules_update on public.mp_schedules for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy mp_schedules_delete on public.mp_schedules for delete to authenticated
  using (owner_id = (select auth.uid()));

-- 가족: 구성원만 보임 (만들기·참여는 아래 함수로만)
drop policy if exists mp_families_select on public.mp_families;
create policy mp_families_select on public.mp_families for select to authenticated
  using (public.mp_is_member(id));

drop policy if exists mp_members_select on public.mp_family_members;
drop policy if exists mp_members_update on public.mp_family_members;
create policy mp_members_select on public.mp_family_members for select to authenticated
  using (public.mp_is_member(family_id));
create policy mp_members_update on public.mp_family_members for update to authenticated   -- 내 표시 이름만
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 공유: 보낸 사람·받은 사람만 보임, 내 일정을 같은 가족에게만 공유 가능, 둘 다 해제 가능
drop policy if exists mp_shares_select on public.mp_schedule_shares;
drop policy if exists mp_shares_insert on public.mp_schedule_shares;
drop policy if exists mp_shares_delete on public.mp_schedule_shares;
create policy mp_shares_select on public.mp_schedule_shares for select to authenticated
  using (owner_id = (select auth.uid()) or target_id = (select auth.uid()));
create policy mp_shares_insert on public.mp_schedule_shares for insert to authenticated
  with check (owner_id = (select auth.uid())
              and public.mp_owns_schedule(schedule_id)
              and public.mp_same_family((select auth.uid()), target_id));
create policy mp_shares_delete on public.mp_schedule_shares for delete to authenticated
  using (owner_id = (select auth.uid()) or target_id = (select auth.uid()));

-- 7) 가족 만들기 · 참여 · 나가기 (서버 함수) ------------------------------
create or replace function public.mp_create_family(p_name text, p_display text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  code text;
  fid uuid;
  abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 헷갈리는 0·O·1·I 제외
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.mp_family_members where user_id = uid) >= 5 then
    raise exception '가족은 5개까지 만들거나 참여할 수 있어요';
  end if;
  loop
    code := '';
    for i in 1..6 loop code := code || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.mp_families where invite_code = code);
  end loop;
  insert into public.mp_families (name, invite_code, created_by)
    values (left(coalesce(nullif(trim(p_name), ''), '우리 가족'), 30), code, uid) returning id into fid;
  insert into public.mp_family_members (family_id, user_id, display_name, role)
    values (fid, uid, left(nullif(trim(p_display), ''), 30), 'owner');
  return json_build_object('id', fid, 'invite_code', code);
end $$;

create or replace function public.mp_join_family(p_code text, p_display text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  f public.mp_families;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into f from public.mp_families where invite_code = upper(trim(p_code));
  if f.id is null then raise exception '초대 코드를 찾을 수 없어요'; end if;
  if (select count(*) from public.mp_family_members where family_id = f.id) >= 10
     and not exists (select 1 from public.mp_family_members where family_id = f.id and user_id = uid) then
    raise exception '가족은 10명까지예요';
  end if;
  insert into public.mp_family_members (family_id, user_id, display_name)
    values (f.id, uid, left(nullif(trim(p_display), ''), 30))
    on conflict (family_id, user_id) do update set display_name = coalesce(excluded.display_name, public.mp_family_members.display_name);
  return json_build_object('id', f.id, 'name', f.name);
end $$;

create or replace function public.mp_leave_family(p_family uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from public.mp_family_members where family_id = p_family and user_id = uid;
  -- 이제 같은 가족이 아닌 사람과의 공유는 정리
  delete from public.mp_schedule_shares s
   where (s.owner_id = uid and not public.mp_same_family(uid, s.target_id))
      or (s.target_id = uid and not public.mp_same_family(s.owner_id, uid));
  -- 아무도 안 남은 가족은 삭제
  delete from public.mp_families f where f.id = p_family
     and not exists (select 1 from public.mp_family_members m where m.family_id = f.id);
end $$;

-- 8) 함수 실행 권한: 로그인한 사용자만 -----------------------------------
revoke execute on function public.mp_create_family(text, text), public.mp_join_family(text, text),
  public.mp_leave_family(uuid), public.mp_is_member(uuid), public.mp_same_family(uuid, uuid),
  public.mp_is_shared_with_me(uuid, text), public.mp_owns_schedule(text) from public, anon;
grant execute on function public.mp_create_family(text, text), public.mp_join_family(text, text),
  public.mp_leave_family(uuid), public.mp_is_member(uuid), public.mp_same_family(uuid, uuid),
  public.mp_is_shared_with_me(uuid, text), public.mp_owns_schedule(text) to authenticated;

-- 테이블: 로그인 안 한 사용자(anon)는 접근 불가
revoke all on public.mp_profiles, public.mp_schedules, public.mp_families,
  public.mp_family_members, public.mp_schedule_shares from anon;

comment on table public.mp_schedules is '마이플래너 일정 (일정 하나 = 한 줄, 앱의 일정 JSON)';
comment on table public.mp_families is '마이플래너 가족 그룹 (초대 코드로 참여)';
comment on table public.mp_schedule_shares is '마이플래너 일정 공유: 받은 사람 폰에서도 알람';

-- 9) AI 비서 하루 사용량 (서버 함수만 기록) --------------------------------
-- 버디플래너 ai_usage와 따로 셉니다 (앱마다 한도가 다름)
create table if not exists public.mp_ai_usage (
  user_id uuid    not null references auth.users (id) on delete cascade,
  day     date    not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.mp_ai_usage enable row level security;
-- 정책 없음: 앱은 읽기·쓰기 불가, 서버 함수(service_role)만 사용

-- 한도 안이면 1 늘리고 남은 횟수, 넘으면 -1 (동시 요청에도 안전)
create or replace function public.mp_ai_try_use(p_user uuid, p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  n integer;
begin
  insert into public.mp_ai_usage (user_id, day, count) values (p_user, today, 1)
  on conflict (user_id, day) do update set count = public.mp_ai_usage.count + 1
  where public.mp_ai_usage.count < p_limit
  returning count into n;
  return case when n is null then -1 else p_limit - n end;
end $$;
revoke all on function public.mp_ai_try_use(uuid, integer) from public, anon, authenticated;
grant execute on function public.mp_ai_try_use(uuid, integer) to service_role;

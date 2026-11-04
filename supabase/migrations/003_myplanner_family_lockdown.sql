-- =========================================================
-- 마이플래너 — 가족 구성원 표 보안 보강 (점검에서 찾은 구멍)
-- 1) 구성원이 자기 줄의 family_id·role을 바꿔 다른 가족에 들어가거나 방장이 되는 것을 막음
--    → 고칠 수 있는 칸은 display_name(표시 이름)만
-- 2) mp_same_family(a, b)를 아무 두 사람으로 불러 '같은 가족인지' 알아내는 것을 막음
--    → 둘 중 한 명이 지금 로그인한 본인일 때만 참 (정책·함수 안에서 쓰는 방식은 그대로 동작)
-- 마이플래너(mp_) 표·함수만 건드림. 버디플래너 표는 바꾸지 않음.
-- =========================================================

revoke update on public.mp_family_members from authenticated;
grant update (display_name) on public.mp_family_members to authenticated;

create or replace function public.mp_same_family(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ((select auth.uid()) is null or (select auth.uid()) in (a, b))   -- 서버 내부(auth 없음) 또는 본인 포함일 때만
     and exists (
       select 1 from public.mp_family_members x
       join public.mp_family_members y on y.family_id = x.family_id
       where x.user_id = a and y.user_id = b
     );
$$;

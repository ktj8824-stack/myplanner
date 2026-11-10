-- =====================================================================
-- 마이플래너 포인트 · 출석 체크 · 럭키드로우 · 이용권 3단계
-- 버디플래너(013_points_raffle_rules) 방식을 그대로 따르되, 마이플래너 전용 mp_ 표에 따로 둠.
-- 버디플래너 표(point_ledger, raffles …)와 함수는 건드리지 않음.
--
-- 원칙
--  · 포인트는 서버 장부(mp_point_ledger) 합계만 인정. 앱은 숫자를 바꿀 수 없음 (읽기만)
--  · 포인트는 무료(출석·광고·활동)로만 적립, 돈으로 팔지 않음 → 럭키드로우는 사행성 아님
--  · 응모·추첨·환불은 모두 서버 함수 안에서
--  · 숫자는 mp_settings 표에서 바꿀 수 있음
-- =====================================================================

-- 0) 운영 설정 ---------------------------------------------------------
create table if not exists public.mp_settings (key text primary key, value text not null);
alter table public.mp_settings enable row level security;
revoke all on public.mp_settings from anon, authenticated;

insert into public.mp_settings (key, value) values
  ('ad_reward_mode', 'client'), ('ad_reward_points', '10'), ('ad_daily_limit', '10'),
  ('attend_points', '3'), ('attend_streak_days', '7'), ('attend_streak_bonus', '10'),
  ('schedule_points', '5'), ('schedule_daily_limit', '2'),
  ('share_points', '5'), ('share_daily_limit', '2'),
  ('family_points', '20'), ('family_daily_limit', '3'),
  ('point_expire_days', '365'),
  ('rf_rev_per_view', '11'), ('rf_payout', '0.75'), ('rf_ad_share', '0.55'),
  ('rf_entry_cost', '100'), ('rf_per_user_limit', '20')
on conflict (key) do nothing;

create or replace function public.mp__setting(p_key text, p_default text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.mp_settings where key = p_key), p_default);
$$;
revoke all on function public.mp__setting(text, text) from public, anon, authenticated;

-- 운영자 (럭키드로우 회차 관리). 마이플래너 계정 id를 대시보드에서 넣음
create table if not exists public.mp_admins (user_id uuid primary key references auth.users (id) on delete cascade, created_at timestamptz not null default now());
alter table public.mp_admins enable row level security;
revoke all on public.mp_admins from anon, authenticated;

create or replace function public.mp_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mp_admins where user_id = auth.uid());
$$;
revoke all on function public.mp_is_admin() from public, anon;
grant execute on function public.mp_is_admin() to authenticated;

create or replace function public.mp__admin_check()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.mp_admins where user_id = auth.uid()) then raise exception 'admin_only'; end if;
end;
$$;
revoke all on function public.mp__admin_check() from public, anon, authenticated;

-- 1) 포인트 장부 -------------------------------------------------------
create table if not exists public.mp_point_ledger (
  id          bigserial   primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  delta       integer     not null check (delta <> 0),
  reason      text        not null check (reason in ('ad', 'attend', 'schedule', 'share', 'family',
                                                     'raffle_entry', 'raffle_refund', 'admin', 'event', 'expire')),
  ref         text,
  created_at  timestamptz not null default now()
);
create index if not exists mp_point_ledger_user_idx on public.mp_point_ledger (user_id, created_at desc);
create unique index if not exists mp_point_ledger_ad_tx_uniq on public.mp_point_ledger (ref) where reason = 'ad' and ref is not null;
create unique index if not exists mp_point_ledger_once_uniq on public.mp_point_ledger (user_id, reason, ref)
  where reason in ('attend', 'schedule', 'share', 'family') and ref is not null;
alter table public.mp_point_ledger enable row level security;
drop policy if exists "mp_ledger_select_own" on public.mp_point_ledger;
create policy "mp_ledger_select_own" on public.mp_point_ledger for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.mp_point_ledger from anon, authenticated;

create or replace function public.mp__kst_today()
returns timestamptz language sql stable set search_path = '' as $$
  select ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul');
$$;

create or replace function public.mp__balance(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::int from public.mp_point_ledger where user_id = p_user;
$$;
revoke all on function public.mp__balance(uuid) from public, anon, authenticated;

create or replace function public.mp__earned_today(p_user uuid, p_reason text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.mp_point_ledger
  where user_id = p_user and reason = p_reason and delta > 0 and created_at >= public.mp__kst_today();
$$;
revoke all on function public.mp__earned_today(uuid, text) from public, anon, authenticated;

-- 1년 지난 포인트 소멸 (먼저 쌓인 것부터 쓴 것으로 봄)
create or replace function public.mp__expire(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare days int := public.mp__setting('point_expire_days', '365')::int; old_earned int; spent int; n int;
begin
  select coalesce(sum(delta), 0) into old_earned from public.mp_point_ledger
    where user_id = p_user and delta > 0 and created_at < now() - make_interval(days => days);
  if old_earned = 0 then return 0; end if;
  select coalesce(-sum(delta), 0) into spent from public.mp_point_ledger where user_id = p_user and delta < 0;
  n := old_earned - spent;
  if n > 0 then
    insert into public.mp_point_ledger (user_id, delta, reason, ref) values (p_user, -n, 'expire', to_char(now(), 'YYYY-MM-DD'));
    return n;
  end if;
  return 0;
end;
$$;
revoke all on function public.mp__expire(uuid) from public, anon, authenticated;

-- 활동 적립 공통 (하루 한도, 같은 대상은 한 번)
create or replace function public.mp__grant(p_user uuid, p_reason text, p_ref text)
returns integer language plpgsql security definer set search_path = '' as $$
declare pts int := public.mp__setting(p_reason || '_points', '0')::int; lim int := public.mp__setting(p_reason || '_daily_limit', '0')::int; n int;
begin
  if p_user is null or pts <= 0 then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('mppts:' || p_user::text));
  if public.mp__earned_today(p_user, p_reason) >= lim then return 0; end if;
  insert into public.mp_point_ledger (user_id, delta, reason, ref) values (p_user, pts, p_reason, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  return case when n > 0 then pts else 0 end;
end;
$$;
revoke all on function public.mp__grant(uuid, text, text) from public, anon, authenticated;

-- 내 포인트
create or replace function public.mp_my_points()
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); exp_soon int; today date := (now() at time zone 'Asia/Seoul')::date; streak int := 0; d date;
begin
  if uid is null then raise exception 'login_required'; end if;
  perform public.mp__expire(uid);
  select greatest(coalesce((select sum(delta) from public.mp_point_ledger where user_id = uid and delta > 0
           and created_at < now() - make_interval(days => public.mp__setting('point_expire_days', '365')::int - 30)), 0)
         - coalesce((select -sum(delta) from public.mp_point_ledger where user_id = uid and delta < 0), 0), 0)::int into exp_soon;
  -- 연속 출석 (오늘 안 했으면 어제까지)
  d := case when exists (select 1 from public.mp_point_ledger where user_id = uid and reason = 'attend' and ref = 'day:' || to_char(today, 'YYYY-MM-DD')) then today else today - 1 end;
  while streak < 400 and exists (select 1 from public.mp_point_ledger where user_id = uid and reason = 'attend' and ref = 'day:' || to_char(d, 'YYYY-MM-DD')) loop
    streak := streak + 1; d := d - 1;
  end loop;
  return json_build_object(
    'balance', public.mp__balance(uid),
    'ad_today', public.mp__earned_today(uid, 'ad'),
    'ad_limit', public.mp__setting('ad_daily_limit', '10')::int,
    'ad_points', public.mp__setting('ad_reward_points', '10')::int,
    'ad_mode', public.mp__setting('ad_reward_mode', 'client'),
    'attended_today', exists (select 1 from public.mp_point_ledger where user_id = uid and reason = 'attend' and ref = 'day:' || to_char(today, 'YYYY-MM-DD')),
    'streak', streak,
    'expiring_soon', exp_soon,
    'rules', json_build_object(
      'attend', public.mp__setting('attend_points', '3')::int, 'streak_days', public.mp__setting('attend_streak_days', '7')::int,
      'streak_bonus', public.mp__setting('attend_streak_bonus', '10')::int,
      'schedule', public.mp__setting('schedule_points', '5')::int, 'schedule_limit', public.mp__setting('schedule_daily_limit', '2')::int,
      'share', public.mp__setting('share_points', '5')::int, 'share_limit', public.mp__setting('share_daily_limit', '2')::int,
      'family', public.mp__setting('family_points', '20')::int,
      'expire_days', public.mp__setting('point_expire_days', '365')::int));
end;
$$;
revoke all on function public.mp_my_points() from public, anon;
grant execute on function public.mp_my_points() to authenticated;

-- 내 포인트 내역 (최근 50건)
create or replace function public.mp_point_history()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x), '[]'::json) from (
    select delta, reason, created_at from public.mp_point_ledger where user_id = auth.uid() order by created_at desc, id desc limit 50) x;
$$;
revoke all on function public.mp_point_history() from public, anon;
grant execute on function public.mp_point_history() to authenticated;

-- 출석 체크 (하루 1번, 연속 N일마다 보너스)
create or replace function public.mp_check_in()
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date;
  pts int := public.mp__setting('attend_points', '3')::int;
  every int := public.mp__setting('attend_streak_days', '7')::int;
  bonus int := public.mp__setting('attend_streak_bonus', '10')::int;
  streak int := 1; d date; earned int;
begin
  if uid is null then raise exception 'login_required'; end if;
  perform pg_advisory_xact_lock(hashtext('mppts:' || uid::text));
  if exists (select 1 from public.mp_point_ledger where user_id = uid and reason = 'attend' and ref = 'day:' || to_char(today, 'YYYY-MM-DD')) then
    return json_build_object('ok', false, 'error', 'already', 'balance', public.mp__balance(uid));
  end if;
  d := today - 1;
  while streak < 400 and exists (select 1 from public.mp_point_ledger where user_id = uid and reason = 'attend' and ref = 'day:' || to_char(d, 'YYYY-MM-DD')) loop
    streak := streak + 1; d := d - 1;
  end loop;
  insert into public.mp_point_ledger (user_id, delta, reason, ref) values (uid, pts, 'attend', 'day:' || to_char(today, 'YYYY-MM-DD'));
  earned := pts;
  if every > 0 and bonus > 0 and streak % every = 0 then
    insert into public.mp_point_ledger (user_id, delta, reason, ref) values (uid, bonus, 'attend', 'streak:' || to_char(today, 'YYYY-MM-DD'));
    earned := earned + bonus;
  end if;
  return json_build_object('ok', true, 'earned', earned, 'streak', streak, 'bonus', every > 0 and streak % every = 0, 'balance', public.mp__balance(uid));
end;
$$;
revoke all on function public.mp_check_in() from public, anon;
grant execute on function public.mp_check_in() to authenticated;

-- 광고 보상 (하루 한도, 같은 애드몹 거래로 두 번 안 줌)
create or replace function public.mp__grant_ad(p_user uuid, p_tx text)
returns json language plpgsql security definer set search_path = '' as $$
declare lim int := public.mp__setting('ad_daily_limit', '10')::int; pts int := public.mp__setting('ad_reward_points', '10')::int; today int;
begin
  perform pg_advisory_xact_lock(hashtext('mppts:' || p_user::text));
  if p_tx is not null and exists (select 1 from public.mp_point_ledger where reason = 'ad' and ref = p_tx) then
    return json_build_object('ok', true, 'duplicate', true, 'balance', public.mp__balance(p_user));
  end if;
  today := public.mp__earned_today(p_user, 'ad');
  if today >= lim then
    return json_build_object('ok', false, 'error', 'daily_limit', 'balance', public.mp__balance(p_user), 'ad_today', today, 'ad_limit', lim);
  end if;
  insert into public.mp_point_ledger (user_id, delta, reason, ref) values (p_user, pts, 'ad', p_tx);
  return json_build_object('ok', true, 'earned', pts, 'balance', public.mp__balance(p_user), 'ad_today', today + 1, 'ad_limit', lim);
end;
$$;
revoke all on function public.mp__grant_ad(uuid, text) from public, anon, authenticated;

-- 앱이 호출: 광고 끝까지 봄 ('client' 모드일 때만)
create or replace function public.mp_earn_ad_points()
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login_required'; end if;
  if public.mp__setting('ad_reward_mode', 'client') <> 'client' then
    return json_build_object('ok', false, 'error', 'use_ssv', 'balance', public.mp__balance(uid));
  end if;
  return public.mp__grant_ad(uid, null);
end;
$$;
revoke all on function public.mp_earn_ad_points() from public, anon;
grant execute on function public.mp_earn_ad_points() to authenticated;

-- 애드몹 서버 검증 함수(서비스 키)만 호출 — 나중에 'ssv' 모드로 바꿀 때
create or replace function public.mp_grant_ad_reward(p_user uuid, p_tx text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users where id = p_user) then return json_build_object('ok', false, 'error', 'unknown_user'); end if;
  return public.mp__grant_ad(p_user, p_tx);
end;
$$;
revoke all on function public.mp_grant_ad_reward(uuid, text) from public, anon, authenticated;
grant execute on function public.mp_grant_ad_reward(uuid, text) to service_role;

-- 2) 활동 적립 (서버가 자동으로) ---------------------------------------
-- 새 일정 등록: 일정마다 한 번, 하루 2번까지 (지운 일정·처음 로그인 때 올라가는 예전 일정도 하루 한도 안에서만)
create or replace function public.mp__schedule_points_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.deleted, false) then return new; end if;
  perform public.mp__grant(new.owner_id, 'schedule', 'sch:' || left(new.id, 100));
  return new;
end;
$$;
revoke all on function public.mp__schedule_points_trg() from public, anon, authenticated;
drop trigger if exists mp_schedule_points on public.mp_schedules;
create trigger mp_schedule_points after insert on public.mp_schedules for each row execute function public.mp__schedule_points_trg();

-- 가족에게 일정 공유: 일정·가족마다 한 번, 하루 2번까지
create or replace function public.mp__share_points_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.mp__grant(new.owner_id, 'share', 'share:' || left(new.schedule_id, 100) || ':' || new.target_id::text);
  return new;
end;
$$;
revoke all on function public.mp__share_points_trg() from public, anon, authenticated;
drop trigger if exists mp_share_points on public.mp_schedule_shares;
create trigger mp_share_points after insert on public.mp_schedule_shares for each row execute function public.mp__share_points_trg();

-- 가족 연결: 새 가족이 들어오면 만든 사람과 들어온 사람 모두 (같은 사람끼리는 한 번, 하루 3번까지)
create or replace function public.mp__family_points_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner uuid;
begin
  select created_by into owner from public.mp_families where id = new.family_id;
  if owner is null or owner = new.user_id then return new; end if;
  perform public.mp__grant(owner, 'family', 'fam:' || new.user_id::text);
  perform public.mp__grant(new.user_id, 'family', 'fam:' || owner::text);
  return new;
end;
$$;
revoke all on function public.mp__family_points_trg() from public, anon, authenticated;
drop trigger if exists mp_family_points on public.mp_family_members;
create trigger mp_family_points after insert on public.mp_family_members for each row execute function public.mp__family_points_trg();

-- 3) 럭키드로우 ---------------------------------------------------------
create table if not exists public.mp_raffles (
  id              bigserial   primary key,
  title           text        not null check (char_length(title) between 1 and 80),
  prize_name      text        not null check (char_length(prize_name) between 1 and 80),
  prize_value     integer     not null default 0 check (prize_value >= 0),
  image_url       text,
  description     text,
  entry_cost      integer     not null check (entry_cost between 1 and 100000),
  max_entries     integer     not null check (max_entries between 1 and 1000000),
  min_entries     integer     not null default 0 check (min_entries >= 0),
  per_user_limit  integer     not null default 20 check (per_user_limit >= 1),
  winners_count   integer     not null default 1 check (winners_count >= 1),
  reserve_count   integer     not null default 1 check (reserve_count between 0 and 5),
  claim_days      integer     not null default 7 check (claim_days between 1 and 60),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz not null,
  status          text        not null default 'open' check (status in ('open', 'drawn', 'cancelled')),
  drawn_at        timestamptz,
  rules           text,
  extended        boolean     not null default false,
  extend_days     integer     not null default 7 check (extend_days between 1 and 30),
  sponsored       boolean     not null default false,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.mp_raffles enable row level security;
revoke all on public.mp_raffles from anon, authenticated;   -- 목록은 mp_get_raffles 함수로만

create table if not exists public.mp_raffle_entries (
  id          bigserial   primary key,
  raffle_id   bigint      not null references public.mp_raffles (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists mp_raffle_entries_raffle_idx on public.mp_raffle_entries (raffle_id);
create index if not exists mp_raffle_entries_user_idx on public.mp_raffle_entries (user_id, raffle_id);
alter table public.mp_raffle_entries enable row level security;
revoke all on public.mp_raffle_entries from anon, authenticated;

create table if not exists public.mp_raffle_winners (
  raffle_id     bigint      not null references public.mp_raffles (id) on delete cascade,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  rank          integer     not null,
  display_name  text        not null,
  reserve       boolean     not null default false,
  forfeited     boolean     not null default false,
  claim_until   timestamptz,
  ship_name     text,
  ship_phone    text,
  ship_addr     text,
  claimed_at    timestamptz,
  shipped_at    timestamptz,
  primary key (raffle_id, user_id)
);
alter table public.mp_raffle_winners enable row level security;
revoke all on public.mp_raffle_winners from anon, authenticated;

-- 이름 가리기: 공진문 → 공**
create or replace function public.mp__masked_name(p_user uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare n text;
begin
  select display_name into n from public.mp_profiles where user_id = p_user;
  n := btrim(coalesce(n, ''));
  if n = '' then return '플래너' || upper(right(replace(p_user::text, '-', ''), 4)); end if;
  return left(n, 1) || repeat('*', greatest(2, least(char_length(n) - 1, 4)));
end;
$$;
revoke all on function public.mp__masked_name(uuid) from public, anon, authenticated;

-- 추첨: 응모 건수만큼 확률이 올라가고 한 사람은 한 번만 당첨. 성립 기준 미달이면 한 번 연장, 그래도 미달이면 취소·전액 반환
create or replace function public.mp__draw_raffle(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.mp_raffles; n int; picked int := 0; u uuid;
begin
  select * into r from public.mp_raffles where id = p_id for update;
  if not found or r.status <> 'open' then return; end if;
  select count(*) into n from public.mp_raffle_entries where raffle_id = p_id;
  if n = 0 or n < r.min_entries then
    if n > 0 and r.min_entries > 0 and not r.extended then
      update public.mp_raffles set extended = true, ends_at = greatest(ends_at, now()) + make_interval(days => r.extend_days) where id = p_id;
      return;
    end if;
    insert into public.mp_point_ledger (user_id, delta, reason, ref)
      select user_id, count(*)::int * r.entry_cost, 'raffle_refund', p_id::text from public.mp_raffle_entries where raffle_id = p_id group by user_id;
    update public.mp_raffles set status = 'cancelled', drawn_at = now() where id = p_id;
    return;
  end if;
  for u in
    select e.user_id from (
      select user_id, min(ord) as first_ord from (
        select user_id, row_number() over (order by gen_random_uuid()) as ord from public.mp_raffle_entries where raffle_id = p_id
      ) shuffled group by user_id
    ) e order by e.first_ord
  loop
    exit when picked >= r.winners_count + r.reserve_count;
    picked := picked + 1;
    insert into public.mp_raffle_winners (raffle_id, user_id, rank, display_name, reserve, claim_until)
      values (p_id, u, picked, public.mp__masked_name(u), picked > r.winners_count,
              case when picked > r.winners_count then null else now() + make_interval(days => r.claim_days) end);
  end loop;
  update public.mp_raffles set status = 'drawn', drawn_at = now() where id = p_id;
end;
$$;
revoke all on function public.mp__draw_raffle(bigint) from public, anon, authenticated;

create or replace function public.mp_draw_due_raffles()
returns integer language plpgsql security definer set search_path = '' as $$
declare rid bigint; cnt int := 0;
begin
  for rid in
    select r.id from public.mp_raffles r where r.status = 'open'
      and (r.ends_at <= now() or (select count(*) from public.mp_raffle_entries e where e.raffle_id = r.id) >= r.max_entries)
  loop
    perform public.mp__draw_raffle(rid); cnt := cnt + 1;
  end loop;
  return cnt;
end;
$$;
revoke all on function public.mp_draw_due_raffles() from public, anon, authenticated;
grant execute on function public.mp_draw_due_raffles() to service_role;

-- 목록 (진행 중 + 최근 30일 종료분). 로그인 안 해도 볼 수 있음
create or replace function public.mp_get_raffles()
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform public.mp_draw_due_raffles();
  return coalesce((
    select json_agg(x order by x.sort_key, x.ends_at) from (
      select r.id, r.title, r.prize_name, r.prize_value, r.image_url, r.description,
             r.entry_cost, r.max_entries, r.min_entries, r.per_user_limit, r.winners_count,
             r.claim_days, r.starts_at, r.ends_at, r.status, r.drawn_at, r.rules, r.extended, r.extend_days,
             (select count(*) from public.mp_raffle_entries e where e.raffle_id = r.id)::int as entries,
             (select count(*) from public.mp_raffle_entries e where e.raffle_id = r.id and e.user_id = uid)::int as my_entries,
             (select json_agg(json_build_object('rank', w.rank, 'name', w.display_name) order by w.rank)
                from public.mp_raffle_winners w where w.raffle_id = r.id and not w.reserve and not w.forfeited) as winners,
             (select json_build_object('claimed', w.claimed_at is not null, 'shipped', w.shipped_at is not null,
                       'claim_until', coalesce(w.claim_until, r.drawn_at + make_interval(days => r.claim_days)))
                from public.mp_raffle_winners w where w.raffle_id = r.id and w.user_id = uid and not w.reserve and not w.forfeited) as me_winner,
             case when r.status = 'open' then 0 else 1 end as sort_key
      from public.mp_raffles r
      where r.starts_at <= now() and (r.status = 'open' or r.drawn_at > now() - interval '30 days')
    ) x), '[]'::json);
end;
$$;
revoke all on function public.mp_get_raffles() from public;
grant execute on function public.mp_get_raffles() to anon, authenticated;

create or replace function public.mp_enter_raffle(p_id bigint, p_count integer default 1)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.mp_raffles; total int; mine int; bal int; cost int; won boolean := false;
begin
  if uid is null then raise exception 'login_required'; end if;
  if p_count is null or p_count < 1 or p_count > 100 then return json_build_object('ok', false, 'error', 'bad_count'); end if;
  if exists (select 1 from public.mp_admins where user_id = uid) then return json_build_object('ok', false, 'error', 'admin_blocked'); end if;
  perform pg_advisory_xact_lock(hashtext('mppts:' || uid::text));
  perform public.mp__expire(uid);
  select * into r from public.mp_raffles where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if r.status <> 'open' or now() < r.starts_at or now() >= r.ends_at then return json_build_object('ok', false, 'error', 'closed'); end if;
  select count(*) into total from public.mp_raffle_entries where raffle_id = p_id;
  select count(*) into mine from public.mp_raffle_entries where raffle_id = p_id and user_id = uid;
  if total + p_count > r.max_entries then return json_build_object('ok', false, 'error', 'full', 'remaining', r.max_entries - total); end if;
  if mine + p_count > r.per_user_limit then return json_build_object('ok', false, 'error', 'user_limit', 'remaining', r.per_user_limit - mine); end if;
  cost := r.entry_cost * p_count;
  bal := public.mp__balance(uid);
  if bal < cost then return json_build_object('ok', false, 'error', 'not_enough_points', 'balance', bal, 'need', cost); end if;
  insert into public.mp_point_ledger (user_id, delta, reason, ref) values (uid, -cost, 'raffle_entry', p_id::text);
  insert into public.mp_raffle_entries (raffle_id, user_id) select p_id, uid from generate_series(1, p_count);
  if total + p_count >= r.max_entries then
    perform public.mp__draw_raffle(p_id);
    won := exists (select 1 from public.mp_raffle_winners where raffle_id = p_id and user_id = uid and not reserve);
  end if;
  return json_build_object('ok', true, 'balance', bal - cost, 'entries', total + p_count, 'my_entries', mine + p_count,
    'drawn', total + p_count >= r.max_entries, 'won', won);
end;
$$;
revoke all on function public.mp_enter_raffle(bigint, integer) from public, anon;
grant execute on function public.mp_enter_raffle(bigint, integer) to authenticated;

create or replace function public.mp_claim_prize(p_id bigint, p_name text, p_phone text, p_addr text)
returns json language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r public.mp_raffles; w public.mp_raffle_winners;
begin
  if uid is null then raise exception 'login_required'; end if;
  select * into r from public.mp_raffles where id = p_id;
  select * into w from public.mp_raffle_winners where raffle_id = p_id and user_id = uid and not reserve and not forfeited;
  if not found then return json_build_object('ok', false, 'error', 'not_winner'); end if;
  if w.shipped_at is not null then return json_build_object('ok', false, 'error', 'already_shipped'); end if;
  if now() > coalesce(w.claim_until, r.drawn_at + make_interval(days => r.claim_days)) then return json_build_object('ok', false, 'error', 'claim_expired'); end if;
  p_name := btrim(coalesce(p_name, '')); p_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); p_addr := btrim(coalesce(p_addr, ''));
  if char_length(p_name) not between 1 and 30 or p_phone !~ '^01[0-9]{8,9}$' or char_length(p_addr) not between 5 and 200 then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;
  update public.mp_raffle_winners set ship_name = p_name, ship_phone = p_phone, ship_addr = p_addr, claimed_at = now() where raffle_id = p_id and user_id = uid;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.mp_claim_prize(bigint, text, text, text) from public, anon;
grant execute on function public.mp_claim_prize(bigint, text, text, text) to authenticated;

-- 배송 정보 파기: 발송 30일 후
create or replace function public.mp_purge_shipping_info()
returns integer language sql security definer set search_path = '' as $$
  with u as (update public.mp_raffle_winners set ship_name = null, ship_phone = null, ship_addr = null
    where shipped_at is not null and shipped_at < now() - interval '30 days' and ship_phone is not null returning 1)
  select count(*)::int from u;
$$;
revoke all on function public.mp_purge_shipping_info() from public, anon, authenticated;
grant execute on function public.mp_purge_shipping_info() to service_role;

-- 4) 관리자 ------------------------------------------------------------
create or replace function public.mp_admin_point_settings()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.mp__admin_check();
  return (select json_object_agg(key, value) from public.mp_settings);
end;
$$;
revoke all on function public.mp_admin_point_settings() from public, anon;
grant execute on function public.mp_admin_point_settings() to authenticated;

create or replace function public.mp_admin_raffle_list()
returns json language plpgsql security definer set search_path = '' as $$
begin
  perform public.mp__admin_check();
  perform public.mp_draw_due_raffles();
  return coalesce((select json_agg(x order by x.sort_key, x.id desc) from (
    select r.*,
      (select count(*) from public.mp_raffle_entries e where e.raffle_id = r.id)::int as entries,
      (select count(distinct e.user_id) from public.mp_raffle_entries e where e.raffle_id = r.id)::int as people,
      (select json_agg(json_build_object('user_id', w.user_id, 'rank', w.rank, 'name', w.display_name, 'reserve', w.reserve,
          'forfeited', w.forfeited, 'claim_until', coalesce(w.claim_until, r.drawn_at + make_interval(days => r.claim_days)),
          'claimed_at', w.claimed_at, 'shipped_at', w.shipped_at, 'ship_name', w.ship_name, 'ship_phone', w.ship_phone, 'ship_addr', w.ship_addr)
          order by w.rank) from public.mp_raffle_winners w where w.raffle_id = r.id) as winners,
      case when r.status = 'open' then 0 else 1 end as sort_key
    from public.mp_raffles r where r.status = 'open' or r.created_at > now() - interval '180 days'
  ) x), '[]'::json);
end;
$$;
revoke all on function public.mp_admin_raffle_list() from public, anon;
grant execute on function public.mp_admin_raffle_list() to authenticated;

create or replace function public.mp_admin_raffle_save(p jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare rid bigint := nullif(p ->> 'id', '')::bigint; has_entries boolean;
begin
  perform public.mp__admin_check();
  if rid is null then
    insert into public.mp_raffles (title, prize_name, prize_value, image_url, description, entry_cost, max_entries, min_entries,
        per_user_limit, winners_count, reserve_count, claim_days, starts_at, ends_at, rules, sponsored, extend_days)
    values (p ->> 'title', p ->> 'prize_name', coalesce((p ->> 'prize_value')::int, 0), nullif(p ->> 'image_url', ''), nullif(p ->> 'description', ''),
        coalesce((p ->> 'entry_cost')::int, 100), coalesce((p ->> 'max_entries')::int, 100000), coalesce((p ->> 'min_entries')::int, 0),
        coalesce((p ->> 'per_user_limit')::int, 20), coalesce((p ->> 'winners_count')::int, 1), coalesce((p ->> 'reserve_count')::int, 1),
        coalesce((p ->> 'claim_days')::int, 7), coalesce((p ->> 'starts_at')::timestamptz, now()), (p ->> 'ends_at')::timestamptz,
        nullif(p ->> 'rules', ''), coalesce((p ->> 'sponsored')::boolean, false), coalesce((p ->> 'extend_days')::int, 7))
    returning id into rid;
    return json_build_object('ok', true, 'id', rid);
  end if;
  select exists (select 1 from public.mp_raffle_entries where raffle_id = rid) into has_entries;
  if has_entries then
    update public.mp_raffles set image_url = nullif(p ->> 'image_url', ''), description = nullif(p ->> 'description', ''),
        rules = nullif(p ->> 'rules', ''), ends_at = greatest(ends_at, (p ->> 'ends_at')::timestamptz)
      where id = rid and status = 'open';
    return json_build_object('ok', true, 'id', rid, 'limited', true);
  end if;
  update public.mp_raffles set title = p ->> 'title', prize_name = p ->> 'prize_name', prize_value = coalesce((p ->> 'prize_value')::int, 0),
      image_url = nullif(p ->> 'image_url', ''), description = nullif(p ->> 'description', ''), entry_cost = coalesce((p ->> 'entry_cost')::int, 100),
      max_entries = coalesce((p ->> 'max_entries')::int, 100000), min_entries = coalesce((p ->> 'min_entries')::int, 0),
      per_user_limit = coalesce((p ->> 'per_user_limit')::int, 20), winners_count = coalesce((p ->> 'winners_count')::int, 1),
      reserve_count = coalesce((p ->> 'reserve_count')::int, 1), claim_days = coalesce((p ->> 'claim_days')::int, 7),
      starts_at = coalesce((p ->> 'starts_at')::timestamptz, starts_at), ends_at = (p ->> 'ends_at')::timestamptz,
      rules = nullif(p ->> 'rules', ''), sponsored = coalesce((p ->> 'sponsored')::boolean, false), extend_days = coalesce((p ->> 'extend_days')::int, 7)
    where id = rid and status = 'open';
  return json_build_object('ok', true, 'id', rid);
end;
$$;
revoke all on function public.mp_admin_raffle_save(jsonb) from public, anon;
grant execute on function public.mp_admin_raffle_save(jsonb) to authenticated;

create or replace function public.mp_admin_raffle_action(p_id bigint, p_action text, p_user uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r public.mp_raffles; w public.mp_raffle_winners; nxt public.mp_raffle_winners;
begin
  perform public.mp__admin_check();
  select * into r from public.mp_raffles where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if p_action = 'cancel' then
    if r.status <> 'open' then return json_build_object('ok', false, 'error', 'not_open'); end if;
    insert into public.mp_point_ledger (user_id, delta, reason, ref)
      select user_id, count(*)::int * r.entry_cost, 'raffle_refund', p_id::text from public.mp_raffle_entries where raffle_id = p_id group by user_id;
    update public.mp_raffles set status = 'cancelled', drawn_at = now() where id = p_id;
    return json_build_object('ok', true);
  elsif p_action = 'draw' then
    if r.status <> 'open' then return json_build_object('ok', false, 'error', 'not_open'); end if;
    update public.mp_raffles set extended = true where id = p_id;
    perform public.mp__draw_raffle(p_id);
    return json_build_object('ok', true);
  elsif p_action = 'ship' then
    update public.mp_raffle_winners set shipped_at = now() where raffle_id = p_id and user_id = p_user and claimed_at is not null;
    return json_build_object('ok', found);
  elsif p_action = 'promote' then
    select * into w from public.mp_raffle_winners where raffle_id = p_id and not reserve and not forfeited and claimed_at is null
      and now() > coalesce(claim_until, r.drawn_at + make_interval(days => r.claim_days)) order by rank limit 1;
    if not found then return json_build_object('ok', false, 'error', 'no_expired_winner'); end if;
    select * into nxt from public.mp_raffle_winners where raffle_id = p_id and reserve and not forfeited order by rank limit 1;
    if not found then return json_build_object('ok', false, 'error', 'no_reserve'); end if;
    update public.mp_raffle_winners set forfeited = true, ship_name = null, ship_phone = null, ship_addr = null where raffle_id = p_id and user_id = w.user_id;
    update public.mp_raffle_winners set reserve = false, claim_until = now() + make_interval(days => r.claim_days) where raffle_id = p_id and user_id = nxt.user_id;
    return json_build_object('ok', true, 'promoted', nxt.display_name);
  end if;
  return json_build_object('ok', false, 'error', 'bad_action');
end;
$$;
revoke all on function public.mp_admin_raffle_action(bigint, text, uuid) from public, anon;
grant execute on function public.mp_admin_raffle_action(bigint, text, uuid) to authenticated;

-- 5) 이용권 3단계: 결제 기록에 플러스·프리미엄 (예전 'pro'는 프리미엄으로 봄) --------
alter table public.mp_payments drop constraint if exists mp_payments_plan_check;
alter table public.mp_payments add constraint mp_payments_plan_check check (plan in ('pro', 'plus', 'premium'));
update public.mp_payments set plan = 'premium' where plan = 'pro';
alter table public.mp_payments alter column plan set default 'premium';

-- =========================================================
-- 마이플래너 PRO 결제 기록 (웹 토스 결제)
-- 서버 함수(myplanner-payments)만 서비스 키로 읽고 씀. 앱·웹에서 직접 읽거나 쓸 수 없음 (RLS 켜고 정책 없음)
-- 앱(아이폰·안드로이드) 구독은 애플·구글 → RevenueCat이 기록하므로 여기에는 없음
-- 마이플래너(mp_) 표만 새로 만듦. 버디플래너 표는 바꾸지 않음.
-- =========================================================

create table if not exists public.mp_payments (
  order_id     text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  plan         text not null default 'pro' check (plan in ('pro')),
  amount       integer not null check (amount > 0),
  order_name   text not null,
  status       text not null default 'READY' check (status in ('READY','DONE','FAILED','WAITING_FOR_DEPOSIT','CANCELED')),
  payment_key  text,
  method       text,
  approved_at  timestamptz,
  period_end   timestamptz,
  fail_reason  text,
  mode         text not null default 'test' check (mode in ('test','live')),
  created_at   timestamptz not null default now()
);

create index if not exists mp_payments_user_done on public.mp_payments (user_id, period_end desc) where status = 'DONE';

alter table public.mp_payments enable row level security;
revoke all on public.mp_payments from anon, authenticated;

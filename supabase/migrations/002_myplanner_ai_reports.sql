-- 마이플래너 AI 비서 답변 신고 (구글 플레이 생성형 AI 정책) — 2026-11-04 적용
create table if not exists public.mp_ai_reports (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question   text check (question is null or char_length(question) <= 2000),
  answer     text not null check (char_length(answer) <= 4000),
  reason     text not null check (reason in ('wrong', 'inappropriate', 'unsafe', 'other')),
  note       text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
alter table public.mp_ai_reports enable row level security;
drop policy if exists mp_ai_reports_insert on public.mp_ai_reports;
create policy mp_ai_reports_insert on public.mp_ai_reports for insert to authenticated
  with check (user_id = (select auth.uid()));
-- 읽기 정책 없음: 운영자만 대시보드에서 확인
revoke all on public.mp_ai_reports from anon;
grant insert on public.mp_ai_reports to authenticated;
comment on table public.mp_ai_reports is '마이플래너 AI 비서 답변 신고 (운영자 검토용)';

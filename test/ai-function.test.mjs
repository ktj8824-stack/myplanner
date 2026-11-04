// AI 비서 서버 함수 확인 (가짜 Claude·Supabase): node --no-warnings test/ai-function.test.mjs
import assert from 'node:assert';
import { handle, checkAction, calendarTable, systemPrompt } from '../supabase/functions/ai/index.ts';

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'sk' };
const ctx = { today: '2026-11-03', weekday: '화', upcoming: [{ idx: 0, title: '판교 출근', date: '2026-11-04' }] };
let usage = 0, claudeCalls = [], script = [];
const fake = (opts = {}) => async (url, init = {}) => {
  if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(opts.noUser ? {} : { id: 'u1' }), { status: opts.noUser ? 401 : 200 });
  if (url.includes('mp_ai_try_use')) {
    if (opts.noTable) return new Response('{"message":"function not found"}', { status: 404 });
    const { p_limit } = JSON.parse(init.body); usage++;
    return new Response(String(usage <= p_limit ? p_limit - usage : -1), { status: 200 });
  }
  if (url.includes('anthropic.com')) {
    const b = JSON.parse(init.body); claudeCalls.push(b);
    return new Response(JSON.stringify(script.shift()), { status: 200 });
  }
  if (url.includes('revenuecat')) return new Response('{}', { status: 404 });
  throw new Error('unexpected ' + url);
};
const req = (body, auth = 'Bearer tok') => new Request('https://x/fn', { method: 'POST', headers: { Authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });

// 1) 일정 제안 → 카드(actions), 저장은 안 함
script = [
  { stop_reason: 'tool_use', content: [{ type: 'text', text: '등록해 드릴게요.' }, { type: 'tool_use', id: 't1', name: 'propose_schedule',
    input: { title: '아산병원 진료', date: '2026-11-04', kind: 'event', time: '10:00', place: '서울아산병원', buffer_min: 15 } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: '아래 카드에서 확인해 주세요.' }] },
];
let r = await handle(req({ message: '내일 10시 아산병원 가야 돼', context: ctx }), env, fake());
let j = await r.json();
assert.strictEqual(r.status, 200);
assert.deepStrictEqual(j.actions.map(a => [a.type, a.title, a.time, a.buffer_min]), [['schedule', '아산병원 진료', '10:00', 15]]);
assert.strictEqual(j.reply, '아래 카드에서 확인해 주세요.');
assert.ok(claudeCalls[0].system.includes('2026-11-03') && claudeCalls[0].system.includes('판교 출근'));
assert.strictEqual(j.pro, false); assert.strictEqual(j.remaining, 4);
console.log('✓ 말 한마디 → 일정 제안 카드 (무료 남은 횟수 4)');

// 2) 잘못된 제안(장소 없음)은 AI에게 되돌려 다시 묻게 함
script = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'propose_schedule', input: { title: '병원', date: '2026-11-04', kind: 'event', time: '10:00' } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: '어느 병원으로 가시나요?' }] },
];
claudeCalls = [];
j = await (await handle(req({ message: '내일 10시 병원', context: ctx }), env, fake())).json();
assert.strictEqual(j.actions.length, 0); assert.strictEqual(j.reply, '어느 병원으로 가시나요?');
assert.ok(JSON.stringify(claudeCalls[1].messages.at(-1)).includes('is_error'));
console.log('✓ 빠진 정보는 카드 대신 되묻기');

// 3) 변경 제안 검사
assert.strictEqual(checkAction('propose_update', { idx: 0, new_time: '11:00' }, ctx), null);
assert.ok(checkAction('propose_update', { idx: 5, new_time: '11:00' }, ctx));
assert.ok(checkAction('propose_update', { idx: 0 }, ctx));
assert.ok(checkAction('propose_schedule', { title: 'x', date: '내일', kind: 'event', time: '10:00', place: 'a' }, ctx));
console.log('✓ 변경 제안 검사 (없는 일정·빈 변경·잘못된 날짜 거절)');

// 4) 무료 한도: 5번 쓰면 6번째는 PRO 안내
usage = 5;
r = await handle(req({ message: '안녕', context: ctx }), env, fake());
j = await r.json();
assert.strictEqual(r.status, 429); assert.ok(j.message.includes('PRO'));
console.log('✓ 무료 하루 5회 넘으면 PRO 안내');

// 5) PRO(시험 모드)는 60회
usage = 5; script = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: '안녕하세요!' }] }];
j = await (await handle(req({ message: '안녕', context: ctx }), { ...env, MYPLANNER_AI_ALLOW_ALL: 'true' }, fake())).json();
assert.strictEqual(j.pro, true); assert.strictEqual(j.remaining, 54);
console.log('✓ PRO는 하루 60회');

// 6) 로그인 안 함 / 서버 준비 전 / 빈 말
assert.strictEqual((await handle(req({ message: 'x' }, ''), env, fake())).status, 401);
assert.strictEqual((await handle(req({ message: 'x' }), env, fake({ noUser: true }))).status, 401);
assert.strictEqual((await handle(req({ message: 'x' }), env, fake({ noTable: true }))).status, 503);
assert.strictEqual((await handle(req({ message: '  ' }), env, fake())).status, 400);
console.log('✓ 로그인 필요 · 서버 준비 전 안내 · 빈 말 거절');

// 7) 날짜표: 요일·이번 주/다음 주를 서버가 계산 (2026-11-03은 화요일)
const cal = calendarTable('2026-11-03').split('\n');
assert.strictEqual(cal.length, 21);
assert.ok(cal[0].startsWith('2026-11-03(화) 오늘'));
assert.ok(cal[1].includes('내일') && cal[1].includes('이번 주 수요일'));
assert.ok(cal[2].includes('모레'));
assert.ok(cal.find(l => l.startsWith('2026-11-07')).includes('이번 주 토요일') && cal.find(l => l.startsWith('2026-11-07')).includes('이번 주말'));
assert.ok(cal.find(l => l.startsWith('2026-11-09')).includes('다음 주 월요일'));
assert.ok(cal.find(l => l.startsWith('2026-11-11')).includes('다음 주 수요일'));
assert.ok(cal.find(l => l.startsWith('2026-11-16')).includes('다다음 주 월요일'));
assert.ok(calendarTable('2026-11-08')[0] && calendarTable('2026-11-08').split('\n')[1].includes('다음 주 월요일')); // 일요일 다음 날은 다음 주
assert.strictEqual(calendarTable('어제'), '');
assert.ok(systemPrompt(ctx).includes('[날짜표]') && systemPrompt(ctx).includes('2026-11-11(수)'));
console.log('✓ 날짜표 (오늘·내일·모레·이번 주·다음 주·주말)');

// 8) 지난 날짜·잘못된 매주 반복 거절
assert.ok(checkAction('propose_schedule', { title: 'x', date: '2026-11-01', kind: 'event', time: '10:00', place: 'a' }, ctx));
assert.ok(checkAction('propose_schedule', { title: 'x', date: '2026-11-04', kind: 'event', time: '10:00', place: 'a', repeat: 'weekly' }, ctx));
assert.strictEqual(checkAction('propose_schedule', { title: 'x', date: '2026-11-04', kind: 'event', time: '10:00', place: 'a', repeat: 'weekly', repeat_days: [2, 4] }, ctx), null);
assert.ok(checkAction('propose_update', { idx: 0, new_date: '2026-10-30' }, ctx));
console.log('✓ 지난 날짜·요일 없는 매주 반복 거절');
{
  const c2 = { today: '2026-11-04', now: '15:00', upcoming: [{}] };
  const ev = o => checkAction('propose_schedule', { title: 'a', kind: 'event', place: 'x', ...o }, c2);
  assert.ok(ev({ date: '2026-11-04', time: '08:00' }));                 // 오늘 이미 지난 시각
  assert.strictEqual(ev({ date: '2026-11-04', time: '16:00' }), null);
  assert.strictEqual(ev({ date: '2026-11-04', time: '08:00', repeat: 'daily' }), null); // 반복은 다음 회차부터
  assert.ok(ev({ date: '2026-11-31', time: '08:00' }));                 // 없는 날짜
  assert.ok(ev({ date: '2026-11-05', time: '08:00', prep_min: -500 })); // 이상한 준비 시간
  assert.ok(checkAction('propose_update', { idx: 0, new_date: '2026-02-30' }, c2));
  console.log('✓ 오늘 지난 시각·없는 날짜·이상한 분 거절');
}
console.log('\nAI 비서 서버 함수 확인 완료');

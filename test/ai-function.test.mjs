// AI 비서 서버 함수 확인 (가짜 Claude·Supabase): node --no-warnings test/ai-function.test.mjs
import assert from 'node:assert';
import { handle, checkAction } from '../supabase/functions/ai/index.ts';

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
console.log('\nAI 비서 서버 함수 확인 완료');

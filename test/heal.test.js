// 어림 경로 → 실제 경로 자동 교체 확인: node test/heal.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.navigator = { onLine: true };
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; } };
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
global.Routes = load('routes.js', 'Routes');
let resched = 0; global.Alarm = { rescheduleAll: async () => { resched++; } };
global.Cloud = undefined;
const home = { name: '집', lat: 37.5, lng: 126.9 }, dest = { name: '회사', lat: 37.49, lng: 127.02 };
const est = { travelMin: 40, steps: [], source: 'estimate' };
const day = Recur.shift(U.today(), 2), far = Recur.shift(U.today(), 30);
State.schedules = [
  { id: 'a', title: 'A', date: day, arriveBy: '09:00', mode: 'car', origin: home, dest, route: { ...est } },
  { id: 'b', title: 'B', date: far, arriveBy: '09:00', mode: 'car', origin: home, dest, route: { ...est } },          // 너무 먼 날
  { id: 'c', title: 'C', date: day, arriveBy: '09:00', mode: 'car', origin: home, dest, route: { ...est }, demo: true } // 예시
];
(async () => {
  // 1) 경로 서버가 여전히 안 되면 그대로
  Routes.options = async () => [{ ...est }];
  assert.strictEqual(await Routes.healEstimates(), false);
  assert.strictEqual(resched, 0);
  // 1-1) 방금 실패한 일정은 6시간 동안 다시 부르지 않음 (앱을 열 때마다 같은 실패 반복 방지)
  let calls = 0;
  Routes.options = async () => { calls++; return [{ ...est }]; };
  assert.strictEqual(await Routes.healEstimates(), false);
  assert.strictEqual(calls, 0);
  const f = JSON.parse(localStorage.getItem('mp_heal_fail')); f.a -= 7 * 3600000; localStorage.setItem('mp_heal_fail', JSON.stringify(f)); // 7시간 지난 셈
  // 2) 되면 가까운 실제 일정만 바꾸고 알람 다시 맞춤
  Routes.options = async () => { calls++; return [{ travelMin: 33, steps: [], source: 'tmap' }]; };
  assert.strictEqual(await Routes.healEstimates(), true);
  assert.strictEqual(State.get('a').route.source, 'tmap');
  assert.strictEqual(State.get('b').route.source, 'estimate');
  assert.strictEqual(State.get('c').route.source, 'estimate');
  assert.strictEqual(calls, 1);
  assert.strictEqual(resched, 1);
  assert.ok(!JSON.parse(localStorage.getItem('mp_heal_fail')).a); // 성공하면 실패 기록 지움
  // 2-1) 700m 안쪽은 경로 API 없이 걷는 시간 (가까움으로 저장 → 다시 조회 대상 아님)
  const R2 = load('routes.js', 'Routes'); let api = 0; R2.api = async () => { api++; return null; };
  const near = { name: '옆 건물', lat: 37.5009, lng: 126.9 }; // 약 100m
  const w = (await R2.options(home, near, 'transit'))[0], w2 = (await R2.options(home, near, 'walk'))[0];
  assert.strictEqual(api, 0);
  assert.strictEqual(w.source, 'near'); assert.ok(w.travelMin >= 1 && w.travelMin <= 3); assert.ok(w.summary.includes('가까운 거리'));
  assert.strictEqual(w2.source, 'near');
  console.log('✓ 700m 안쪽은 경로 API를 부르지 않음 · 실패한 일정은 6시간 뒤에 다시');
  // 3) 오프라인이면 시도하지 않음
  State.get('a').route = { ...est }; navigator.onLine = false; calls = 0;
  assert.strictEqual(await Routes.healEstimates(), false);
  assert.strictEqual(calls, 0);
  console.log('✓ 어림 경로 자동 교체 (가까운 일정만 · 예시 제외 · 오프라인 건너뜀)');
  console.log('경로 자동 교체 테스트 완료');
})().catch(e => { console.error(e); process.exit(1); });

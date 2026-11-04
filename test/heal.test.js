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
  // 2) 되면 가까운 실제 일정만 바꾸고 알람 다시 맞춤
  let calls = 0;
  Routes.options = async () => { calls++; return [{ travelMin: 33, steps: [], source: 'tmap' }]; };
  assert.strictEqual(await Routes.healEstimates(), true);
  assert.strictEqual(State.get('a').route.source, 'tmap');
  assert.strictEqual(State.get('b').route.source, 'estimate');
  assert.strictEqual(State.get('c').route.source, 'estimate');
  assert.strictEqual(calls, 1);
  assert.strictEqual(resched, 1);
  // 3) 오프라인이면 시도하지 않음
  State.get('a').route = { ...est }; navigator.onLine = false; calls = 0;
  assert.strictEqual(await Routes.healEstimates(), false);
  assert.strictEqual(calls, 0);
  console.log('✓ 어림 경로 자동 교체 (가까운 일정만 · 예시 제외 · 오프라인 건너뜀)');
  console.log('경로 자동 교체 테스트 완료');
})().catch(e => { console.error(e); process.exit(1); });

// 가까운 거리는 도보로 (버스·지하철 '정류장·역 대기 5분'이 붙지 않게): node test/shortwalk.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.navigator = { onLine: true };
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };
global.requestAnimationFrame = () => {};
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
global.Routes = load('routes.js', 'Routes');
global.Alarm = { rescheduleAll: async () => {} };
global.Cloud = undefined;
const { DayPlan } = require('../js/day.js'); global.DayPlan = DayPlan;
let html = ''; global.App = { setMain(h) { html = h; }, navigate() {} };
U.toast = () => {};
global.Register = load('register.js', 'Register');

const D = Recur.shift(U.today(), 3);
const home = { name: '집', lat: 37.5000, lng: 127.0000 };
const kinder = { name: '유치원', lat: 37.5027, lng: 127.0000 };   // 약 300m
const mid = { name: '도서관', lat: 37.5058, lng: 127.0000 };      // 약 650m
const far = { name: '회사', lat: 37.5300, lng: 127.0300 };        // 약 4km
const walk5 = { travelMin: 5, source: 'tmap', summary: '도보 5분', steps: [{ type: 'walk', label: '도보', to: '유치원', min: 5 }] };
const bus = { travelMin: 20, source: 'odsay', summary: '20분', steps: [{ type: 'walk', label: '도보', min: 3 }, { type: 'bus', label: '146번 버스', min: 14 }, { type: 'walk', label: '도보', min: 3 }] };
const mk = (extra = {}) => ({ id: 'k', title: '하원', date: D, arriveBy: '14:40', mode: 'transit', origin: { ...home }, dest: { ...kinder },
  prepMin: 60, bufferMin: 0, route: null, alarm: { wake: true, depart: true }, repeat: { type: 'none', days: [] }, trip: {}, ...extra });
State.settings.home = home; State.settings.prepMin = 60; State.settings.alarm = { wake: true, depart: true };

(async () => {
  // 0) 바꾸기 전 문제: 버스·지하철 + 걷기만 있는 경로면 '정류장·역 대기 5분'이 붙어 14:30 출발
  const before = Planner.compute(mk({ route: walk5 }));
  assert.strictEqual(U.hm(before.departAt), '14:30');
  const after = Planner.compute(mk({ mode: 'walk', route: walk5 }));
  assert.strictEqual(U.hm(after.departAt), '14:35');
  assert.strictEqual(U.hm(after.wakeAt), '13:35');
  assert.ok(!after.items.some(i => i.kind === 'wait'));

  // 1) 경로 결과가 걷기만 → 도보
  assert.strictEqual(Routes.walkOnly(walk5), true);
  assert.strictEqual(Routes.walkOnly(bus), false);
  assert.strictEqual(await Routes.shortWalk(mk(), home, kinder, walk5), walk5);
  // 2) 직선 700m 안이면 버스 경로(어림값)가 와도 걷기 경로로
  Routes.can = () => false; // 키 없음 → 걷기는 거리로 어림
  const w2 = await Routes.shortWalk(mk({ dest: mid }), home, mid, Routes.estimate(home, mid, 'transit'));
  assert.ok(w2 && Routes.walkOnly(w2));
  // 멀면 그대로 버스·지하철
  assert.strictEqual(await Routes.shortWalk(mk({ dest: far }), home, far, bus), null);
  // 3) 사용자가 직접 버스·지하철을 골랐으면 그대로, 자가용·택시도 그대로
  assert.strictEqual(await Routes.shortWalk(mk({ modeSet: true }), home, kinder, walk5), null);
  assert.strictEqual(await Routes.shortWalk(mk({ mode: 'car' }), home, kinder, walk5), null);
  assert.strictEqual(await Routes.shortWalk(mk({ mode: 'taxi' }), home, mid, null), null);
  console.log('✓ 걷기만 있는 경로·700m 안 → 도보, 직접 고른 버스·지하철·자가용·택시는 그대로');

  // 4) 자동 경로(routeFor): 가까우면 도보, 자동 도보였던 일정이 멀어지면 버스·지하철로
  Routes.options = async (o, d, m) => (m === 'transit' ? [Routes.distanceKm(o, d) < 0.7 ? walk5 : bus] : m === 'walk' ? [walk5] : [{ travelMin: 7, source: 'tmap', steps: [{ type: 'car', label: '자가용', min: 7 }] }]);
  let p = await Routes.routeFor(mk(), home, kinder, null);
  assert.deepStrictEqual([p.mode, p.walkAuto, p.route.travelMin], ['walk', true, 5]);
  p = await Routes.routeFor(mk({ mode: 'walk', walkAuto: true }), home, far, null);
  assert.deepStrictEqual([p.mode, p.walkAuto, p.route.source], ['transit', false, 'odsay']);
  p = await Routes.routeFor(mk({ mode: 'car' }), home, kinder, null);
  assert.strictEqual(p.mode, 'car');
  p = await Routes.routeFor(mk({ modeSet: true }), home, kinder, null);
  assert.strictEqual(p.mode, 'transit');
  // 앞 일정 연결을 풀고 집에서 출발로 되돌릴 때도 (DayPlan.unchainPatch)
  const up = await DayPlan.unchainPatch(mk({ origin: far, chained: { from: 'x' } }));
  assert.deepStrictEqual([up.mode, up.walkAuto, up.route.travelMin], ['walk', true, 5]);
  console.log('✓ 자동 연결·집에서 출발로 되돌리기도 가까우면 도보 (멀어지면 다시 버스·지하철)');

  // 5) 등록 화면: 걷기만 나오면 도보로 바꾸고 한 줄 안내 · '바꾸기'로 버스·지하철을 고르면 다시 바꾸지 않음
  Register.render({});
  Object.assign(Register.d, { title: '하원', date: D, arriveBy: '14:40', dest: { ...kinder }, bufferMin: 0 });
  await Register.fetchRoutes();
  assert.strictEqual(Register.d.mode, 'walk');
  assert.strictEqual(Register.d.walkAuto, true);
  assert.strictEqual(Register.d.route.travelMin, 5);
  assert.ok(html.includes('가까운 거리라 도보로 바꿨어요') && html.includes("Register.set('mode','transit')"));
  assert.strictEqual(U.hm(Planner.compute(Register.d).departAt), '14:35');
  Register.set('mode', 'transit');
  await new Promise(r => setTimeout(r, 0)); await Register.fetchRoutes();
  assert.strictEqual(Register.d.mode, 'transit');
  assert.strictEqual(Register.d.modeSet, true);
  assert.ok(!html.includes('가까운 거리라 도보로'));
  // 자동 도보 뒤 목적지를 먼 곳으로 바꾸면 버스·지하철로 돌아감
  Register.render({});
  Object.assign(Register.d, { date: D, arriveBy: '14:40', dest: { ...kinder } });
  await Register.fetchRoutes();
  assert.strictEqual(Register.d.mode, 'walk');
  Register.d.dest = { ...far }; Register.d.route = null; Register.opts = [];
  await Register.fetchRoutes();
  assert.deepStrictEqual([Register.d.mode, !!Register.d.walkAuto, Register.d.route.source], ['transit', false, 'odsay']);
  // 자가용을 고른 사람은 가까워도 자가용
  Register.render({});
  Object.assign(Register.d, { date: D, arriveBy: '14:40', dest: { ...kinder } });
  Register.set('mode', 'car');
  await new Promise(r => setTimeout(r, 0)); await Register.fetchRoutes();
  assert.strictEqual(Register.d.mode, 'car');
  console.log('✓ 등록 화면: 자동 도보 + 한 줄 안내, 바꾸기로 고른 버스·지하철·자가용은 그대로');

  // 6) 예전에 저장된 버스·지하철 + 걷기만 있는 경로 → 앱을 열 때 도보로 (직접 고른 일정은 그대로). 클라우드 정리에도 표시 유지
  State.schedules = [mk({ id: 'old', route: walk5 }), mk({ id: 'mine', route: walk5, modeSet: true })];
  assert.strictEqual(await Routes.healEstimates(), true);
  assert.deepStrictEqual([State.get('old').mode, State.get('old').walkAuto], ['walk', true]);
  assert.strictEqual(State.get('mine').mode, 'transit');
  const c = U.cleanSchedule({ ...State.get('mine'), walkAuto: true });
  assert.ok(c.modeSet && c.walkAuto);
  console.log('✓ 저장된 가까운 일정도 도보로 바로잡음 · 직접 고른 수단은 그대로');
  console.log('가까운 거리 도보 테스트 완료');
})().catch(e => { console.error(e); process.exit(1); });

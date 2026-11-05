// 같은 날 약속 자동 연결·끼워 넣기 확인: node test/chain.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.navigator = { onLine: true };
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; } };
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
global.Cloud = undefined;
let routeCalls = [];
global.Routes = { options: async (o, d, m) => { routeCalls.push([o.name, d.name, m]); return [{ travelMin: 30, source: 'odsay', steps: [{ type: 'subway', label: '지하철', min: 30 }] }]; } };
const { DayPlan } = require('../js/day.js');
const D = '2030-12-10';
const home = { name: '집', lat: 37.5446, lng: 126.9516 };
State.settings.home = home; State.settings.prepMin = 60; State.settings.alarm = { wake: true, preDepart: true, depart: true, nightBefore: true };
const P = { gangnam: { name: '강남 약속', lat: 37.4979, lng: 127.0276 }, ilsan: { name: '일산 약속', lat: 37.6584, lng: 126.7700 }, cafe: { name: '성수 카페', lat: 37.5445, lng: 127.0560 } };
const mk = (id, title, arriveBy, endBy, dest, extra = {}) => ({ id, title, date: D, arriveBy, endBy, mode: 'transit', dest, origin: { ...home }, prepMin: 60, bufferMin: 10,
  route: { travelMin: 40, source: 'odsay', steps: [{ type: 'subway', label: '지하철', min: 40 }] }, alarm: { ...State.settings.alarm }, repeat: { type: 'none', days: [] }, ...extra });

(async () => {
  // 1) 12:00~15:00 강남 → 18:00 일산 새로 등록: 출발지 자동으로 강남 약속 장소, 기상 없음
  State.schedules = [mk('a', '강남 점심', '12:00', '15:00', P.gangnam)];
  const b = mk('b', '일산 저녁', '18:00', '', P.ilsan);
  const prev = DayPlan.applyAuto(b);
  assert.ok(prev);
  assert.strictEqual(b.origin.name, '강남 약속');
  assert.strictEqual(b.chained.from, 'a');
  assert.strictEqual(b.prepMin, 0);
  assert.strictEqual(b.route, null);                         // 경로는 새로 찾아야 함
  console.log('✓ 앞 약속 장소에서 자동 출발');

  // 2) 끝나는 시간을 모르면·3시간 넘게 비면·집에서 출발을 골랐으면 그대로
  State.schedules = [mk('a', '강남 점심', '12:00', '', P.gangnam)];
  assert.strictEqual(DayPlan.applyAuto(mk('b', 'x', '18:00', '', P.ilsan)), null);
  State.schedules = [mk('a', '강남 점심', '09:00', '10:00', P.gangnam)];
  assert.strictEqual(DayPlan.applyAuto(mk('b', 'x', '18:00', '', P.ilsan)), null);
  State.schedules = [mk('a', '강남 점심', '12:00', '15:00', P.gangnam)];
  assert.strictEqual(DayPlan.applyAuto(mk('b', 'x', '18:00', '', P.ilsan, { homeFirst: true })), null);
  console.log('✓ 끝 시간 모름·오래 빔·집에서 출발 선택은 그대로');

  // 3) 사이에 끼워 넣기: 12~15 강남, 18 일산(강남에서 출발) 사이에 16~17 성수 카페 → 일산은 카페에서 출발로 바뀜
  const b2 = mk('b', '일산 저녁', '18:00', '', P.ilsan); DayPlan.applyAuto(b2); b2.route = { travelMin: 50, source: 'odsay', steps: [] };
  State.schedules = [mk('a', '강남 점심', '12:00', '15:00', P.gangnam), b2];
  const c = mk('c', '성수 카페', '16:00', '17:00', P.cafe);
  DayPlan.applyAuto(c);
  assert.strictEqual(c.origin.name, '강남 약속');               // 카페는 강남에서 출발
  c.route = { travelMin: 25, source: 'odsay', steps: [] };
  State.schedules.push(c);
  routeCalls = [];
  const changed = await DayPlan.rechainNext(c);
  assert.strictEqual(changed, '일산 저녁');
  const nb = State.get('b');
  assert.strictEqual(nb.origin.name, '성수 카페');
  assert.strictEqual(nb.chained.from, 'c');
  assert.deepStrictEqual(routeCalls[0], ['성수 카페', '일산 약속', 'transit']);
  console.log('✓ 끼워 넣으면 다음 약속 출발지·경로 자동 변경');

  // 4) 다음 약속이 직접 고른 다른 곳에서 출발이면 건드리지 않음
  State.schedules = [mk('a', '강남 점심', '12:00', '15:00', P.gangnam), mk('b', '일산 저녁', '18:00', '', P.ilsan, { origin: { name: '사무실', lat: 37.56, lng: 126.97 } })];
  const c2 = mk('c', '성수 카페', '16:00', '17:00', P.cafe); State.schedules.push(c2);
  assert.strictEqual(await DayPlan.rechainNext(c2), null);
  console.log('✓ 사용자가 고른 출발지는 존중');
  console.log('약속 자동 연결 테스트 완료');
})().catch(e => { console.error(e); process.exit(1); });

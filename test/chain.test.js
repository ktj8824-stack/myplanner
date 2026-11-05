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

  // 5) 이어서 가는 일정을 앞 약속보다 이르게(08:00) 바꾸면 연결이 깨진 것으로 보고, 기상 알람을 다시 켬
  State.schedules = [mk('a', '강남 오전', '10:00', '12:00', P.gangnam)];
  const nx = mk('b', '성수 카페', '13:00', '', P.cafe);
  DayPlan.applyAuto(nx); State.schedules.push(nx);
  assert.strictEqual(nx.chained.from, 'a');
  assert.strictEqual(DayPlan.chainBroken(nx), false);
  assert.strictEqual(Planner.compute(nx).chained, true);
  const moved = { ...nx, arriveBy: '08:00' };
  assert.strictEqual(DayPlan.chainBroken(moved), true);
  const pl = Planner.compute(moved);
  assert.strictEqual(pl.chained, false);                                   // 계산도 안전하게: 이어서 출발 아님
  assert.ok(pl.warnings[0].includes('앞 일정보다 먼저'));
  assert.ok(Planner.alarms(moved, pl).some(a => a.key === 'wake'));        // 기상 알람 복구
  routeCalls = [];
  const patch = await DayPlan.unchainPatch(moved);
  assert.strictEqual(patch.chained, false);
  assert.strictEqual(patch.origin.name, '집');
  assert.strictEqual(patch.prepMin, 60);
  assert.deepStrictEqual(routeCalls[0], ['집', '성수 카페', 'transit']);  // 집 기준 경로 다시
  // 반복 일정의 그 날만 푼 경우(chained:false)도 기상 알람이 울림
  const ovOcc = { ...nx, ...patch, route: patch.route };
  const pl2 = Planner.compute(ovOcc);
  assert.ok(!pl2.chained && Planner.alarms(ovOcc, pl2).some(a => a.key === 'wake'));
  // 앞 약속 사이(11:00)로 당겨도 깨짐
  assert.strictEqual(DayPlan.chainBroken({ ...nx, arriveBy: '11:00' }), true);
  console.log('✓ 시간을 앞 약속보다 이르게 바꾸면 연결 풀고 집에서 출발·기상 알람 복구');

  // 6) 지금 위치에서 출발: 원래 출발 시각이 지난 뒤 저장하면 실제 나선 시각 기준으로
  const due = Planner.at(D, '15:00').getTime();
  const urgent = mk('u', '급한 약속', '15:00', '', P.cafe, { startNow: true, prepMin: 0, origin: { name: '지금 위치', lat: 37.5, lng: 127 } });
  const normal = Planner.compute(urgent);
  const travel = (normal.arriveAt - normal.departAt) / 60000;
  urgent.leftAt = due - 20 * 60000;                                         // 14:40에 나섬
  const nowPlan = Planner.compute(urgent);
  assert.strictEqual(U.hm(nowPlan.departAt), '14:40');
  assert.strictEqual((nowPlan.arriveAt - nowPlan.departAt) / 60000, travel);
  const late = travel - 20;
  assert.ok(nowPlan.warnings.some(w => w.includes(`약 ${late}분 늦으니`)));
  assert.ok(nowPlan.items.find(i => i.kind === 'arrive').detail.includes(`${late}분 늦게`));
  assert.ok(nowPlan.items.every(i => i.at >= nowPlan.departAt));           // 지난 시각 줄 없음
  assert.strictEqual(U.cleanSchedule(urgent).leftAt, urgent.leftAt);       // 동기화해도 유지
  assert.ok(!U.cleanSchedule({ ...urgent, startNow: false }).leftAt);
  console.log('✓ 급한 약속은 지금 나선 시각 기준으로 화면·도착 예상');
  console.log('약속 자동 연결 테스트 완료');
})().catch(e => { console.error(e); process.exit(1); });

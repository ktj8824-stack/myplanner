// 집이 아닌 곳에서 출발·집으로 가는 일정 이어서·시간 바퀴 시작 시각 (2026-11-23 점검): node test/dayprep.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.navigator = { onLine: true };
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; } };
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
global.Cloud = undefined;
global.Routes = { options: async () => [] };
const { DayPlan } = require('../js/day.js');
const TimePick = require('../js/timepick.js');

const D = '2030-12-09'; // 월요일
const home = { name: '집', lat: 37.5133, lng: 127.1028 };          // 잠실역 바로 옆
const P = {
  office: { name: '판교 회사', lat: 37.4020, lng: 127.1086 },
  hongdae: { name: '홍대입구', lat: 37.5571, lng: 126.9245 },
  jamsil: { name: '잠실역', lat: 37.5132, lng: 127.1001 },          // 집에서 약 240m
  homeDoor: { name: '우리 집', lat: 37.5135, lng: 127.1030 }
};
State.settings.home = home; State.settings.prepMin = 60;
State.settings.alarm = { wake: true, preDepart: true, depart: true, nightBefore: true };
const route = min => ({ travelMin: min, source: 'odsay', steps: [{ type: 'subway', label: '지하철', min }] });
const mk = (id, title, arriveBy, endBy, dest, extra = {}) => ({ id, title, date: D, arriveBy, endBy, mode: 'transit', dest, origin: { ...home }, prepMin: 60, bufferMin: 10,
  route: route(40), alarm: { ...State.settings.alarm }, repeat: { type: 'none', days: [] }, ...extra });

// 1) M14: 회사(판교)에서 바로 홍대로 → 준비 '바로 출발'·준비 알람 끔, 저장한 일정의 알람에 준비(기상) 알람 없음
assert.ok(DayPlan.distM(home, P.jamsil) < 300);
assert.ok(DayPlan.awayFromHome(P.office));
assert.ok(!DayPlan.awayFromHome(P.jamsil));
assert.ok(!DayPlan.awayFromHome(P.office, null));                  // 집 주소가 없으면 판단하지 않음
State.schedules = [];
const m14 = mk('m14', '홍대 저녁', '19:00', '', P.hongdae, { origin: { ...P.office }, route: route(70) });
assert.strictEqual(DayPlan.applyAway(m14), true);
assert.strictEqual(m14.prepMin, 0);
assert.strictEqual(m14.alarm.wake, false);
assert.strictEqual(m14.alarm.depart, true);
let plan = Planner.compute(m14);
assert.strictEqual(plan.wakeAt.getTime(), plan.departAt.getTime());
let keys = Planner.alarms(m14, plan).map(a => a.key);
assert.ok(!keys.includes('wake'), keys.join());
assert.ok(keys.includes('depart') && keys.includes('pre') && keys.includes('next'), keys.join());
// 클라우드 동기화(정리) 뒤에도 그대로 → 다른 폰에서도 준비 알람 없음
const synced = U.cleanSchedule(m14);
assert.strictEqual(synced.prepMin, 0);
assert.strictEqual(synced.alarm.wake, false);
assert.ok(!Planner.alarms(synced, Planner.compute(synced)).some(a => a.key === 'wake'));
// 집에서 출발·이어서 출발·지금 위치 출발은 건드리지 않음
assert.strictEqual(DayPlan.applyAway(mk('h', 'x', '19:00', '', P.hongdae)), false);
assert.strictEqual(DayPlan.applyAway(mk('c', 'x', '19:00', '', P.hongdae, { origin: { ...P.office }, chained: { from: 'z' }, prepMin: 0 })), false);
// 사용자가 다시 준비 시간을 고르면 그 값대로 계산 (준비 알람을 켜면 울림)
const back = { ...m14, prepMin: 30, alarm: { ...m14.alarm, wake: true } };
plan = Planner.compute(back);
assert.strictEqual((plan.departAt - plan.wakeAt) / 60000, 30);
assert.ok(Planner.alarms(back, plan).some(a => +a.at === +plan.wakeAt));   // 낮 일정: 준비 시작 시각에 알림 (30분 전 알림과 겹침)
assert.ok(!Planner.alarms(back, plan).some(a => a.key === 'wake'));      // 낮 일정은 전체 화면 기상 알람 없음
console.log('✓ 집이 아닌 곳에서 출발: 바로 출발 · 준비 알람 끔');

// 2) 시간 바퀴 시작 시각
const now = new Date(2030, 11, 9, 12, 10);
assert.deepStrictEqual(TimePick.startAt({ value: '09:00', kind: 'arrive', now }), [14, 0]);
assert.deepStrictEqual(TimePick.startAt({ value: '', kind: 'arrive', now }), [14, 0]);
assert.deepStrictEqual(TimePick.startAt({ value: '09:00', kind: 'arrive', now: new Date(2030, 11, 9, 12, 40) }), [15, 0]);
assert.deepStrictEqual(TimePick.startAt({ value: '', kind: 'arrive', now: new Date(2030, 11, 9, 22, 50) }), [1, 0]);
assert.deepStrictEqual(TimePick.startAt({ value: '19:00', kind: 'arrive', now }), [19, 0]);          // 고른 값은 그대로
assert.deepStrictEqual(TimePick.startAt({ value: '09:00', kind: 'arrive', fresh: false, now }), [9, 0]); // 수정 중인 09:00 약속은 그대로
assert.deepStrictEqual(TimePick.startAt({ value: '', kind: 'end', arrive: '19:00', now }), [20, 0]);
assert.deepStrictEqual(TimePick.startAt({ value: '', kind: 'end', arrive: '23:30', now }), [0, 30]);
assert.deepStrictEqual(TimePick.startAt({ value: '21:15', kind: 'end', arrive: '19:00', now }), [21, 15]);
assert.deepStrictEqual(TimePick.startAt({ value: '', kind: '', now }), [9, 0]);
console.log('✓ 시간 바퀴: 지금+2시간 · 도착+1시간에서 시작');

// 3) M15: 18:50 잠실역 아이 픽업(10분) → 19:30 잠실역 옆 집 저녁 — 집에서 준비 60분이 아니라 잠실역에서 이어서
State.schedules = [
  mk('off', '퇴근', '18:20', '', P.office),
  mk('kid', '아이 픽업', '18:50', '19:00', P.jamsil, { origin: { ...P.office }, prepMin: 0 })
];
const dinner = mk('din', '집 저녁', '19:30', '', P.homeDoor, { route: route(1) });
assert.ok(DayPlan.within(dinner.origin, dinner.dest));
const prev = DayPlan.applyAuto(dinner);
assert.ok(prev);
assert.strictEqual(prev.s.id, 'kid');
assert.strictEqual(dinner.origin.name, '잠실역');
assert.strictEqual(dinner.chained.from, 'kid');
assert.strictEqual(dinner.prepMin, 0);
assert.strictEqual(dinner.alarm.wake, false);
dinner.route = route(5);
plan = Planner.compute(dinner);
assert.ok(plan.chained);
assert.ok(!Planner.alarms(dinner, plan).some(a => a.key === 'wake'));
// 앞 약속이 끝나는 시간을 몰라도 시작 기준으로 이어서
State.schedules = [mk('kid', '아이 픽업', '18:50', '', P.jamsil, { origin: { ...P.office } })];
const d2 = mk('din', '집 저녁', '19:30', '', P.homeDoor);
assert.ok(DayPlan.applyAuto(d2));
assert.strictEqual(d2.origin.name, '잠실역');
// 집 근처가 아닌 목적지는 예전 그대로 (끝나는 시간을 알아야 연결)
assert.strictEqual(DayPlan.applyAuto(mk('x', 'x', '19:30', '', P.hongdae)), null);
// 앞 약속이 3시간 넘게 전이면·집에서 출발을 골랐으면·앞 약속이 없으면 그대로
State.schedules = [mk('kid', '아이 픽업', '10:00', '11:00', P.jamsil)];
assert.strictEqual(DayPlan.applyAuto(mk('din', '집 저녁', '19:30', '', P.homeDoor)), null);
State.schedules = [mk('kid', '아이 픽업', '18:50', '19:00', P.jamsil)];
assert.strictEqual(DayPlan.applyAuto(mk('din', '집 저녁', '19:30', '', P.homeDoor, { homeFirst: true })), null);
State.schedules = [];
assert.strictEqual(DayPlan.applyAuto(mk('din', '집 저녁', '19:30', '', P.homeDoor)), null);
console.log('✓ 집으로 가는 일정: 앞 일정 장소에서 이어서 (준비·기상 알람 없음)');

// 기상 알람은 아침 일정만 · 1시간 전·30분 전 알림과 출발 알람은 항상 (2026-11-24)
{
  const base = { title: 'T', date: D, mode: 'car', prepMin: 60, bufferMin: 0, origin: home, dest: P.office, route: { travelMin: 40, steps: [] },
    alarm: { wake: false, preDepart: false, depart: false, nightBefore: false } };   // 예전에 끈 값이 남아 있어도 기상 외에는 무시
  const ks = o => { const s = { ...base, ...o }; return Planner.alarms(s, Planner.compute(s)); };
  const am = ks({ arriveBy: '09:00', alarm: { wake: true } });
  assert.deepStrictEqual(am.map(a => a.key), ['night', 'wake', 'next', 'pre', 'depart']);
  assert.strictEqual(am.find(a => a.key === 'wake').alarm, true);
  assert.strictEqual((am.find(a => a.key === 'depart').at - am.find(a => a.key === 'pre').at) / 60000, 30);
  assert.strictEqual((am.find(a => a.key === 'depart').at - am.find(a => a.key === 'next').at) / 60000, 60);
  assert.ok(!am.find(a => a.key === 'next').alarm && !am.find(a => a.key === 'pre').alarm);
  const pm = ks({ arriveBy: '15:00', prepMin: 90, alarm: { wake: true } });          // 준비 12:50 → 낮 일정
  assert.deepStrictEqual(pm.map(a => a.key), ['night', 'prep', 'next', 'pre', 'depart']);
  assert.ok(!pm.find(a => a.key === 'prep').alarm);
  const off = ks({ arriveBy: '09:00' });                                              // 집이 아닌 곳에서 바로 출발(wake:false)
  assert.deepStrictEqual(off.map(a => a.key), ['night', 'next', 'pre', 'depart']);
  console.log('✓ 기상 알람은 아침 일정만 · 1시간·30분 전 알림 · 출발 알람 항상');
}

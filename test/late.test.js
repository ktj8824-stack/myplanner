// 11-18 점검 확인: 이어서 출발은 앞 약속 끝난 뒤 · 밤 약속 중 홈에 남김 · 이 날만 이동 수단 · 지금 나가면 · 기차 탈 수 있는지
// node test/late.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.navigator = { onLine: true };
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; } };
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
global.Cloud = undefined;
const Weather = require('../js/weather.js');
const { DayPlan } = require('../js/day.js');
const hm = U.hm;
const D = '2030-12-10'; // 화요일
const home = { name: '집', lat: 37.5446, lng: 126.9516 };
const euljiro = { name: '을지로 식당', lat: 37.5660, lng: 126.9910 };
const pangyo = { name: '판교 회사', lat: 37.3948, lng: 127.1112 };
const sub = min => ({ travelMin: min, source: 'odsay', steps: [{ type: 'subway', label: '신분당선', min }] });

// 1) M8: 을지로 점심 12:30~13:20 → 판교 오후 회의 14:00 (이어서, 버스·지하철 50분)
const lunch = { id: 'lunch', title: '을지로 점심', date: D, arriveBy: '12:30', endBy: '13:20', mode: 'transit', prepMin: 60, bufferMin: 10,
  origin: home, dest: euljiro, route: sub(30), repeat: { type: 'none', days: [] } };
const meet = { id: 'meet', title: '판교 회사 오후 회의', date: D, arriveBy: '14:00', mode: 'transit', prepMin: 0, bufferMin: 10,
  origin: euljiro, dest: pangyo, chained: { from: 'lunch' }, route: sub(50), repeat: { type: 'none', days: [] } };
State.schedules = [lunch, meet];
let p = Planner.compute(meet);
assert.strictEqual(p.chained, true);
assert.strictEqual(hm(p.departAt), '13:20');               // 12:55 가 아니라 앞 약속 끝
assert.strictEqual(hm(p.wakeAt), '13:20');
assert.strictEqual(hm(p.arriveAt), '14:15');               // 13:20 + 대기 5 + 50
assert.strictEqual(p.lateMin, 15);
assert.strictEqual(p.heldByPrev, true);
assert.strictEqual(Planner.chainLateLine(p, meet), '앞 약속 끝(13:20) 바로 나가면 14:15 도착 · 약속보다 15분 늦어요');
assert.ok(p.warnings[0].startsWith('앞 약속 끝(13:20) 바로 나가면 14:15 도착'));
// 알람: 출발 알람도 13:20 (앞 약속 중에 울리지 않음). 지난 날이면 알람이 걸러지므로 시각만 확인
const dep = (() => { const now = Date.now; Date.now = () => Planner.at(D, '06:00').getTime(); try { return Planner.alarms(meet, p).find(a => a.key === 'depart'); } finally { Date.now = now; } })();
assert.strictEqual(hm(dep.at), '13:20');
// 실시간 재확인이 출발을 다시 앞으로 당기지 않게
assert.strictEqual(Planner.rideSpec(meet, p), null);
console.log('✓ 이어서 출발은 앞 약속 끝(13:20) 이후 · 14:15 도착 · 15분 늦음 · 출발 알람 13:20');

// 1-1) 하루 동선: 같은 숫자로 겹침 안내
const list = DayPlan.build([lunch, meet].map(s => ({ s, plan: Planner.compute(s) })));
assert.strictEqual(list[1].conflict, true);
assert.strictEqual(list[1].lateMin, 15);
console.log('✓ 하루 동선 겹침 안내도 15분');

// 1-2) 넉넉하면 그대로 (16:00 약속 → 14:55 출발, 늦지 않음)
const meet2 = { ...meet, arriveBy: '16:00' };
p = Planner.compute(meet2);
assert.strictEqual(hm(p.departAt), '14:55');
assert.strictEqual(p.lateMin, 0);
assert.strictEqual(p.heldByPrev, false);
assert.strictEqual(Planner.chainLateLine(p, meet2), '');
// 앞 일정 끝나는 시간을 모르면 예전처럼
State.schedules = [{ ...lunch, endBy: '' }, meet];
assert.strictEqual(hm(Planner.compute(meet).departAt), '12:55');
State.schedules = [lunch, meet];
console.log('✓ 여유 있으면·끝 시간 모르면 그대로');

// 1-3) 기차: 앞 약속 끝 13:20 → 서울역 14:00 KTX (역까지 30분)
const ktx = { id: 'ktx', title: 'KTX', date: D, mode: 'train', prepMin: 0, bufferMin: 10, origin: euljiro, chained: { from: 'lunch' },
  trip: { accessMode: 'transit', departTime: '14:00', arriveTime: '16:30', departStation: { name: '서울역', lat: 37.555, lng: 126.97 } },
  accessRoute: sub(30), repeat: { type: 'none', days: [] } };
p = Planner.compute(ktx);
assert.strictEqual(hm(p.departAt), '13:20');
assert.strictEqual(hm(p.stationAt), '13:55');
assert.strictEqual(p.lateMin, 10);                          // 승강장 여유 15분 중 10분 모자람
assert.strictEqual(p.missTrip, false);
assert.ok(Planner.chainLateLine(p, ktx).includes('승강장 여유가 10분 모자라요'));
console.log('✓ 기차도 앞 약속 끝 이후 출발 · 승강장 여유 모자람 안내');

// 2) 지금 나가면 (등록 화면 now-box 와 홈 카드가 같이 쓰는 계산)
const solo = { title: '판교', date: D, arriveBy: '14:00', mode: 'transit', prepMin: 30, bufferMin: 10, origin: home, dest: pangyo, route: sub(50) };
p = Planner.compute(solo);
let ln = Planner.leaveNow(solo, p, Planner.at(D, '13:20').getTime());
assert.strictEqual(hm(ln.at), '14:15');
assert.strictEqual(ln.lateMin, 15);
ln = Planner.leaveNow(solo, p, Planner.at(D, '12:58').getTime());
assert.strictEqual(hm(ln.at), '13:53');
assert.ok(ln.lateMin < 0);
console.log('✓ 지금 나가면 몇 시 도착 · 몇 분 늦는지');

// 3) 밤 약속(21:00~23:30, 집으로·막차 23:52) 중 23:20 에도 State.upcoming 에 남음
const night = { id: 'night', title: '홍대 모임', date: U.today(), arriveBy: '21:00', endBy: '23:30', mode: 'transit', prepMin: 30, bufferMin: 10,
  origin: home, dest: { name: '홍대입구', lat: 37.5572, lng: 126.9245 }, route: sub(20), repeat: { type: 'none', days: [] },
  goHome: { on: true, mode: 'transit', lastTime: '23:52', route: { travelMin: 30, source: 'odsay', steps: [{ type: 'walk', label: '도보', min: 6 }, { type: 'subway', label: '2호선', min: 24 }] } } };
p = Planner.compute(night);
assert.strictEqual(hm(p.homeDepartAt), '23:35');
assert.strictEqual(hm(p.lastLeaveAt), '23:41');
const realNow = Date.now;
State.schedules = [night];
Date.now = () => Planner.at(U.today(), '23:20').getTime();
assert.strictEqual(State.upcoming().length, 1);              // 예전: 21:30 지나면 빠졌음
Date.now = () => Planner.at(U.today(), '21:20').getTime();
assert.strictEqual(State.upcoming().length, 1);
// 끝 시간·집으로가 없으면 예전처럼 도착 + 30분
State.schedules = [{ ...night, endBy: '', goHome: null }];
Date.now = () => Planner.at(U.today(), '21:25').getTime();
assert.strictEqual(State.upcoming().length, 0);
Date.now = realNow;
console.log('✓ 밤 약속 중(23:20)에도 다가오는 일정에 남음 · 끝 시간 없으면 예전처럼');

// 4) 기차 탈 수 있는지 (출발 알람 화면)
const t1 = { mode: 'train', date: D, trip: { departTime: '08:00' } };
assert.strictEqual(Planner.tripCatch(t1, Planner.at(D, '07:47')).text, '여유가 빠듯해요 (13분)'); // 승강장 여유 15분보다 적음
assert.strictEqual(Planner.tripCatch(t1, Planner.at(D, '07:40')).text, '탈 수 있어요 · 승강장 여유 20분');
assert.strictEqual(Planner.tripCatch(t1, Planner.at(D, '08:02')).text, '08:00 기차를 놓칠 수 있어요');
assert.strictEqual(Planner.tripCatch({ ...t1, trip: { ...t1.trip, marginMin: 10 } }, Planner.at(D, '07:47')).text, '탈 수 있어요 · 승강장 여유 13분');
assert.strictEqual(Planner.tripCatch({ mode: 'transit', date: D, arriveBy: '08:00' }, Planner.at(D, '07:47')), null);
assert.strictEqual(Planner.tripCatch({ mode: 'flight', date: D, trip: { departTime: '08:00' } }, Planner.at(D, '07:45')).text, '08:00 비행기를 놓칠 수 있어요');
console.log('✓ 기차·비행기 탈 수 있는지 한 줄');

// 5) 반복 일정 '이 날만' 이동 수단: 허용 값만 저장, 회차에 덮어씀
const commute = { id: 'c', title: '출근', date: '2030-12-02', arriveBy: '09:00', mode: 'transit', prepMin: 60, bufferMin: 10, origin: home, dest: pangyo,
  route: sub(50), repeat: { type: 'weekdays', days: [], until: '', skipHolidays: true },
  overrides: { [D]: { mode: 'taxi', route: { travelMin: 40, source: 'tmap', steps: [{ type: 'taxi', label: '택시', min: 40 }] } }, '2030-12-11': { mode: 'flight' }, '2030-12-12': { mode: 'rocket' } } };
const clean = U.cleanSchedule(commute);
assert.strictEqual(clean.overrides[D].mode, 'taxi');
assert.strictEqual(clean.overrides[D].route.travelMin, 40);
assert.strictEqual(clean.overrides['2030-12-11'].mode, undefined);
assert.strictEqual(clean.overrides['2030-12-12'].mode, undefined);
const occ = Recur.instance(clean, D);
assert.strictEqual(occ.mode, 'taxi');
assert.strictEqual(hm(Planner.compute(occ).departAt), '08:00'); // 09:00 - 10 - 택시 호출 10 - 40
assert.strictEqual(Recur.instance(clean, '2030-12-13').mode, 'transit');
assert.strictEqual(Recur.instance({ ...commute }, '2030-12-11').mode, 'transit'); // 기차·비행기로는 안 바뀜
console.log('✓ 이 날만 이동 수단 (택시) · 다른 날은 그대로');

// 7) 비 예보 판정 + '이 날만 10분 일찍' 표시 저장
assert.strictEqual(Weather.isWet({ weather: { kind: 'rain' } }), true);
assert.strictEqual(Weather.isWet({ weather: { kind: 'snow' } }), true);
assert.strictEqual(Weather.isWet({ weather: null }), false);
assert.strictEqual(Weather.isWet(null), false);
const rainy = U.cleanSchedule({ ...commute, overrides: { [D]: { bufferMin: 20, rainEarly: true } } });
assert.strictEqual(rainy.overrides[D].rainEarly, true);
assert.strictEqual(Recur.instance(rainy, D).rainEarly, true);
assert.strictEqual(hm(Planner.compute(Recur.instance(rainy, D)).departAt), '07:45');            // 여유 20분
assert.strictEqual(hm(Planner.compute(Recur.instance(rainy, '2030-12-13')).departAt), '07:55');  // 다른 날 여유 10분
console.log('✓ 비·눈 판정 · 이 날만 10분 일찍 저장');

console.log('11-18 점검 확인: 모두 통과');

// 까다로운 경우 계산 확인: node test/edge.test.js
const assert = require('assert');
global.U = { hm: d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  ymd: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, DOW: ['일', '월', '화', '수', '목', '금', '토'] };
global.Weather = undefined;
const Planner = require('../js/planner.js'); global.Planner = Planner;
const Recur = require('../js/recur.js'); global.Recur = Recur;
const D = '2030-12-10'; // 미래 날짜 (알람은 지난 시각을 빼므로)
const home = { name: '집', lat: 37.5, lng: 126.9 };
const full = (d) => `${U.ymd(d)} ${U.hm(d)}`;
const base = o => ({ title: '약속', date: D, mode: 'transit', prepMin: 60, bufferMin: 10, origin: home, route: { travelMin: 30, steps: [] }, ...o });
const run = s => { const plan = Planner.compute(s); return { plan, al: Planner.alarms(s, plan) }; };
const get = (al, k) => al.find(a => a.key === k);

// 1) 시각이 없는 일정은 알람을 만들지 않음 (엉뚱한 밤 11시 알람 방지)
let r = run(base({ arriveBy: '' }));
assert.strictEqual(r.plan.invalid, true);
assert.strictEqual(r.al.length, 0);
assert.ok(r.plan.warnings[0].includes('도착 시간이 없어'));
assert.ok(!r.plan.warnings.some(w => w.includes('새벽')));
r = run(base({ mode: 'train', trip: { accessMode: 'transit' }, accessRoute: { travelMin: 20, steps: [] } }));
assert.strictEqual(r.al.length, 0);
console.log('✓ 시각 없는 일정: 알람 없음 + 안내');

// 2) 앞 일정에서 이어서 출발: 기상 알람이 켜져 있어도 울리지 않음, 전날 안내는 '출발 예정'
r = run(base({ arriveBy: '15:00', prepMin: 0, chained: { from: 'x' }, alarm: { wake: true, depart: true, preDepart: true, nightBefore: true } }));
assert.ok(!get(r.al, 'wake'));
assert.ok(get(r.al, 'depart'));
assert.ok(get(r.al, 'night').title.includes('출발 예정'));
console.log('✓ 이어서 출발: 기상 알람 중복 없음');

// 3) 전날 안내: 기상이 전날 밤이면 '오늘', 너무 가까우면 기상 2시간 전으로
r = run(base({ mode: 'car', arriveBy: '00:30', prepMin: 30, route: { travelMin: 20, steps: [] } }));   // 기상 전날 23:20
assert.strictEqual(full(r.plan.wakeAt), '2030-12-09 23:20');
assert.ok(get(r.al, 'night').title.startsWith('오늘 23:20'));
r = run(base({ mode: 'car', arriveBy: '00:30', prepMin: 120, route: { travelMin: 60, steps: [] } }));  // 기상 전날 21:10
assert.strictEqual(full(get(r.al, 'night').at), '2030-12-09 19:10');
assert.ok(get(r.al, 'night').at < r.plan.wakeAt);
r = run(base({ arriveBy: '09:00' }));
assert.strictEqual(full(get(r.al, 'night').at), '2030-12-09 21:00');
assert.ok(get(r.al, 'night').title.startsWith('내일 07:15'));
console.log('✓ 전날 안내: 항상 기상보다 먼저 · 오늘/내일 바르게');

// 4) 경로가 없으면 알려 줌 (이동 시간 0으로 조용히 계산하지 않기)
r = run(base({ arriveBy: '09:00', route: null }));
assert.ok(r.plan.warnings.some(w => w.includes('경로 정보가 없어')));
r = run(base({ arriveBy: '09:00', mode: 'walk', route: null }));
assert.ok(!r.plan.warnings.some(w => w.includes('경로 정보가 없어')));
console.log('✓ 경로 없음 경고');

// 5) 새벽 국제선: 기상·출발 순서와 수속 여유
r = run(base({ mode: 'flight', prepMin: 90, bufferMin: 20, trip: { departTime: '07:00', arriveTime: '11:00', international: true, accessMode: 'car' }, accessRoute: { travelMin: 70, steps: [] } }));
assert.strictEqual(U.hm(r.plan.departAt), '02:50');        // 07:00 - 150 수속 - 20 여유 - (70+10 주차)
assert.strictEqual(U.hm(r.plan.wakeAt), '01:20');
assert.ok(r.plan.warnings.some(w => w.includes('새벽')));
console.log('✓ 새벽 국제선');

// 6) 야간 열차 (도착이 다음 날)
r = run(base({ mode: 'train', trip: { departTime: '23:00', arriveTime: '04:00', accessMode: 'taxi' }, accessRoute: { travelMin: 20, steps: [] } }));
assert.strictEqual(full(r.plan.arriveAt), '2030-12-11 04:00');
console.log('✓ 자정 넘는 열차');

// 7) 숫자가 문자열로 저장돼도 계산
r = run(base({ arriveBy: '09:00', prepMin: '45', bufferMin: '5', mode: 'walk', route: { travelMin: 15, steps: [] } }));
assert.strictEqual(U.hm(r.plan.departAt), '08:40');
assert.strictEqual(U.hm(r.plan.wakeAt), '07:55');
console.log('✓ 문자열 숫자');

// 8) 반복: 공휴일·건너뛰기·이 날만 변경·종료일 / 요일이 문자열이어도
const rep = { id: 'r', title: '출근', date: '2026-12-21', arriveBy: '09:00', repeat: { type: 'weekdays', until: '2027-01-05', skipHolidays: true },
  skips: ['2026-12-28'], overrides: { '2026-12-29': { arriveBy: '10:00' } } };
const occ = Recur.between([rep], '2026-12-20', '2027-01-10');
assert.deepStrictEqual(occ.map(o => o.date), ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-04', '2027-01-05']);
assert.strictEqual(occ.find(o => o.date === '2026-12-29').arriveBy, '10:00');
const wk = { id: 'w', date: '2026-12-01', repeat: { type: 'weekly', days: ['1', '3'] } };
assert.deepStrictEqual(Recur.between([wk], '2026-12-01', '2026-12-10').map(o => o.date), ['2026-12-02', '2026-12-07', '2026-12-09']);
assert.strictEqual(Recur.label({ repeat: { type: 'weekly', days: ['3', '1'] } }), '매주 월·수');
console.log('✓ 반복 일정 펼치기');

// 9) 모든 알람이 시간 순서가 맞음 (전날 안내 < 기상 ≤ 출발 10분 전 ≤ 출발)
[['09:00', 60], ['06:00', 20], ['23:30', 45], ['00:10', 90]].forEach(([t, prep]) => {
  const { al } = run(base({ arriveBy: t, prepMin: prep }));
  const at = k => get(al, k).at.getTime();
  assert.ok(at('night') < at('wake'), t);
  assert.ok(at('wake') <= at('depart') && at('pre') <= at('depart'), t);
});
console.log('✓ 알람 순서');
console.log('까다로운 경우 테스트 완료');

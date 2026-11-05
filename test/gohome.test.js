// 끝나고 집에 가는 길 · 막차 알림 확인: node test/gohome.test.js
const assert = require('assert');
global.U = { hm: d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
global.Weather = undefined;
const Planner = require('../js/planner.js'); global.Planner = Planner;
const D = '2030-11-05';
const home = { name: '집', lat: 37.5446, lng: 126.9516 };
const hosp = { name: '서울아산병원', lat: 37.5266, lng: 127.1081 };
const back = { travelMin: 50, steps: [{ type: 'walk', label: '도보', min: 6 }, { type: 'subway', label: '2호선', min: 40 }, { type: 'walk', label: '도보', min: 4 }] };
const mk = o => ({ title: '검진', date: D, mode: 'transit', prepMin: 60, bufferMin: 10, origin: home, dest: hosp, arriveBy: '15:00', endBy: '16:30',
  route: { travelMin: 40, steps: [] }, goHome: { on: true, mode: 'transit', route: back, lastTime: '', to: home }, ...o });
const keys = (s, p) => Planner.alarms(s, p).map(a => a.key);

// 1) 끝나면 5분 뒤 출발 → 집 도착 = 16:35 + 50분 + 대기 5분
let s = mk(), p = Planner.compute(s);
assert.strictEqual(U.hm(p.homeDepartAt), '16:35');
assert.strictEqual(U.hm(p.homeAt), '17:30');
assert.ok(p.items.find(i => i.kind === 'home'));
assert.ok(keys(s, p).includes('home'));
assert.ok(!keys(s, p).includes('last'));
console.log('✓ 귀가 출발·집 도착 계산 · 귀가 알림');

// 2) 막차: 23:40 막차, 역까지 걸어서 6분 + 여유 5분 → 23:29에는 나서야, 알람은 23:14
s = mk({ arriveBy: '19:00', endBy: '22:30', goHome: { ...mk().goHome, lastTime: '23:40' } }); p = Planner.compute(s);
assert.strictEqual(U.hm(p.lastLeaveAt), '23:29');
const last = Planner.alarms(s, p).find(a => a.key === 'last');
assert.strictEqual(U.hm(last.at), '23:14');
assert.strictEqual(last.alarm, true);
assert.ok(!p.warnings.some(w => w.includes('막차')));
console.log('✓ 막차 출발 마감 · 15분 전 알람');

// 3) 일정이 막차 마감보다 늦게 끝남 → 경고 / 자정 넘는 막차
s = mk({ arriveBy: '22:00', endBy: '23:50', goHome: { ...mk().goHome, lastTime: '00:10' } }); p = Planner.compute(s);
assert.ok(p.lastLeaveAt > p.homeDepartAt);                 // 다음 날 00:10 막차 → 그날 23:59 출발 (끝나고 23:55 나섬)
assert.ok(!p.warnings.some(w => w.includes('막차')));
assert.strictEqual(U.hm(p.lastLeaveAt), '23:59');
s = mk({ arriveBy: '22:00', endBy: '23:50', goHome: { ...mk().goHome, lastTime: '23:30' } }); p = Planner.compute(s);
assert.ok(p.warnings.some(w => w.includes('막차')));
console.log('✓ 자정 넘는 막차 · 막차 놓치는 경우 경고');

// 4) 밤늦게 끝나는데 막차를 안 넣음 → 확인 안내 / 자가용은 안내 없음
s = mk({ arriveBy: '20:00', endBy: '23:10' }); p = Planner.compute(s);
assert.ok(p.warnings.some(w => w.includes('막차 시간을 확인')));
s = mk({ arriveBy: '20:00', endBy: '23:10', goHome: { ...mk().goHome, mode: 'car', route: { travelMin: 30, steps: [] } } }); p = Planner.compute(s);
assert.ok(!p.warnings.some(w => w.includes('막차')));
assert.ok(!p.lastLeaveAt);
console.log('✓ 늦은 밤 막차 확인 안내 (대중교통만)');

// 5) 끄거나 끝나는 시간이 없으면 아무것도 안 함
p = Planner.compute(mk({ goHome: { ...mk().goHome, on: false } }));
assert.strictEqual(p.homeAt, null);
p = Planner.compute(mk({ endBy: '' }));
assert.strictEqual(p.homeAt, null);
assert.ok(!keys(mk({ endBy: '' }), p).includes('home'));
console.log('✓ 꺼져 있거나 끝나는 시간 없으면 계산 안 함');
console.log('귀가·막차 테스트 완료');

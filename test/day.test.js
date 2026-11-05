// 하루 동선 확인: node test/day.test.js
const assert = require('assert');
global.U = { hm: d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
global.Weather = undefined;
const Planner = require('../js/planner.js'); global.Planner = Planner;
const { DayPlan } = require('../js/day.js');
const D = '2030-11-05';
const home = { name: '집', lat: 37.5446, lng: 126.9516 };
const hosp = { name: '서울아산병원', lat: 37.5266, lng: 127.1081 };
const office = { name: '회사', lat: 37.4979, lng: 127.0276 };
const mk = (o) => ({ date: D, mode: 'transit', prepMin: 60, bufferMin: 10, origin: home, route: { travelMin: 50, steps: [] }, ...o });
const E = s => ({ s, plan: Planner.compute(s) });

// 1) 병원 10:00~11:30 → 회사 14:00 (집에서 출발로 되어 있음)
const a = mk({ title: '병원', arriveBy: '10:00', endBy: '11:30', dest: hosp });
const b = mk({ title: '회사', arriveBy: '14:00', dest: office, route: { travelMin: 30, steps: [] } });
let l = DayPlan.build([E(b), E(a)]);
assert.strictEqual(l[0].s.title, '병원');
assert.strictEqual(l[1].knownEnd, true);
assert.strictEqual(l[1].gapMin, 105);          // 14:00 - 10분 여유 - 5분 대기 - 30분 이동 = 13:15 출발, 11:30부터 1시간 45분
assert.strictEqual(l[1].conflict, false);
assert.strictEqual(l[1].canChain, true);       // 병원에서 바로 갈 수 있음
console.log('✓ 순서 정렬 · 끝나는 시간 기준 여유 · 이어서 출발 제안');

// 2) 이어서 출발로 바꾸면: 기상 없이 출발부터, 제안 사라짐
const b2 = { ...b, origin: hosp, chained: { from: 'a' }, prepMin: 0, route: { travelMin: 40, steps: [] } };
const p2 = Planner.compute(b2);
assert.strictEqual(p2.wakeAt.getTime(), p2.departAt.getTime());
assert.ok(!p2.items.find(i => i.kind === 'wake'));
assert.ok(p2.items.find(i => i.kind === 'depart').title.includes('이어서'));
assert.ok(!p2.warnings.find(w => w.includes('기상')));
l = DayPlan.build([E(a), E(b2)]);
assert.strictEqual(l[1].canChain, false);
console.log('✓ 이어서 출발: 기상 없음, 제안 없음');

// 3) 겹침: 앞 일정이 끝나기 전에 출발해야 함 / 끝나는 시간 없으면 시작 기준
const c = mk({ title: '점심', arriveBy: '12:00', dest: office, route: { travelMin: 40, steps: [] } });
l = DayPlan.build([E(a), E(c)]);
assert.strictEqual(l[1].conflict, true);       // 11:05 출발 < 11:30 끝
const a3 = { ...a, endBy: '' };
l = DayPlan.build([E(a3), E(c)]);
assert.strictEqual(l[1].knownEnd, false);
assert.strictEqual(l[1].conflict, false);
assert.strictEqual(l[1].gapMin, 65);           // 10:00 시작부터 11:05 출발
console.log('✓ 겹침 감지 · 끝나는 시간이 없을 때');

// 4) 끝나는 시간이 일정 타임라인에 들어감, 자정 넘김
const night = mk({ title: '야간', arriveBy: '22:00', endBy: '01:00', dest: hosp });
const pn = Planner.compute(night);
const end = pn.items.find(i => i.kind === 'end');
assert.ok(end && end.at.getDate() === 6 && end.at.getHours() === 1);
console.log('✓ 끝나는 시간 표시 (자정 넘김)');
console.log('\n하루 동선 확인 완료');

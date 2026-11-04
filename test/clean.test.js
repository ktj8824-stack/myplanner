// 밖에서 들어온 일정 정리 확인: node test/clean.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.document = { addEventListener() {} };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const U = new Function(fs.readFileSync(__dirname + '/../js/core.js', 'utf8') + '; return U;')();
global.U = U; global.Planner = require('../js/planner.js');

// 1) 날짜·시각에 끼워 넣은 HTML·스크립트는 버려짐
let o = U.cleanSchedule({ title: '<b>병원</b>', date: '2026-11-20" autofocus onfocus="alert(1)', mode: 'transit' });
assert.strictEqual(o, null);
o = U.cleanSchedule({ id: "x');alert(1);('", title: '병원', date: '2026-11-20', arriveBy: '09:00<img src=x onerror=alert(1)>', mode: 'bad', prepMin: '45"><script>', bufferMin: 9999 });
assert.strictEqual(o.arriveBy, '');
assert.strictEqual(o.mode, 'transit');
assert.strictEqual(o.prepMin, 60);
assert.strictEqual(o.bufferMin, 120);
assert.ok(!('id' in o));                       // 위험한 id는 버림
assert.strictEqual(U.cleanSchedule({ title: '<b>병원</b>', date: '2026-11-20' }).title, '<b>병원</b>'); // 글은 남기되 화면에서 이스케이프
console.log('✓ 날짜·시각·숫자·id 주입 차단');

// 2) 기기 전용·내부 표시 값은 받지 않음 (가짜 실시간 교통, 공유 표시, 예시 표시)
o = U.cleanSchedule({ id: 'abc', title: 'x', date: '2026-11-20', arriveBy: '09:00', mode: 'car',
  live: { '2026-11-20': { travelMin: 1 } }, weather: {}, _shared: { from: 'x' }, demo: true, route: { travelMin: '30', steps: [{ type: 'car<x>', label: 'L', min: '30' }], source: 'tmap' } });
assert.ok(!o.live && !o.weather && !o._shared && !o.demo);
assert.strictEqual(o.id, 'abc');
assert.strictEqual(o.route.travelMin, 30);
assert.strictEqual(o.route.steps[0].type, 'carx');
console.log('✓ 실시간·공유·예시 표시 차단');

// 3) 정상 일정은 그대로 계산됨 (반복·이 날만 변경·귀가·챙길 것 포함)
const good = { id: 'r1', title: '출근', date: '2026-11-20', arriveBy: '09:00', endBy: '18:00', mode: 'transit', prepMin: 45, bufferMin: 10,
  origin: { name: '집', lat: 37.5, lng: 126.9 }, dest: { name: '회사', lat: 37.49, lng: 127.02, address: '서울' },
  route: { travelMin: 40, source: 'odsay', summary: '환승 1회', steps: [{ type: 'subway', label: '2호선', from: 'A', to: 'B', min: 30, stops: 6 }] },
  repeat: { type: 'weekly', days: ['1', 3, 9], until: '', skipHolidays: true }, skips: ['2026-11-23', 'bad'],
  overrides: { '2026-11-25': { arriveBy: '10:00', prepMin: 30 }, nope: {} }, alarm: { wake: false, depart: true },
  goHome: { on: true, mode: 'transit', lastTime: '23:40', route: { travelMin: 50, steps: [] }, to: { name: '집', lat: 37.5, lng: 126.9 } },
  pack: { add: ['우산'], removed: [] }, chained: { from: 'z' }, updatedAt: 123 };
o = U.cleanSchedule(good);
assert.deepStrictEqual(o.repeat.days, [1, 3]);
assert.deepStrictEqual(o.skips, ['2026-11-23']);
assert.deepStrictEqual(Object.keys(o.overrides), ['2026-11-25']);
assert.strictEqual(o.alarm.wake, false);
assert.strictEqual(o.goHome.lastTime, '23:40');
assert.strictEqual(o.updatedAt, 123);
const a = Planner.compute(good), b = Planner.compute(o);
assert.strictEqual(a.wakeAt.getTime(), b.wakeAt.getTime());
assert.strictEqual(a.homeAt.getTime(), b.homeAt.getTime());
console.log('✓ 정상 일정은 그대로');
console.log('일정 정리 테스트 완료');

// 반복 일정 확인: node test/recur.test.js
global.U = {
  DOW: ['일', '월', '화', '수', '목', '금', '토'],
  pad: n => String(n).padStart(2, '0'),
  ymd: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  hm: d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
};
global.Planner = require('../js/planner.js');
const Recur = require('../js/recur.js');
const assert = require('assert');

const base = { id: 'a', title: '출근', date: '2026-09-21', arriveBy: '09:00', mode: 'car', prepMin: 60, bufferMin: 10,
  route: { travelMin: 30, steps: [{ type: 'car', label: '자가용', min: 30 }] } };

// 평일 반복 + 공휴일 제외: 2026-09-21(월)~10-02(금), 추석 9/24·25 제외
let s = { ...base, repeat: { type: 'weekdays', skipHolidays: true } };
let occ = Recur.between([s], '2026-09-21', '2026-10-04').map(x => x.date);
assert.deepStrictEqual(occ, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
console.log('✓ 평일 + 공휴일 제외 (추석 연휴 빠짐)', occ.length + '회');

// 공휴일 포함
s.repeat.skipHolidays = false;
assert.strictEqual(Recur.between([s], '2026-09-21', '2026-10-04').length, 10);
console.log('✓ 공휴일 포함 10회');

// 요일 선택(월·수) + 종료일 + 건너뛰기 + 이 날만 변경
s = { ...base, repeat: { type: 'weekly', days: [1, 3], until: '2026-10-07' }, skips: ['2026-09-30'],
  overrides: { '2026-10-05': { arriveBy: '10:30' } } };
occ = Recur.between([s], '2026-09-01', '2026-12-31');
assert.deepStrictEqual(occ.map(x => x.date), ['2026-09-21', '2026-09-23', '2026-09-28', '2026-10-05', '2026-10-07']);
const ov = occ.find(x => x.date === '2026-10-05');
assert.strictEqual(ov.arriveBy, '10:30');
assert.strictEqual(ov.occId, 'a@2026-10-05');
assert.strictEqual(U.hm(Planner.compute(ov).departAt), '09:40'); // 10:30-10-30-10
console.log('✓ 요일 선택·종료일·건너뛰기·이 날만 변경');

// 매일: 시작일 이전은 없음
s = { ...base, date: '2026-11-05', repeat: { type: 'daily' } };
assert.strictEqual(Recur.between([s], '2026-11-01', '2026-11-07').length, 3);
console.log('✓ 매일 (시작일부터)');

// 단발 일정은 그대로
assert.strictEqual(Recur.between([{ ...base }], '2026-09-21', '2026-09-21')[0].occId, undefined);
assert.strictEqual(Recur.label({ ...base, repeat: { type: 'weekly', days: [3, 1], skipHolidays: true } }), '매주 월·수 · 공휴일 제외');
console.log('✓ 단발 일정 · 반복 문구');
console.log('\n반복 일정 확인 완료');

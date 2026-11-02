// 실시간 교통 반영 확인: node test/live.test.js
global.U = { DOW: ['일','월','화','수','목','금','토'], pad: n => String(n).padStart(2,'0'),
  ymd: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
  hm: d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` };
global.Planner = require('../js/planner.js');
const Recur = require('../js/recur.js');
const assert = require('assert');
const hm = U.hm;

const car = { id: 'c', title: '출근', date: '2030-03-04', arriveBy: '09:00', mode: 'car', prepMin: 60, bufferMin: 10,
  origin: { name: '집', lat: 37.5, lng: 127.1 }, dest: { name: '회사', lat: 37.4, lng: 127.1 },
  route: { travelMin: 40, source: 'tmap', steps: [{ type: 'car', label: '자가용', min: 40 }] } };

let p = Planner.compute(car);
assert.strictEqual(hm(p.departAt), '08:00');           // 09:00 −10 −10(주차) −40
// 실시간 55분 → 15분 일찍
p = Planner.compute({ ...car, live: { '2030-03-04': { travelMin: 55, checkedAt: 0 } } });
assert.strictEqual(hm(p.departAt), '07:45');
assert.strictEqual(hm(p.wakeAt), '06:45');
assert.ok(p.live);
console.log('✓ 자가용 실시간 55분 → 출발', hm(p.departAt));

// 다른 날짜의 live는 영향 없음
assert.strictEqual(hm(Planner.compute({ ...car, live: { '2030-03-05': { travelMin: 90 } } }).departAt), '08:00');
console.log('✓ 다른 날의 실시간 값은 무시');

// 네이티브 공식(anchor − fixed − travel)이 앱 계산과 항상 같은지
const check = (s) => {
  const plan = Planner.compute(s), spec = Planner.recheckSpec(s, plan);
  assert.ok(spec, 'spec 없음');
  assert.strictEqual(spec.anchorMs - (spec.fixedMin + spec.travelMin) * 60000, plan.departAt.getTime());
  return spec;
};
let spec = check(car);
assert.deepStrictEqual([spec.fixedMin, spec.travelMin], [20, 40]);
check({ ...car, mode: 'taxi', route: { travelMin: 33, steps: [{ type: 'taxi', label: '택시', min: 33 }] } });
// 기차 + 역까지 택시
spec = check({ ...car, mode: 'train', arriveBy: '', trip: { departStation: { name: '서울역', lat: 37.55, lng: 126.97 }, departTime: '08:00', arriveTime: '10:40', accessMode: 'taxi' },
  accessRoute: { travelMin: 25, steps: [{ type: 'taxi', label: '택시', min: 25 }] } });
assert.strictEqual(new Date(spec.anchorMs).getHours() * 60 + new Date(spec.anchorMs).getMinutes(), 7 * 60 + 45); // 08:00 − 승강장 15
console.log('✓ 네이티브 재계산 공식 = 앱 계산 (자가용·택시·기차)');

// 반복 일정: 회차마다 그날 live 적용
const rep = { ...car, date: '2030-03-04', repeat: { type: 'daily' }, live: { '2030-03-05': { travelMin: 70 } } };
const occ = Recur.between([rep], '2030-03-04', '2030-03-06').map(o => hm(Planner.compute(o).departAt));
assert.deepStrictEqual(occ, ['08:00', '07:30', '08:00']);
console.log('✓ 반복 회차별 실시간 반영', occ.join(', '));

// 버스·지하철은 재확인 대상 아님
assert.strictEqual(Planner.recheckSpec({ ...car, mode: 'transit' }, Planner.compute({ ...car, mode: 'transit' })), null);
console.log('✓ 버스·지하철은 실시간 재계산 제외');
console.log('\n실시간 반영 확인 완료');

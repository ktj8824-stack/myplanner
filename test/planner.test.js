// 역산 엔진 확인: node test/planner.test.js
global.U = { hm: d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` };
const Planner = require('../js/planner.js');
const assert = require('assert');
const hm = U.hm;

// 1) 버스·지하철: 09:00 도착, 이동 52분(+대기 5), 여유 10, 준비 60
let s = { title: '미팅', date: '2030-03-04', arriveBy: '09:00', mode: 'transit', prepMin: 60, bufferMin: 10,
  origin: { name: '집' }, dest: { name: '강남역' },
  route: { travelMin: 52, source: 'odsay', steps: [
    { type: 'walk', label: '도보', min: 7 }, { type: 'bus', label: '7714번 버스', from: 'A', to: 'B', min: 20, stops: 9 },
    { type: 'subway', label: '2호선', from: 'B', to: '강남', min: 20 }, { type: 'walk', label: '도보', min: 5 }] } };
let p = Planner.compute(s);
assert.strictEqual(hm(p.departAt), '07:42');   // 09:00 - 10 - 52 - 5 - 출근길 보정 11 (버스 20→26, 걷기 7→10, 5→7)
assert.strictEqual(hm(p.wakeAt), '06:42');
assert.strictEqual(hm(p.arriveAt), '08:50');
assert.strictEqual(p.items[0].kind, 'wake');
assert.strictEqual(p.items[1].kind, 'depart');
console.log('✓ 대중교통', hm(p.wakeAt), hm(p.departAt), hm(p.arriveAt));

// 2) 자가용: 주차 10분은 도착 직전
s = { ...s, mode: 'car', route: { travelMin: 40, source: 'tmap', steps: [{ type: 'car', label: '자가용', min: 40 }] } };
p = Planner.compute(s);
assert.strictEqual(hm(p.departAt), '08:00');   // 09:00 - 10 - 40 - 10
console.log('✓ 자가용', hm(p.wakeAt), hm(p.departAt));

// 3) 기차: KTX 08:00 출발, 역까지 택시 25분(+호출 10), 승강장 여유 15, 여유 10, 준비 45
s = { title: '부산 출장', date: '2030-03-04', arriveBy: '', mode: 'train', prepMin: 45, bufferMin: 10,
  origin: { name: '집' }, dest: null,
  trip: { number: 'KTX 101', departStation: { name: '서울역' }, departTime: '08:00', arriveStation: { name: '부산역' }, arriveTime: '10:40', accessMode: 'taxi' },
  accessRoute: { travelMin: 25, source: 'tmap', steps: [{ type: 'taxi', label: '택시', min: 25 }] } };
p = Planner.compute(s);
assert.strictEqual(hm(p.departAt), '07:00');   // 08:00 - 15 - 10 - 25 - 10
assert.strictEqual(hm(p.wakeAt), '06:15');
assert.strictEqual(hm(p.arriveAt), '10:40');
console.log('✓ 기차', hm(p.wakeAt), hm(p.departAt), hm(p.arriveAt));

// 4) 국제선: 수속 150분
s = { ...s, mode: 'flight', trip: { ...s.trip, departTime: '10:00', arriveTime: '13:00', international: true, accessMode: 'transit' },
  accessRoute: { travelMin: 70, source: 'odsay', steps: [{ type: 'subway', label: '공항철도', min: 70 }] } };
p = Planner.compute(s);
assert.strictEqual(hm(p.departAt), '06:05');   // 10:00 - 150 - 10 - 70 - 5
console.log('✓ 국제선', hm(p.wakeAt), hm(p.departAt));

// 5) 늦는 기차 경고
s = { ...s, mode: 'train', arriveBy: '10:00', trip: { ...s.trip, departTime: '08:00', arriveTime: '10:40' } };
p = Planner.compute(s);
assert.ok(p.warnings.some(w => w.includes('늦게')));
console.log('✓ 지각 경고');

// 6) 알람: 기상·출발 알람 포함
const al = Planner.alarms({ ...s, date: '2099-01-02' }, Planner.compute({ ...s, date: '2099-01-02' }));
assert.deepStrictEqual(al.map(a => a.key), ['night', 'wake', 'pre', 'depart']);
console.log('✓ 알람', al.map(a => `${a.key} ${hm(a.at)}`).join(', '));
console.log('\n모든 계산 확인 완료');

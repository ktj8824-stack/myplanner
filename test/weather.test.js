// 날씨 반영 확인: node test/weather.test.js
global.U = { DOW: ['일','월','화','수','목','금','토'], pad: n => String(n).padStart(2,'0'),
  ymd: d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
  hm: d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` };
global.Planner = require('../js/planner.js');
global.Recur = require('../js/recur.js');
const Weather = require('../js/weather.js');
const assert = require('assert');
const hm = U.hm;

// 1) 예보 분류
assert.strictEqual(Weather.classify([{ prob: 20, mm: 0 }]).kind, 'clear');
assert.strictEqual(Weather.classify([{ prob: 70, mm: 0.3 }]).kind, 'rain');
assert.strictEqual(Weather.classify([{ prob: 30, mm: 0.8 }]).kind, 'rain');
assert.strictEqual(Weather.classify([{ prob: 90, mm: 7 }]).kind, 'heavy');
assert.strictEqual(Weather.classify([{ prob: 60, mm: 0.5, snow: 0.6, code: 73 }]).kind, 'snow');
assert.strictEqual(Weather.classify([{ prob: 10 }, { prob: 80, mm: 1 }]).kind, 'rain'); // 출발 1시간 뒤 비도 반영
console.log('✓ 예보 분류 (맑음·비·많은 비·눈)');

const car = { id: 'c', title: '출근', date: '2030-03-04', arriveBy: '09:00', mode: 'car', prepMin: 60, bufferMin: 10,
  origin: { name: '집', lat: 37.5, lng: 127.1 }, dest: { name: '회사', lat: 37.4, lng: 127.1 },
  route: { travelMin: 40, source: 'tmap', steps: [{ type: 'car', label: '자가용', min: 40 }] } };
const wx = kind => ({ '2030-03-04': { kind, prob: 80, mm: 2, temp: 3, checkedAt: 0 } });

// 2) 자가용: 비 +6분(40×15%), 눈 +16분(40×40%)
let p = Planner.compute({ ...car, weather: wx('rain') });
assert.strictEqual(hm(p.departAt), '07:54');  // 08:00 − 6
assert.strictEqual(p.weather.extraMin, 6);
assert.ok(p.items.some(i => /비 예보 여유/.test(i.title)));
assert.strictEqual(hm(p.arriveAt), '08:50');  // 약속 10분 전 도착은 그대로
assert.strictEqual(hm(Planner.compute({ ...car, weather: wx('snow') }).departAt), '07:44');
assert.strictEqual(hm(Planner.compute({ ...car, weather: wx('clear') }).departAt), '08:00');
assert.strictEqual(Planner.compute({ ...car, weather: wx('clear') }).weather, null);
console.log('✓ 자가용: 비 +6분, 눈 +16분, 맑음 그대로');

// 3) 버스·지하철: 비 +5분, 다른 날짜 날씨는 무시
const tr = { ...car, mode: 'transit', route: { travelMin: 50, steps: [{ type: 'subway', label: '지하철', min: 50 }] } }; // 지하철은 출근길 보정 없음 → 날씨만 확인
assert.strictEqual(hm(Planner.compute({ ...tr, weather: wx('rain') }).departAt), '07:50'); // 09:00−10−5(대기)−50−5
assert.strictEqual(hm(Planner.compute({ ...tr, weather: { '2030-03-05': { kind: 'snow' } } }).departAt), '07:55');
console.log('✓ 버스·지하철 비 +5분, 다른 날 날씨 무시');

// 4) 기차: 역까지 택시 구간에 눈 여유 (25분 → 최소 20분)
const train = { ...car, mode: 'train', arriveBy: '', trip: { departStation: { name: '서울역', lat: 37.55, lng: 126.97 }, departTime: '08:00', arriveTime: '10:40', accessMode: 'taxi' },
  accessRoute: { travelMin: 25, steps: [{ type: 'taxi', label: '택시', min: 25 }] } };
assert.strictEqual(hm(Planner.compute(train).departAt), '07:00');
assert.strictEqual(hm(Planner.compute({ ...train, weather: wx('snow') }).departAt), '06:40');
console.log('✓ 기차: 역까지 가는 길 눈 +20분');

// 5) 폰 백그라운드 재계산 공식이 날씨 포함해도 앱 계산과 같음
for (const s of [{ ...car, weather: wx('rain') }, { ...car, mode: 'taxi', weather: wx('heavy') }, { ...train, weather: wx('snow') }]) {
  const plan = Planner.compute(s), spec = Planner.recheckSpec(s, plan);
  assert.strictEqual(spec.anchorMs - (spec.fixedMin + spec.travelMin) * 60000, plan.departAt.getTime());
}
console.log('✓ 백그라운드 재계산 공식 = 앱 계산 (날씨 포함)');

// 6) 알람 문구에 날씨 안내
const future = { ...car, date: '2099-01-02', weather: { '2099-01-02': { kind: 'rain', prob: 80 } } };
const al = Planner.alarms(future, Planner.compute(future));
assert.ok(al.find(a => a.key === 'wake').body.includes('우산'));
assert.ok(al.find(a => a.key === 'night').body.includes('비 예보'));
console.log('✓ 전날 밤·기상 알람에 "비 예보 — 우산 챙기세요"');
console.log('\n날씨 반영 확인 완료');

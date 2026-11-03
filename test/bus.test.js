// 버스 실시간 판단 확인: node test/bus.test.js
const { BusMath } = require('../js/bus.js');
global.U = {}; global.Planner = { MODES: { transit: { extraMin: 5 } } };
const Routes = (() => { const src = require('fs').readFileSync(__dirname + '/../js/routes.js', 'utf8'); return new Function(src + '; return Routes;')(); })();
const assert = require('assert');
const M = 60000, now = 1_000_000_000_000;
const dep = now + 10 * M;           // 10분 뒤 출발 예정
const pre = 5 + 6, walk = 6;        // 출발 → 정류장 계획 11분 (대기 여유 5 + 걷기 6) → 정류장 계획 now+21분

// 1) 제때 오는 버스(22분 뒤)만 있음 → 그대로, 14분 뒤 나가면 됨
let r = BusMath.decide(now, dep, pre, walk, [22 * 60]);
assert.strictEqual(r.kind, 'ok'); assert.strictEqual((r.leaveAt - now) / M, 14);
console.log('✓ 제때 오는 버스 → "08:13에 나가면 딱 맞아요"');

// 2) 15분 뒤 버스 다음이 40분 뒤 → 15분 뒤 버스를 타야 함 → 7분 뒤 출발 (3분 일찍)
r = BusMath.decide(now, dep, pre, walk, [15 * 60, 40 * 60]);
assert.strictEqual(r.kind, 'earlier'); assert.strictEqual(r.deltaMin, -3); assert.strictEqual((r.busAt - now) / M, 15);
console.log('✓ 다음 버스가 너무 늦으면 앞 버스 타게 일찍 출발');

// 3) 두 대 다 제때면 늦은 쪽(26분)을 골라 여유롭게
r = BusMath.decide(now, dep, pre, walk, [17 * 60, 26 * 60]);
assert.strictEqual((r.busAt - now) / M, 26); assert.strictEqual(r.kind, 'ok');
console.log('✓ 제때 버스가 여럿이면 늦은 버스 기준');

// 4) 버스가 다 늦음 → late, 몇 분 늦는지
r = BusMath.decide(now, dep, pre, walk, [35 * 60]);
assert.strictEqual(r.kind, 'late'); assert.strictEqual(r.lateMin, 9); // 35 − (21+5)
console.log('✓ 다음 버스가 늦으면 "약 9분 늦을 수 있어요"');

// 5) 걸어서 못 타는 버스(3분 뒤)는 무시, 8분 뒤 버스는 지금 바로 나가야 함
r = BusMath.decide(now, dep, pre, walk, [3 * 60, 8 * 60]);
assert.strictEqual((r.busAt - now) / M, 8); assert.strictEqual(r.urgent, true); assert.strictEqual(r.leaveAt, now + M);
console.log('✓ 못 타는 버스 무시, 아슬아슬하면 "지금 나가세요"');

// 6) 정보 없음
assert.strictEqual(BusMath.decide(now, dep, pre, walk, []).kind, 'none');
assert.strictEqual(BusMath.decide(now, dep, pre, walk, [60]).kind, 'none');
console.log('✓ 탈 수 있는 버스 정보 없음');

// 7) ODsay 응답 형태 여러 가지 정규화
const a = Routes.normalizeBus({ result: { real: [{ routeId: 100, routeNm: '7714', arrival1: { arrivalSec: 300, leftStation: 2 }, arrival2: { arrivalSec: 1200 } }] } });
assert.deepStrictEqual(a.map(x => [x.routeId, x.sec, x.left]), [['100', 300, 2], ['100', 1200, null]]);
const b = Routes.normalizeBus({ result: { real: { routeID: '7', busNo: '6', arrival1: { arrivalMin: 4 } } } });
assert.deepStrictEqual(b.map(x => [x.routeId, x.routeNm, x.sec]), [['7', '6', 240]]);
assert.deepStrictEqual(Routes.normalizeBus({ error: { msg: 'x' } }), []);
assert.deepStrictEqual(Routes.normalizeBus({ result: { real: [{ routeId: 1, arrival1: { arrivalSec: -5 } }] } }), []);
console.log('✓ 실시간 응답 형식 여러 가지 처리');
console.log('\n버스 실시간 판단 확인 완료');

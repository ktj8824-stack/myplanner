// 알람 점검 판단 확인: node test/alarmcheck.test.js
const assert = require('assert');
global.window = {}; global.document = { addEventListener() {} };
const src = require('fs').readFileSync(__dirname + '/../js/alarm.js', 'utf8');
const Alarm = new Function(src + '; return Alarm;')();
const good = { exact: true, fullScreen: true, notifications: true, battery: true, alarmChannel: true, alarmVolume: 5 };
assert.deepStrictEqual(Alarm.problems('granted', good), []);
assert.deepStrictEqual(Alarm.problems('denied', null), ['notifications']);
assert.deepStrictEqual(Alarm.problems('unsupported', null), []);
const p = Alarm.problems('granted', { ...good, alarmChannel: false, battery: false, alarmVolume: 0 });
assert.deepStrictEqual(p, ['alarmChannel', 'battery', 'volume']);
assert.ok(p.some(k => Alarm.CRITICAL.includes(k)));                 // 알람 알림이 꺼짐 → 홈 경고
assert.ok(!['battery', 'volume'].some(k => Alarm.CRITICAL.includes(k))); // 배터리·소리는 설정에서만
// 예전 앱(새 항목 없음)도 문제로 잡지 않음
assert.deepStrictEqual(Alarm.problems('granted', { exact: true, fullScreen: true, notifications: true }), []);
console.log('✓ 알람 점검 항목 · 홈 경고 기준');
console.log('알람 점검 테스트 완료');

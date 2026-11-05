// 저장 확인 문장 확인: node test/easy.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.document = { addEventListener() {} };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const U = new Function(fs.readFileSync(__dirname + '/../js/core.js', 'utf8') + '; return U;')();
global.U = U; global.Planner = require('../js/planner.js');
global.Recur = { isRepeating: () => false, label: () => '' };
const { koTime, Saved } = new Function(fs.readFileSync(__dirname + '/../js/easy.js', 'utf8') + '; return { koTime, Saved };')();

const at = (h, m) => new Date(2030, 10, 9, h, m);
assert.strictEqual(koTime(at(7, 3)), '아침 7시 3분');
assert.strictEqual(koTime(at(7, 0)), '아침 7시');
assert.strictEqual(koTime(at(12, 30)), '낮 12시 30분');
assert.strictEqual(koTime(at(14, 5)), '오후 2시 5분');
assert.strictEqual(koTime(at(21, 0)), '저녁 9시');
assert.strictEqual(koTime(at(4, 40)), '새벽 4시 40분');
console.log('✓ 시각을 말로 (아침 7시 3분)');

const d = { title: '병원', startNow: false };
const s = { id: 'a' };
assert.strictEqual(Saved.sentence(d, [{ key: 'night', at: at(-3, 0), s }, { key: 'wake', at: at(7, 3), s }, { key: 'depart', at: at(7, 48), s }]), '11월 9일 (토) 아침 7시 3분에 깨워 드릴게요');
assert.strictEqual(Saved.sentence(d, [{ key: 'depart', at: at(13, 20), s }]), '11월 9일 (토) 오후 1시 20분에 출발 알람을 울려 드릴게요');
assert.strictEqual(Saved.sentence(d, []), '저장했어요. 울릴 알람은 없어요');
console.log('✓ 저장 뒤 한 문장');
console.log('\n저장 확인 문장 테스트 완료');

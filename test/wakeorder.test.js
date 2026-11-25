// 아침 일정: 기상 알람보다 먼저 울리는 '출발 1시간 전'·'30분 전' 알림이 없어야 함 (2026-11-25 점검): node test/wakeorder.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.navigator = { onLine: true };
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; } };
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
const D = '2030-12-10';
const home = { name: '집', lat: 37.5133, lng: 127.1028 };
State.settings.home = home; State.settings.prepMin = 60;
const route = min => ({ travelMin: min, source: 'odsay', steps: [{ type: 'subway', label: '지하철', min }] });
const mk = (arriveBy, prepMin, extra = {}) => ({ id: 'w' + arriveBy + prepMin, title: '병원 예약', date: D, arriveBy, endBy: '', mode: 'transit',
  dest: { name: '강남역', lat: 37.498, lng: 127.0276 }, origin: { ...home }, prepMin, bufferMin: 10, route: route(40),
  alarm: { wake: true, nightBefore: true, preDepart: true, depart: true }, repeat: { type: 'none', days: [] }, ...extra });
const realNow = Date.now;
Date.now = () => new Date(D + 'T00:00:00+09:00').getTime() - 2 * 86400000;
const list = s => { const p = Planner.compute(s); return { p, a: Planner.alarms(s, p) }; };

// 1) 08:00 약속 · 준비 30분: 기상 06:31 전에 울리는 알림 없음, 30분 전(06:31)은 기상과 겹쳐 생략
{
  const { p, a } = list(mk('08:00', 30));
  const wake = a.find(x => x.key === 'wake');
  assert.ok(wake, '기상 알람 있음');
  const early = a.filter(x => x.key !== 'night' && x.key !== 'wake' && x.at.getTime() <= wake.at.getTime() + 5 * 60000);
  assert.deepStrictEqual(early.map(x => x.key), [], '기상 전·같은 시각에 다른 알림 없음: ' + early.map(x => x.key + ' ' + U.hm(x.at)).join(', '));
  assert.ok(a.some(x => x.key === 'depart'), '출발 알람은 그대로');
  assert.strictEqual(U.hm(wake.at), U.hm(p.wakeAt));
}
// 2) 준비 90분: 기상 뒤에 1시간 전·30분 전 알림이 그대로 울림
{
  const { a } = list(mk('09:00', 90));
  assert.deepStrictEqual(a.map(x => x.key), ['night', 'wake', 'next', 'pre', 'depart']);
}
// 3) 준비 45분: 1시간 전(기상보다 15분 먼저)은 빼고 30분 전은 울림
{
  const { a } = list(mk('08:00', 45));
  assert.deepStrictEqual(a.map(x => x.key), ['night', 'wake', 'pre', 'depart']);
}
// 4) 낮 일정(기상 알람 없음)은 1시간 전·30분 전 그대로
{
  const { a } = list(mk('14:00', 30));
  assert.ok(a.some(x => x.key === 'next') && a.some(x => x.key === 'pre'));
}
// 4b) 준비 60분(기본값): '1시간 전'은 기상과 같은 시각이라 그대로 (기상 때 알림 목록에 길안내)
{
  const { a } = list(mk('09:00', 60));
  assert.deepStrictEqual(a.map(x => x.key), ['night', 'wake', 'next', 'pre', 'depart']);
}
// 5) 앞 일정에서 이어서 가는 일정·기상 알람 끈 일정은 그대로 (기상 없음 → 알림 다 울림)
{
  const { a } = list(mk('08:00', 0, { alarm: { wake: false, nightBefore: true, preDepart: true, depart: true } }));
  assert.ok(a.some(x => x.key === 'next') && a.some(x => x.key === 'pre') && !a.some(x => x.key === 'wake'));
}
Date.now = realNow;
console.log('11-25 점검 확인(기상 전 알림 없음): 모두 통과');

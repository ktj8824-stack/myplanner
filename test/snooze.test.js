// 2026-11-21 점검 확인: 출발 알람 미루기 한도 · 끝 시간을 늘리면 다음 일정 늦음 안내 · 스토어 전 '곧 나와요'
// node test/snooze.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, configurable: true, writable: true });
global.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; } };
global.location = { protocol: 'https:', hostname: 'x', origin: 'https://x', pathname: '/', href: 'https://x/' };
const load = (f, name) => new Function(fs.readFileSync(__dirname + '/../js/' + f, 'utf8') + `; return ${name};`)();
global.U = load('core.js', 'U'); global.State = load('core.js', 'State');
global.Planner = require('../js/planner.js'); global.Recur = require('../js/recur.js');
global.Cloud = undefined;
const hm = U.hm;
const D = '2030-12-10';
const home = { name: '집', lat: 37.5446, lng: 126.9516 };
const sub = min => ({ travelMin: min, source: 'odsay', steps: [{ type: 'subway', label: '지하철', min }] });

// 1) 기차: 서울역 08:00 KTX, 역까지 40분 → 07:20 이후에 다시 울리면 못 탐
const ktx = { id: 'k', title: '부산 출장', date: D, mode: 'train', prepMin: 30, bufferMin: 10, origin: home,
  trip: { departStation: { name: '서울역', lat: 37.5547, lng: 126.9707 }, departTime: '08:00', accessMode: 'transit' },
  accessRoute: sub(40), repeat: { type: 'none', days: [] } };
let p = Planner.compute(ktx);
let lim = Planner.snoozeLimit(ktx, p);
assert.strictEqual(lim.trip, true);
const leg = (p.stationAt - p.departAt) / 60000;
assert.strictEqual(hm(new Date(lim.until)), hm(new Date(Planner.at(D, '08:00').getTime() - leg * 60000)));
// 미룬 뒤 다시 울리는 시각에 나가면 tripCatch 가 'miss' 가 되는 지점과 같아야 함
assert.strictEqual(Planner.tripCatch(ktx, new Date(lim.until + leg * 60000)).state, 'miss');
assert.notStrictEqual(Planner.tripCatch(ktx, new Date(lim.until - 60000 + leg * 60000)).state, 'miss');
// 비행기는 탑승 마감 20분 더 일찍
const fl = { ...ktx, mode: 'flight', trip: { ...ktx.trip, departTime: '10:00' } };
const pf = Planner.compute(fl);
assert.strictEqual(Planner.snoozeLimit(fl, pf).until, Planner.at(D, '10:00').getTime() - 20 * 60000 - (pf.stationAt - pf.departAt));
// 2) 보통 약속: 약속 시각까지
const meet = { id: 'm', title: '강남역 미팅', date: D, arriveBy: '16:00', mode: 'transit', prepMin: 0, bufferMin: 10, origin: home, dest: { name: '강남역', lat: 37.4979, lng: 127.0276 }, route: sub(40), repeat: { type: 'none', days: [] } };
lim = Planner.snoozeLimit(meet, Planner.compute(meet));
assert.deepStrictEqual(lim, { until: Planner.at(D, '16:00').getTime(), trip: false });
assert.strictEqual(Planner.snoozeLimit({ ...meet, arriveBy: '' }, Planner.compute(meet)), null);
console.log('✓ 출발 알람 미루기 한도: 기차·비행기는 탈 수 있는 마지막 출발, 보통 약속은 약속 시각');

// 3) 앞 일정 끝을 15:00 → 15:21 으로 늘리면 '앞 일정에서 바로 출발'하는 16:00 강남역 미팅이 늦어짐
const Register = load('register.js', 'Register');
const lunch = { id: 'l', title: '점심', date: D, arriveBy: '12:00', endBy: '15:00', mode: 'transit', prepMin: 30, bufferMin: 10, origin: home, dest: { name: '을지로', lat: 37.566, lng: 126.991 }, route: sub(30), repeat: { type: 'none', days: [] } };
const next = { ...meet, origin: { name: '을지로', lat: 37.566, lng: 126.991 }, chained: { from: 'l' } };
State.schedules = [lunch, next];
assert.strictEqual(Register.nextLateLine(lunch), '');            // 15:00 끝: 15:40 도착, 늦지 않음
lunch.endBy = '15:21';
assert.strictEqual(Register.nextLateLine(lunch), '다음 강남역 미팅 16:06 도착(6분 늦어요)');
console.log('✓ 끝 시간을 늘려 다음 일정이 늦으면 저장 알림에 같이');

// 4) 플레이 스토어 출시 전: 안드로이드도 '곧 나와요' (없는 주소로 보내지 않음)
global.Sheet = { open() {} }; global.Icons = { svg: () => '' };
const Share = load('share.js', 'Share');
let toast = '';
U.toast = m => { toast = m; };
assert.strictEqual(Share.STORE_LIVE, false);
Share.installApp();
assert.strictEqual(location.href, 'https://x/');
assert.ok(/안드로이드 앱은 곧 나와요/.test(toast));
Share.STORE_LIVE = true; Share.installApp();
assert.ok(/play\.google\.com/.test(location.href));
console.log('✓ 스토어 출시 전에는 앱 설치 버튼이 곧 나와요 안내');

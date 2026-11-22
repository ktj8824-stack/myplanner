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
// 2) 보통 약속: 다시 울릴 때 나가도 약속에 안 늦는 시각까지 (약속 − 이동 45분 = 지하철 40 + 환승 여유 5, 2026-11-22 점검)
const meet = { id: 'm', title: '강남역 미팅', date: D, arriveBy: '16:00', mode: 'transit', prepMin: 0, bufferMin: 10, origin: home, dest: { name: '강남역', lat: 37.4979, lng: 127.0276 }, route: sub(40), repeat: { type: 'none', days: [] } };
lim = Planner.snoozeLimit(meet, Planner.compute(meet));
assert.deepStrictEqual(lim, { until: Planner.at(D, '15:15').getTime() + 1, trip: false, due: Planner.at(D, '16:00').getTime() });
assert.strictEqual(Planner.snoozeLimit({ ...meet, arriveBy: '' }, Planner.compute(meet)), null);
console.log('✓ 출발 알람 미루기 한도: 기차·비행기는 탈 수 있는 마지막 출발, 보통 약속은 약속 − 이동 시간');

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

// 5) 2026-11-22 점검 M13: 월 10:00 강남역 미팅, 이동 44분(지하철 39 + 환승 여유 5), 출발 알람 09:10 — 계속 '5분 뒤 다시'
global.Share = Share; global.Routes = { openNav() {} }; global.Ads = undefined;
const Alarm = load('alarm.js', 'Alarm');
const m13 = { id: 'm13', title: '강남역 미팅', date: D, arriveBy: '10:00', mode: 'transit', prepMin: 0, bufferMin: 6, origin: home, dest: { name: '강남역', lat: 37.4979, lng: 127.0276 }, route: sub(39), repeat: { type: 'none', days: [] } };
const p13 = Planner.compute(m13);
assert.strictEqual(hm(p13.departAt), '09:10');
const T = t => Planner.at(D, t).getTime();
// 미루기 한도: 다시 울릴 때(+5분) 나가도 10:00 안에 닿는 마지막 — 09:11에 미루면 09:16+44=10:00 딱 맞음(허용), 09:11:01부터는 늦음(막음)
lim = Planner.snoozeLimit(m13, p13);
assert.deepStrictEqual(lim, { until: T('09:16') + 1, trip: false, due: T('10:00') });
assert.strictEqual(Alarm.snoozeBlocked(m13, p13, T('09:10')), null);
assert.strictEqual(Alarm.snoozeBlocked(m13, p13, T('09:11')), null);
assert.ok(Alarm.snoozeBlocked(m13, p13, T('09:11') + 1000));
assert.ok(Alarm.snoozeBlocked(m13, p13, T('09:15')));
// 옛 한도(약속 시각)였다면 09:55까지 9번 미룰 수 있었음 → 이제 09:10 한 번뿐
let n = 0; for (let t = T('09:10'); !Alarm.snoozeBlocked(m13, p13, t); t += 5 * 60000) n++;
assert.strictEqual(n, 1);
// 늦음 판단: 09:16까지는 안 늦음, 09:20이면 10:04 도착 · 4분 늦음
assert.strictEqual(Planner.lateNow(m13, p13, T('09:16')), null);
let lt = Planner.lateNow(m13, p13, T('09:20'));
assert.strictEqual(hm(lt.at), '10:04'); assert.strictEqual(lt.lateMin, 4);
assert.strictEqual(Planner.lateNow(m13, p13, T('09:20') + 59000).lateMin, 4);  // 화면의 10:04 와 분이 맞음
assert.strictEqual(Planner.lateNow(ktx, Planner.compute(ktx), T('09:20')), null); // 기차·비행기는 따로(놓침 판단)
console.log('✓ 보통 약속 미루기 한도: 지금 + 5분 + 이동 > 약속이면 막음 · 지금 나가도 늦는지');

// 6) 안내 문구: 아직 약속 전이면 '5분 뒤에 나가면 약속에 늦어요', 지났으면 '약속 시각이 지나'
assert.strictEqual(Alarm.snoozeWhy(Alarm.snoozeBlocked(m13, p13, T('09:14')), T('09:14')), '5분 뒤에 나가면 약속에 늦어요 — 더 미룰 수 없어요');
assert.strictEqual(Alarm.snoozeWhy(Alarm.snoozeBlocked(m13, p13, T('10:02')), T('10:02')), '약속 시각이 지나 더 미룰 수 없어요');
assert.strictEqual(Alarm.snoozeWhy({ trip: true, due: T('08:00') }), '지금 안 나가면 놓쳐요 · 더 미룰 수 없어요');
const java = fs.readFileSync(__dirname + '/../native/android/AlarmActionReceiver.java', 'utf8');
assert.ok(java.includes('"약속 시각이 지나 더 미룰 수 없어요" : "5분 뒤에 나가면 약속에 늦어요 — 더 미룰 수 없어요"'));
for (const f of ['AlarmActivity.java', 'AlarmReceiver.java']) {
  assert.ok(!fs.readFileSync(__dirname + '/../native/android/' + f, 'utf8').includes('"약속 시각이 지나 더 미룰 수 없어요"'), f + ' 는 noSnoozeText 를 써야 함');
}
console.log('✓ 미루기 막힘 문구: 약속 전/후 구분 (앱·안드로이드 같은 말)');

// 7) 출발 알람 화면: 09:20 에 울리면 빨간 '10:04 도착 · 4분 늦어요' + '늦는다고 알리기 ›', '남았어요' 없음
const RealDate = Date;
const fixed = ms => { global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(ms); } static now() { return ms; } }; };
U.modeIcon = () => ''; U.durLabel = v => v + '분';
Alarm._canGoNow = () => true;
fixed(T('09:20'));
let html = Alarm.departHTML(m13, 'm13');
assert.ok(/class="wa-go late">지금 나가면 <b>10:04<\/b> 도착 · <b>4분 늦어요<\/b>/.test(html));
assert.ok(html.includes('<div class="wa-foot late">지금 나가도 4분 늦어요</div>'));
assert.ok(html.includes('onclick="Alarm.lateShare()">늦는다고 알리기 ›</button>'));
assert.ok(!html.includes('남았어요') && !html.includes('Alarm.snooze()'));
assert.ok(html.includes('지금 출발 · 길안내') && html.includes('일정 보기'));
assert.strictEqual(Alarm.lateMessage(m13), '죄송해요, 10:04쯤 도착할 것 같아요 (4분 늦어요) — 마이플래너');
// 09:14: 아직 안 늦지만 미루면 늦음 → 미루기 막고 문구
fixed(T('09:14'));
html = Alarm.departHTML(m13, 'm13');
assert.ok(html.includes('<button class="wa-sub" disabled>5분 뒤 다시</button>'));
assert.ok(html.includes('5분 뒤에 나가면 약속에 늦어요 — 더 미룰 수 없어요') && !html.includes('lateShare'));
// 09:10: 평소대로
fixed(T('09:10'));
html = Alarm.departHTML(m13, 'm13');
assert.ok(html.includes('onclick="Alarm.snooze()"') && html.includes('약속까지 50분 남았어요') && !html.includes(' late'));
global.Date = RealDate;
console.log('✓ 출발 알람 화면: 늦음 빨간 줄 · 늦는다고 알리기 · 미루기 막힘 문구');

// 8) '늦는다고 알리기': 공유창 → 없으면 복사 + 안내
(async () => {
  let shared = null;
  navigator.share = async o => { shared = o; };
  await Share.text('죄송해요', '미팅');
  assert.deepStrictEqual(shared, { title: '미팅', text: '죄송해요' });
  delete navigator.share; let copied = '';
  navigator.clipboard = { writeText: async t => { copied = t; } };
  await Share.text('죄송해요');
  assert.strictEqual(copied, '죄송해요'); assert.ok(/복사했어요/.test(toast));
  console.log('✓ 늦는다고 알리기: 공유창 → 복사');
})().catch(e => { console.error(e); process.exit(1); });

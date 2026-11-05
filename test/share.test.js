// 일정 링크 보내기 확인: node test/share.test.js
const assert = require('assert');
const fs = require('fs');
global.window = {}; global.document = { addEventListener() {} };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.location = { protocol: 'https:', hostname: 'ktj8824-stack.github.io', origin: 'https://ktj8824-stack.github.io', pathname: '/myplanner/' };
const U = new Function(fs.readFileSync(__dirname + '/../js/core.js', 'utf8') + '; return U;')();
global.U = U; global.Planner = require('../js/planner.js');
const home = { name: '집', address: '마포구 공덕동', lat: 37.544, lng: 126.951 };
global.State = { settings: { home }, schedules: [] };
const Share = new Function(fs.readFileSync(__dirname + '/../js/share.js', 'utf8') + '; return Share;')();

const s = { id: 'a1', title: '출근', date: '2030-11-20', arriveBy: '09:00', mode: 'transit', prepMin: 40, bufferMin: 10,
  origin: { ...home }, dest: { name: '판교역', lat: 37.39, lng: 127.11 }, route: { travelMin: 50, steps: [], source: 'odsay' }, memo: '지하 3층 주차' };

// 1) 집 주소·좌표, 집 기준 경로, 메모는 기본으로 빠짐
let raw = JSON.parse(Share.b64d(Share.pack(s)));
assert.ok(!raw.origin && !raw.route, '집 출발지는 링크에 없어야 함');
assert.ok(!raw.memo, '메모는 고르지 않으면 빠짐');
assert.strictEqual(raw.dest.name, '판교역');
assert.ok(!/공덕동|37\.544/.test(Share.link(s)) && !/공덕동/.test(Share.b64d(Share.link(s).split('#mp=')[1])));
console.log('✓ 보낸 사람 집 주소·메모 제외');

// 2) 메모를 골랐을 때만 들어감, 집이 아닌 출발지는 그대로
raw = JSON.parse(Share.b64d(Share.pack({ ...s, origin: { name: '서울역', lat: 37.55, lng: 126.97 } }, { memo: true })));
assert.strictEqual(raw.memo, '지하 3층 주차');
assert.strictEqual(raw.origin.name, '서울역');
assert.ok(raw.route);
console.log('✓ 메모 선택 · 집이 아닌 출발지 유지');

// 3) 받은 링크 → 같은 일정이 이미 있으면 알아봄
const got = Share.detect(Share.link(s));
assert.ok(got && got.title === '출근' && !got.origin);
assert.strictEqual(Share.existing(got), null);
State.schedules.push({ ...got, id: 'x' });
assert.strictEqual(Share.existing(got).id, 'x');
console.log('✓ 같은 링크 두 번 저장 방지');

// 4) 경로 요약에서 맨 앞 시간 빼기
assert.strictEqual(U.routeRest('40분 · 환승 1회 · 1,500원'), '환승 1회 · 1,500원');
assert.strictEqual(U.routeRest('1시간 5분 · 환승 0회'), '환승 0회');
assert.strictEqual(U.routeRest('티맵 30분'), '티맵 30분');
console.log('✓ 소요 시간 두 번 표시 방지');
console.log('\n링크 보내기 확인 완료');

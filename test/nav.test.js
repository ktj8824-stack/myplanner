// 길안내 주소 확인: node test/nav.test.js
const assert = require('assert');
global.U = {}; global.Planner = { MODES: {} };
const Routes = (() => { const src = require('fs').readFileSync(__dirname + '/../js/routes.js', 'utf8'); return new Function(src + '; return Routes;')(); })();
const home = { name: '우리집 (마포구 공덕동)', lat: 37.5446, lng: 126.9516 };
const dest = { name: '서울아산병원', lat: 37.5266, lng: 127.1081 };

// 1) 버스·지하철 → 카카오맵 대중교통 길찾기, 출발·도착 모두
let u = Routes.navUrls('kakaomap', 'transit', home, dest);
assert.strictEqual(u.scheme, 'kakaomap://route?sp=37.5446,126.9516&ep=37.5266,127.1081&by=publictransit');
assert.ok(u.web.startsWith('https://map.kakao.com/link/by/traffic/'));
assert.ok(u.web.includes(',37.5446,126.9516/') && u.web.endsWith(',37.5266,127.1081'));
console.log('✓ 카카오맵: 출발·도착·대중교통이 채워진 길찾기');

// 2) 자가용 → 티맵 (x=경도, y=위도), 도보 → FOOT
u = Routes.navUrls('tmap', 'car', home, dest);
assert.ok(u.scheme.startsWith('tmap://route?goalname=') && u.scheme.includes('goalx=127.1081&goaly=37.5266') && u.scheme.includes('startx=126.9516&starty=37.5446'));
assert.strictEqual(Routes.navUrls('kakaomap', 'walk', home, dest).by, 'foot');
assert.strictEqual(Routes.navUrls('kakaomap', 'car', home, dest).by, 'car');
assert.ok(Routes.navUrls('kakaomap', 'walk', home, dest).web.includes('/link/by/walk/'));
console.log('✓ 티맵: 출발·도착 좌표, 도보·자가용 방식');

// 3) 이름의 쉼표·빗금이 주소를 깨지 않게, 출발지가 없으면 목적지만
u = Routes.navUrls('kakaomap', 'transit', { name: 'A, B/C', lat: 37.5, lng: 127 }, dest);
assert.ok(!decodeURIComponent(u.web.split('/traffic/')[1].split(',')[0]).includes(','));
u = Routes.navUrls('kakaomap', 'transit', null, dest);
assert.ok(u.web.startsWith('https://map.kakao.com/link/to/') && !u.scheme.includes('sp='));
console.log('✓ 이름 정리 · 출발지 없을 때');
console.log('\n길안내 주소 확인 완료');

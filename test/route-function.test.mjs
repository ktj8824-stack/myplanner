// 경로 서버 함수 확인: node test/route-function.test.mjs  (실제 API 호출 없이 가짜 응답으로)
import assert from 'node:assert';
import { handle } from '../supabase/functions/route/index.ts';

const env = { TMAP_APP_KEY: 'SECRET-TMAP', ODSAY_API_KEY: 'SECRET-ODSAY', ODSAY_REFERER: 'https://ktj8824-stack.github.io' };
const calls = [];
const fakeFetch = async (url, init = {}) => {
  calls.push({ url, init });
  if (url.includes('/pois')) return new Response(JSON.stringify({ searchPoiInfo: { pois: { poi: [{ name: '강남역' }] } } }), { status: 200 });
  if (url.includes('odsay')) return new Response(JSON.stringify({ result: { path: [] } }), { status: 200 });
  return new Response(JSON.stringify({ features: [{ properties: { totalTime: 3300 } }] }), { status: 200 });
};
const req = (body, ip = '1.1.1.1', method = 'POST') => new Request('https://x/functions/v1/route', {
  method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const C = { sx: 127.1001, sy: 37.5133, ex: 127.1112, ey: 37.3948 };
let t = 1_000_000;

// 1) 실시간 경로: 키는 헤더로만, 응답은 원본 그대로
let r = await handle(req({ service: 'tmap_route', ...C }), env, fakeFetch, t);
assert.strictEqual(r.status, 200);
assert.strictEqual((await r.json()).features[0].properties.totalTime, 3300);
assert.strictEqual(calls[0].init.headers.appKey, 'SECRET-TMAP');
assert.ok(!calls[0].url.includes('SECRET'), 'URL에 티맵 키 노출');
console.log('✓ 티맵 실시간 경로 (키는 서버에만)');

// 2) 같은 요청은 1분 캐시 → 티맵 호출 안 함
await handle(req({ service: 'tmap_route', ...C }), env, fakeFetch, t + 5000);
assert.strictEqual(calls.length, 1);
console.log('✓ 1분 캐시로 중복 호출 절약');

// 3) ODsay: Referer 전달
r = await handle(req({ service: 'odsay_transit', ...C }), env, fakeFetch, t);
assert.strictEqual(r.status, 200);
assert.strictEqual(calls.at(-1).init.headers.Referer, env.ODSAY_REFERER);
console.log('✓ ODsay 대중교통 (등록 주소 전달)');

// 4) 장소 검색, 예측(형식 검사), 도보
r = await handle(req({ service: 'tmap_pois', keyword: '강남' }), env, fakeFetch, t);
assert.strictEqual((await r.json()).searchPoiInfo.pois.poi[0].name, '강남역');
assert.strictEqual((await handle(req({ service: 'tmap_predict', ...C, predictionTime: '2026-11-03T09:00:00+0900' }), env, fakeFetch, t)).status, 200);
assert.strictEqual((await handle(req({ service: 'tmap_predict', ...C, predictionTime: 'bad' }), env, fakeFetch, t)).status, 400);
assert.strictEqual((await handle(req({ service: 'tmap_walk', ...C }), env, fakeFetch, t)).status, 200);
console.log('✓ 장소 검색·예측 경로·도보');

// 5) 남용 차단: 해외 좌표, 모르는 요청, GET, 키 미설정
assert.strictEqual((await handle(req({ service: 'tmap_route', sx: -74, sy: 40.7, ex: 127, ey: 37 }), env, fakeFetch, t)).status, 400);
assert.strictEqual((await handle(req({ service: 'anything', url: 'https://evil' }), env, fakeFetch, t)).status, 400);
assert.strictEqual((await handle(req(null, '1.1.1.1', 'GET'), env, fakeFetch, t)).status, 405);
assert.strictEqual((await handle(req({ service: 'tmap_route', ...C, sx: 127.2 }), {}, fakeFetch, t)).status, 503);
console.log('✓ 해외 좌표·임의 요청·GET·키 없음 차단');

// 6) 1분 61번째 호출은 429
let last;
for (let i = 0; i < 61; i++) last = await handle(req({ service: 'tmap_pois', keyword: 'a' + i }, '9.9.9.9'), env, fakeFetch, t + 100000);
assert.strictEqual(last.status, 429);
assert.strictEqual((await handle(req({ service: 'tmap_pois', keyword: 'z' }, '9.9.9.9'), env, fakeFetch, t + 170000)).status, 200);
console.log('✓ 사용자당 1분 60회 제한 후 회복');

// 7) CORS 사전 요청
assert.strictEqual((await handle(req(null, '1.1.1.1', 'OPTIONS'), env, fakeFetch, t)).headers.get('Access-Control-Allow-Origin'), '*');
console.log('✓ 웹 CORS');
// 8) 버스 실시간: 정리된 형태로 반환, 정류장 ID 형식 검사, 20초 캐시
const busFetch = async (url) => { calls.push({ url }); return new Response(JSON.stringify({ result: { real: [{ routeId: 100, routeNm: '7714', arrival1: { arrivalSec: 300, leftStation: 2 }, arrival2: { arrivalSec: 1200 } }] } }), { status: 200 }); };
r = await handle(req({ service: 'bus_arrival', stationID: '105123', routeIDs: '100,200' }, '7.7.7.7'), env, busFetch, t);
const bj = await r.json();
assert.deepStrictEqual(bj.arrivals.map(a => a.sec), [300, 1200]);
assert.ok(calls.at(-1).url.includes('realtimeStation') && calls.at(-1).url.includes('stationID=105123'));
assert.strictEqual((await handle(req({ service: 'bus_arrival', stationID: '1; drop' }, '7.7.7.7'), env, busFetch, t)).status, 400);
const before = calls.length;
await handle(req({ service: 'bus_arrival', stationID: '105123', routeIDs: '100,200' }, '7.7.7.7'), env, busFetch, t + 10000);
assert.strictEqual(calls.length, before);
await handle(req({ service: 'bus_arrival', stationID: '105123', routeIDs: '100,200' }, '7.7.7.7'), env, busFetch, t + 25000);
assert.strictEqual(calls.length, before + 1);
console.log('✓ 버스 실시간 (정리된 응답·형식 검사·20초 캐시)');
console.log('\n경로 서버 함수 확인 완료');

// 카카오 장소 검색: 키는 Authorization 헤더로만, 키가 없으면 503 (앱은 예시 장소로 대체)
{
  const kc = [];
  const kf = async (url, init = {}) => { kc.push({ url, init }); return new Response(JSON.stringify({ documents: [{ place_name: '서울아산병원', x: '127.108', y: '37.526' }] }), { status: 200 }); };
  let k = await handle(req({ service: 'kakao_local', keyword: '아산병원' }, '7.7.7.7'), { ...env, KAKAO_REST_KEY: 'SECRET-KAKAO' }, kf, t + 900000);
  assert.strictEqual(k.status, 200);
  assert.strictEqual((await k.json()).documents[0].place_name, '서울아산병원');
  assert.strictEqual(kc[0].init.headers.Authorization, 'KakaoAK SECRET-KAKAO');
  assert.ok(!kc[0].url.includes('SECRET'));
  k = await handle(req({ service: 'kakao_local', keyword: '아산병원2' }, '7.7.7.8'), env, kf, t + 900000);
  assert.strictEqual(k.status, 503);
  console.log('✓ 카카오 장소 검색 (키는 서버에만, 없으면 503)');
}

// 서울 버스: 같은 차량이 탈 곳·내릴 곳에 도착하는 시간 차이 = 지금 타면 걸리는 시간
{
  const { arrSec, rideFromRoute } = await import('../supabase/functions/route/index.ts');
  assert.strictEqual(arrSec('3분12초후[2번째 전]'), 192);
  assert.strictEqual(arrSec('곧 도착'), 30);
  assert.strictEqual(arrSec('운행종료'), null);
  const items = [
    { arsId: '14179', vehId1: 'X', arrmsg1: '1분후' },
    { arsId: '14180', vehId1: 'A', arrmsg1: '3분12초후[2번째 전]', plainNo1: '서울74사1234', vehId2: 'B', arrmsg2: '11분후' },
    { arsId: '22001', vehId1: 'Z', arrmsg1: '2분후', vehId2: 'A', arrmsg2: '49분12초후' }];
  assert.deepStrictEqual(rideFromRoute(items, '14-180', '22001'), { ride: 46, boardSec: 192, plainNo: '서울74사1234' });
  assert.strictEqual(rideFromRoute(items, '22001', '14180'), null);   // 반대 방향
  const env2 = { ...env, SEOUL_BUS_KEY: 'SEOULKEY' }, sc = [];
  const sf = async (url) => { sc.push(url);
    if (url.includes('busLaneDetail')) return new Response(JSON.stringify({ result: { busLocalBlID: '100100118' } }));
    return new Response(JSON.stringify({ msgBody: { itemList: items } })); };
  let rr = await handle(req({ service: 'seoul_bus_ride', busID: '1234', fromArs: '14180', toArs: '22001' }, '9.9.9.1'), env2, sf, t + 2e6);
  const body = await rr.json();
  assert.strictEqual(body.ride, 46);
  assert.ok(sc[1].includes('busRouteId=100100118') && sc[1].includes('SEOULKEY'));
  rr = await handle(req({ service: 'seoul_bus_ride', busID: '1234', fromArs: '14180', toArs: '22001' }, '9.9.9.1'), env, sf, t + 2e6);
  assert.strictEqual(rr.status, 503);                                  // 키 없으면 503 → 앱은 보정값 사용
  console.log('✓ 서울 버스 실시간 타는 시간 (같은 차량 추적)');
}

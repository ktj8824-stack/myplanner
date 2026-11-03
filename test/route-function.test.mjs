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

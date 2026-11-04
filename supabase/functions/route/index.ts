// =========================================
// MyPlanner — 경로 조회 서버 함수 (Supabase Edge Function)
// 앱 대신 티맵·ODsay를 호출해서, API 키가 앱(APK)에 들어가지 않게 합니다.
//
// 요청: POST { service, ...값 }
//   service: tmap_pois {keyword} | tmap_route {sx,sy,ex,ey} | tmap_predict {sx,sy,ex,ey,predictionTime}
//            | tmap_walk {sx,sy,ex,ey} | odsay_transit {sx,sy,ex,ey}
//            | kakao_local {keyword}  (카카오 키워드 장소 검색 — 티맵 키가 없거나 결과가 없을 때)
//            | bus_arrival {stationID, routeIDs?}  → { arrivals: [{ routeId, routeNm, sec, left }] } (정리된 형태)
// 응답: 원래 API의 JSON 그대로 (앱의 해석 코드가 같도록) — bus_arrival만 앱·폰이 바로 쓰기 쉽게 정리
//
// 배포: 버디플래너 Supabase 프로젝트에 함수 이름 myplanner-route 로 올라가 있음
// 비밀값 (Supabase 대시보드 > Edge Functions > Secrets) — MYPLANNER_ 접두사가 먼저, 없으면 접두사 없는 이름:
//   MYPLANNER_TMAP_APP_KEY, MYPLANNER_ODSAY_API_KEY, MYPLANNER_KAKAO_REST_KEY, (선택) MYPLANNER_ODSAY_REFERER = ODsay에 등록한 웹 주소
// =========================================

type Env = { TMAP_APP_KEY?: string; ODSAY_API_KEY?: string; ODSAY_REFERER?: string; KAKAO_REST_KEY?: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEO = "reqCoordType=WGS84GEO&resCoordType=WGS84GEO";
const RATE_PER_MIN = 60;          // 한 사용자(IP)당 1분 최대 호출
const CACHE_MS = 60_000;          // 같은 요청은 1분 동안 재사용 (비용 절약)
const rate = new Map<string, { n: number; t: number }>();
const cache = new Map<string, { at: number; status: number; body: string }>();

function json(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 대한민국 근처 좌표만 허용 (남용 방지) */
function coords(p: Record<string, unknown>) {
  const n = (k: string) => Number(p[k]);
  const c = { sx: n("sx"), sy: n("sy"), ex: n("ex"), ey: n("ey") };
  const okLng = (v: number) => Number.isFinite(v) && v > 123 && v < 133;
  const okLat = (v: number) => Number.isFinite(v) && v > 32 && v < 40;
  if (!okLng(c.sx) || !okLng(c.ex) || !okLat(c.sy) || !okLat(c.ey)) return null;
  return c;
}

/** ODsay 실시간 도착 응답 → [{ routeId, routeNm, sec, left }] (앱 Routes.normalizeBus와 같은 규칙) */
// deno-lint-ignore no-explicit-any
export function normalizeBus(data: any) {
  const res = data && data.result ? data.result : {};
  let real = res.real || res.realtime || res.arrival || [];
  if (!Array.isArray(real)) real = [real];
  const out: { routeId: string; routeNm: string; sec: number; left: number | null }[] = [];
  // deno-lint-ignore no-explicit-any
  real.forEach((r: any) => {
    if (!r) return;
    const routeId = String(r.routeId ?? r.routeID ?? r.busID ?? "");
    const routeNm = String(r.routeNm ?? r.routeName ?? r.busNo ?? "");
    // deno-lint-ignore no-explicit-any
    [r.arrival1, r.arrival2].forEach((a: any) => {
      if (!a) return;
      let sec = a.arrivalSec ?? a.predictTimeSec;
      if (sec == null && a.arrivalMin != null) sec = a.arrivalMin * 60;
      if (sec == null && a.predictTime != null) sec = a.predictTime * 60;
      sec = Number(sec);
      if (!isFinite(sec) || sec < 0 || sec > 7200) return;
      out.push({ routeId, routeNm, sec, left: a.leftStation ?? a.leftStop ?? null });
    });
  });
  return out.sort((x, y) => x.sec - y.sec);
}

const GLOBAL_PER_MIN = 1500;      // 이 서버 전체 1분 최대 (주소를 바꿔 가며 부르는 남용 대비)
let allReq = { n: 0, t: 0 };

function limited(ip: string, now: number) {
  if (now - allReq.t > 60_000) allReq = { n: 0, t: now };
  if (++allReq.n > GLOBAL_PER_MIN) return true;
  if (rate.size > 5000) for (const [k, v] of rate) if (now - v.t > 60_000) rate.delete(k); // 오래된 기록 정리
  const r = rate.get(ip);
  if (!r || now - r.t > 60_000) { rate.set(ip, { n: 1, t: now }); return false; }
  r.n++;
  return r.n > RATE_PER_MIN;
}

/** 요청한 쪽 주소: 앞쪽 값은 요청자가 꾸밀 수 있어 플랫폼이 붙인 값(x-real-ip·cf-connecting-ip·마지막 값)을 씀 */
export function clientIp(h: Headers): string {
  const direct = h.get("cf-connecting-ip") || h.get("x-real-ip");
  if (direct) return direct.trim();
  const xff = (h.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
  return xff[xff.length - 1] || "unknown";
}

export async function handle(req: Request, env: Env, fetchFn: Fetch = fetch, now = Date.now()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 가능" }, 405);

  const ip = clientIp(req.headers);
  if (limited(ip, now)) return json({ error: "잠시 후 다시 시도해 주세요" }, 429);

  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return json({ error: "잘못된 요청" }, 400); }
  const service = String(p.service || "");

  let url = "";
  let init: RequestInit = {};
  const tmap = env.TMAP_APP_KEY || "";

  if (service === "tmap_pois") {
    const keyword = String(p.keyword || "").trim().slice(0, 60);
    if (!keyword) return json({ error: "검색어 없음" }, 400);
    url = `https://apis.openapi.sk.com/tmap/pois?version=1&count=15&${GEO}&searchKeyword=${encodeURIComponent(keyword)}`;
    init = { headers: { appKey: tmap } };
  } else if (service === "kakao_local") {
    const keyword = String(p.keyword || "").trim().slice(0, 60);
    if (!keyword) return json({ error: "검색어 없음" }, 400);
    if (!env.KAKAO_REST_KEY) return json({ error: "카카오 키가 설정되지 않음" }, 503);
    url = `https://dapi.kakao.com/v2/local/search/keyword.json?size=15&query=${encodeURIComponent(keyword)}`;
    init = { headers: { Authorization: "KakaoAK " + env.KAKAO_REST_KEY } };
  } else if (service === "bus_arrival") {
    const stationID = String(p.stationID || "");
    const routeIDs = String(p.routeIDs || "");
    if (!/^\d{1,12}$/.test(stationID) || !/^[\d,]{0,200}$/.test(routeIDs)) return json({ error: "정류장 정보가 올바르지 않음" }, 400);
    if (!env.ODSAY_API_KEY) return json({ error: "ODsay 키가 설정되지 않음" }, 503);
    url = `https://api.odsay.com/v1/api/realtimeStation?lang=0&stationBase=0&stationID=${stationID}${routeIDs ? "&routeIDs=" + routeIDs : ""}&apiKey=${encodeURIComponent(env.ODSAY_API_KEY)}`;
    init = env.ODSAY_REFERER ? { headers: { Referer: env.ODSAY_REFERER } } : {};
  } else if (["tmap_route", "tmap_predict", "tmap_walk", "odsay_transit"].includes(service)) {
    const c = coords(p);
    if (!c) return json({ error: "좌표가 올바르지 않음" }, 400);
    const sname = String(p.sname || "출발").slice(0, 40), ename = String(p.ename || "도착").slice(0, 40);
    if (service === "tmap_route") {
      url = `https://apis.openapi.sk.com/tmap/routes?version=1&startX=${c.sx}&startY=${c.sy}&endX=${c.ex}&endY=${c.ey}&${GEO}&searchOption=0&trafficInfo=Y`;
      init = { headers: { appKey: tmap } };
    } else if (service === "tmap_predict") {
      const t = String(p.predictionTime || "");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0900$/.test(t)) return json({ error: "시각 형식 오류" }, 400);
      url = `https://apis.openapi.sk.com/tmap/routes/prediction?version=1&${GEO}&sort=index`;
      init = {
        method: "POST",
        headers: { appKey: tmap, "Content-Type": "application/json" },
        body: JSON.stringify({ routesInfo: {
          departure: { name: sname, lon: String(c.sx), lat: String(c.sy) },
          destination: { name: ename, lon: String(c.ex), lat: String(c.ey) },
          predictionType: "arrival", predictionTime: t,
        } }),
      };
    } else if (service === "tmap_walk") {
      url = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1";
      init = {
        method: "POST",
        headers: { appKey: tmap, "Content-Type": "application/json" },
        body: JSON.stringify({ startX: c.sx, startY: c.sy, endX: c.ex, endY: c.ey, startName: sname, endName: ename,
          reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO" }),
      };
    } else {
      if (!env.ODSAY_API_KEY) return json({ error: "ODsay 키가 설정되지 않음" }, 503);
      url = `https://api.odsay.com/v1/api/searchPubTransPathT?lang=0&SX=${c.sx}&SY=${c.sy}&EX=${c.ex}&EY=${c.ey}&apiKey=${encodeURIComponent(env.ODSAY_API_KEY)}`;
      // ODsay '웹(URI)' 키는 등록한 주소에서 온 요청만 받으므로 그 주소를 함께 보냄
      init = env.ODSAY_REFERER ? { headers: { Referer: env.ODSAY_REFERER } } : {};
    }
  } else {
    return json({ error: "지원하지 않는 요청" }, 400);
  }
  if (service.startsWith("tmap") && !tmap) return json({ error: "티맵 키가 설정되지 않음" }, 503);

  // 실시간 경로(tmap_route)는 1분 캐시, 나머지도 같은 요청이면 재사용
  const cacheKey = service + "|" + url + "|" + (init.body || "");
  const hit = cache.get(cacheKey);
  const ttl = service === "bus_arrival" ? 20_000 : CACHE_MS; // 실시간 버스는 20초만 재사용
  if (hit && now - hit.at < ttl) return json(hit.body, hit.status);

  try {
    const res = await fetchFn(url, init);
    if (res.status === 204) return json({}, 200); // 티맵 검색 결과 없음
    let body = await res.text();
    if (res.ok && service === "bus_arrival") {
      try { body = JSON.stringify({ arrivals: normalizeBus(JSON.parse(body)), source: "odsay" }); }
      catch { return json({ error: "실시간 응답 해석 실패" }, 502); }
    }
    if (!res.ok || (service.startsWith("odsay") && body.includes('"error"'))) {
      // 원인 확인용 기록 (ODsay는 오류도 200으로 보냄) (키는 URL·헤더에만 있고 여기엔 남기지 않음)
      console.warn(`[myplanner-route] ${service} upstream ${res.status}: ${body.slice(0, 300)}`);
    }
    if (res.ok) {
      cache.set(cacheKey, { at: now, status: res.status, body });
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    }
    return json(body, res.ok ? 200 : 502);
  } catch (_e) {
    return json({ error: "경로 서비스에 연결하지 못함" }, 502);
  }
}

// Supabase(Deno)에서 실행될 때만 서버 시작
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) {
  // 다른 앱(버디플래너)과 같은 프로젝트에 둘 수 있도록 MYPLANNER_ 접두사 비밀값을 먼저 읽음
  // 복사할 때 따라온 빈칸·줄바꿈은 지움
  const env = (k: string) => (D.env.get("MYPLANNER_" + k) || D.env.get(k) || "").trim() || undefined;
  // 진단용: 키 값은 남기지 않고 길이·빈칸 여부만 기록
  const raw = D.env.get("MYPLANNER_TMAP_APP_KEY") || "";
  console.log(`[myplanner-route] boot tmapKey len=${raw.length} trimmedLen=${raw.trim().length} quotes=${/["']/.test(raw)}`);
  D.serve((req: Request) => handle(req, {
    TMAP_APP_KEY: env("TMAP_APP_KEY"),
    ODSAY_API_KEY: env("ODSAY_API_KEY"),
    ODSAY_REFERER: env("ODSAY_REFERER"),
    KAKAO_REST_KEY: env("KAKAO_REST_KEY"),
  }));
}

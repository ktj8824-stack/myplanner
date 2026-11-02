// =========================================
// MyPlanner — 경로 조회 서버 함수 (Supabase Edge Function)
// 앱 대신 티맵·ODsay를 호출해서, API 키가 앱(APK)에 들어가지 않게 합니다.
//
// 요청: POST { service, ...값 }
//   service: tmap_pois {keyword} | tmap_route {sx,sy,ex,ey} | tmap_predict {sx,sy,ex,ey,predictionTime}
//            | tmap_walk {sx,sy,ex,ey} | odsay_transit {sx,sy,ex,ey}
// 응답: 원래 API의 JSON 그대로 (앱의 해석 코드가 같도록)
//
// 비밀값 (Supabase 대시보드 > Edge Functions > Secrets):
//   TMAP_APP_KEY, ODSAY_API_KEY, (선택) ODSAY_REFERER = ODsay에 등록한 웹 주소
// =========================================

type Env = { TMAP_APP_KEY?: string; ODSAY_API_KEY?: string; ODSAY_REFERER?: string };
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

function limited(ip: string, now: number) {
  const r = rate.get(ip);
  if (!r || now - r.t > 60_000) { rate.set(ip, { n: 1, t: now }); return false; }
  r.n++;
  return r.n > RATE_PER_MIN;
}

export async function handle(req: Request, env: Env, fetchFn: Fetch = fetch, now = Date.now()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 가능" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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
  if (hit && now - hit.at < CACHE_MS) return json(hit.body, hit.status);

  try {
    const res = await fetchFn(url, init);
    if (res.status === 204) return json({}, 200); // 티맵 검색 결과 없음
    const body = await res.text();
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
  D.serve((req: Request) => handle(req, {
    TMAP_APP_KEY: D.env.get("TMAP_APP_KEY"),
    ODSAY_API_KEY: D.env.get("ODSAY_API_KEY"),
    ODSAY_REFERER: D.env.get("ODSAY_REFERER"),
  }));
}

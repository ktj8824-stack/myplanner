// 마이플래너 카카오 로그인 (Supabase Edge Function: myplanner-kakao-login, verify_jwt=false)
// 왜 따로 두나: Supabase 카카오 설정 칸은 버디플래너와 같이 쓰고, 키를 하나만 받음.
// 그래서 마이플래너 앱 키로 받은 카카오 ID 토큰은 여기서 직접 확인하고 Supabase 로그인 상태를 만들어 돌려줌.
// 흐름: 앱(카카오 SDK) → id_token → 이 함수
//   1) 카카오 공개키(JWKS)로 서명 확인 + iss=https://kauth.kakao.com + aud=마이플래너 앱 키 + 만료 확인
//   2) 사용자 없으면 만듦 (이메일 칸은 카카오 번호로 만든 내부 주소 — 메일은 보내지 않음)
//   3) 일회용 로그인 링크를 만들고 바로 확인 → 보통 Supabase 세션(access/refresh 토큰)을 돌려줌
// 비밀값: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (Supabase가 자동으로 넣어 줌)
//         (선택) MYPLANNER_KAKAO_AUDS = 받을 카카오 앱 키 목록, 쉼표로 구분
//         웹 로그인: MYPLANNER_KAKAO_REST_KEY (마이플래너 카카오 앱 REST API 키), MYPLANNER_KAKAO_CLIENT_SECRET (켜 둔 경우)
// 웹은 카카오 로그인 → ?code= 로 돌아옴 → 앱이 code를 보냄 → 여기서 카카오에 code를 ID 토큰으로 바꿔 같은 확인을 거침

export const DEFAULT_AUDS = ["76014afcf1968e5e75b1976ada2896de", "a33bc63b10bc25a96b8f266cedde3680"]; // 마이플래너 카카오 앱 키, (예전) 버디플래너 앱 안의 마이플래너 키
export const ISS = "https://kauth.kakao.com";
/** 웹 로그인 뒤 돌아올 수 있는 주소 (카카오 디벨로퍼스 Redirect URI에도 같은 주소 등록) */
export const WEB_BACK = ["https://ktj8824-stack.github.io/myplanner/", "http://localhost:8787/"];

/** 웹: 카카오가 준 code → ID 토큰 (REST API 키 + 비밀 키는 서버에만) */
export async function codeToIdToken(body: any, env: Record<string, string | undefined>, fetchFn: typeof fetch) {
  const rest = (env.MYPLANNER_KAKAO_REST_KEY || "").trim();
  if (!rest) throw new Error("웹 로그인 설정이 아직 없어요");
  if (!WEB_BACK.includes(String(body.redirect_uri || ""))) throw new Error("허용되지 않은 주소예요");
  const form = new URLSearchParams({ grant_type: "authorization_code", client_id: rest, redirect_uri: body.redirect_uri, code: String(body.code || "") });
  if (env.MYPLANNER_KAKAO_CLIENT_SECRET) form.set("client_secret", env.MYPLANNER_KAKAO_CLIENT_SECRET.trim());
  const r = await fetchFn("https://kauth.kakao.com/oauth/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: form.toString() });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.id_token) throw new Error(t.error_description ? `카카오: ${t.error_description}` : "카카오에서 로그인 정보를 받지 못했어요 (OpenID Connect를 켜 주세요)");
  return { idToken: t.id_token as string, rest };
}
const JWKS_URL = "https://kauth.kakao.com/.well-known/jwks.json";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (s: string) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "===".slice((p.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const parse = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

let jwksCache: { at: number; keys: any[] } | null = null;
async function jwks(fetchFn: typeof fetch, force = false) {
  if (!force && jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetchFn(JWKS_URL);
  if (!r.ok) throw new Error("카카오 공개키를 못 받았어요");
  const keys = (await r.json()).keys || [];
  jwksCache = { at: Date.now(), keys };
  return keys;
}
export function _resetJwks() { jwksCache = null; }

/** 카카오 ID 토큰 확인 → 내용(claims). 틀리면 오류 */
export async function verifyKakao(token: string, auds: string[], fetchFn: typeof fetch = fetch, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("ID 토큰 형식이 아니에요");
  const head = parse(parts[0]), claims = parse(parts[1]);
  if (head.alg !== "RS256") throw new Error("지원하지 않는 서명 방식이에요");
  let key = (await jwks(fetchFn)).find((k: any) => k.kid === head.kid);
  if (!key) key = (await jwks(fetchFn, true)).find((k: any) => k.kid === head.kid); // 카카오가 키를 바꾼 경우
  if (!key) throw new Error("카카오 공개키를 찾지 못했어요");
  const ck = await crypto.subtle.importKey("jwk", { kty: key.kty, n: key.n, e: key.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", ck, b64url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("ID 토큰 서명이 맞지 않아요");
  if (claims.iss !== ISS) throw new Error("카카오에서 온 토큰이 아니에요");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a: string) => auds.includes(a))) throw new Error("마이플래너 앱 키로 받은 토큰이 아니에요");
  if (!claims.exp || claims.exp * 1000 < now - 60_000) throw new Error("ID 토큰이 만료됐어요. 다시 로그인해 주세요");
  if (!claims.sub) throw new Error("카카오 사용자 번호가 없어요");
  return claims;
}

/** 카카오 사용자 번호 → 내부 로그인용 주소 (실제 메일은 보내지 않음) */
export const emailFor = (sub: string) => `kakao-${sub}@myplanner.invalid`;

export async function handle(req: Request, env: Record<string, string | undefined>, fetchFn: typeof fetch = fetch) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST로 보내 주세요" }, 405);
  const url = (env.SUPABASE_URL || "").replace(/\/+$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.SUPABASE_ANON_KEY;
  if (!url || !svc || !anon) return json({ error: "서버 설정이 없어요" }, 503);
  const auds = (env.MYPLANNER_KAKAO_AUDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* 빈 몸통 */ }

  let claims: any;
  try {
    let token = body.id_token, allow = auds.length ? auds : DEFAULT_AUDS;
    if (!token && body.code) { const w = await codeToIdToken(body, env, fetchFn); token = w.idToken; allow = [...allow, w.rest]; }
    claims = await verifyKakao(token, allow, fetchFn);
    if (body.code && (!body.nonce || claims.nonce !== body.nonce)) throw new Error("로그인 확인 값이 맞지 않아요. 다시 눌러 주세요");
  }
  catch (e) { return json({ error: (e as Error).message }, 401); }

  const email = emailFor(String(claims.sub));
  const meta = { provider: "kakao", app: "myplanner", kakao_sub: String(claims.sub), nickname: claims.nickname || "", name: claims.nickname || "", avatar_url: claims.picture || "" };
  const admin = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

  // 1) 사용자 만들기 (이미 있으면 그대로)
  const cu = await fetchFn(`${url}/auth/v1/admin/users`, { method: "POST", headers: admin,
    body: JSON.stringify({ email, email_confirm: true, user_metadata: meta, app_metadata: { provider: "kakao", providers: ["kakao"], kakao_sub: String(claims.sub) } }) });
  if (!cu.ok && cu.status !== 422) return json({ error: `사용자를 만들지 못했어요 (${cu.status})` }, 502);

  // 2) 일회용 로그인 링크 → 3) 바로 확인해서 세션 받기
  const gl = await fetchFn(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: admin, body: JSON.stringify({ type: "magiclink", email }) });
  const link = await gl.json().catch(() => ({}));
  const hash = link.hashed_token || (link.properties && link.properties.hashed_token);
  if (!gl.ok || !hash) return json({ error: `로그인 링크를 만들지 못했어요 (${gl.status})` }, 502);
  const vr = await fetchFn(`${url}/auth/v1/verify`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: hash }) });
  const sess = await vr.json().catch(() => ({}));
  if (!vr.ok || !sess.access_token) return json({ error: `로그인 세션을 만들지 못했어요 (${vr.status})` }, 502);
  // 이 함수가 카카오 번호로 만든 계정이 맞는지 확인 (누가 같은 주소로 미리 가입해 둔 계정에 들어가지 않게). app_metadata는 본인이 못 바꿈
  const owner = ((sess.user && sess.user.app_metadata) || {}).kakao_sub;
  if (String(owner || "") !== String(claims.sub)) return json({ error: "이 카카오 계정으로는 로그인할 수 없어요. 문의해 주세요." }, 403);
  if (sess.user) sess.user.user_metadata = { ...meta, ...(sess.user.user_metadata || {}) };
  return json(sess);
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) D.serve((req: Request) => handle(req, D.env.toObject()));

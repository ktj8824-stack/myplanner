// 마이플래너 광고 포인트 서버 확인 (Supabase Edge Function: myplanner-admob-ssv, verify_jwt=false)
// 애드몹이 '보상형 광고를 끝까지 봤다'고 이 주소로 직접 알려 줌 (SSV). 앱이 아니라 구글이 부르므로 앱을 고쳐도 포인트를 못 만듦.
//  1) 구글 공개키(https://www.gstatic.com/admob/reward/verifier-keys.json)로 서명 확인 — ECDSA P-256 / SHA-256 / DER
//     서명 대상 = 받은 주소의 '?' 뒤부터 '&signature=' 앞까지 (순서·글자 그대로)
//  2) user_id(앱이 넣은 Supabase 사용자 id) + transaction_id(광고 1번마다 다름)로 mp_grant_ad_reward 호출
//     → 하루 한도·같은 거래 두 번 지급 막기는 DB 함수가 처리
// 애드몹 콘솔: 보상형 광고 단위 → 서버 측 확인 → 콜백 URL = https://<프로젝트>.supabase.co/functions/v1/myplanner-admob-ssv
// 자동: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null;

const b64 = (s: string) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "===".slice((p.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** DER(ECDSA) 서명 → WebCrypto가 받는 r||s 64바이트 */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("bad sig");
  let i = 2; if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const part = () => {
    if (der[i] !== 0x02) throw new Error("bad sig");
    const len = der[i + 1]; let v = der.slice(i + 2, i + 2 + len); i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("bad sig");
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = part(), s = part();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

export async function loadKeys(f: typeof fetch, force = false) {
  if (!force && keyCache && Date.now() - keyCache.at < 12 * 3600_000) return keyCache.keys;
  const r = await f(KEYS_URL);
  if (!r.ok) throw new Error("구글 공개키를 못 받았어요");
  const keys = new Map<string, CryptoKey>();
  for (const k of ((await r.json()).keys || [])) {
    keys.set(String(k.keyId), await crypto.subtle.importKey("spki", b64(k.base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}
export function _resetKeys() { keyCache = null; }

/** 서명 확인 → 맞으면 매개변수, 틀리면 오류 */
export async function verifySsv(rawQuery: string, f: typeof fetch) {
  const i = rawQuery.indexOf("&signature=");
  if (i < 0) throw new Error("서명이 없어요");
  const message = new TextEncoder().encode(rawQuery.slice(0, i));
  const q = new URLSearchParams(rawQuery);
  const sig = q.get("signature") || "", keyId = q.get("key_id") || "";
  let key = (await loadKeys(f)).get(keyId);
  if (!key) key = (await loadKeys(f, true)).get(keyId); // 구글이 키를 바꾼 경우
  if (!key) throw new Error("모르는 키예요");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64(sig)), message);
  if (!ok) throw new Error("서명이 맞지 않아요");
  return q;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(req: Request, env: Record<string, string | undefined>, f: typeof fetch = fetch) {
  const url = new URL(req.url);
  const raw = url.search.replace(/^\?/, "");
  // 애드몹 콘솔의 '확인' 버튼은 서명 없이 부를 수 있음 → 200으로 답해 등록이 되게
  if (!raw.includes("signature=")) return new Response("ok", { status: 200 });
  let q: URLSearchParams;
  try { q = await verifySsv(raw, f); }
  catch (e) { console.warn("ssv 거절", (e as Error).message); return new Response("bad signature", { status: 403 }); }
  const user = q.get("user_id") || "", tx = q.get("transaction_id") || "";
  if (!UUID.test(user) || !/^[0-9a-f]{8,64}$/i.test(tx)) return new Response("ok", { status: 200 }); // 앱이 사용자 id를 안 넣은 광고(로그인 전) → 지급 없음
  const svc = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const r = await f(`${env.SUPABASE_URL}/rest/v1/rpc/mp_grant_ad_reward`, {
    method: "POST", headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_user: user, p_tx: "admob:" + tx }),
  });
  const out = await r.json().catch(() => ({}));
  console.info("ssv", user.slice(0, 8), out && (out.ok ? (out.duplicate ? "dup" : "ok") : out.error));
  // 하루 한도 초과·중복도 200 (애드몹이 다시 보내지 않게). DB 오류만 500 → 애드몹이 나중에 다시 보냄
  return new Response("ok", { status: r.ok ? 200 : 500 });
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) D.serve((req: Request) => handle(req, D.env.toObject()));

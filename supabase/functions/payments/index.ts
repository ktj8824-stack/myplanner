// 마이플래너 이용권 결제 (플러스·프리미엄) (Supabase Edge Function: myplanner-payments, verify_jwt=true)
// action: prepare(주문 만들기) → 토스 결제창 → confirm(서버가 토스에 승인 요청) / status(이용권 상태)
// 비밀값: MYPLANNER_TOSS_SECRET_KEY (없으면 토스 문서 공개 테스트 키 — 실제 돈 안 나감)
//         MYPLANNER_REVENUECAT_SECRET_KEY (앱 구독 확인, 선택)
// 자동: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { handle, PayError, DOCS_TEST_SECRET, revenueCat } from "./logic.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
D.serve(async (req: Request) => {
  const h = { ...CORS, "Content-Type": "application/json; charset=utf-8" };
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new PayError(405, "METHOD", "POST로 보내 주세요");
    const env = D.env.toObject();
    const url = env.SUPABASE_URL, svc = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.SUPABASE_ANON_KEY;
    if (!url || !svc) throw new PayError(500, "CONFIG", "서버 설정이 아직 없어요.");
    const auth = req.headers.get("authorization") || "";
    const ur = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: anon || svc } });
    const user = ur.ok ? await ur.json() : null;
    if (!user || !user.id) throw new PayError(401, "UNAUTHORIZED", "카카오로 로그인한 뒤 결제할 수 있어요.");

    const text = await req.text();
    if (text.length > 8192) throw new PayError(413, "TOO_LARGE", "요청이 너무 커요.");
    const body = text ? JSON.parse(text) : {};
    const secret = (env.MYPLANNER_TOSS_SECRET_KEY || DOCS_TEST_SECRET).trim();
    const mode = secret.startsWith("live_") ? "live" : "test";

    const rest = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
      if (!r.ok) { console.error("db", r.status, await r.text()); throw new PayError(500, "DB", "저장소 오류가 났어요."); }
      return r.status === 204 ? null : r.json();
    };
    const q = encodeURIComponent;
    const db = {
      getPayment: async (id: string) => ((await rest(`mp_payments?order_id=eq.${q(id)}&select=*`)) || [])[0] || null,
      insertPayment: (row: unknown) => rest("mp_payments", { method: "POST", body: JSON.stringify(row) }),
      updatePayment: (id: string, patch: unknown) => rest(`mp_payments?order_id=eq.${q(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
      // 프리미엄은 예전 'pro' 결제도 포함
      proUntil: async (uid: string, plan = "premium") => ((await rest(`mp_payments?user_id=eq.${uid}&status=eq.DONE&plan=in.(${plan === "plus" ? "plus" : "premium,pro"})&select=period_end&order=period_end.desc&limit=1`)) || [])[0]?.period_end || null,
      recentPayments: (uid: string) => rest(`mp_payments?user_id=eq.${uid}&status=neq.READY&select=order_id,plan,amount,status,method,approved_at,period_end,mode,created_at&order=created_at.desc&limit=12`),
    };
    const toss = async (paymentKey: string, orderId: string, amount: number) => {
      const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(secret + ":"), "Content-Type": "application/json", "Idempotency-Key": orderId },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });
      // deno-lint-ignore no-explicit-any
      let b: any = {}; try { b = await res.json(); } catch (_) { /* */ }
      return { ok: res.ok, status: res.status, body: b };
    };
    const store = () => revenueCat(user.id, env.MYPLANNER_REVENUECAT_SECRET_KEY, fetch);
    return reply(200, await handle(String(body.action || ""), body, user.id, db, toss, store, mode, new Date(), env.MYPLANNER_PROMO_UNTIL || undefined));
  } catch (e) {
    if (e instanceof PayError) return reply(e.status, { error: { code: e.code, message: e.message } });
    console.error("payments error", e instanceof Error ? e.message : e);
    return reply(500, { error: { code: "INTERNAL", message: "결제 서버 오류가 났어요." } });
  }
});

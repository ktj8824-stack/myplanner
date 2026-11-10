// 마이플래너 이용권 결제 로직 (서버) — 로드플래너 결제 방식 그대로: 금액은 서버가 정하고,
// 토스 승인 결과를 서버가 확인한 뒤에만 이용 기간을 늘립니다.
// 이용권 3단계: 무료 / 플러스 월 1,900원(광고 없음) / 프리미엄 월 4,900원(광고 없음 + AI 비서)
// 웹 = 토스 결제(1개월씩), 앱 = 애플·구글 구독(RevenueCat). 둘 중 높은 등급을 씀. 예전 'pro'는 프리미엄.
export const PLANS: Record<string, { price: number; name: string }> = {
  plus: { price: 1900, name: "마이플래너 플러스 (월 정기)" },
  premium: { price: 4900, name: "마이플래너 프리미엄 (월 정기)" },
};
export const PRICE = PLANS.premium.price; // 예전 이름 (프리미엄 가격)
export const ORDER_NAME = PLANS.premium.name;
const RANK: Record<string, number> = { free: 0, plus: 1, premium: 2 };
export const planOf = (p: unknown) => (p === "pro" ? "premium" : (PLANS[String(p)] ? String(p) : "premium"));
export const DOCS_TEST_SECRET = "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6"; // 토스 문서 공개 테스트 키 (실제 돈 안 나감)

export class PayError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export function addMonth(from: Date) {
  const d = new Date(from.getTime()), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); // 1월 31일 → 2월 28일 (3월로 넘어가지 않게)
  return d;
}

// db: { getPayment, insertPayment, updatePayment, proUntil(userId, plan), recentPayments }
// toss: (paymentKey, orderId, amount) => { ok, status, body }
// store: () => Promise<{ active, expires, product } | null>  (앱 구독, RevenueCat)
// 주문번호: 문의·환불 때 불러 주기 쉽게 "MP-날짜(한국)-영문숫자 6자리" (예: MP-20261110-8F3K2A)
export function makeOrderId(now: Date) {
  const k = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I 빼고
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `MP-${k}-${Array.from(r, (b) => abc[b % abc.length]).join("")}`;
}

export async function handle(action: string, body: Record<string, unknown>, userId: string, db: any, toss: any, store: any, mode: string, now = new Date()) {
  if (action === "prepare") {
    const plan = planOf(body.plan), p = PLANS[plan];
    const orderId = makeOrderId(now);
    await db.insertPayment({ order_id: orderId, user_id: userId, plan, amount: p.price, order_name: p.name, status: "READY", mode });
    return { orderId, plan, amount: p.price, orderName: p.name, mode };
  }

  if (action === "confirm") {
    const orderId = String(body.orderId || ""), paymentKey = String(body.paymentKey || "");
    if (!orderId || !paymentKey || paymentKey.length > 200) throw new PayError(400, "INVALID_REQUEST", "결제 정보가 올바르지 않아요.");
    const row = await db.getPayment(orderId);
    if (!row || row.user_id !== userId) throw new PayError(404, "ORDER_NOT_FOUND", "주문을 찾을 수 없어요.");
    if (row.status === "DONE") return { status: "DONE", orderId, plan: planOf(row.plan), amount: row.amount, method: row.method, approvedAt: row.approved_at, periodEnd: row.period_end, mode: row.mode };
    if (row.status !== "READY") throw new PayError(409, "ORDER_CLOSED", "이미 처리된 주문이에요.");
    if (Number(body.amount) !== row.amount) {
      await db.updatePayment(orderId, { status: "FAILED", fail_reason: "AMOUNT_MISMATCH" });
      throw new PayError(400, "AMOUNT_MISMATCH", "결제 금액이 주문과 달라요. 결제가 승인되지 않았어요.");
    }
    const r = await toss(paymentKey, orderId, row.amount);
    if (!r.ok || r.body?.status !== "DONE") {
      const waiting = r.ok && r.body?.status === "WAITING_FOR_DEPOSIT";
      await db.updatePayment(orderId, { status: waiting ? "WAITING_FOR_DEPOSIT" : "FAILED", payment_key: paymentKey, fail_reason: waiting ? null : String(r.body?.code || r.status || "TOSS_ERROR").slice(0, 80) });
      if (waiting) return { status: "WAITING_FOR_DEPOSIT", orderId, virtualAccount: r.body.virtualAccount };
      throw new PayError(402, String(r.body?.code || "PAYMENT_FAILED"), String(r.body?.message || "결제 승인에 실패했어요."));
    }
    if (Number(r.body.totalAmount) !== row.amount) throw new PayError(400, "AMOUNT_MISMATCH", "승인 금액이 주문과 달라요.");
    // 같은 이용권 기간이 남아 있으면 그 끝에서 1개월 더
    const plan = planOf(row.plan);
    const cur = await db.proUntil(userId, plan);
    const start = cur && new Date(cur) > now ? new Date(cur) : now;
    const periodEnd = addMonth(start);
    const approvedAt = r.body.approvedAt || now.toISOString();
    await db.updatePayment(orderId, { status: "DONE", payment_key: paymentKey, method: String(r.body.method || ""), approved_at: approvedAt, period_end: periodEnd.toISOString() });
    return { status: "DONE", orderId, plan, amount: row.amount, method: r.body.method, approvedAt, periodEnd: periodEnd.toISOString(), mode: row.mode };
  }

  if (action === "status") {
    const web: Record<string, { until: string | null; active: boolean }> = {};
    for (const plan of ["plus", "premium"]) {
      const until = await db.proUntil(userId, plan);
      web[plan] = { until, active: !!until && new Date(until) > now };
    }
    let app = null;
    try { app = await store(); } catch (_) { app = null; }
    const webTier = web.premium.active ? "premium" : web.plus.active ? "plus" : "free";
    const appTier = app && app.active ? (app.tier || "premium") : "free";
    const tier = RANK[appTier] > RANK[webTier] ? appTier : webTier;
    const cur = webTier !== "free" ? web[webTier] : { until: null, active: false };
    return {
      tier, pro: tier === "premium", plus: tier !== "free",
      web: { tier: webTier, until: cur.until, active: cur.active, plus: web.plus, premium: web.premium },
      app: app ? { active: !!app.active, tier: app.active ? appTier : "free", until: app.expires || null, product: app.product || null } : null,
      plans: { plus: PLANS.plus.price, premium: PLANS.premium.price },
      price: PRICE, mode,
      payments: await db.recentPayments(userId),
    };
  }
  throw new PayError(400, "INVALID_ACTION", "알 수 없는 요청이에요.");
}

/** 앱 구독(RevenueCat) 확인 — 앱에서 구독한 사람의 RevenueCat 사용자 번호 = Supabase 사용자 id
 *  권한(entitlement): premium(예전 pro) > plus */
export async function revenueCat(userId: string, key: string | undefined, f: typeof fetch) {
  if (!key) return null;
  const res = await f(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const ents = (await res.json())?.subscriber?.entitlements || {};
  const live = (e: any) => !!e && (!e.expires_date || Date.parse(e.expires_date) > Date.now());
  for (const [name, tier] of [["premium", "premium"], ["pro", "premium"], ["plus", "plus"]]) {
    const e = ents[name];
    if (live(e)) return { active: true, tier, expires: e.expires_date || null, product: e.product_identifier || null };
  }
  return { active: false };
}

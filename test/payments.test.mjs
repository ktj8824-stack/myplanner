// PRO 결제 서버 로직: node --no-warnings test/payments.test.mjs
import assert from 'node:assert';
import { handle, PRICE, PLANS, PayError, addMonth, revenueCat } from '../supabase/functions/payments/logic.ts';

const rows = {};
const db = {
  getPayment: async (id) => rows[id] || null,
  insertPayment: async (r) => { rows[r.order_id] = { ...r }; },
  updatePayment: async (id, p) => { Object.assign(rows[id], p); },
  proUntil: async (uid, plan = 'premium') => Object.values(rows).filter(r => r.user_id === uid && r.status === 'DONE' && (plan === 'plus' ? r.plan === 'plus' : ['premium', 'pro'].includes(r.plan))).map(r => r.period_end).sort().pop() || null,
  recentPayments: async () => [],
};
let tossRes = { ok: true, status: 200, body: { status: 'DONE', totalAmount: PRICE, method: '카드', approvedAt: '2026-11-10T02:00:00Z' } };
const toss = async () => tossRes;
const noStore = async () => null;
const now = new Date('2026-11-10T02:00:00Z');
// 결제 흐름 시험은 출시 기념 무료 기간이 끝난 것으로 보고 함
const H = (a, b, u, d, t, s, m, n) => handle(a, b, u, d, t, s, m, n, '2000-01-01T00:00:00Z');

assert.strictEqual(PRICE, 4900);
// 1) 주문: 금액은 서버가 정함
const o = await H('prepare', { amount: 1 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(o.amount, 4900); assert.ok(/^MP-20261110-[A-Z2-9]{6}$/.test(o.orderId), o.orderId);
// 2) 금액이 다르면 승인하지 않음
const o2 = await H('prepare', {}, 'u1', db, toss, noStore, 'test', now);
await assert.rejects(H('confirm', { orderId: o2.orderId, paymentKey: 'k', amount: 100 }, 'u1', db, toss, noStore, 'test', now), e => e.code === 'AMOUNT_MISMATCH');
// 3) 남의 주문은 못 씀
await assert.rejects(H('confirm', { orderId: o.orderId, paymentKey: 'k', amount: 4900 }, 'u2', db, toss, noStore, 'test', now), e => e.code === 'ORDER_NOT_FOUND');
// 4) 정상 승인 → 1개월, 두 번 눌러도 한 번만
const c = await H('confirm', { orderId: o.orderId, paymentKey: 'k', amount: 4900 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(c.status, 'DONE'); assert.strictEqual(c.periodEnd, '2026-12-10T02:00:00.000Z');
const c2 = await H('confirm', { orderId: o.orderId, paymentKey: 'k', amount: 4900 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(c2.periodEnd, c.periodEnd);
// 5) 남은 기간 끝에서 1개월 더
const o3 = await H('prepare', {}, 'u1', db, toss, noStore, 'test', now);
const c3 = await H('confirm', { orderId: o3.orderId, paymentKey: 'k3', amount: 4900 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(c3.periodEnd, '2027-01-10T02:00:00.000Z');
// 6) 토스가 거절하면 FAILED, PRO 안 늘어남
tossRes = { ok: false, status: 400, body: { code: 'REJECT_CARD_COMPANY', message: '카드 거절' } };
const o4 = await H('prepare', {}, 'u1', db, toss, noStore, 'test', now);
await assert.rejects(H('confirm', { orderId: o4.orderId, paymentKey: 'k4', amount: 4900 }, 'u1', db, toss, noStore, 'test', now), e => e.status === 402);
assert.strictEqual(rows[o4.orderId].status, 'FAILED');
// 7) 상태: 웹 결제 또는 앱 구독 중 하나면 PRO
let s = await H('status', {}, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(s.pro, true); assert.strictEqual(s.web.until, '2027-01-10T02:00:00.000Z');
s = await H('status', {}, 'u9', db, toss, noStore, 'test', now); assert.strictEqual(s.pro, false);
s = await H('status', {}, 'u9', db, toss, async () => ({ active: true, expires: '2026-12-01T00:00:00Z', product: 'mp_pro_monthly' }), 'test', now); assert.strictEqual(s.pro, true);
assert.strictEqual(s.tier, 'premium');
// 8) 이용권 3단계: 플러스 1,900원 → 광고만 없음 (AI 비서는 프리미엄)
assert.strictEqual(PLANS.plus.price, 1900); assert.strictEqual(PLANS.premium.price, 4900);
tossRes = { ok: true, status: 200, body: { status: 'DONE', totalAmount: 1900, method: '카드' } };
const p1 = await H('prepare', { plan: 'plus', amount: 1 }, 'u3', db, toss, noStore, 'test', now);
assert.strictEqual(p1.amount, 1900); assert.strictEqual(p1.plan, 'plus');
await H('confirm', { orderId: p1.orderId, paymentKey: 'p1', amount: 1900 }, 'u3', db, toss, noStore, 'test', now);
s = await H('status', {}, 'u3', db, toss, noStore, 'test', now);
assert.strictEqual(s.tier, 'plus'); assert.strictEqual(s.plus, true); assert.strictEqual(s.pro, false);
// 플러스 쓰는 중에 프리미엄 결제 → 프리미엄 기간은 플러스와 따로 1개월
tossRes = { ok: true, status: 200, body: { status: 'DONE', totalAmount: 4900, method: '카드' } };
const p2 = await H('prepare', { plan: 'premium' }, 'u3', db, toss, noStore, 'test', now);
const c5 = await H('confirm', { orderId: p2.orderId, paymentKey: 'p2', amount: 4900 }, 'u3', db, toss, noStore, 'test', now);
assert.strictEqual(c5.periodEnd, '2026-12-10T02:00:00.000Z');
s = await H('status', {}, 'u3', db, toss, noStore, 'test', now); assert.strictEqual(s.tier, 'premium');
// 앱에서 플러스 구독 + 웹 프리미엄 없음 → 플러스. 모르는 등급 이름은 프리미엄으로
s = await H('status', {}, 'u8', db, toss, async () => ({ active: true, tier: 'plus' }), 'test', now); assert.strictEqual(s.tier, 'plus');
assert.strictEqual((await H('prepare', { plan: 'gold' }, 'u8', db, toss, noStore, 'test', now)).amount, 4900);
// 예전 'pro' 결제 기록은 프리미엄
rows['OLD'] = { order_id: 'OLD', user_id: 'u7', plan: 'pro', status: 'DONE', period_end: '2026-11-20T00:00:00Z' };
s = await H('status', {}, 'u7', db, toss, noStore, 'test', now); assert.strictEqual(s.tier, 'premium');
// RevenueCat 권한 이름 → 등급
const rcf = (ents) => async () => ({ ok: true, json: async () => ({ subscriber: { entitlements: ents } }) });
const fut = '2099-01-01T00:00:00Z', past = '2020-01-01T00:00:00Z';
assert.strictEqual((await revenueCat('u', 'k', rcf({ plus: { expires_date: fut } }))).tier, 'plus');
assert.strictEqual((await revenueCat('u', 'k', rcf({ plus: { expires_date: fut }, premium: { expires_date: fut } }))).tier, 'premium');
assert.strictEqual((await revenueCat('u', 'k', rcf({ pro: { expires_date: fut } }))).tier, 'premium');
assert.strictEqual((await revenueCat('u', 'k', rcf({ premium: { expires_date: past } }))).active, false);
await assert.rejects(H('nope', {}, 'u1', db, toss, noStore, 'test', now), e => e instanceof PayError);
assert.strictEqual(addMonth(new Date('2026-01-31T00:00:00Z')).toISOString().slice(0, 10), '2026-02-28');
// 출시 기념 무료 기간(2027-03-31까지)에는 결제를 받지 않고, 상태에 무료 기간을 알려 줌
await assert.rejects(handle('prepare', { plan: 'premium' }, 'u5', db, toss, noStore, 'test', now), e => e.code === 'PROMO_FREE');
const ps = await handle('status', {}, 'u5', db, toss, noStore, 'test', now);
assert.strictEqual(ps.promo.active, true);
assert.strictEqual((await handle('status', {}, 'u5', db, toss, noStore, 'test', new Date('2027-04-01T00:00:00+09:00'))).promo.active, false);
console.log('✓ 이용권 결제(플러스 1,900 · 프리미엄 4,900): 서버가 금액 결정 · 금액 다르면 거절 · 남의 주문 거절 · 1개월 연장 · 중복 승인 없음 · 웹/앱 둘 다 PRO');

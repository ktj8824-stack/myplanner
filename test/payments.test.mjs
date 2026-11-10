// PRO 결제 서버 로직: node --no-warnings test/payments.test.mjs
import assert from 'node:assert';
import { handle, PRICE, PayError, addMonth } from '../supabase/functions/payments/logic.ts';

const rows = {};
const db = {
  getPayment: async (id) => rows[id] || null,
  insertPayment: async (r) => { rows[r.order_id] = { ...r }; },
  updatePayment: async (id, p) => { Object.assign(rows[id], p); },
  proUntil: async (uid) => Object.values(rows).filter(r => r.user_id === uid && r.status === 'DONE').map(r => r.period_end).sort().pop() || null,
  recentPayments: async () => [],
};
let tossRes = { ok: true, status: 200, body: { status: 'DONE', totalAmount: PRICE, method: '카드', approvedAt: '2026-11-10T02:00:00Z' } };
const toss = async () => tossRes;
const noStore = async () => null;
const now = new Date('2026-11-10T02:00:00Z');

assert.strictEqual(PRICE, 4900);
// 1) 주문: 금액은 서버가 정함
const o = await handle('prepare', { amount: 1 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(o.amount, 4900); assert.ok(/^MP-20261110-[A-Z2-9]{6}$/.test(o.orderId), o.orderId);
// 2) 금액이 다르면 승인하지 않음
const o2 = await handle('prepare', {}, 'u1', db, toss, noStore, 'test', now);
await assert.rejects(handle('confirm', { orderId: o2.orderId, paymentKey: 'k', amount: 100 }, 'u1', db, toss, noStore, 'test', now), e => e.code === 'AMOUNT_MISMATCH');
// 3) 남의 주문은 못 씀
await assert.rejects(handle('confirm', { orderId: o.orderId, paymentKey: 'k', amount: 4900 }, 'u2', db, toss, noStore, 'test', now), e => e.code === 'ORDER_NOT_FOUND');
// 4) 정상 승인 → 1개월, 두 번 눌러도 한 번만
const c = await handle('confirm', { orderId: o.orderId, paymentKey: 'k', amount: 4900 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(c.status, 'DONE'); assert.strictEqual(c.periodEnd, '2026-12-10T02:00:00.000Z');
const c2 = await handle('confirm', { orderId: o.orderId, paymentKey: 'k', amount: 4900 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(c2.periodEnd, c.periodEnd);
// 5) 남은 기간 끝에서 1개월 더
const o3 = await handle('prepare', {}, 'u1', db, toss, noStore, 'test', now);
const c3 = await handle('confirm', { orderId: o3.orderId, paymentKey: 'k3', amount: 4900 }, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(c3.periodEnd, '2027-01-10T02:00:00.000Z');
// 6) 토스가 거절하면 FAILED, PRO 안 늘어남
tossRes = { ok: false, status: 400, body: { code: 'REJECT_CARD_COMPANY', message: '카드 거절' } };
const o4 = await handle('prepare', {}, 'u1', db, toss, noStore, 'test', now);
await assert.rejects(handle('confirm', { orderId: o4.orderId, paymentKey: 'k4', amount: 4900 }, 'u1', db, toss, noStore, 'test', now), e => e.status === 402);
assert.strictEqual(rows[o4.orderId].status, 'FAILED');
// 7) 상태: 웹 결제 또는 앱 구독 중 하나면 PRO
let s = await handle('status', {}, 'u1', db, toss, noStore, 'test', now);
assert.strictEqual(s.pro, true); assert.strictEqual(s.web.until, '2027-01-10T02:00:00.000Z');
s = await handle('status', {}, 'u9', db, toss, noStore, 'test', now); assert.strictEqual(s.pro, false);
s = await handle('status', {}, 'u9', db, toss, async () => ({ active: true, expires: '2026-12-01T00:00:00Z', product: 'mp_pro_monthly' }), 'test', now); assert.strictEqual(s.pro, true);
await assert.rejects(handle('nope', {}, 'u1', db, toss, noStore, 'test', now), e => e instanceof PayError);
assert.strictEqual(addMonth(new Date('2026-01-31T00:00:00Z')).toISOString().slice(0, 10), '2026-02-28');
console.log('✓ PRO 결제: 서버가 금액 결정 · 금액 다르면 거절 · 남의 주문 거절 · 1개월 연장 · 중복 승인 없음 · 웹/앱 둘 다 PRO');

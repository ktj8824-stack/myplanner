// 애드몹 서버 확인(SSV): 구글 서명이 맞을 때만 포인트 지급
import assert from 'node:assert';
import { handle, _resetKeys, derToRaw } from '../supabase/functions/admob-ssv/index.ts';

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
/** r||s → DER */
const toDer = (raw) => {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return Buffer.concat([Buffer.from([2, b.length]), b]); };
  const body = Buffer.concat([int(Buffer.from(raw.slice(0, 32))), int(Buffer.from(raw.slice(32)))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
};
const sign = async (msg) => toDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(msg)))).toString('base64url');
const UID = '0d4e6c2a-1b2c-4d3e-8f90-123456789abc';
const calls = [];
const f = async (url, init) => {
  if (String(url).includes('verifier-keys')) return new Response(JSON.stringify({ keys: [{ keyId: 123, base64: spki }] }));
  calls.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ ok: true, earned: 10 }));
};
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
_resetKeys();
const base = `ad_network=5450213213286189855&ad_unit=1234&custom_data=mp&reward_amount=1&reward_item=P&timestamp=1794380000000&transaction_id=abc123def456&user_id=${UID}`;
const good = `${base}&signature=${await sign(base)}&key_id=123`;
let r = await handle(new Request('https://x/f?' + good), env, f);
assert.strictEqual(r.status, 200); assert.deepStrictEqual(calls.pop(), { p_user: UID, p_tx: 'admob:abc123def456' });
// 금액·사용자를 바꾸면 서명이 안 맞아 거절
r = await handle(new Request('https://x/f?' + good.replace('user_id=0d4e', 'user_id=1d4e')), env, f);
assert.strictEqual(r.status, 403); assert.strictEqual(calls.length, 0);
// 모르는 키 → 거절
r = await handle(new Request('https://x/f?' + good.replace('key_id=123', 'key_id=999')), env, f);
assert.strictEqual(r.status, 403);
// 애드몹 콘솔 '확인'(서명 없음) → 200, 지급 없음
r = await handle(new Request('https://x/f'), env, f); assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 0);
// 로그인 안 한 광고(user_id 없음) → 200, 지급 없음
const nb = base.replace(`&user_id=${UID}`, '');
r = await handle(new Request(`https://x/f?${nb}&signature=${await sign(nb)}&key_id=123`), env, f);
assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 0);
assert.strictEqual(derToRaw(new Uint8Array(toDer(new Uint8Array(64).fill(1)))).length, 64);
console.log('✓ 광고 포인트 서버 확인(SSV): 구글 서명이 맞을 때만 지급 · 바꾼 주소·모르는 키 거절 · 로그인 전 광고는 지급 없음');

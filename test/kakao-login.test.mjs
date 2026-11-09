// 카카오 로그인 서버 함수 확인 (가짜 카카오 공개키·Supabase): node --no-warnings test/kakao-login.test.mjs
import assert from 'node:assert';
import { handle, verifyKakao, emailFor, _resetJwks, ISS, DEFAULT_AUDS } from '../supabase/functions/kakao-login/index.ts';

const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = await subtle.exportKey('jwk', kp.publicKey);
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function token(claims, kid = 'k1') {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })), p = b64u(JSON.stringify(claims));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return `${h}.${p}.${b64u(sig)}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: ISS, aud: DEFAULT_AUDS[0], sub: '12345', exp: now + 3600, nickname: '공진문' };
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

const calls = [];
const fake = (opts = {}) => async (url, init = {}) => {
  calls.push(url);
  if (url.includes('jwks')) return new Response(JSON.stringify({ keys: [{ ...pub, kid: 'k1' }] }));
  if (url.endsWith('/admin/users')) return new Response('{"code":"email_exists"}', { status: opts.exists ? 422 : 200 });
  if (url.endsWith('/admin/generate_link')) { assert.strictEqual(JSON.parse(init.body).email, emailFor('12345')); return new Response(JSON.stringify({ hashed_token: 'h1' })); }
  if (url.endsWith('/auth/v1/verify')) { assert.strictEqual(JSON.parse(init.body).token_hash, 'h1'); return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, user: { id: 'u1', user_metadata: {}, app_metadata: { kakao_sub: opts.owner ?? '12345' } } })); }
  return new Response('{}', { status: 404 });
};
const post = (b) => new Request('https://f/', { method: 'POST', body: JSON.stringify(b) });

// 1) 정상 → 세션
let r = await handle(post({ id_token: await token(good) }), env, fake());
let j = await r.json();
assert.strictEqual(r.status, 200); assert.strictEqual(j.access_token, 'AT'); assert.strictEqual(j.user.user_metadata.nickname, '공진문');
// 2) 이미 있는 사용자도 로그인
r = await handle(post({ id_token: await token(good) }), env, fake({ exists: true }));
assert.strictEqual(r.status, 200);
// 2-1) 같은 주소로 누가 미리 만들어 둔 계정(카카오 번호 표시 없음)에는 들어가지 않음
r = await handle(post({ id_token: await token(good) }), env, fake({ exists: true, owner: '' }));
assert.strictEqual(r.status, 403);
console.log('✓ 카카오 ID 토큰 → Supabase 세션 (새 사용자 · 기존 사용자) · 미리 만든 계정 거절');

// 3) 다른 앱 키(버디플래너)·가짜 발급처·만료·서명 위조는 거절
for (const [bad, why] of [[{ ...good, aud: '023bb498015836d0a4a922373e48f39f' }, '다른 앱 키'], [{ ...good, iss: 'https://evil' }, '발급처'], [{ ...good, exp: now - 3600 }, '만료']]) {
  r = await handle(post({ id_token: await token(bad) }), env, fake());
  assert.strictEqual(r.status, 401, why);
}
const t = (await token(good)).split('.'); const forged = t[0] + '.' + b64u(JSON.stringify({ ...good, sub: '999' })) + '.' + t[2];
r = await handle(post({ id_token: forged }), env, fake()); assert.strictEqual(r.status, 401);
r = await handle(post({}), env, fake()); assert.strictEqual(r.status, 401);
// 4) 받을 키 목록은 비밀값으로 바꿀 수 있음
_resetJwks();
await assert.rejects(verifyKakao(await token(good), ['other'], fake()));
r = await handle(post({ id_token: await token({ ...good, aud: 'newkey' }) }), { ...env, MYPLANNER_KAKAO_AUDS: 'newkey, x' }, fake());
assert.strictEqual(r.status, 200);
console.log('✓ 다른 앱 키 · 가짜 발급처 · 만료 · 서명 위조 거절, 키 목록 교체 가능');
console.log('카카오 로그인 함수 테스트 완료');

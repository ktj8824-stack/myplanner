// 로그인 동기화 확인 (가짜 서버): node test/sync.test.js
const assert = require('assert');
const fs = require('fs'), vm = require('vm');
function make() {
  const store = {};
  const ctx = { console, Date, JSON, Math, Promise, setTimeout: () => 0, clearTimeout() {}, URLSearchParams, atob: s => Buffer.from(s, 'base64').toString('binary'), escape,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { onLine: true }, document: { addEventListener() {}, getElementById() { return null; } }, window: {}, location: { hash: '' },
    Routes: { key: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k' })[k] || '' },
    Alarm: { rescheduleAll: async () => [] }, App: { current: 'x' }, Settings: { cloudCard() {} }, AbortController: undefined };
  ctx.server = []; ctx.hook = null; ctx.refreshStatus = 200;
  ctx.fetch = async (url, o) => {
    if (url.includes('grant_type=refresh_token')) return { ok: ctx.refreshStatus === 200, status: ctx.refreshStatus, json: async () => ({}) };
    if (url.includes('mp_schedules?select')) return { ok: true, status: 200, text: async () => JSON.stringify(ctx.server) };
    if (url.includes('mp_schedules?on_conflict')) {
      if (ctx.hook) { const h = ctx.hook; ctx.hook = null; await h(); }
      JSON.parse(o.body).forEach(r => { const i = ctx.server.findIndex(x => x.id === r.id); if (i >= 0) ctx.server[i] = r; else ctx.server.push(r); });
      return { ok: true, status: 201, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => '[]' };
  };
  vm.createContext(ctx);
  vm.runInContext(['core.js', 'planner.js', 'recur.js', 'cloud.js'].map(f => fs.readFileSync(__dirname + '/../js/' + f, 'utf8')).join('\n') + '\n;this.State=State;this.Cloud=Cloud;', ctx);
  return ctx;
}
const signIn = (c, user = { id: 'me' }, exp = Date.now() + 3600e3) => c.localStorage.setItem('mp_cloud_session', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: exp, user }));
const S = { id: 'abc', title: 't', date: '2030-01-01', arriveBy: '09:00', mode: 'walk', updatedAt: 1000 };
const row = (data, extra = {}) => ({ owner_id: 'me', id: data.id, data, deleted: false, updated_at: new Date(data.updatedAt).toISOString(), ...extra });

(async () => {
  // 1) 오프라인에서 지운 일정이 되살아나지 않음
  let c = make(); signIn(c); c.localStorage.setItem('mp_sync_last', '1');
  c.State.schedules = [{ ...S }]; c.server = [row(S)];
  c.State.remove('abc');
  await c.Cloud.sync();
  assert.deepStrictEqual(c.State.schedules.map(x => x.id), []);
  assert.strictEqual(c.server[0].deleted, true);
  console.log('✓ 오프라인 삭제 유지');

  // 2) 로그아웃 중에 지운 일정도 다시 로그인하면 지워짐
  c = make(); c.State.schedules = [{ ...S }]; c.server = [row(S)];
  c.State.remove('abc'); signIn(c);
  await c.Cloud.sync();
  assert.deepStrictEqual(c.State.schedules.map(x => x.id), []);
  assert.strictEqual(c.server[0].deleted, true);
  console.log('✓ 로그아웃 중 삭제 → 다시 로그인해도 유지');

  // 3) 올리는 도중 또 고친 내용은 다음에 올라감
  c = make(); signIn(c); c.localStorage.setItem('mp_sync_last', '1');
  c.State.schedules = [{ ...S }]; c.State.upsert({ ...S, arriveBy: '10:00' });
  c.hook = async () => { await new Promise(r => setImmediate(r)); c.State.upsert({ ...c.State.get('abc'), arriveBy: '11:00', updatedAt: 0 }); };
  await c.Cloud.push();
  assert.strictEqual(c.server[0].data.arriveBy, '10:00');
  assert.ok(JSON.parse(c.localStorage.getItem('mp_sync_dirty')).abc);
  await c.Cloud.push();
  assert.strictEqual(c.server[0].data.arriveBy, '11:00');
  assert.deepStrictEqual(JSON.parse(c.localStorage.getItem('mp_sync_dirty')), {});
  console.log('✓ 올리는 중 수정도 놓치지 않음');

  // 4) 다른 기기에서 더 나중에 고친 내용이 이김 (오래된 오프라인 수정이 덮어쓰지 않음)
  c = make(); signIn(c); c.localStorage.setItem('mp_sync_last', '1');
  c.State.schedules = [{ ...S, arriveBy: '08:00', updatedAt: 2000 }];
  c.localStorage.setItem('mp_sync_dirty', JSON.stringify({ abc: { at: 2000 } }));
  c.server = [row({ ...S, arriveBy: '12:00', updatedAt: 5000 })];
  await c.Cloud.sync();
  assert.strictEqual(c.State.get('abc').arriveBy, '12:00');
  assert.strictEqual(c.server[0].data.arriveBy, '12:00');
  //    반대로 내 수정이 더 나중이면 내 것이 올라감
  c.State.upsert({ ...c.State.get('abc'), arriveBy: '07:00' });
  await c.Cloud.sync();
  assert.strictEqual(c.server[0].data.arriveBy, '07:00');
  console.log('✓ 나중에 바꾼 쪽이 이김');

  // 5) 사용자 정보 없이 토큰만 있으면 토큰 안의 id를 씀 (내 일정을 공유 일정으로 착각하지 않음)
  c = make();
  const jwt = 'x.' + Buffer.from(JSON.stringify({ sub: 'me' })).toString('base64url') + '.y';
  c.Cloud._save({ access_token: jwt, expires_in: 3600 });
  assert.strictEqual(c.Cloud.userId(), 'me');
  c.State.schedules = [{ ...S }]; c.server = [row(S)]; c.localStorage.setItem('mp_sync_last', '1');
  await c.Cloud.sync();
  assert.deepStrictEqual(c.State.schedules.map(x => x.id), ['abc']);
  console.log('✓ 웹 로그인 직후 사용자 id');

  // 6) 토큰 갱신이 느리거나 서버 오류면 로그인 유지, 거절(401)이면 로그아웃
  c = make(); signIn(c, { id: 'me' }, Date.now() - 1000); c.refreshStatus = 503;
  await c.Cloud.sync().catch(() => {});
  assert.ok(c.Cloud.isSignedIn());
  c.refreshStatus = 401;
  await c.Cloud.sync().catch(() => {});
  assert.ok(!c.Cloud.isSignedIn());
  console.log('✓ 일시 오류로 로그아웃되지 않음');

  // 7) 예전 형식(배열) 기록도 읽음
  c = make(); signIn(c); c.localStorage.setItem('mp_sync_last', '1');
  c.State.schedules = [{ ...S, arriveBy: '06:00' }]; c.localStorage.setItem('mp_sync_dirty', JSON.stringify(['abc']));
  c.server = [row(S)];
  await c.Cloud.sync();
  assert.strictEqual(c.server[0].data.arriveBy, '06:00');
  console.log('✓ 예전 동기화 기록 호환');
  console.log('동기화 테스트 완료');
})().catch(e => { console.error(e); process.exit(1); });

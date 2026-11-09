/* =========================================
   MyPlanner — 로그인 · 동기화 · 가족 공유 (Supabase)
   - 라이브러리 없이 Supabase REST(Auth/PostgREST/RPC)를 직접 호출 (버디플래너 cloud.js 방식)
   - 오프라인 우선: 일정은 계속 기기에 저장하고, 로그인하면 바뀐 일정만 서버로 올림
   - 일정 하나 = mp_schedules 한 줄. 충돌은 '나중에 수정한 쪽'(data.updatedAt)이 이김
   - 가족에게 공유받은 일정은 읽기 전용으로 내 목록에 들어와 내 폰에서도 알람이 울림
   - 계정은 버디플래너와 같은 Supabase 프로젝트를 함께 씀 (카카오 로그인)
   ========================================= */

const Cloud = {
  SESSION_KEY: 'mp_cloud_session',
  DIRTY_KEY: 'mp_sync_dirty',      // 아직 못 올린 내 변경 { id: { at, del } } (로그아웃 중에도 기록)
  LAST_KEY: 'mp_sync_last',
  status: 'off',                   // off | signed_out | syncing | synced | offline | error | no_server
  families: [],                    // [{ id, name, invite_code, members: [{ user_id, display_name, role }] }]
  shares: [],                      // 내가 보낸 공유 [{ schedule_id, target_id }]
  _syncing: null,

  /* ---------- 설정 ---------- */
  cfg() {
    let url = Routes.key('SUPABASE_URL');
    if (!url) {
      // 경로 서버 주소(https://xxx.supabase.co/functions/v1/…)에서 프로젝트 주소를 알아냄
      const m = Routes.key('ROUTE_PROXY_URL').match(/^(https:\/\/[^/]+\.supabase\.co)/);
      if (m) url = m[1];
    }
    return { url: url.replace(/\/+$/, ''), key: Routes.key('SUPABASE_ANON_KEY') };
  },
  isConfigured() { const c = this.cfg(); return !!(c.url && c.key); },
  session() { try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch (e) { return null; } },
  isSignedIn() { return !!this.session(); },
  userId() { const s = this.session(); return s && s.user && s.user.id; },
  myName() { const s = this.session(); return (State.settings.name || (s && s.user && s.user.name) || '나').slice(0, 30); },
  isNative() { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); },

  async init() {
    if (!this.isConfigured()) { this.status = 'off'; return; }
    const back = (await this._consumeKakaoCode()) || this._consumeRedirect();
    this.status = this.isSignedIn() ? 'synced' : 'signed_out';
    if (back) U.toast('카카오 로그인 완료 — 일정을 맞추는 중…');
    if (this.isSignedIn()) this.sync().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isSignedIn() && Date.now() - (+localStorage.getItem(this.LAST_KEY) || 0) > 60000) this.sync().catch(() => {});
    });
    window.addEventListener('online', () => this.isSignedIn() && this.sync().catch(() => {}));
  },

  /* ---------- 인증 ---------- */
  _save(data, user) {
    if (!data || !data.access_token) throw new Error('세션 정보가 없어요');
    const prev = this.session() || {};
    let u = data.user || user;
    // 웹 카카오 로그인 직후처럼 사용자 정보가 아직 없으면 토큰 안의 사용자 id(sub)를 바로 씀
    if (!u && !(prev.user && prev.user.id)) { const sub = this._jwtSub(data.access_token); if (sub) u = { id: sub }; }
    const s = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || prev.refresh_token,
      expires_at: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
      user: u ? { id: u.id, name: (u.user_metadata && (u.user_metadata.name || u.user_metadata.full_name || u.user_metadata.nickname)) || '' } : prev.user
    };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(s));
    return s;
  },

  _jwtSub(t) {
    try {
      const p = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p + '==='.slice((p.length + 3) % 4))))).sub || null;
    } catch (e) { return null; }
  },

  async _auth(path, body) {
    const { url, key } = this.cfg();
    const res = await U.fetchT(`${url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.msg || data.error_description || data.message || `로그인 실패 (${res.status})`); e.status = res.status; throw e; }
    return data;
  },

  async _kakaoLogin(idToken, web) {
    const { url, key } = this.cfg();
    const res = await U.fetchT(`${url}/functions/v1/myplanner-kakao-login`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(web || { id_token: idToken }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `로그인 실패 (${res.status})`);
    return data;
  },

  /** 카카오 로그인: 앱은 카카오 SDK → ID 토큰, 웹은 카카오 로그인 페이지로 이동 */
  async signInKakao() {
    if (!this.isConfigured()) return U.toast('서버 설정이 없어요 (설정 > 개발자 설정)');
    const K = this.isNative() && window.Capacitor.Plugins && (window.Capacitor.Plugins.CapacitorKakaoLogin
      || (window.Capacitor.registerPlugin && window.Capacitor.registerPlugin('CapacitorKakaoLogin')));
    if (K && K.login) {
      try {
        if (K.initialize && !this._kakaoReady) {
          await K.initialize({ appKey: Routes.key('KAKAO_NATIVE_APP_KEY') });
          this._kakaoReady = true;
        }
        const r = await K.login();
        if (!r || !r.idToken) throw new Error('카카오 ID 토큰이 없어요 (카카오 디벨로퍼스에서 OpenID Connect를 켜 주세요)');
        // 마이플래너 앱 키로 받은 토큰은 전용 서버 함수가 확인 (Supabase 카카오 설정 칸은 버디플래너 키 하나만 받음)
        const data = await this._kakaoLogin(r.idToken);
        this._save(data);
        this.status = 'synced';
        U.toast('로그인했어요');
        await this.sync();
      } catch (e) { U.toast('카카오 로그인 실패: ' + (e.message || e)); }
      return;
    }
    const back = location.origin + location.pathname;
    // 로그인하고 돌아오면 누른 화면(예: AI 비서)으로 바로 돌아가게
    try { if (typeof App !== 'undefined' && App.current && !['start', 'welcome'].includes(App.current)) sessionStorage.setItem('mp_after_login', App.current); } catch (e) {}
    const rest = Routes.key('KAKAO_REST_KEY');
    if (rest) {
      // 웹: 앱과 같은 '마이플래너' 카카오 앱으로 로그인 → 돌아온 code를 서버 함수가 ID 토큰으로 바꿔 확인 (앱과 같은 계정)
      const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      const state = rnd(), nonce = rnd();
      // 홈 화면에 추가한 앱은 …/index.html로 열림 → 카카오·서버에 등록한 …/ 주소로 맞춤
      const webBack = location.origin + location.pathname.replace(/index\.html$/, '');
      try { sessionStorage.setItem('mp_kakao_state', JSON.stringify({ state, nonce, back: webBack })); } catch (e) {}
      location.href = `https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(rest)}&redirect_uri=${encodeURIComponent(webBack)}`
        + `&response_type=code&state=${state}&nonce=${nonce}`;
      return;
    }
    // (예전 방식) Supabase 카카오 설정으로 로그인 — 웹용 카카오 키를 넣기 전까지만
    const { url } = this.cfg();
    location.href = `${url}/auth/v1/authorize?provider=kakao&redirect_to=${encodeURIComponent(back)}`;
  },

  /** 웹: 카카오 로그인에서 ?code=…&state=…로 돌아온 경우 → 서버 함수로 로그인 */
  async _consumeKakaoCode() {
    const q = new URLSearchParams(location.search);
    if (!q.has('state') || !(q.has('code') || q.has('error'))) return false;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('mp_kakao_state') || 'null'); sessionStorage.removeItem('mp_kakao_state'); } catch (e) {}
    const code = q.get('code'), err = q.get('error'), state = q.get('state');
    ['code', 'state', 'error', 'error_description'].forEach(k => q.delete(k));
    history.replaceState(null, document.title, location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    const fail = (msg) => { try { localStorage.removeItem('mp_start_seen'); } catch (e) {} setTimeout(() => U.toast(msg), 300); return false; };
    if (err) return fail(err === 'access_denied' ? '카카오 로그인을 취소했어요.' : '카카오 로그인이 안 됐어요. 다시 눌러 주세요.');
    if (!saved || saved.state !== state) return fail('카카오 로그인이 안 됐어요. 다시 눌러 주세요.'); // 다른 곳에서 시작된 로그인은 받지 않음
    try {
      const data = await this._kakaoLogin(null, { code, redirect_uri: saved.back, nonce: saved.nonce });
      this._save(data);
      return true;
    } catch (e) { return fail('카카오 로그인 실패: ' + (e.message || e)); }
  },

  _consumeRedirect() {
    const h = location.hash || '';
    if (/[#&]error=/.test(h)) { // 카카오·서버 로그인 실패로 돌아온 경우: 말없이 넘어가지 않고 로그인 화면으로
      history.replaceState(null, document.title, location.pathname + location.search);
      try { localStorage.removeItem('mp_start_seen'); } catch (e) {}
      setTimeout(() => U.toast('카카오 로그인이 안 됐어요. 다시 눌러 주세요.'), 300);
      return false;
    }
    if (h.indexOf('access_token=') < 0) return false;
    const p = new URLSearchParams(h.slice(1));
    try {
      this._save({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
        expires_at: +p.get('expires_at') || null, expires_in: +p.get('expires_in') || 3600 });
      history.replaceState(null, document.title, location.pathname + location.search);
      this._api('auth/v1/user').then(u => { if (u) this._save({ ...this.session(), expires_at: this.session().expires_at / 1000 }, u); }).catch(() => {});
      return true;
    } catch (e) { return false; }
  },

  async _token() {
    const s = this.session();
    if (!s) throw new Error('로그인이 필요해요');
    if (Date.now() < s.expires_at - 60000) return s.access_token;
    try {
      return this._save(await this._auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token })).access_token;
    } catch (e) {
      // 서버가 '이 로그인은 더 못 씀'이라고 답한 경우만 로그아웃 (느린 인터넷·서버 오류로는 로그인 유지)
      if (e.status === 400 || e.status === 401) { localStorage.removeItem(this.SESSION_KEY); this.status = 'signed_out'; }
      throw e;
    }
  },

  async _api(path, opts = {}) {
    const { url, key } = this.cfg();
    const headers = Object.assign({ apikey: key, Authorization: `Bearer ${await this._token()}` }, opts.headers || {});
    let body = opts.body;
    if (body !== undefined && typeof body !== 'string') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const res = await U.fetchT(`${url}/${path}`, { method: opts.method || 'GET', headers, body });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.message || j.msg || text; } catch (e) {}
      const err = new Error(msg.slice(0, 200)); err.status = res.status;
      // 테이블이 아직 없음 (서버 설정 전)
      if (res.status === 404 || /does not exist|schema cache/i.test(msg)) { err.noServer = true; this.status = 'no_server'; }
      throw err;
    }
    return text ? JSON.parse(text) : null;
  },

  rpc(fn, args) { return this._api(`rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} }); },

  async signOut() {
    try { if (this.isSignedIn()) await this._api('auth/v1/logout', { method: 'POST' }); } catch (e) {}
    localStorage.removeItem(this.SESSION_KEY);
    // 다음에 로그인하면 '처음 로그인'처럼 기기 일정을 다시 맞춤. 못 올린 변경(지운 일정 포함)은 남겨 둠
    localStorage.removeItem(this.LAST_KEY);
    // 공유받은 일정은 이 계정 것이라 지움 (내 일정은 기기에 남김)
    State.schedules = State.schedules.filter(s => !s._shared);
    State.save();
    this.families = []; this.shares = [];
    this.status = 'signed_out';
    await Alarm.rescheduleAll();
  },

  /* ---------- 동기화 ---------- */
  /** 바뀐 일정 기록: 그 일정의 수정 시각(지웠으면 지운 시각)을 함께 저장 → 올리는 중에 또 고쳐도 놓치지 않음 */
  markDirty(id) {
    const d = this._dirty();
    const s = State.get(id);
    d[id] = s ? { at: s.updatedAt || Date.now() } : { at: Date.now(), del: true };
    this._setDirty(d);
    if (!this.isSignedIn()) return; // 로그아웃 중이면 기록만 → 다음 로그인 때 올림
    clearTimeout(this._t);
    this._t = setTimeout(() => this.push().catch(() => {}), 1500);
  },
  /** { id: { at, del } } — 예전 형식(id 배열)도 읽음 */
  _dirty() {
    try {
      const v = JSON.parse(localStorage.getItem(this.DIRTY_KEY) || '{}');
      if (Array.isArray(v)) { const o = {}; v.forEach(id => { o[id] = { at: 0 }; }); return o; }
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  },
  _setDirty(d) { localStorage.setItem(this.DIRTY_KEY, JSON.stringify(d)); },

  /** 서버로 보낼 일정 (기기 전용 값은 뺌: 실시간 교통·날씨) */
  _wire(s) {
    const { live, weather, _shared, ...rest } = s;
    return rest;
  },

  sync() {
    if (!this.isConfigured() || !this.isSignedIn()) return Promise.resolve(false);
    if (this._syncing) return this._syncing;
    this.status = 'syncing';
    this._syncing = (async () => {
      try {
        const changed = await this.pull();
        await this.push();
        await this.loadFamilies();
        localStorage.setItem(this.LAST_KEY, String(Date.now()));
        this.status = 'synced';
        if (changed) {
          await Alarm.rescheduleAll();
          if (['home', 'calendar', 'timeline', 'settings'].includes(App.current)) App.navigate(App.current, App.params);
        }
        return true;
      } catch (e) {
        if (!e.noServer) this.status = navigator.onLine === false ? 'offline' : 'error';
        console.warn('[Cloud] 동기화 실패', e);
        throw e;
      } finally { this._syncing = null; if (App.current === 'settings') Settings.cloudCard(); }
    })();
    return this._syncing;
  },

  /** 서버 → 기기: 내 일정(더 최신만) + 공유받은 일정(통째로 교체). 바뀌었으면 true */
  async pull() {
    const me = this.userId();
    const rows = await this._api('rest/v1/mp_schedules?select=owner_id,id,data,deleted,updated_at') || [];
    const firstTime = !localStorage.getItem(this.LAST_KEY);
    let changed = false;
    if (!me) throw new Error('로그인 정보를 다시 확인하는 중이에요');
    const mine = rows.filter(r => r.owner_id === me);
    const dirty = this._dirty();
    let dirtyChanged = false;
    for (const r of mine) {
      const local = State.get(r.id);
      if (local && local._shared) continue;
      // 지운 줄은 지운 시각, 아니면 마지막 수정 시각 — '나중에 바꾼 쪽'이 이김
      const remoteAt = r.deleted ? (Date.parse(r.updated_at) || 0) : ((r.data && r.data.updatedAt) || Date.parse(r.updated_at) || 0);
      const q = dirty[r.id];
      if (q) {
        if (q.at && remoteAt <= q.at) continue;          // 아직 못 올린 내 변경이 더 최신
        if (!q.at && (r.deleted || !local)) continue;     // 예전 형식 기록: 내 변경 우선
        if (q.at) { delete dirty[r.id]; dirtyChanged = true; } // 다른 기기에서 더 나중에 바꿈 → 그쪽으로
        else continue;
      }
      if (r.deleted) {
        if (local) { State.schedules = State.schedules.filter(s => s.id !== r.id); changed = true; }
        continue;
      }
      if (!local || remoteAt > (local.updatedAt || 0)) {
        const data = U.cleanSchedule({ ...r.data, id: r.id });
        if (!data || data.id !== r.id) continue; // 깨진 줄은 건너뜀
        const keep = local ? { live: local.live, weather: local.weather } : {};
        State.putRaw({ ...data, ...keep, id: r.id });
        changed = true;
      }
    }
    // 처음 로그인: 기기에만 있던 일정을 모두 올림
    if (firstTime) {
      const onServer = new Set(mine.filter(r => !r.deleted).map(r => r.id));
      State.schedules.filter(s => !s._shared && !s.demo && !onServer.has(s.id) && !dirty[s.id])
        .forEach(s => { dirty[s.id] = { at: s.updatedAt || Date.now() }; dirtyChanged = true; });
    }
    if (dirtyChanged) this._setDirty(dirty);
    // 공유받은 일정: 서버에 있는 그대로 (내 폰의 알람 끄기·실시간 값은 유지)
    const sharedRows = rows.filter(r => r.owner_id !== me && !r.deleted);
    const prevShared = new Map(State.schedules.filter(s => s._shared).map(s => [s.id, s]));
    const names = await this._names(sharedRows.map(r => r.owner_id));
    const SAFE = /^[\w\-.]{1,120}$/;
    const nextShared = sharedRows.filter(r => SAFE.test(String(r.owner_id)) && SAFE.test(String(r.id))).map(r => {
      const p = prevShared.get(r.owner_id + ':' + r.id);
      const data = U.cleanSchedule(r.data, { keepId: false });
      if (!data) return null;
      return { ...data, id: r.owner_id + ':' + r.id, alarmOff: p ? p.alarmOff : false, live: p && p.live, weather: p && p.weather,
        _shared: { ownerId: r.owner_id, scheduleId: r.id, from: String(names[r.owner_id] || '가족').slice(0, 20) } };
    }).filter(Boolean);
    const sig = a => JSON.stringify(a.map(s => [s.id, s.updatedAt]).sort());
    if (sig([...prevShared.values()]) !== sig(nextShared)) changed = true;
    State.schedules = State.schedules.filter(s => !s._shared).concat(nextShared);
    State.save(true);
    return changed;
  },

  async _names(ids) {
    ids = [...new Set(ids)];
    if (!ids.length) return {};
    const out = {};
    try {
      const rows = await this._api(`rest/v1/mp_family_members?select=user_id,display_name&user_id=in.(${ids.join(',')})`) || [];
      rows.forEach(r => { if (r.display_name) out[r.user_id] = r.display_name; });
    } catch (e) {}
    return out;
  },

  /** 기기 → 서버: 바뀐 내 일정만 (지운 일정은 deleted 표시) */
  async push() {
    const dirty = this._dirty();
    const ids = Object.keys(dirty);
    if (!ids.length || !this.isSignedIn()) return;
    const me = this.userId();
    if (!me) return;
    const rows = ids.map(id => {
      const s = State.get(id);
      if (s && (s._shared || s.demo)) return null; // 예시 일정은 서버에 올리지 않음
      if (!s && String(id).includes(':')) return null; // 공유받은 일정 id
      const at = dirty[id].at || Date.now();
      return s ? { owner_id: me, id, data: this._wire(s), deleted: false, updated_at: new Date(s.updatedAt || at).toISOString() }
        : { owner_id: me, id, data: { id, updatedAt: at }, deleted: true, updated_at: new Date(at).toISOString() };
    }).filter(Boolean);
    if (rows.length) {
      await this._api('rest/v1/mp_schedules?on_conflict=owner_id,id', {
        method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
    }
    // 올린 그 버전 그대로인 것만 지움 (올리는 동안 또 고친 일정은 다음에 다시 올림)
    const now = this._dirty();
    ids.forEach(id => { if (now[id] && dirty[id] && now[id].at === dirty[id].at && !!now[id].del === !!dirty[id].del) delete now[id]; });
    this._setDirty(now);
  },

  /* ---------- 가족 ---------- */
  async loadFamilies() {
    this.families = await this._api('rest/v1/mp_families?select=id,name,invite_code,mp_family_members(user_id,display_name,role)&order=created_at') || [];
    this.families.forEach(f => { f.members = f.mp_family_members || []; delete f.mp_family_members; });
    this.shares = await this._api(`rest/v1/mp_schedule_shares?select=schedule_id,target_id&owner_id=eq.${this.userId()}`) || [];
    return this.families;
  },

  /** 나 말고 가족 구성원 (여러 가족이면 합쳐서) */
  familyPeople() {
    const me = this.userId(), map = new Map();
    this.families.forEach(f => f.members.forEach(m => { if (m.user_id !== me && !map.has(m.user_id)) map.set(m.user_id, { ...m, family: f.name }); }));
    return [...map.values()];
  },

  async createFamily(name) {
    const r = await this.rpc('mp_create_family', { p_name: name, p_display: this.myName() });
    await this.loadFamilies();
    return r;
  },
  async joinFamily(code) {
    const r = await this.rpc('mp_join_family', { p_code: code, p_display: this.myName() });
    await this.loadFamilies();
    return r;
  },
  async leaveFamily(id) {
    await this.rpc('mp_leave_family', { p_family: id });
    await this.loadFamilies();
  },

  sharedTargets(scheduleId) { return this.shares.filter(x => x.schedule_id === scheduleId).map(x => x.target_id); },

  /** 일정을 고른 가족에게 공유 (targets = 공유할 사람 전체 목록) */
  async setShares(scheduleId, targets) {
    await this.push(); // 일정이 서버에 먼저 있어야 공유 가능
    const s = State.get(scheduleId);
    if (s && !s._shared) {
      await this._api('rest/v1/mp_schedules?on_conflict=owner_id,id', { method: 'POST',
        body: [{ owner_id: this.userId(), id: scheduleId, data: this._wire(s), deleted: false, updated_at: new Date().toISOString() }],
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    }
    const now = this.sharedTargets(scheduleId);
    const add = targets.filter(t => !now.includes(t)), del = now.filter(t => !targets.includes(t));
    if (add.length) await this._api('rest/v1/mp_schedule_shares', { method: 'POST',
      body: add.map(t => ({ owner_id: this.userId(), schedule_id: scheduleId, target_id: t })), headers: { Prefer: 'return=minimal' } });
    for (const t of del) await this._api(`rest/v1/mp_schedule_shares?owner_id=eq.${this.userId()}&schedule_id=eq.${encodeURIComponent(scheduleId)}&target_id=eq.${t}`, { method: 'DELETE' });
    await this.loadFamilies();
  },

  /** 마이플래너 서버 데이터 모두 삭제 (일정·공유·가족 참여) 후 로그아웃. 기기 일정은 남김
      ※ 카카오 계정 자체는 버디플래너와 함께 쓰므로 여기서는 지우지 않음 */
  async deleteMyData() {
    const me = this.userId();
    await this._api(`rest/v1/mp_schedule_shares?owner_id=eq.${me}`, { method: 'DELETE' });
    await this._api(`rest/v1/mp_schedule_shares?target_id=eq.${me}`, { method: 'DELETE' });
    await this._api(`rest/v1/mp_schedules?owner_id=eq.${me}`, { method: 'DELETE' });
    for (const f of this.families) await this.rpc('mp_leave_family', { p_family: f.id });
    localStorage.removeItem(this.LAST_KEY);
    await this.signOut();
  },

  /** 공유받은 일정 그만 받기 */
  async declineShare(s) {
    await this._api(`rest/v1/mp_schedule_shares?owner_id=eq.${s._shared.ownerId}&schedule_id=eq.${encodeURIComponent(s._shared.scheduleId)}&target_id=eq.${this.userId()}`, { method: 'DELETE' });
    State.schedules = State.schedules.filter(x => x.id !== s.id);
    State.save(true);
    await Alarm.rescheduleAll();
  }
};

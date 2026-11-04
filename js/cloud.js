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
  DIRTY_KEY: 'mp_sync_dirty',      // 아직 못 올린 내 일정 id
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

  init() {
    if (!this.isConfigured()) { this.status = 'off'; return; }
    const back = this._consumeRedirect();
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
    const u = data.user || user;
    const s = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || prev.refresh_token,
      expires_at: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
      user: u ? { id: u.id, name: (u.user_metadata && (u.user_metadata.name || u.user_metadata.full_name || u.user_metadata.nickname)) || '' } : prev.user
    };
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(s));
    return s;
  },

  async _auth(path, body) {
    const { url, key } = this.cfg();
    const res = await fetch(`${url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `로그인 실패 (${res.status})`);
    return data;
  },

  /** 카카오 로그인: 앱은 카카오 SDK → ID 토큰, 웹은 카카오 로그인 페이지로 이동 */
  async signInKakao() {
    if (!this.isConfigured()) return U.toast('서버 설정이 없어요 (설정 > 개발자 설정)');
    const K = this.isNative() && window.Capacitor.Plugins && (window.Capacitor.Plugins.CapacitorKakaoLogin
      || (window.Capacitor.registerPlugin && window.Capacitor.registerPlugin('CapacitorKakaoLogin')));
    if (K && K.login) {
      try {
        const r = await K.login();
        if (!r || !r.idToken) throw new Error('카카오 ID 토큰이 없어요 (카카오 디벨로퍼스에서 OpenID Connect를 켜 주세요)');
        const data = await this._auth('token?grant_type=id_token', { provider: 'kakao', id_token: r.idToken });
        this._save(data);
        this.status = 'synced';
        U.toast('로그인했어요');
        await this.sync();
      } catch (e) { U.toast('카카오 로그인 실패: ' + (e.message || e)); }
      return;
    }
    // 웹: Supabase가 카카오 로그인 후 이 주소로 돌려보냄 (Supabase 대시보드에 주소 등록 필요)
    const { url } = this.cfg();
    const back = location.origin + location.pathname;
    location.href = `${url}/auth/v1/authorize?provider=kakao&redirect_to=${encodeURIComponent(back)}`;
  },

  _consumeRedirect() {
    const h = location.hash || '';
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
      if (navigator.onLine !== false) { localStorage.removeItem(this.SESSION_KEY); this.status = 'signed_out'; }
      throw e;
    }
  },

  async _api(path, opts = {}) {
    const { url, key } = this.cfg();
    const headers = Object.assign({ apikey: key, Authorization: `Bearer ${await this._token()}` }, opts.headers || {});
    let body = opts.body;
    if (body !== undefined && typeof body !== 'string') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const res = await fetch(`${url}/${path}`, { method: opts.method || 'GET', headers, body });
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
    localStorage.removeItem(this.DIRTY_KEY);
    // 공유받은 일정은 이 계정 것이라 지움 (내 일정은 기기에 남김)
    State.schedules = State.schedules.filter(s => !s._shared);
    State.save();
    this.families = []; this.shares = [];
    this.status = 'signed_out';
    await Alarm.rescheduleAll();
  },

  /* ---------- 동기화 ---------- */
  markDirty(id) {
    if (!this.isSignedIn()) return;
    const d = this._dirty();
    if (!d.includes(id)) { d.push(id); localStorage.setItem(this.DIRTY_KEY, JSON.stringify(d)); }
    clearTimeout(this._t);
    this._t = setTimeout(() => this.push().catch(() => {}), 1500);
  },
  _dirty() { try { return JSON.parse(localStorage.getItem(this.DIRTY_KEY) || '[]'); } catch (e) { return []; } },

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
    const mine = rows.filter(r => r.owner_id === me);
    const dirty = this._dirty();
    for (const r of mine) {
      const local = State.get(r.id);
      if (r.deleted) {
        if (local && !local._shared) { State.schedules = State.schedules.filter(s => s.id !== r.id); changed = true; }
        continue;
      }
      const remoteAt = (r.data && r.data.updatedAt) || Date.parse(r.updated_at) || 0;
      if (!local || (!dirty.includes(r.id) && remoteAt > (local.updatedAt || 0))) {
        const keep = local ? { live: local.live, weather: local.weather } : {};
        State.putRaw({ ...r.data, ...keep, id: r.id });
        changed = true;
      }
    }
    // 처음 로그인: 기기에만 있던 일정을 모두 올림
    if (firstTime) {
      const onServer = new Set(mine.map(r => r.id));
      State.schedules.filter(s => !s._shared && !s.demo && !onServer.has(s.id)).forEach(s => dirty.push(s.id));
      localStorage.setItem(this.DIRTY_KEY, JSON.stringify([...new Set(dirty)]));
    }
    // 공유받은 일정: 서버에 있는 그대로 (내 폰의 알람 끄기·실시간 값은 유지)
    const sharedRows = rows.filter(r => r.owner_id !== me && !r.deleted);
    const prevShared = new Map(State.schedules.filter(s => s._shared).map(s => [s.id, s]));
    const names = await this._names(sharedRows.map(r => r.owner_id));
    const nextShared = sharedRows.map(r => {
      const p = prevShared.get(r.owner_id + ':' + r.id);
      return { ...r.data, id: r.owner_id + ':' + r.id, alarmOff: p ? p.alarmOff : false, live: p && p.live, weather: p && p.weather,
        _shared: { ownerId: r.owner_id, scheduleId: r.id, from: names[r.owner_id] || '가족' } };
    });
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
    if (!dirty.length || !this.isSignedIn()) return;
    const me = this.userId();
    const rows = dirty.map(id => {
      const s = State.get(id);
      if (s && (s._shared || s.demo)) return null; // 예시 일정은 서버에 올리지 않음
      return s ? { owner_id: me, id, data: this._wire(s), deleted: false, updated_at: new Date().toISOString() }
        : { owner_id: me, id, data: { id }, deleted: true, updated_at: new Date().toISOString() };
    }).filter(Boolean);
    if (rows.length) {
      await this._api('rest/v1/mp_schedules?on_conflict=owner_id,id', {
        method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
      });
    }
    const left = this._dirty().filter(id => !dirty.includes(id));
    localStorage.setItem(this.DIRTY_KEY, JSON.stringify(left));
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

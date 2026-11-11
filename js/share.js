/* =========================================
   MyPlanner — 링크로 일정 보내기 (로그인 없이)
   일정을 링크에 담아 카톡 등으로 보내면, 받은 사람이 링크를 눌러(또는 붙여넣어)
   자기 폰 알람에 추가합니다. 서버를 거치지 않고 링크 안에 일정이 들어 있음.
   ========================================= */

const Share = {
  WEB: 'https://ktj8824-stack.github.io/myplanner/',   // 앱 안에서 만든 링크도 웹으로 열리게

  b64e(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  b64d(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  },

  /** 링크에 넣을 일정 (기기 전용·개인 값은 뺌) */
  pack(s, opt = {}) {
    const keep = ['title', 'date', 'arriveBy', 'mode', 'prepMin', 'bufferMin', 'origin', 'dest', 'route', 'trip',
      'accessRoute', 'egressRoute', 'repeat'];
    if (opt.memo) keep.push('memo');
    const o = { v: 1 };
    keep.forEach(k => { if (s[k] != null && s[k] !== '') o[k] = s[k]; });
    // 보낸 사람의 집(주소·좌표)은 넘기지 않음 → 받는 사람 집 기준으로 경로를 다시 찾음
    if (this.isHome(o.origin)) { delete o.origin; delete o.route; delete o.accessRoute; }
    if (o.repeat && o.repeat.type === 'none') delete o.repeat;
    return this.b64e(JSON.stringify(o));
  },

  isHome(p) {
    const h = typeof State !== 'undefined' && State.settings && State.settings.home;
    if (!p) return false;
    if (h && p.lat != null && Math.abs(h.lat - p.lat) < 0.002 && Math.abs(h.lng - p.lng) < 0.002) return true;
    return /^(우리\s*)?집$/.test(String(p.name || '').trim());
  },

  baseUrl() {
    const isWeb = /^https?:$/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname);
    return isWeb ? location.origin + location.pathname : this.WEB;
  },
  link(s, opt) { return this.baseUrl() + '#mp=' + this.pack(s, opt); },

  /** 글 안에서 마이플래너 일정 링크 찾기 → 일정 객체 (없으면 null) */
  detect(text) {
    const m = String(text || '').match(/#mp=([A-Za-z0-9_-]{20,})/);
    if (!m) return null;
    try {
      const raw = JSON.parse(this.b64d(m[1]));
      if (!raw || raw.v !== 1 || !raw.title || !raw.date || !raw.mode || !Planner.MODES[raw.mode]) return null;
      // 링크에 넣는 값만, 안전한 모양으로 (실시간 교통·공유 표시 같은 값은 받지 않음)
      const o = U.cleanSchedule(raw, { keepId: false });
      if (!o) return null;
      ['skips', 'overrides', 'alarm', 'alarmOff', 'chained', 'goHome', 'pack', 'packDone', 'updatedAt', 'endBy'].forEach(k => delete o[k]);
      if (!raw.repeat || raw.repeat.type === 'none') delete o.repeat;
      return o;
    } catch (e) { return null; }
  },

  /** 보내기: 휴대폰 공유창(카톡 등) → 안 되면 복사 */
  async send(id) {
    const s = Recur.resolve(id);
    if (!s) return;
    const base = State.get(s.baseId || s.id) || s;
    const plan = Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const when = Planner.isTrip(s.mode) ? `${s.trip.departTime} ${m.label} 출발` : `${s.arriveBy} 도착`;
    const text = `[마이플래너] ${s.title}\n${U.dateLabel(s.date).split(' · ')[0]} ${when}${s.dest ? ' · ' + s.dest.name : ''}\n`
      + `⏰ 기상 ${U.hm(plan.wakeAt)} · 🚪 출발 ${U.hm(plan.departAt)} (${m.label})\n`
      + `링크를 누르면 내 폰 알람에 추가돼요 👇`;
    // 이 날 바뀐 시간(이 날만 변경)이 링크에도 그대로 들어가도록 회차 값으로. 반복은 원본 규칙 유지
    // 메모는 개인 내용일 수 있어서 물어보고 넣음
    const memo = !!(s.memo && String(s.memo).trim()) && confirm(`메모도 같이 보낼까요?\n\n"${String(s.memo).slice(0, 60)}"`);
    const url = this.link({ ...s, repeat: base.repeat, date: s.date }, { memo });
    try {
      if (navigator.share) { await navigator.share({ title: s.title, text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      U.toast('링크를 복사했어요. 카톡에 붙여넣어 보내 주세요');
    } catch (e) {
      Sheet.open(`<div class="sheet-head"><b>링크 복사</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
        <textarea class="input paste-area" readonly onclick="this.select()">${U.esc(text + '\n' + url)}</textarea>
        <p class="muted small">길게 눌러 복사한 뒤 카톡에 붙여넣으세요.</p>`);
    }
  },

  /** 받은 일정 미리보기 → 내 일정 추가 화면으로 */
  openImport(o) {
    this._incoming = o;
    const m = Planner.MODES[o.mode];
    const home = State.settings.home;
    const plan = (() => { try { return Planner.compute({ ...o, alarm: {} }); } catch (e) { return null; } })();
    const sameHome = home && o.origin && Math.abs(home.lat - o.origin.lat) < 0.002 && Math.abs(home.lng - o.origin.lng) < 0.002;
    Sheet.open(`
      <div class="sheet-head"><b>받은 일정</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <div class="card import-card">
        <div class="muted small">${U.dateLabel(o.date)} · ${m.emoji} ${m.label}${o.repeat ? ' · 🔁 ' + U.esc(Recur.label(o)) : ''}</div>
        <div class="import-title">${U.esc(o.title)}</div>
        <div class="small">${o.origin ? '🏠 ' + U.esc(o.origin.name) + ' → ' : ''}${o.dest ? '🎯 ' + U.esc(o.dest.name) : ''}</div>
        ${plan && o.origin ? `<div class="small muted">기상 ${U.hm(plan.wakeAt)} · 출발 ${U.hm(plan.departAt)}</div>` : ''}
      </div>
      ${this.existing(o) ? `<p class="small">이미 내 일정에 있어요. 누르면 그 일정을 열어요.</p>` : ''}
      ${!o.origin ? `<p class="small">${home ? `내 집(<b>${U.esc(home.name)}</b>)에서 출발로 경로를 찾아요.` : '추가 화면에서 출발지를 골라 주세요.'}</p>` : ''}
      ${home && !sameHome && o.origin ? `
        <p class="small">출발지가 보낸 사람 기준(<b>${U.esc(o.origin.name)}</b>)이에요.</p>
        <button class="btn primary big" onclick="Share.accept(true)">🏠 내 집(${U.esc(home.name)})에서 출발로 추가</button>
        <button class="btn ghost" onclick="Share.accept(false)">${U.esc(o.origin.name)}에서 출발 그대로 추가</button>`
      : `<button class="btn primary big" onclick="Share.accept(false)">내 알람에 추가</button>`}
      <p class="muted small center">추가 화면에서 확인한 뒤 저장하면 알람이 맞춰져요.</p>
      ${this.quickNavHTML(o)}`);
  },

  /** 받은 일정 '바로 길안내': 로그인·추가 없이, 지금 있는 곳에서 목적지까지 */
  quickNavHTML(o) {
    const trip = Planner.isTrip(o.mode);
    const dest = trip ? (o.trip && o.trip.departStation) : o.dest;
    if (!dest || !isFinite(dest.lat) || !isFinite(dest.lng)) return '';
    const navMode = trip ? (o.trip.accessMode || 'transit') : o.mode;
    if (navMode === 'taxi') return '';
    const car = navMode === 'car';
    return `
      <div class="qnav">
        <div class="qnav-h">🚗 바로 길안내 <small>지금 있는 곳에서 출발해요 · 로그인 없이 돼요</small></div>
        <div class="qnav-to">📍 <b>${U.esc(dest.name || '목적지')}</b></div>
        <div class="qnav-b${car ? '' : ' one'}">
          ${car ? `<button class="qnav-btn tmap" onclick="Share.quickNav('tmap')">티맵</button>` : ''}
          <button class="qnav-btn kakao" onclick="Share.quickNav('kakaomap')">${car ? '카카오맵' : '카카오맵 길찾기'}</button>
        </div>
      </div>`;
  },
  quickNav(app) {
    const o = this._incoming; if (!o) return;
    const trip = Planner.isTrip(o.mode);
    Routes.openNav(app, trip ? (o.trip.accessMode || 'transit') : o.mode, null, trip ? o.trip.departStation : o.dest);
  },

  /** 같은 일정(이름·날짜·시각)이 이미 있으면 그 일정 */
  existing(o) {
    const t = x => Planner.isTrip(x.mode) ? (x.trip && x.trip.departTime) : x.arriveBy;
    return State.schedules.find(x => !x._shared && x.title === o.title && x.date === o.date && t(x) === t(o)) || null;
  },

  accept(useHome) {
    const o = this._incoming;
    if (!o) return;
    Sheet.close();
    const dup = this.existing(o);
    if (dup) { U.toast('이미 추가한 일정이에요'); return App.navigate('timeline', { id: dup.id }); }
    if (!o.origin) useHome = true;
    const st = State.settings;
    const draft = {
      ...o, id: U.uid(), alarm: { ...st.alarm }, skips: [], overrides: {},
      repeat: o.repeat || { type: 'none', days: [], until: '', skipHolidays: true },
      trip: o.trip || { accessMode: 'transit', egressMode: 'transit', departTime: '08:00', arriveTime: '', international: false }
    };
    delete draft.v;
    if (useHome && st.home) {
      draft.origin = { ...st.home };
      draft.route = null; draft.accessRoute = null; // 내 집 기준으로 경로 다시 찾기
    }
    App.navigate('register', { draft });
  },

  /** 앱이 링크로 열렸을 때 */
  fromLocation() {
    const o = this.detect(location.hash);
    if (!o) return false;
    history.replaceState(null, document.title, location.pathname + location.search);
    setTimeout(() => this.openImport(o), 300);
    return true;
  }
};

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
    const text = `⏰ [마이플래너] 약속 일정\n▪ 일정  ${s.title}\n▪ 일시  ${U.dateLabel(s.date).split(' · ')[0]} ${when}${s.dest ? `\n▪ 장소  ${s.dest.name}` : ''}\n`
      + `출발지만 고르면 출발 시간·알람이 맞춰져요\n\n▶ 눌러서 받기`;
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

  /** 받은 일정: 확인 + 단계 안내 ① 출발지 → ② 준비 시간 → ③ 이동 수단 → ④ 알람에 추가 (버디플래너와 같은 틀) */
  openImport(o) {
    this._incoming = o;
    const trip = Planner.isTrip(o.mode);
    // 받은 사람이 직접 고르게: 미리 골라 두지 않음 (기차·비행기는 이동 수단 단계 없음)
    this._g = { origin: null, originLabel: '', prep: null, mode: trip ? o.mode : null, trip };
    this.drawImport();
  },

  _row(icon, label, value) {
    return `<div class="ss-row"><span class="ss-i">${Icons.svg(icon)}</span><div><small>${label}</small><b>${U.esc(value)}</b></div></div>`;
  },

  _step() {
    const g = this._g || {};
    if (!g.origin) return 'origin';
    if (g.prep == null) return 'prep';
    if (!g.mode) return 'mode';
    return 'done';
  },

  drawImport(scroll) {
    const o = this._incoming; if (!o) return;
    const g = this._g;
    const m = Planner.MODES[o.mode];
    const trip = g.trip;
    const when = trip ? `${o.trip.departTime} ${m.label} 출발` : `${o.arriveBy} 도착`;
    const home = State.settings.home;
    const work = (State.settings.places || {})['회사'] || null;
    const now = this._step();
    const order = trip ? ['origin', 'prep'] : ['origin', 'prep', 'mode'];
    const ni = now === 'done' ? 99 : order.indexOf(now);
    const cls = (k) => { const i = order.indexOf(k); return i === ni ? 'now' : i < ni ? 'done' : 'wait'; };
    const num = (k) => { const i = order.indexOf(k); return i < ni ? '✓' : String(i + 1); };
    const P = [20, 30, 40, 50, 60, 70, 80, 90];
    const MODES = ['transit', 'car', 'taxi', 'walk'];
    const dup = this.existing(o);
    Sheet.open(`
      <div class="sheet-head"><b>공유받은 일정</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <div class="ss-rows">
        ${this._row('calendar', '일정', o.title)}
        ${this._row('alarm', '일시', `${U.dateLabel(o.date).split(' · ')[0]} ${when}`)}
        ${o.dest ? this._row('pin', trip ? '도착지' : '목적지', o.dest.name) : ''}
      </div>
      ${dup ? `<p class="small">이미 내 일정에 있어요. 고르고 추가하면 그 일정을 새 내용으로 바꿔요.</p>` : ''}
      <div class="rs-step ${cls('origin')}" id="mp-st-origin">
        <div class="rs-q"><em>${num('origin')}</em>어디서 출발하세요?</div>
        <div class="rs-now">출발지를 골라 주세요</div>
        <div class="seg">
          ${home ? `<button class="${g.originLabel === '집' ? 'on' : ''}" onclick="Share.pickOrigin('home')">집</button>` : ''}
          ${work ? `<button class="${g.originLabel === '회사' ? 'on' : ''}" onclick="Share.pickOrigin('work')">회사</button>` : ''}
          <button class="${g.originLabel === '직접' ? 'on' : ''}" onclick="Share.pickOrigin('custom')">${g.originLabel === '직접' && g.origin ? U.esc(g.origin.name) : '직접 입력'}</button>
        </div>
      </div>
      <div class="rs-step ${cls('prep')}" id="mp-st-prep">
        <div class="rs-q"><em>${num('prep')}</em>나가기 전 준비 시간</div>
        <div class="rs-now">준비 시간을 골라 주세요</div>
        <div class="seg">${P.map(v => `<button class="${g.prep === v ? 'on' : ''}" onclick="Share.pickPrep(${v})">${v}분</button>`).join('')}</div>
      </div>
      ${trip ? '' : `<div class="rs-step ${cls('mode')}" id="mp-st-mode">
        <div class="rs-q"><em>${num('mode')}</em>무엇을 타고 가세요?</div>
        <div class="rs-now">이동 수단을 골라 주세요</div>
        <div class="seg">${MODES.map(k => `<button class="${g.mode === k ? 'on' : ''}" onclick="Share.pickMode('${k}')">${Icons.svg(Icons.mode ? Icons.mode(k) : k)} ${Planner.MODES[k].label}</button>`).join('')}</div>
      </div>`}
      <div class="rs-go ${now === 'done' ? 'show' : ''}"><em>${order.length + 1}</em>다 됐어요! 아래 버튼을 눌러 주세요</div>
      <button class="btn primary big ${now === 'done' ? 'rs-ready' : ''}" id="mp-accept" onclick="Share.acceptGuided()">내 알람에 추가</button>
      ${this.quickNavHTML(o)}`);
    if (scroll) setTimeout(() => {
      const t = now === 'done' ? document.getElementById('mp-accept') : document.getElementById('mp-st-' + now);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: now === 'done' ? 'center' : 'start' });
    }, 120);
  },

  pickOrigin(k) {
    const g = this._g; if (!g) return;
    const first = !g.origin;
    if (k === 'home' && State.settings.home) { g.origin = { ...State.settings.home }; g.originLabel = '집'; return this.drawImport(first); }
    if (k === 'work') { const w = (State.settings.places || {})['회사']; if (w) { g.origin = { ...w }; g.originLabel = '회사'; return this.drawImport(first); } }
    PlacePicker.open('출발지 검색', (p) => {
      if (p) { g.origin = { name: p.name, address: p.address || '', lat: p.lat, lng: p.lng }; g.originLabel = '직접'; }
      setTimeout(() => this.drawImport(!!p), 50);
    });
  },
  pickPrep(v) { const g = this._g; const first = g.prep == null; g.prep = v; this.drawImport(first); },
  pickMode(k) { const g = this._g; const first = !g.mode; g.mode = k; this.drawImport(first); },

  acceptGuided() {
    const o = this._incoming, g = this._g;
    if (!o || !g) return;
    const st = this._step();
    const msg = { origin: '① 출발지를 골라 주세요', prep: '② 준비 시간을 골라 주세요', mode: '③ 이동 수단을 골라 주세요' }[st];
    if (msg) { U.toast(msg); return this.drawImport(true); }
    Sheet.close();
    const dup = this.existing(o);
    const s = State.settings;
    const draft = {
      ...o, id: dup ? dup.id : U.uid(), alarm: { ...s.alarm }, skips: [], overrides: {},
      repeat: o.repeat || { type: 'none', days: [], until: '', skipHolidays: true },
      trip: o.trip || { accessMode: 'transit', egressMode: 'transit', departTime: '08:00', arriveTime: '', international: false },
      origin: { ...g.origin }, prepMin: g.prep, mode: g.mode, route: null, accessRoute: null, _fromShare: true
    };
    delete draft.v;
    App.navigate('register', { draft });
  },

  /* 예전 방식 (이전 링크 호환용으로 남김) */
  openImportOld(o) {
    this._incoming = o;
    const m = Planner.MODES[o.mode];
    const home = State.settings.home;
    const plan = (() => { try { return Planner.compute({ ...o, alarm: {} }); } catch (e) { return null; } })();
    Sheet.open(`<div class="sheet-head"><b>받은 일정</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <div class="card import-card"><div class="import-title">${U.esc(o.title)}</div></div>
      <button class="btn primary big" onclick="Share.accept(${!!home})">내 알람에 추가</button>${plan ? '' : ''}${m ? '' : ''}`);
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
        <div class="qnav-h">${Icons.svg('car')} 바로 길안내 <small>지금 있는 곳에서 출발해요 · 로그인 없이 돼요</small></div>
        <div class="qnav-to">${Icons.svg('pin')} <b>${U.esc(dest.name || '목적지')}</b></div>
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

  /** 받은 일정을 저장한 뒤 (웹): 앱 설치(추천) · 홈 화면에 추가 */
  PLAY_ID: 'kr.myplanner.app',
  offer(id) {
    const s = State.get(id); if (!s) return;
    const ua = navigator.userAgent || '';
    const android = /Android/i.test(ua);
    Sheet.open(`
      <div class="ha-ok">${Icons.svg('check')}</div>
      <h3 class="center" style="margin:6px 0 2px">일정을 저장했어요</h3>
      <p class="muted small center" style="margin-bottom:14px">${U.esc(U.dateLabel(s.date).split(' · ')[0])} · ${U.esc(s.title)}</p>
      <button class="ha-opt on" onclick="Share.installApp()"><span class="i">${Icons.svg('bell')}</span><div><b>앱 설치하고 받기 <em>추천</em></b><small>기상·출발 알람 · 자동 길안내</small></div><span class="go">›</span></button>
      <button class="ha-opt" onclick="Share.addHome()"><span class="i">${Icons.svg('home')}</span><div><b>홈 화면에 추가</b><small>아이콘 누르면 바로 열려요</small></div><span class="go">›</span></button>
      <button class="ha-later" onclick="Sheet.close()">나중에 할게요</button>`);
  },
  installApp() {
    const android = /Android/i.test(navigator.userAgent || '');
    if (android) location.href = 'https://play.google.com/store/apps/details?id=' + this.PLAY_ID;
    else U.toast('아이폰 앱은 곧 나와요. 지금은 홈 화면에 추가해 주세요');
  },
  addHome() {
    const ios = /iPhone|iPad/i.test(navigator.userAgent || '');
    Sheet.open(`<div class="sheet-head"><b>홈 화면에 추가</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <p>${ios ? '아래 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 눌러 주세요.' : '오른쪽 위 <b>⋮ 메뉴</b> → <b>홈 화면에 추가</b>를 눌러 주세요.'}</p>`);
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
